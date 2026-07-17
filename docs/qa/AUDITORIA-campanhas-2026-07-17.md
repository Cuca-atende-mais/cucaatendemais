# Auditoria — `campanhas_engine.py` (foco correção/segurança/performance/testes/tech-debt)

**Data:** 2026-07-17
**Autor:** Auditoria independente (João/sócio + Claude Code), não-implementação — este documento reporta diagnóstico, não aplica fixes.
**Escopo:** `worker/campanhas_engine.py` (590 linhas) — motor de disparo em massa de templates WhatsApp Meta (eventos pontuais, follow-up de ouvidoria, e divulgação mensal city-wide do Institucional). Quinta rodada de auditoria do projeto, mesmo recorte das quatro anteriores.
**Fora de escopo nesta rodada:** canal Ouvidoria (decisão já tomada nas rodadas anteriores) e o portal Next.js (`cuca-portal`) — essa é a próxima rodada. Dois achados abaixo (SEC-02, BUG-03) precisaram rastrear até o portal pra confirmar, mas não são uma auditoria completa dele.
**Método:** leitura completa do arquivo (4 subagents paralelos + vetting pessoal). Confirmei pessoalmente o achado mais importante (BUG-01) lendo a migração SQL citada.
**Ferramenta usada:** skill `improve`, mesma das quatro rodadas anteriores.

**Nota sobre esta entrega**: sem `plans/` de novo — mesma decisão das quatro rodadas anteriores.

**Contexto que veio junto do pedido de auditoria**: o usuário já sabia, de uma rodada anterior, que este arquivo usa `asyncio.to_thread` corretamente na maior parte das chamadas — pedi pra confirmar isso em vez de assumir, e vim com duas pistas próprias (um lookup de template e um upsert dentro do loop de envio que pareciam ter escapado do padrão). Ambas confirmadas abaixo.

---

## Diagnóstico

### 🔴 Achados de maior severidade/leverage

#### SEC-01 — Rota interna de envio manual ignora a checagem de "template aprovado" que o resto do arquivo sempre exige

**Arquivo:** `worker/main.py:287-336` (rota `/send-message/{token}`) → `campanhas_engine.py:168-201` (`_enviar_template_meta`)

A rota interna que o portal usa pra mandar mensagem manual pega `number`, `template_name` e `template_components` direto do corpo da requisição e manda pra `_enviar_template_meta` sem nenhuma consulta prévia em `meta_templates` (`ativo=True`, `status="aprovado"`, `phone_number_ids` contém o número de origem) — a mesma checagem que **todo outro ponto de chamada dentro deste arquivo** faz antes de disparar (`:271-283`, `:529-535`). A única proteção é um token estático comparado contra `WEBHOOK_INTERNAL_TOKEN`.

- **Impacto:** ALTO — se esse token vazar ou for fraco, dá pra mandar qualquer template (nome e parâmetros livres) pro número comercial da organização, pra qualquer destinatário, sem passar pelo filtro de aprovação que existe justamente pra evitar violação de política da API do WhatsApp Business (template não-aprovado ou usado fora de contexto pode banir o número).
- **Esforço do fix:** S/M — replicar a mesma consulta de `meta_templates` já usada dentro deste arquivo, antes do dispatch em `main.py`.
- **Risco do fix:** BAIXO/MÉDIO — pode quebrar um fluxo de envio manual legítimo do portal se a validação ficar mais rígida do que o que os operadores usam hoje; precisa alinhar com quem mantém essa feature no portal.
- **Confiança:** MED (o caminho e a ausência de validação estão confirmados na leitura; se isso é um risco aceito por design de "serviço interno confiável" é uma decisão de produto, não algo que dá pra resolver só lendo código).

#### BUG-01 — Item travado pra sempre em "em_andamento" se o worker cair no meio do disparo (confirmado na migração SQL)

**Arquivo:** `campanhas_engine.py:436-461` (loop de claim), `supabase/migrations/20260706000000_claim_atomico_disparos_race_condition.sql` (RPCs, li pessoalmente)

Confirmei a migração: as 3 funções de claim (`claim_evento_pontual`, `claim_ouvidoria_evento`, `claim_disparo_divulgacao`) fazem um `UPDATE ... FOR UPDATE SKIP LOCKED` atômico que muda o status pra `em_andamento` no instante da reivindicação — isso é ótimo, elimina a race condition entre dois workers concorrentes que motivou a migração. Mas **nenhum lugar do código (worker ou portal) jamais move um item de volta pra fora de `em_andamento`** — só os caminhos terminais (`concluida`/`pausada`) fazem isso, e só se o processamento chegar até lá.

```sql
UPDATE public.eventos_pontuais
SET status = 'em_andamento', updated_at = now()
WHERE id = (SELECT id FROM public.eventos_pontuais
    WHERE status = 'aprovado' AND disparo_id IS NULL
    FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;
```

- **Impacto:** ALTO, mas com uma boa notícia embutida: se o worker cair no meio de um disparo (deploy, crash, restart), **não há risco de reenviar mensagem duplicada** pros leads que já receberam (a boa notícia). O problema é o oposto: o item fica travado permanentemente em `em_andamento` — nenhuma consulta de claim nunca mais o pega, os leads restantes nunca recebem a campanha, e a única forma de destravar é um `UPDATE` manual direto no banco de produção.
- **Esforço do fix:** S — uma query periódica que reseta itens `em_andamento` com `updated_at` antigo (ex.: mais de 2x o tempo esperado de uma campanha) de volta pro status reivindicável.
- **Risco do fix:** BAIXO — é aditivo; cuidado só pra não escolher uma janela curta demais e resetar uma campanha genuinamente ainda em andamento.
- **Confiança:** HIGH (li a migração inteira e conferi exaustivamente que não existe nenhuma transição de volta pra fora de `em_andamento`, nem no worker nem no portal).

#### BUG-03 — Item pausado pelo circuit breaker também não tem caminho de retomada — mesma raiz do BUG-01

**Arquivo:** todos os pontos que gravam `"pausada"`/`"pausado"` (`:220,256,281,404,504,518,538,586`)

Mesma investigação do achado acima, aplicada ao outro estado terminal de falha: quando o circuit breaker de taxa de erro dispara (ou um template/canal não é encontrado), o item vira `"pausada"`/`"pausado"` e nada — nem neste arquivo, nem em nenhuma tela do portal encontrada por busca — jamais lê esse status de volta pra retomar. A tela de divulgação do portal só exibe o status como selo de leitura, sem botão de ação.

- **Impacto:** ALTO — um circuit breaker que protege corretamente contra continuar mandando mensagem quebrada, mas depois disso a campanha morre em silêncio até alguém notar e mexer no banco manualmente. Combinado com o BUG-01, os dois caminhos de falha do arquivo convergem pro mesmo desfecho: "travado até intervenção manual".
- **Esforço do fix:** M — endpoint + botão no portal pra retomar um item pausado (idealmente com um cooldown, pra não disparar o mesmo circuit breaker de novo em loop se a causa raiz não foi corrigida).
- **Confiança:** HIGH que não existe caminho de retomada hoje; MED se isso é um "portão manual" intencional (proteção deliberada) ou um esquecimento — vale perguntar.

#### TEST-01 — Circuit breaker (o único mecanismo de segurança do arquivo) nunca foi testado

**Arquivo:** `:400-405`, `:582-587`

O único freio automático que existe contra uma campanha quebrada (número banido, token expirado, template malformado) continuar mandando mensagem pra todo mundo — e não tem um teste sequer. Um off-by-one na condição (`(i + 1) > 5`, é no 6º envio que ativa, ou deveria ser no 5º?) ou uma inversão de comparação desativaria o freio silenciosamente, e o jeito de descobrir seria uma campanha real mandando mensagem quebrada pra centenas de pessoas.

- **Impacto:** ALTO — não é sobre o estado atual (a lógica parece correta na leitura), é sobre não ter rede de segurança pra proteger esse mecanismo específico de regressão futura.
- **Esforço do fix:** S — mockar `supabase`/`_enviar_template_meta`, testar a matemática do threshold diretamente.
- **Confiança:** HIGH.

#### TEST-02 — Lógica de disparo em si nunca foi testada, e o histórico do git prova que bug real já foi ao ar aqui 3 vezes

**Arquivo:** `:223-426` (`_processar_item_disparo_interno`)

```
50de4d5 fix(S-WM-16): adiciona parameter_name aos templates Meta NAMED
bc5ed8b fix(S-WM-16): corrige sintaxe de array Postgres em lookup relacional de templates
978de08 fix(ouvidoria): corrigir status 'aprovado' -> 'ativo' no engine de campanhas
```

Três commits de correção de bug real, direto nesse trecho do arquivo, e zero teste de regressão prevenindo que aconteça de novo — o arquivo de teste existente cobre só o helper de formatação de parâmetro (`_montar_parametros_named`), não a lógica que decide quem recebe mensagem, quantos recebem, e se o disparo foi marcado como concluído corretamente.

- **Impacto:** ALTO — mesmo raciocínio do achado acima, mas com prova histórica concreta de que regressão real já aconteceu nesse exato trecho.
- **Esforço do fix:** M — mockável, mas com scaffolding real (5 pontos de chamada ao Supabase através de helpers síncronos diferentes).
- **Confiança:** HIGH.

---

### 🟠 Demais achados vetados

| # | Achado | Categoria | Evidência | Esforço | Confiança |
|---|---|---|---|---|---|
| 6 | Data mal formatada em campanha real: `_fmt_data_br` quebra com timestamp (`T00:00:00+00:00`) em vez de data pura, sem cair no fallback — texto tipo "17T00:00:00+00:00/07/2026" pode ir pro WhatsApp de um cidadão real | correção | `:326-331`; evidência indireta no portal (`ouvidoria/eventos/page.tsx:88` já faz `.split("T")[0]` antes de usar o mesmo campo) | S | MED (mecanismo certo, tipo exato da coluna no banco não confirmado — ver ressalva) |
| 7 | Circuit breaker usa taxa de erro acumulada desde o início da campanha, não uma janela recente — banimento no meio de uma campanha de 500 leads só é detectado depois de ~50 falhas seguidas | tech-debt (decisão de design, não bug de aritmética) | `:400-405`, `:582-587` | M | MED — troca deliberada, não "conserto" |
| 8 | Upsert de breadcrumb (`conversas`) dentro do loop de envio por lead SEM `asyncio.to_thread` — é a chamada bloqueante de maior volume do arquivo (até 500x por disparo) | performance | `:387-394` (contraste com o resto do arquivo, que usa o padrão certo) | S | HIGH |
| 9 | Lookup de template SEM `asyncio.to_thread`, inconsistente com a função irmã que faz a mesma consulta corretamente | performance | `:271-275` vs `:529-535` | S | HIGH |
| 10 | Telefone completo em log de falha de envio, mesma inconsistência já vista nas rodadas anteriores | segurança | `:197,200` | S | HIGH |
| 11 | Query de leads sem `.limit()`, busca a lista inteira e descarta a maior parte em memória — mas cuidado: um `.limit()` ingênuo quebra a métrica de "quantos leads elegíveis existiam de verdade" | performance | `:67-96`, `:104-111` | S | HIGH (achado) / precisa decisão sobre a métrica |
| 12 | `httpx.AsyncClient` recriado do zero a cada envio — mesmo padrão já visto na rodada do meta-adapter, mas aqui é o maior volume de chamadas do projeto inteiro (até 500 sequenciais por disparo) | performance | `:189` | S | HIGH |
| 13 | Duas trincas de campo por `origem` (`tipo`/`evento_id`/`campanha_mensal_id`) duplicadas byte a byte dentro da mesma função — 2 caminhos de código diferentes que precisam ser lembrados em sincronia | tech-debt | `:295,298-299` vs `:407,410-411` | S | HIGH |
| 14 | Bloco do circuit breaker duplicado quase idêntico entre as duas funções de disparo | tech-debt | `:400-405` vs `:582-587` | S | HIGH |
| 15 | Strings de status com gênero gramatical inconsistente entre tabelas (`"pausada"/"concluida"` vs `"pausado"/"concluido"`) — hoje consistente ponta a ponta, mas frágil (já houve bug de string de status nesse arquivo antes) e sem teste travando o valor | tech-debt | grep completo no worker + portal | S | MED |
| 16 | Loop externo nunca testado, e não existe no repo um padrão pra testar "rodar N iterações de um `while True` e parar" | testes | `:431-466` | S/M | MED |
| 17 | Config (delay/limite/threshold) rebuscada do banco a cada 30s mesmo sem mudar — 4 round-trips extras por ciclo | performance | `:438-441` | S | MED — provavelmente não vale a pena isolado |
| 18 | Loop interno drena `eventos_pontuais` por completo antes de sequer olhar pra `ouvidoria_eventos`/divulgação — starvation teórica | tech-debt | `:443-461` | — | MED — não recomendo agir sem ver profundidade de fila real |

**Considerados e confirmados sem achado (checados especificamente, não é achado):**

- **Segmentação de lead (unidade/categoria)** — rastreei até o portal: quando `unidade_cuca` vem `null`, é porque um humano marcou explicitamente "toda a rede"/"Geral" na tela de criação — não é um vazamento acidental de filtro. Os 2 nomes de campo "fallback" extras (`unidade_cuca_id`, `unidade_id`) que o código também tenta ler são código morto (nenhuma das duas tabelas reais usa esses nomes) — confuso, mas inofensivo.
- **Filtro opt_in/bloqueado** — aplicado sem exceção em toda query de lead, inclusive no caminho com `categorias_alvo`. Sem brecha.
- **Injeção via `automacao_filtro`** (string montada manualmente pro Postgres) — confirmei que `automacao_tags` é sempre lista literal hardcoded no próprio código, nunca vem de input externo. Sem risco.
- **Token da Meta nos logs** — nunca logado, sem fallback hardcoded suspeito.
- **3 wrappers de claim quase idênticos** (`:55-64`) — 2 linhas cada, abaixo do limiar que justificaria uma abstração.

---

## Perguntas em aberto para o Valmir

1. **BUG-01/BUG-03 (itens travados sem retomada)** — isso é um "portão manual" intencional (alguém da equipe precisa olhar antes de retomar uma campanha que falhou) ou foi só nunca priorizado? Muda bastante se vira plano de "adicionar reconciliação automática" ou só "adicionar botão de retomada manual no portal".
2. **BUG-02 (data mal formatada)** — preciso confirmar se `ouvidoria_eventos.data_inicio` é `timestamptz` (o que causaria o bug) ou `date` puro — não achei a definição da tabela nas migrations rastreadas (ela deve ter sido criada direto no Supabase Studio). Uma query rápida no schema resolve.
3. **SEC-01 (rota de envio manual sem checagem de template aprovado)** — é assim de propósito porque a rota já é "serviço interno confiável" (só o portal chama, protegido por token), ou vale endurecer mesmo assim como defesa em profundidade?
