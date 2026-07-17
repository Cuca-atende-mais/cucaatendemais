# Auditoria — `meta_adapter_inbound.py` + `meta_adapter_outbound.py` (foco correção/segurança/performance/testes/tech-debt)

**Data:** 2026-07-17
**Autor:** Auditoria independente (João/sócio + Claude Code), não-implementação — este documento reporta diagnóstico, não aplica fixes.
**Escopo:** `worker/meta_adapter_inbound.py` (784 linhas) + `worker/meta_adapter_outbound.py` (160 linhas) — a camada de transporte Meta WhatsApp Cloud API compartilhada pelos canais Institucional e Empregabilidade: recepção de webhook, validação HMAC, dedupe por `wamid`, debounce de dispatch, download de mídia, transbordo pra atendente humano, envio de mensagem. Quarta rodada de auditoria do projeto (depois de Institucional/`motor-agente`, Empregabilidade/motor de estados, currículo/banco de talentos).
**Fora de escopo nesta rodada:** `worker/main.py` (só foi lido o suficiente pra confirmar 2 coisas pontuais: que a validação HMAC é realmente obrigatória antes do processamento, e o comparador de `verify_token`); tudo relacionado ao canal Ouvidoria (`salvar_manifestacao_ouvidoria`, `main.py:190-275`) — deixado pra uma rodada futura por pedido explícito.
**Método:** leitura completa dos 2 arquivos-fonte + 2 arquivos de teste (4 subagents paralelos, um por categoria, mais vetting pessoal — confirmei a existência da migração SQL citada no achado #2 antes de incluir aqui).
**Ferramenta usada:** skill `improve`, mesma das três rodadas anteriores.

**Nota sobre esta entrega**: sem `plans/` de novo — mesma decisão das três rodadas anteriores, diagnóstico completo pro Claude do Valmir avaliar e priorizar.

**Avaliação geral, antes dos achados**: este par de arquivos está em condição bem melhor que os três alvos anteriores. O código é fartamente documentado — várias decisões não-óbvias (por que o debounce só funciona com processo único, por que `awaiting_human` é checado duas vezes, por que uma falha parcial no envio de partes da resposta aborta em vez de tentar de novo) já vêm explicadas em comentário, e a maioria se sustenta na leitura. A suíte de teste é a mais robusta do projeto (1332 + 672 linhas de teste pra 784 + 160 de código-fonte — contraste direto com os três alvos anteriores, que não tinham teste nenhum). A validação HMAC do webhook está correta e é realmente obrigatória. Por isso esta rodada tem uma lista mais curta e de severidade mais baixa — não forcei achado pra preencher quota.

---

## Diagnóstico

### 🔴 Achados de maior severidade/leverage

#### PERF-01 — 14 chamadas síncronas ao Supabase no arquivo com maior volume de tráfego de todo o projeto

**Arquivo:** `meta_adapter_inbound.py` — 14 pontos (`:29`/`:538`, `:340`, `:357`, `:383`, `:387`, `:401`, `:552`, `:582`, `:587`, `:604`, `:615`, `:626`, `:641`, `:697`, `:771`), nenhum usando `asyncio.to_thread`

Mesmo padrão já achado nas três rodadas anteriores (`empregabilidade_engine.py`, `cv_processor.py`, `talent_bank_matcher.py`) — mas aqui merece destaque próprio porque **este é o único arquivo por onde passa toda mensagem de WhatsApp, dos dois canais**. Confirmei: uma única mensagem inbound, antes mesmo do dispatch ser agendado, já dispara **8 round-trips sequenciais e bloqueantes** ao banco (lookup de instância → dedupe por wamid → upsert de lead → refetch de bloqueado → upsert de conversa → refetch de status → insert de mensagem → RPC de incremento de não-lidas). Já existe o padrão `asyncio.to_thread` usado em outros dois arquivos do mesmo worker (`campanhas_engine.py`, `empregabilidade_engine.py`) — só nunca foi aplicado aqui, no ponto de entrada de maior volume.

- **Impacto:** ALTO — mesmo raciocínio das rodadas anteriores (worker roda como processo único, `gunicorn -w 1`, confirmado no Dockerfile — travar aqui trava tudo mais), mas com o maior raio de alcance porque é literalmente todo mensagem de todo canal.
- **Esforço do fix:** M — ~14 pontos, mecânico mas precisa preservar a ordem (dedupe antes de upsert, upsert antes de refetch).
- **Risco do fix:** MÉDIO — mesmo padrão de risco das rodadas anteriores.
- **Confiança:** HIGH.

**Sugestão de fix (mesmo padrão já usado no repo, não é ideia nova):** `campanhas_engine.py` já resolve exatamente esse problema em outro arquivo do mesmo worker — extrai cada chamada síncrona numa função `_xxx_sync` (ou, pra chamadas mais simples, um lambda inline) e envolve com `await asyncio.to_thread(...)`. Exemplo real desse arquivo (`campanhas_engine.py:529-535`):

```python
_tpl_div = await asyncio.to_thread(
    lambda: supabase.table("meta_templates").select("nome, corpo_texto, variaveis")
    .eq("automacoes", '{"Institucional"}')
    .eq("ativo", True).eq("status", "aprovado")
    .limit(1).maybe_single().execute()
)
```

Aplicado a este arquivo, por exemplo o upsert de lead (`meta_adapter_inbound.py:582-585`) ficaria:

```python
lead_result = await asyncio.to_thread(
    lambda: supabase.table("leads").upsert(
        {"telefone": telefone, "nome": push_name, "updated_at": "now()"},
        on_conflict="telefone",
    ).execute()
)
```

Repetir isso nos 14 pontos listados acima. Três cuidados pra quem for aplicar:

1. **Fazer na mesma passada que o PERF-02** (as 2 selects redundantes logo abaixo) — é a mesma região de código (`:582-618`), evita mexer duas vezes no mesmo bloco.
2. **Preservar a ordem exata das chamadas com `await` sequencial** — não trocar por `asyncio.gather`. Os passos são dependentes entre si (upsert de lead precisa terminar antes do upsert de conversa, que precisa do `lead_id` resultante); `asyncio.to_thread` só tira o bloqueio do event loop durante a espera, não muda a ordem.
3. **Rodar a suíte inteira depois** (`pytest worker/tests/test_meta_adapter_inbound.py -v`) — os mocks de `supabase.table(...)` na suíte existente (1332 linhas) podem precisar de ajuste pra aceitar ser chamados de dentro de uma thread via `asyncio.to_thread`, não só via `await` direto.

#### CORRECTNESS-01 — Falha real na gravação da mensagem é indistinguível de "duplicata pega pela trava do banco" no log

**Arquivo:** `meta_adapter_inbound.py:625-643` (insert), `:550-557` (dedupe check), `supabase/migrations/20260704200000_wm20_wamid_dedupe_mensagens.sql` (índice único, confirmei que existe)

A checagem de duplicata (`select wamid`) e a gravação de fato (`insert`) não são atômicas — entre uma e outra, `build_contrato_v2` pode chamar o Whisper (transcrição de áudio), um ponto de `await` real. Isso significa que **duas reentregas do mesmo webhook (comportamento conhecido da Meta) podem, em teoria, passar as duas pela checagem antes de qualquer uma terminar o insert**. A boa notícia, que confirmei: existe uma trava real no banco (`CREATE UNIQUE INDEX ... WHERE wamid IS NOT NULL`) pegando exatamente esse caso — a duplicata falha no insert e cai no `except Exception` genérico.

O problema é justamente esse: o mesmo bloco `except` trata "duplicata seguramente barrada pela trava do banco (nada de errado)" exatamente igual a "erro de verdade, tipo RLS mal configurado ou conexão caiu" — mesma linha de log, sem `return`. No segundo caso, a execução **continua** pro dispatch mesmo assim (a resposta da IA ainda sai certa pro turno atual, porque `contrato_v2["mensagem"]` já está em memória), mas a mensagem nunca entra no `historico` que o motor-agente lê nos próximos turnos — um gap silencioso de dado, sem alerta.

- **Impacto:** MÉDIO-ALTO — não é uma falha que derruba o sistema, é um gap silencioso de integridade de dado (histórico da conversa) sem sinal nenhum de que aconteceu, distinto de "raro mas inofensivo" (a duplicata) só na cabeça de quem já sabe olhar o log com atenção.
- **Esforço do fix:** S — distinguir a violação de constraint única (log "seguro, já tratado pela trava") de qualquer outro erro (log real + decidir se aborta o dispatch).
- **Risco do fix:** BAIXO.
- **Confiança:** HIGH (li o código, a migração, e os testes existentes — não há teste cobrindo o caminho de erro genuíno, só o caminho de dedupe sequencial).

#### PERF-02 — 2 consultas extras parecem desnecessárias logo depois de um upsert que já devolveria o mesmo dado

**Arquivo:** `meta_adapter_inbound.py:582-588` (lead), `:604-618` (conversa)

Em ambos os pontos, o código faz um `upsert` e, logo em seguida, um `select` separado pra buscar um campo que o próprio `upsert` provavelmente já devolveria se encadeado com `.select(...)`. Cortar essas duas selects reduziria a cadeia bloqueante pré-dispatch de 8 pra 6 chamadas (25%) em toda mensagem — complementar ao achado anterior.

- **Impacto:** MÉDIO — ganho real, mas precisa ser confirmado empiricamente antes de aplicar (ver ressalva de confiança).
- **Esforço do fix:** S.
- **Risco do fix:** BAIXO/MÉDIO — depende de a versão do client Postgrest usada neste projeto realmente devolver a linha completa num upsert com `on_conflict`; isso **não foi testado ao vivo**, só inferido do comportamento padrão do Postgrest.
- **Confiança:** MED — sinal forte, mas "precisa verificar antes de confiar" segundo o próprio subagent que achou isso.

---

### 🟠 Demais achados vetados

| # | Achado | Categoria | Evidência | Esforço | Confiança |
|---|---|---|---|---|---|
| 4 | Telefone completo (lead e contato de transbordo) em log, inconsistente com o mascaramento já usado em `empregabilidade_engine.py` | segurança | `meta_adapter_inbound.py:566,594,432,434`; `meta_adapter_outbound.py:76,79,90-94,97` | S | HIGH |
| 5 | `_notificar_transbordo`: acesso direto a `contato["telefone_destino"]` sem `.get()` — uma linha malformada na tabela derruba o resto do loop silenciosamente, sem notificar os contatos seguintes | correção | `meta_adapter_inbound.py:419` | S | MED |
| 6 | Caminho de fallback do transbordo (unidade específica → contatos globais) nunca é testado com dado real passando por ele | testes | `worker/tests/test_meta_adapter_inbound.py` (`TestNotificarTransbordo`) | S | HIGH |
| 7 | Comparação do `verify_token` do webhook usa `==` simples em vez de comparação de tempo constante (`hmac.compare_digest`) — inconsistente com o resto do arquivo | segurança | `main.py:547` vs. `meta_adapter_inbound.py:53` | S | HIGH (padrão) / risco real baixo (é só o handshake de configuração do webhook, não autentica mensagem) |
| 8 | Sem checagem no boot de que `META_APP_SECRET`/`META_VERIFY_TOKEN` estão configurados — se algum ficar vazio por engano no deploy, o app sobe normalmente com validação degradada, sem alerta | segurança | `main.py:186-187` | S | MED |
| 9 | Caminho de exceção do dispatch pra Empregabilidade nunca é testado (só o caminho feliz) — o de motor-agente tem teste de resiliência equivalente, esse não | testes | `meta_adapter_inbound.py:711-726` vs. teste existente só do motor-agente | S | HIGH |
| 10 | `MODULO_AUTOMACAO_MAP` tem 11 entradas, mas só 4 valores são de fato alcançáveis pelos 2 pontos de chamada reais do sistema hoje — as outras 7 são especulativas | tech-debt | `meta_adapter_inbound.py:247-259` (confirmado por grep exaustivo dos 2 call sites) | S | HIGH |
| 11 | `token=""` passado pro dispatch de Empregabilidade é morto — percorre 15 assinaturas de função em `empregabilidade_engine.py` sem nunca ser usado (confirmado: `_enviar()` lê a variável de ambiente direto) | tech-debt | `meta_adapter_inbound.py:718` → `empregabilidade_engine.py` (15 assinaturas) | M (mas melhor tratar junto de uma futura limpeza do `empregabilidade_engine.py`, que já não tem teste) | HIGH |
| 12 | `_meta_enviar` e `_meta_marcar_lida_e_digitando` duplicam ~35-40% da lógica de montar a chamada HTTP pra Graph API, sem helper compartilhado | tech-debt | `meta_adapter_outbound.py:28-98` vs `:101-159` | S | HIGH |
| 13 | `httpx.AsyncClient` criado do zero a cada chamada de envio, sem reuso de conexão | performance | `meta_adapter_outbound.py:66,138`; `meta_adapter_inbound.py:61,83,305` | S | MED (impacto real depende do volume, não medido) |
| 14 | Comentário "httpx ausente nos containers de teste" nos imports lazy é impreciso — a causa real é um conflito de versão entre `supabase`/`httpx` já documentado (e revertido) em outro arquivo de teste do mesmo projeto | tech-debt | `meta_adapter_inbound.py`/`meta_adapter_outbound.py` (5 imports lazy) vs. `test_campanhas_engine.py` (explica a causa real) | S (só corrigir o comentário) | MED |

**Considerados e confirmados sem achado (checados especificamente, não é achado):**

- Validação HMAC do webhook — obrigatória, correta, usa comparação segura, roda sobre os mesmos bytes que depois são parseados. Sem gap.
- SSRF via download de mídia — `media_id` só entra como segmento de path numa URL de host fixo (`graph.facebook.com`); a URL temporária de mídia vem da própria API da Meta, não do usuário. Risco baixo, confirmado.
- Redação de token nos logs de erro de `_meta_enviar` — já feita corretamente de propósito.
- Lógica de fallback `mensagens`/`resposta` do `_chamar_motor_agente` — rastreada linha a linha, está correta (trata `None`, string vazia e lista corretamente).
- Normalização de telefone brasileiro (`_normalizar_telefone_br`) — testada exaustivamente contra todos os limites documentados no próprio docstring.
- Mecanismo de debounce — já documentado no próprio código como limitação conhecida e aceita (só funciona com processo único); não é achado novo, é decisão já registrada.

---

## Perguntas em aberto para o Valmir

1. **PERF-02 (selects extras evitáveis)** — vale rodar um teste rápido contra o Supabase real (ou checar a versão do `postgrest-py` instalada) antes de aplicar esse fix — o subagent que achou isso não teve como confirmar ao vivo que o upsert encadeado com `.select()` realmente devolve a linha completa nesta versão específica do client.
2. **CORRECTNESS-01 (dedupe race)** — combinado com a trava no banco, isso não é urgente (o pior caso já é coberto), mas vale decidir: quando a exceção genérica acontecer de verdade (não-dedupe), o dispatch deveria abortar em vez de seguir com histórico incompleto?
3. **Achado #11 (token="" morto)** — como isso atravessa `empregabilidade_engine.py` (arquivo já sem teste, auditado numa rodada anterior), faz mais sentido resolver junto de uma limpeza futura desse arquivo do que isolado aqui. Concorda?
