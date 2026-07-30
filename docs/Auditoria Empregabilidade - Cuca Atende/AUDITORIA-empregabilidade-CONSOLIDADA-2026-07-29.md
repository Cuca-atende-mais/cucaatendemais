# Auditoria consolidada — `empregabilidade_engine.py` + `intencao_detector.py`

**Data desta consolidação:** 2026-07-29
**Natureza:** este documento junta 2 auditorias independentes que existiam separadas, sem que nenhuma delas soubesse da outra:
- `AUDITORIA-empregabilidade-2026-07-09.md` (4 achados, EMP-01 a EMP-04, cada um com teste automatizado vermelho já escrito).
- `AUDITORIA-empregabilidade-2026-07-17.md` (17 achados, mais aprofundada, com impacto/esforço/risco/confiança por item — feita na branch `audit/empregabilidade-2026-07-17`, nunca mergeada).

Cruzei os 21 achados das duas: **1 se sobrepõe** (EMP-02 ⊂ achado #8 da auditoria de 17 — mesma raiz, mesmo arquivo, mesma linha de causa; mantive a versão mais detalhada). Os outros **3 da auditoria de 09 são achados novos**, não cobertos pela de 17 (EMP-01, EMP-03, EMP-04). Resultado: **20 achados distintos**, todos verificados de novo por mim linha a linha antes de entrar aqui (não copiei nenhuma citação sem reconferir contra o código atual, commit `bf8b152` / `origin/main` em 2026-07-29 — nenhum dos dois arquivos-alvo foi tocado desde 2026-07-05).

**Escopo:** `worker/empregabilidade_engine.py` (2799 linhas) + `worker/intencao_detector.py` — a máquina de estados Python que roda todo o canal Empregabilidade via WhatsApp (empresa cadastra/gerencia vaga, candidato consulta status, público navega/aplica/deixa currículo). Roteada direto pelo worker (`meta_adapter_inbound.py:546-561`), **não passa** pelo `motor-agente` (Edge Function) — é um caminho de código totalmente separado do canal Institucional.

**Fora de escopo:** `cv_processor.py`, `talent_bank_matcher.py`, `import_curriculos.py`, `category_extractor.py`, o portal Next.js que recebe os links gerados por este engine, e teste ao vivo no número real (nenhuma mensagem real foi enviada em nenhuma das duas rodadas).

**Nota sobre planos:** ao contrário das auditorias do canal Institucional (que geraram `plans/001-017`) e da investigação da Corrida da Juventude (`plans/001-008`), esta rodada **não tinha planos escritos até esta consolidação**. Escrevi 3 planos completos para os achados de maior severidade/confiança (SEC-01, SEC-02, BUG-01) — ver pasta `plans/` desta entrega. Os demais 17 achados estão documentados com o mesmo nível de detalhe (arquivo:linha, causa, sugestão), prontos pra virarem plano quando alguém (você) decidir priorizar.

**Nota crítica sobre os testes dos achados EMP-01/02/03/04:** os 4 testes que a auditoria de 09/07 cita como "vermelho, provando o bug" **existem, mas nunca foram commitados em nenhuma branch** — são uma alteração local, não rastreada pelo git, no computador onde esta auditoria foi feita. Copiei o conteúdo completo desses testes pra esta pasta (`testes-locais-nao-commitados/`) exatamente por causa desse risco — se o ambiente local original for perdido, esses testes desaparecem sem deixar rastro em lugar nenhum. **Recomendo commitar esses 2 arquivos de teste antes de qualquer outra coisa.**

---

## Resumo executivo

| # | Achado | Categoria | Severidade | Confiança | Teste hoje |
|---|---|---|---|---|---|
| SEC-01 | Empresa "autenticada" só pelo CNPJ (dado público) — takeover de identidade, ação destrutiva possível | Segurança | **Alta** | HIGH | Não |
| SEC-02 | Consulta de candidatura vaza PII de terceiro (nome/telefone sem provar identidade) | Segurança | **Alta** | HIGH | Não |
| BUG-01 | `aguardando_retorno_selecao` sem handler síncrono — reseta a empresa inteira | Bug/UX | **Alta** | HIGH | Não |
| BUG-02/PERF-01 | ~48 chamadas Supabase síncronas dentro de `async def` — trava o event loop inteiro sob concorrência | Performance | **Alta** | HIGH | Não |
| TEST-01 | Zero teste nos 3 fluxos de maior risco (cancelamento, cadastro de empresa, confirmação de entrevista) | Testes | **Alta** | HIGH | — |
| EMP-01 | Filtro de setor por substring ("entrega" casa em "entregar") esconde vagas na 1ª mensagem | Bug | Alta | HIGH | **Sim (local, não commitado)** |
| EMP-02 / #8 | `_quer_encerrar` substring sem limite de palavra, sem exceção em 3 fluxos (candidato roda antes do próprio escape semântico) | Bug | Alta | MED/HIGH | **Sim (local, não commitado)** |
| EMP-03 | Negação ignorada em `pos_candidatura` — mesma classe já corrigida na etapa vizinha | Bug | Média-alta | HIGH | **Sim (local, não commitado)** |
| EMP-04 | `menu_pos_vaga` reinterpreta resposta contra o menu errado ("3=Encerrar" → "3=Editar vaga") | Bug | Média-alta | HIGH | **Sim (local, não commitado)** |
| #6 | `_set_fluxo` refaz select redundante + risco de lost-update contra o loop de notificação | Perf/Bug | Média | HIGH/MED | Não |
| #9 | N+1 em 2 telas de listagem (contagem de candidaturas, título de vaga) | Perf | Média | HIGH | Não |
| #10 | Regex de número de vaga sem `\b` real pode capturar dígito de CNPJ/data | Bug | Média | MED | Não |
| #11 | Menu de 4 opções duplicado 10x como string (uma cópia já divergiu); 7 tuplas de afirmativo inconsistentes | Tech-debt | Média | HIGH | Não |
| #12 | Links do portal levam `empresa_id`/`vaga_id`/telefone/nome crus na URL, sem assinatura/expiração | Segurança | Média | MED | Não |
| #13 | 2 pontos gravam estado antes de enviar mensagem — se o envio falhar, próxima msg cai no handler errado | Bug | Média | MED | Não |
| #14 | Mocks de teste nunca verificam payload da query (`.eq()`, coluna) — bug de filtro passaria despercebido | Testes | Média | HIGH | — |
| #15 | Loop de notificação: N+1 de lead por conversa + query externa sem `.limit()` | Perf | Média | HIGH/MED | Não |
| #16 | Fluxos candidato/público quase sem teste além dos escape hatches | Testes | Alta (cobertura) | HIGH | — |
| #17 | CNPJ completo em log de erro, sem o mascaramento que telefone já tem | Segurança | Baixa | HIGH | Não |
| Cosmético | Parâmetro `token` de `_enviar()` nunca usado (sempre lê de env direto) | Tech-debt | Baixa | — | — |

**Considerados e rebaixados** (avaliados, não entraram no corte de plano — registrados pra não serem reauditados à toa):
- CNPJ sem dígito verificador — a consulta externa (`publica.cnpj.ws`) já barra CNPJ inválido antes de qualquer insert; custo é só um round-trip HTTP a mais.
- 2 etapas "legado"/shim (`menu_empresa_retomada`, `perguntando_unidade_vaga`) — parecem seguras pra apagar, mas só confirmável rodando `select count(*) from conversas where metadata->'empreg_fluxo'->>'etapa' in (...)` contra produção — não rodado ainda nesta consolidação.
- Quebrar o arquivo de 2799 linhas em módulos menores — não recomendado antes dos achados #5(TEST-01)/#14/#16 estarem resolvidos (alto risco sem rede de testes).

---

## 🔴 Achados de maior severidade/leverage (verificados linha a linha nesta consolidação)

### SEC-01 — Empresa é "autenticada" só pelo CNPJ — dado público, sem verificação de posse

**Arquivo:** `empregabilidade_engine.py:753` (lookup), `:761-767` (concessão de sessão)

```python
emp_res = supabase.table("empresas").select("id, nome, nome_fantasia").eq("cnpj", cnpj_limpo).execute()
if emp_res.data:
    empresa = emp_res.data[0]
    ...
    _set_fluxo(conversa_id, {
        "etapa": "aguardando_criar_vaga",
        "cnpj": cnpj_limpo,
        "empresa_id": empresa["id"],
        ...
    })
```

Qualquer conversa que informe os 14 dígitos de um CNPJ já cadastrado recebe, sem mais nenhuma verificação, a identidade completa daquela empresa (`empresa_id`) pelo resto da sessão. CNPJ não é segredo — está em nota fiscal, contrato, site de busca pública (inclusive o próprio bot ecoa razão social/endereço/telefone da empresa via `_formatar_dados_cnpj`, puxados de `https://publica.cnpj.ws`). Os fluxos de edição (`selecionando_vaga_edicao`) e cancelamento (`selecionando_vaga_cancelamento`/`confirmando_cancelamento`) filtram corretamente por `.eq("empresa_id", empresa_id)` — mas esse `empresa_id` só vale o que vale o check acima, ou seja, nada. Quem souber (ou pesquisar) o CNPJ de uma empresa concorrente pode registrar um número de WhatsApp qualquer como aquela empresa e cancelar/editar vagas reais dela.

- **Impacto:** ALTO — takeover completo de identidade de empresa, ação destrutiva possível (cancelamento é irreversível pelo próprio texto do bot).
- **Esforço do fix:** M — precisa de uma etapa de verificação fora de banda antes de vincular um novo número de WhatsApp a um `empresa_id` já existente.
- **Plano:** `plans/empregabilidade/001-sec01-autenticacao-empresa-por-cnpj.md`

### SEC-02 — Consulta de status de candidatura vaza dado de terceiro

**Arquivo:** `empregabilidade_engine.py:1298-1352` (dentro de `_processar_candidato`, etapa `aguardando_id_candidato`)

O bot pede: "*você pode tentar com: número da candidatura, nome completo, ou telefone cadastrado*". As 4 estratégias de busca (CPF, código de referência, telefone, nome) usam o valor **digitado na mensagem**, nunca o `phone` real de quem está mandando a mensagem — que já está disponível como parâmetro da própria função (`_processar_candidato(texto, phone, instance_name, token, lead_id, conversa_id)`). Qualquer pessoa que saiba o nome completo ou telefone de um candidato consegue puxar o status da candidatura dele e as `observacoes` internas do recrutador, sem provar que é aquela pessoa.

- **Impacto:** ALTO — exposição de PII de público em geral (candidatos a emprego), incluindo notas internas de recrutador.
- **Esforço do fix:** S — trocar a comparação de telefone pelo `phone` já confiável; a busca por nome deveria também exigir bater com esse telefone.
- **Plano:** `plans/empregabilidade/002-sec02-consulta-candidatura-vaza-dado-terceiro.md`

### BUG-01 — Estado `aguardando_retorno_selecao` sem handler síncrono em `_processar_empresa` — reseta a empresa inteira

**Arquivo:** `empregabilidade_engine.py:1034-1045` (etapa é atribuída), `:358-1116` (`_processar_empresa`, onde deveria ser tratada), `:1113-1115` (fallback que efetivamente acontece)

Quando a empresa escolhe "2️⃣ Marcar seleção", a etapa vira `aguardando_retorno_selecao` enquanto aguarda preenchimento no portal. As 2 etapas irmãs (`aguardando_retorno_vaga:1058-1099`, `aguardando_retorno_edicao`) têm um branch explícito pra mensagem manual do usuário nesse meio-tempo ("Ainda aguardando o preenchimento..."). `aguardando_retorno_selecao` não tem — cai no fallback genérico (`:1113-1115`), que reseta pra `solicitar_cnpj`. Qualquer mensagem da empresa nesse meio-tempo ("oi", "ainda aí?") perde `empresa_id` e todo contexto. (O loop de notificação em background, `empregabilidade_notify_loop:2617-2618`, **já cobre** esta etapa pro lado assíncrono — confirmado nesta consolidação — o gap é só a mensagem manual síncrona.)

- **Impacto:** ALTO — regressão de UX direta num fluxo de primeira classe do menu.
- **Esforço do fix:** S — espelhar o bloco já existente em `aguardando_retorno_vaga`.
- **Plano:** `plans/empregabilidade/003-bug01-aguardando-retorno-selecao-sem-handler.md`

### BUG-02 / PERF-01 — Quase todas as chamadas Supabase são síncronas dentro de `async def`

`asyncio.to_thread` aparece 1 vez no arquivo (dentro de `_enviar`); `supabase.table(` aparece 49 vezes. As outras ~48 chamadas rodam bloqueantes dentro de handlers `async def` — inclusive no loop de notificação (a cada 20s). Como o worker roda num único event loop atendendo todas as conversas, cada uma dessas chamadas trava o **processo inteiro**, não só a conversa daquele usuário, pela duração do round-trip ao Postgres.

- **Impacto:** ALTO — afeta escalabilidade/responsividade de todo o canal.
- **Esforço do fix:** L — mecânico mas espalhado (~49 pontos); melhor via helper `_exec()` envolvendo `asyncio.to_thread`, aplicado sistematicamente.
- **Sem plano formal ainda** — recomendo ter o TEST-01/#14 resolvidos antes (rede de segurança pra uma refatoração desse tamanho).

### TEST-01 — Zero testes nos 3 fluxos de maior risco

`confirmando_cancelamento` (marca vaga como cancelada, irreversível), `confirmando_cadastro` (insere empresa real), confirmação/recusa de entrevista (grava `candidaturas.status`) — grep confirma zero ocorrência desses 3 nomes de etapa em `test_empregabilidade_engine.py`. Não é bug no estado atual — é ausência de rede de segurança pra qualquer mudança futura, inclusive as que este documento sugere.

- **Esforço do fix:** M — fixture `mock_sb` por branch + assert no payload exato.
- **Sem plano formal ainda.**

### EMP-01 — Filtro de setor por substring ingênua esconde vagas já na 1ª mensagem

**Arquivo:** `intencao_detector.py:270-285` (`extrair_setor_da_mensagem`), usado em `empregabilidade_engine.py:2500`.

A keyword `"entrega"` (setor Logística) é buscada como substring simples — bate dentro de **"entregar"**. "Quero **entregar** meu currículo" é frase natural de candidato na 1ª mensagem. O sistema filtra silenciosamente só vagas de Logística e, sem nenhuma, responde "Não temos vagas de *entrega*" mesmo havendo vagas de sobra em outras áreas. Mesma classe de bug já corrigida no canal Institucional (AUD-05, "barragem" continha "barra", regex com limite de palavra) — aqui nunca foi corrigida.

- **Teste (local, não commitado):** `test_intencao_detector.py::test_entregar_curriculo_nao_deveria_disparar_filtro_de_logistica`
- **Sugestão:** regex `\bentrega\b` em vez de substring pura.

### EMP-02 (= achado #8) — "Quer encerrar" por substring sem limite de palavra

**Arquivo:** `empregabilidade_engine.py:24-28` (lista `_PALAVRAS_ENCERRAR`), `:191-193` (`_quer_encerrar`, checado via `any(p in t for p in ...)`), chamado no topo de 3 fluxos: candidato (`:1267` — **sem nenhuma exceção de etapa**, e roda **antes** de `candidato_consultado` ter chance de rodar seu próprio escape semântico), empresa (`:374`, exceção cobre só 3 de ~14 etapas), público (`:1494`, exceção cobre só 3 etapas).

O próprio código já reconhece esse padrão 2x (`_quer_banco_talentos` foi corrigido pra exatamente isso) — nunca resolvido na raiz pra `_quer_encerrar`. Um "muito obrigado! mas ainda tenho uma dúvida sobre X" em qualquer etapa não coberta encerra a conversa sem aviso.

- **Teste (local, não commitado):** `test_empregabilidade_engine.py::TestQuerEncerrarSubstringSemLimiteDePalavra`
- **Sugestão:** `_quer_encerrar` só deveria considerar mensagens curtas/isoladas (a mensagem inteira, após strip, é uma das frases), ou usar o classificador semântico já usado em outros pontos.

### EMP-03 — Negação ignorada em `pos_candidatura`

**Arquivo:** `empregabilidade_engine.py:1585-1601`.

`quer_mais_vagas = any(p in t_lower for p in (..., "quero", "ok"))` não checa negação. "**Não** quero mais vagas, obrigado" contém "quero" → lido como pedido de mais vagas, reabrindo a busca com uma resposta descolada do que o lead disse. A etapa seguinte (`oferta_banco_talentos:1626-1629`) já tem a correção certa (checa `tem_negacao` antes de aceitar `quer_banco`, com comentário citando "bug 5 do relatório anterior") — não foi replicada de volta.

- **Teste (local, não commitado):** `test_empregabilidade_engine.py::TestPosCandidaturaNegacaoIgnorada`
- **Sugestão:** aplicar o mesmo padrão de `oferta_banco_talentos`.

### EMP-04 — `menu_pos_vaga` reinterpreta a resposta contra um menu diferente

**Arquivo:** `empregabilidade_engine.py:1101-1106`.

Depois de criar uma vaga, o menu é `1=Divulgar outra vaga / 2=Acompanhar candidatos / 3=Encerrar`. Mas o dispatch dessa etapa não interpreta a resposta contra essas opções — só troca a etapa pra `menu_empresa_acoes` e reprocessa o **mesmo texto**, cujo menu real é `1=Cadastrar nova vaga / 2=Consultar status / 3=Editar uma vaga / 4=Cancelar`. Uma empresa que responde "3" pensando em "Encerrar" acaba, sem perceber, no fluxo de **edição de vaga**.

- **Teste (local, não commitado):** `test_empregabilidade_engine.py::TestMenuPosVagaReinterpretaResposta`
- **Sugestão:** `menu_pos_vaga` precisa do próprio dispatch, não delegar cegamente pra `menu_empresa_acoes`.

---

## 🟠 Demais achados (da auditoria de 17/07, mantidos como estavam — não re-verificados linha a linha nesta consolidação)

| # | Achado | Categoria | Evidência | Esforço | Confiança | Nota |
|---|---|---|---|---|---|---|
| 6 | `_set_fluxo` refaz o `select` que `_get_fluxo` já fez (redundante) + risco de lost-update contra o loop de notificação (roda a cada 20s, independente do dispatch) | perf + bug | `:178-188`, `:2160-2166`, `:2595-2799` | M | HIGH/MED | fix natural: `_set_fluxo` aceitar o dict já em mãos + trava por `conversa_id` (mesmo padrão do debounce em `meta_adapter_inbound.py`) |
| 9 | N+1 em 2 telas de listagem (candidaturas por vaga, título de vaga por candidatura) | perf | `:1219-1237`, `:1349-1352` | S | HIGH | troca por `.in_(...)` + agrupamento em Python |
| 10 | Regex de número de vaga (`\b(\d{1,4})\b`) pode capturar dígito de CNPJ/data — `\b` não barra pontuação | bug | `:487`, `:570`, `:1192`, `:1775`, `:1812`, `:1888` | S | MED | ex.: "CNPJ 12.345.678/0001-95, editar vaga 3" pode casar "12" |
| 11 | Menu de 4 opções duplicado 10x como string (1 cópia já divergiu, `:646` diz "Encerrar" em vez de "Cancelar uma vaga"); 7 tuplas de afirmativo divergentes | tech-debt | menu: `:387,404,456,541,643,687,929,2659,2693,2725`; afirmativo: `:616,826,872,913,2291,2340,2351` | S/M | HIGH | consolidar exige revisão etapa-a-etapa, não find-replace cego |
| 12 | Links do portal levam `empresa_id`/`vaga_id`/telefone/nome crus na query string, sem assinatura nem expiração | security | `:513`, `:1023`, `:1035`, `:2087-2088` | M | MED (parte que falta é do lado do portal Next.js) | WhatsApp é trivialmente encaminhável; se o portal confia só na URL, é capability-URL sem proteção |
| 13 | 2 pontos gravam estado **antes** de enviar mensagem — se o envio falhar, próxima mensagem do usuário cai no handler errado | bug | `:1826-1832`, `:1962-1972` | S | MED | resto do arquivo faz enviar-depois-persistir; esses 2 são exceção |
| 14 | Mocks de Supabase nos testes nunca verificam formato da query — bug de coluna/filtro passaria despercebido por todos os testes existentes | tests | zero `.assert_called_with` contra mock de `supabase` | S | HIGH | complementa TEST-01 |
| 15 | Loop de notificação faz 1 busca de lead por conversa num `for` (N+1); query externa sem `.limit()` | perf | `:2606-2608`, `:2611-2634` | S/M | HIGH/MED | batch via `.in_("id", [...])`; limitar externa pode precisar coluna gerada |
| 16 | Fluxos candidato/público quase sem teste além dos escape hatches | tests | `_rotear_por_intencao` só tem teste pro branch `ambiguo`; ~30 etapas sem hit | L | HIGH | priorizar as 4 branches de `_rotear_por_intencao` primeiro |
| 17 | CNPJ completo em log de erro, sem o mascaramento que telefone já tem | security | `:138` vs. `:2172,2205,2491` | S | HIGH | inconsistência pontual, fácil de alinhar |
| Cosmético | Parâmetro `token` de `_enviar()` nunca usado (sempre lê de env direto) | tech-debt | `:96` | — | — | enganoso pra quem for mexer depois |

---

## Perguntas em aberto para o Valmir (herdadas da auditoria de 17/07, ainda sem resposta)

1. **SEC-01** — existe alguma verificação fora deste arquivo (portal, passo manual da equipe) que hoje mitiga isso na prática, ou o CNPJ é realmente o único fator?
2. **Achado #12** — só quem tem visão do portal Next.js pode confirmar se a rota que recebe `vaga_id`/`empresa_id` da URL faz checagem de sessão própria antes de aceitar a edição.
3. **Etapas "legado"** (`menu_empresa_retomada`, `perguntando_unidade_vaga`) — pede pra rodar a query de contagem antes de decidir se remove.
