# S-WM-23 — AUD-12: opt-out (LGPD) com efeito real

## Status
Ready for Review

## Complexidade
**S/M** (pequeno-médio) — a peça mais difícil (RPC de banco) já existe e está testada em produção (`registrar_opt_out`); o trabalho é só religar: detectar a intenção na mensagem inbound e chamar a RPC. Risco baixo tecnicamente, mas prioridade máxima por ser LGPD.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - pytest worker/tests/ → detecção de opt-out + chamada da RPC testadas, sem regressão
  - grep -n "registrar_opt_out" worker/*.py → confirma que a RPC deixou de ser código morto
  - MCP execute_sql (cuca-dev, read-only) → confirmar leads.opt_in e historico_opt_in reagem à chamada real em teste
  - grep -n "opt_in" worker/campanhas_engine.py → confirmar que os pontos de disparo em massa continuam filtrando por opt_in=True (não regredir o que já funciona)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que quando um lead pedir pra sair ("SAIR"/"PARAR"/"CANCELAR" e variações claras), isso registre `opt_in=false` de verdade no banco,
**para que** o opt-out tenha efeito real em disparos em massa futuros — hoje é só um gesto sem consequência, o que é um risco de LGPD, não só uma frescura de UX.

## Contexto e Problema

Achado AUD-12, prioridade máxima nesta rodada por ser risco de negócio (LGPD), confirmado por investigação de código nesta sessão:

- A função `registrar_opt_out(p_telefone, p_motivo)` **já existe no banco** (`schema_producao.sql`): busca o lead pelo telefone, seta `leads.opt_in = false`, grava uma linha em `historico_opt_in`. Pronta, testada estruturalmente (é SQL simples), só não é chamada por ninguém.
- `grep -rn "registrar_opt_out"` no repo inteiro (Python + TS) → **zero call sites**. A função é código morto do lado de quem deveria chamá-la.
- `grep -rn "sair|SAIR|opt.out|cancelar|parar"` em `worker/meta_adapter_inbound.py` → **nenhuma detecção de intenção de opt-out existe hoje** em nenhum agente/canal.
- O **consumo** já está certo: `worker/campanhas_engine.py` já filtra por `.eq("opt_in", True)` em 3 pontos (linhas 83, 91, 108) — ou seja, se `opt_in` fosse `false`, o lead já ficaria de fora do disparo em massa. **O gap é só a escrita**: nada nunca grava `opt_in=false` a partir de uma ação do lead.

**Preservar (herdado do MAPA antigo de auditoria, reafirmado aqui):** dois caminhos que não podem se misturar — lead **cadastrado** que recebe campanha em massa (aqui `opt_in` deve filtrar, é o que esta story conserta) vs. lead **não cadastrado** entrando pelo portão de entrada livre (não pode ser bloqueado por opt-out; já funciona assim hoje, preservar, não é escopo mudar).

## Escopo

### IN
1. Detectar intenção de opt-out na mensagem inbound do lead (ex.: "sair", "parar", "cancelar", variações razoáveis). **Decisão recomendada, não travada:** preferir detecção determinística (keyword/regex, mesmo padrão simples já usado em outros pontos do worker) em vez de depender de LLM — é uma decisão binária sem ambiguidade real de negócio, e confiabilidade importa mais que sofisticação aqui (é LGPD). Se o @dev/@architect avaliar que faz mais sentido technically emitir isso como sinal do motor-agente (ex.: nova chave no contrato semântico), documentar o porquê antes de codar.
2. Ao detectar, chamar a RPC `registrar_opt_out(p_telefone, p_motivo)` (via `supabase.rpc(...)`, mesmo padrão já usado no worker para outras RPCs).
3. Responder ao lead confirmando o opt-out de forma clara (texto simples, tom da persona atual do canal).
4. Confirmar (via MCP read-only, `.mcp.dev.json`) que os 3 pontos de `campanhas_engine.py` que já filtram por `opt_in` cobrem **todos** os caminhos reais de disparo em massa hoje — mapear antes de codar, documentar no PR se achar algum ponto de disparo que NÃO filtra (não presumir que os 3 já vistos são exaustivos).
5. Testes automatizados (`pytest`) cobrindo detecção + chamada da RPC + ausência de falso positivo em mensagens comuns.

### OUT
- Opt-in (re-adesão de quem já saiu) — não pedido, fora de escopo.
- Mudar o mecanismo de disparo em massa em si (`campanhas_engine.py`) além de confirmar que os filtros existentes cobrem tudo.
- Caminho de entrada livre (lead não cadastrado) — não pode ser tocado, já funciona sem checar `opt_in`, preservar.
- Deploy — nenhum automático. `supabase functions deploy`/redeploy do worker são só sugeridos ao final.
- Qualquer mudança de schema — a RPC e a tabela `historico_opt_in` já existem; se durante a implementação for encontrada necessidade real de mudança de schema, **parar e avisar antes de aplicar**.

## Acceptance Criteria

1. **Given** um lead manda uma mensagem clara de opt-out (ex.: "sair", "pode parar de mandar mensagem", "cancelar"), **when** processada, **then** `registrar_opt_out` é chamado com o telefone do lead, e o teste confirma a chamada (mock da RPC) com o argumento certo.
2. **Given** o opt-out foi registrado, **when** o lead recebe a resposta, **then** o texto confirma claramente que ele não vai mais receber campanhas/disparos em massa (não uma mensagem genérica).
3. **Given** uma mensagem comum de acompanhamento (ex.: "quero saber os horários", "obrigado"), **when** processada, **then** `registrar_opt_out` **não** é chamado — sem falso positivo.
4. **Given** um lead com `opt_in=false` já registrado, **when** uma campanha em massa roda (teste de regressão em `campanhas_engine.py`), **then** esse lead continua fora do disparo — comportamento já existente, não pode regredir.
5. **Given** um lead **não cadastrado** entrando pela primeira vez (caminho de entrada livre), **when** processado, **then** o acesso não é bloqueado por `opt_in` de forma alguma — preserva o comportamento atual desse caminho.
6. **Given** a suíte `pytest worker/tests/`, **when** executada após a implementação, **then** passa sem regressão do baseline vigente, com os testes novos desta story incluídos.
7. Nenhum deploy é executado por esta story — próximos passos são só sugeridos.

## Tasks / Subtasks

- [x] **Task 1 — Mapeamento (pré-requisito, antes de qualquer código)** (AC: 4)
  - [x] Confirmado (via `grep`, não precisou MCP) que os 3 pontos de `campanhas_engine.py` cobrem 100% dos disparos em massa do worker.
- [x] **Task 2 — Detecção de opt-out + chamada da RPC** (AC: 1, 2, 3)
  - [x] Implementada detecção determinística (regex específico, não palavra solta).
  - [x] `registrar_opt_out` chamado via RPC quando detectado.
  - [x] Confirmação clara enviada ao lead.
  - [x] Testes `pytest`: 5 novos, incluindo os casos-armadilha do risco documentado.
  - [x] **Reportado no Dev Agent Record** — ver acima.
- [x] **Task 3 — Fechamento** (AC: 5, 6, 7)
  - [x] `pytest worker/tests/`: 128 passed/3 skipped, sem regressão.
  - [x] File List e Change Log atualizados.
  - [x] Conclusão anunciada, recomendando @qa.

## Dev Notes

### Touch points confirmados nesta investigação
- `schema_producao.sql` (linha ~784): definição de `registrar_opt_out(p_telefone, p_motivo)` — já existe, não precisa criar.
- `worker/campanhas_engine.py` (linhas 83, 91, 108): 3 pontos já filtram por `opt_in=True` — não mexer, só confirmar cobertura (Task 1).
- `worker/meta_adapter_inbound.py`: ponto de entrada da mensagem inbound — provável lugar pra adicionar a detecção, mas @dev decide o ponto exato durante a implementação.

### Testing
- Padrão `pytest` já estabelecido em `worker/tests/test_meta_adapter_inbound.py` (mocks de `MagicMock`/`AsyncMock`, `patch` de RPCs).

## Dependências
- Nenhuma dependência técnica com outras stories desta leva.

## Riscos
- Falso positivo na detecção (ex.: "vou sair de férias") registrando opt-out indevido — mitigar com keywords/frases específicas o suficiente, testar explicitamente frases parecidas mas não-opt-out.
- Se o mapeamento da Task 1 encontrar um ponto de disparo em massa que NÃO filtra por `opt_in`, isso vira um achado novo que pode expandir o escopo — documentar e HALT para decisão antes de tentar corrigir "de graça" dentro desta story.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-11 | 0.1 | Draft inicial — AUD-12, prioridade máxima (LGPD), a pedido de Junior | @sm River |
| 2026-07-11 | 0.2 | Validado (GO, 10/10). Sem lacuna que exigisse ajuste — escopo, AC e riscos já completos. Status Draft → Ready | @po Pax |
| 2026-07-11 | 0.3 | Implementadas as 3 Tasks. Achado de ambiente: MCP mudou de `.mcp.dev.json` pra `.mcp.prod.json` (confirmado por Junior, HALT feito antes de prosseguir). `pytest`: 128 passed/3 skipped (baseline 123, +5 novos), sem regressão. Status Ready → Ready for Review | @dev Dex |

## Dev Agent Record

### ⚠️ Achado durante a implementação: mudança de ambiente MCP
A story (e a regra `.claude/rules/cuca-deploy-environments.md`) previa MCP read-only contra **cuca-dev** (`.mcp.dev.json`). Ao iniciar a Task 1, a sessão MCP conectada estava em **produção** (`svzkrkfzpiqcesloukgb`) — HALT imediato, sinalizado ao Junior antes de rodar qualquer query. Junior confirmou explicitamente: o projeto não usa mais `.mcp.dev.json`, a sessão correta agora é `.mcp.prod.json` (leitura E escrita), mantendo a mesma sequência de sempre (código pronto → escrita no Supabase confirmada com sucesso → só então commit). Prosseguido com essa confirmação. Registrando aqui pra não repetir o HALT em toda story futura desta leva.

### Task 1 — Mapeamento (concluída)
Investigação por `grep` (não precisou de MCP — é uma questão de cobertura de código, não de dado): confirmado que os 3 pontos de `campanhas_engine.py` que filtram `opt_in=True` (`_query_leads_sync`, usado em `_processar_item_disparo_interno` linha 289; `_query_leads_divulgacao_sync`, usado em `_processar_disparo_divulgacao_interno` linha 543) são as **únicas** queries em massa (`.table("leads")` sem `.eq("id", ...)`) em todo o `worker/`. Os demais `.table("leads")` do repo (`empregabilidade_engine.py`, `meta_adapter_inbound.py`) são todos lookups de 1 lead (`.single()`/`.maybe_single()` por id), não disparo em massa — irrelevantes pro escopo desta story. Cobertura confirmada 100%, nenhum ponto de disparo em massa passa batido do filtro de `opt_in`.

### Task 2 — Detecção + RPC (concluída)
Implementado `_eh_pedido_opt_out` (função pura, `meta_adapter_inbound.py`) com padrões regex deliberadamente específicos, não uma palavra solta — testei manualmente antes de escrever o teste formal e encontrei um falso positivo real na primeira versão (`\bquero\s+(sair|cancelar)\b` batia em "quero sair pra jantar hoje", exatamente o risco que a story já tinha antecipado) — corrigido restringindo o padrão de "sair" a exigir contexto explícito (`quero sair da lista/das mensagens/de receber/do whatsapp/desse número`), mantendo "quero cancelar" solto (risco de falso positivo bem menor).

Interceptação adicionada em `processar_webhook_meta`, entre o registro da mensagem inbound (DB C) e o guard de `awaiting_human` — se detectado: chama `registrar_opt_out` via RPC (best-effort, não propaga exceção), salva e envia confirmação direto ao lead, **retorna sem chamar `_agendar_dispatch_debounced`** (não roteia pro motor-agente/Empregabilidade).

`pytest tests/`: **128 passed | 3 skipped** (baseline 123, herdado da S-WM-22, +5 testes novos desta Task) — zero regressão.

Testes novos:
- `test_detecta_pedidos_claros_de_opt_out` / `test_nao_confunde_mensagens_comuns_com_opt_out` — função pura, incluindo os casos-armadilha da story ("vou sair de férias", "quero sair pra jantar").
- `test_mensagem_de_opt_out_chama_rpc_e_nao_despacha_pro_motor_agente` (AC1/AC3) — RPC chamada com o telefone certo, `_chamar_motor_agente` NÃO chamado.
- `test_mensagem_comum_nao_chama_registrar_opt_out_e_segue_dispatch_normal` (AC3, regressão) — mensagem comum não aciona RPC, dispatch normal preservado.
- `test_falha_ao_registrar_opt_out_nao_quebra_o_fluxo` — RPC falhando (exceção simulada) ainda assim confirma pro lead, sem propagar erro.

### Task 3 — Fechamento (concluída)

**AC5 (entrada livre não bloqueada):** satisfeito por construção, não por teste novo — a implementação não tocou em NENHUM ponto de checagem de acesso/entrada (só adicionou detecção de opt-out, que grava um sinal, nunca lê `opt_in` pra decidir se atende ou não o lead). Confirmável por `grep -n "opt_in" worker/meta_adapter_inbound.py` — só aparece dentro do bloco novo de opt-out (chamada da RPC), nunca como condição de bloqueio de entrada.

`pytest worker/tests/` (final): **128 passed | 3 skipped**, mesmo resultado da Task 2 (nenhuma mudança adicional nesta Task).

**File List:**
- `worker/meta_adapter_inbound.py` — `import re`, `_PADROES_OPT_OUT`/`_eh_pedido_opt_out`, interceptação em `processar_webhook_meta`.
- `worker/tests/test_meta_adapter_inbound.py` — classe `TestOptOutAud12` (5 testes novos).

**Próximo passo sugerido (manual, não executado):** nenhum deploy — redeploy do `cuca-worker` fica pra depois do gate da @qa e autorização do Junior.

**Recomendação:** chamar @qa Quinn pro gate desta story (junto com a S-WM-30). @qa e @devops não foram acionados por mim.

## QA Results
_A ser preenchido pelo @qa após a implementação._
