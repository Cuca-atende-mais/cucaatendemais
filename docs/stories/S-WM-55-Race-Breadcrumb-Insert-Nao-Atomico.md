# S-WM-55 — Corrigir corrida no caminho de INSERT do breadcrumb de disparo (achado #5 revisado)

## Status
Draft

## Origem
Investigação "Corrida da Juventude" (disparo de 724 leads, 24/07/2026) — `docs/qa/DIAGNOSTICO-disparo-corrida-juventude-2026-07-27.md`, achado #3 (caso real confirmado: lead Glauwênya recebeu "De novo, foi mal!" em resposta a agradecimento). Plano técnico completo, com o diff exato do retry atômico, preservado integralmente em `docs/qa/planos-corrida-juventude/004-race-breadcrumb-insert-nao-atomico.md` — usar esse arquivo como referência técnica primária, não este resumo. Elaborado em 2026-07-25 (commit base `256d547`), continuação direta do PR #53/#54 (S-WM-31, já em produção). Formalizada em story por @sm em 2026-07-27, setup de teste ("Equipe Interna — QA") já criado e confirmado.

## Complexidade
**S** — 1 função (`_gravar_breadcrumb_disparo`), adiciona retry no ramo de INSERT.

## Prioridade
P2 — corrida de concorrência com causa raiz confirmada em produção (caso real, não hipotético). **Bloqueia a S-WM-56** (Plano 005) — precisa estar DONE antes dela.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd worker && pytest tests/test_campanhas_engine.py -v → todos passam, incluindo o teste novo e os 2 já existentes de _gravar_breadcrumb_disparo sem alteração
  - cd worker && pytest tests/ -v → suíte completa sem regressão
  - grep -n "except Exception" worker/campanhas_engine.py → confirma o novo bloco de retry dentro de _gravar_breadcrumb_disparo
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que o caminho de criação de conversa nova em `_gravar_breadcrumb_disparo` seja resiliente a uma corrida com o fluxo inbound,
**para que** o breadcrumb `ultimo_disparo` nunca seja perdido quando a auto-resposta do WhatsApp Business do lead chega quase ao mesmo tempo do disparo — sem esse campo, o mecanismo que já reconhece disparo recente (`deveReconhecerDisparoRecente`, PR #55, já em produção) não tem como agir, e o lead cai na resposta canned de cortesia genérica.

## Contexto e Problema — causa raiz mais profunda que o achado #5 original

O PR #53/#54 (S-WM-31, já mergeado) corrigiu `_gravar_breadcrumb_disparo` pra **mesclar** `metadata` em vez de sobrescrever — mas o caminho de **criação** de conversa nova continua usando um `.insert()` simples, **não atômico**, enquanto o caminho equivalente do fluxo inbound (`worker/meta_adapter_inbound.py:604-613`, já corrigido desde a S-WM-31) usa `.upsert(..., on_conflict="lead_id,origem_id")`.

Isso cria uma corrida real: se a auto-resposta do WhatsApp Business do lead (comum em números comerciais — confirmado que uma fração real dos 724 destinatários eram números comerciais) chega **quase ao mesmo tempo** que `_gravar_breadcrumb_disparo` tenta gravar o breadcrumb pela primeira vez, os dois processos competem pra criar a MESMA linha `conversas`. O fluxo inbound (atômico) sempre vence sem erro. `_gravar_breadcrumb_disparo`, quando perde a corrida, tenta um `INSERT` numa linha que já existe (`UNIQUE(lead_id, origem_id)`, desde a S-WM-31) — a exceção é engolida silenciosamente pelo `except Exception as bc_err: logger.warning(...)` do chamador, e **o breadcrumb nunca é gravado**.

Confirmado no caso real da Glauwênya: sua conversa tinha `metadata = {"conversa_engajada": true, "aguardando_unidade": false}` — **sem `ultimo_disparo`**. O 1º evento da conversa dela, minutos antes, é literalmente a resposta automática de ausência do WhatsApp Business dela — exatamente o cenário de corrida descrito. **Corrigir esta corrida é o que faz o PR #55 funcionar pros leads que caem nesse cenário — não é preciso mexer em nenhuma resposta canned.**

## Escopo

### IN
1. Em `worker/campanhas_engine.py::_gravar_breadcrumb_disparo`, no ramo `else` (hoje um `INSERT` simples): envolver em `try/except`; se o `INSERT` falhar (violação de `UNIQUE(lead_id, origem_id)` — a linha foi criada por outra escrita entre o `SELECT` e este `INSERT`), re-buscar a linha e refazer o merge de metadata via `UPDATE`, em vez de deixar a exceção subir para ser engolida pelo chamador.
2. Se o retry também não encontrar a linha (`existente_retry.data` vazio), **re-propagar** a exceção original (`raise`) — não era corrida, é um erro real.
3. Teste reproduzindo a corrida (1º select vazio → insert lança exceção simulando `UNIQUE` violation → 2º select encontra a linha → confirma que `update` é chamado com metadata mesclado).
4. Mutation check: reverter o retry, confirmar que o teste falha (exceção sobe sem tratamento); restaurar, confirmar que passa.

### OUT
- `worker/meta_adapter_inbound.py` — já correto, é o exemplar a copiar, sem mudança.
- `supabase/functions/motor-agente/index.ts` (`deveReconhecerDisparoRecente`, PR #55) — já correto e testado; esta story só garante que ele *recebe* o dado que precisa.
- Qualquer mudança na resposta canned de cortesia/`evitarRepeticaoLiteral` — depois desta correção, o cenário do achado #5 passa a ser coberto pelo mecanismo do PR #55. Se ainda sobrar algum caso de repetição sem `ultimo_disparo` disponível (cortesia genuína, sem disparo recente nenhum), é comportamento correto, não bug.
- O ramo `if existente.data:` (já correto, mescla metadata em memória) — não trocar `.select(...).limit(1)`.

## Acceptance Criteria

1. **Given** o `INSERT` do ramo de criação falha por violação de `UNIQUE(lead_id, origem_id)` (corrida com o fluxo inbound), **when** `_gravar_breadcrumb_disparo` trata a exceção, **then** re-busca a linha e grava o breadcrumb via `UPDATE` com metadata mesclado — não perdido.
2. **Given** o retry também não encontra a linha, **when** processado, **then** a exceção original é re-propagada (não mascarada como corrida quando não é).
3. **Given** o teste do cenário 1 revertido, **when** rodado, **then** falha (exceção não tratada, ou `update` nunca chamado).
4. **Given** os 2 testes já existentes de `_gravar_breadcrumb_disparo`, **when** a suíte roda após esta mudança, **then** continuam passando sem modificação.
5. `pytest tests/` sai com exit 0, incluindo o teste novo.
6. Nenhum arquivo fora de `worker/campanhas_engine.py` e `worker/tests/test_campanhas_engine.py` é modificado.

## Tasks / Subtasks

- [ ] **Task 1 — Retry atômico no ramo de INSERT** (AC: 1, 2)
  - [ ] Envolver o `INSERT` em `try/except`.
  - [ ] No `except`, re-buscar e refazer merge via `UPDATE`; se não achar, `raise`.
- [ ] **Task 2 — Teste + mutation check** (AC: 3, 4)
  - [ ] Teste reproduzindo a corrida (mock de 1º select vazio, insert lança exceção, 2º select encontra a linha).
  - [ ] Reverter → falha; restaurar → passa.
- [ ] **Task 3 — Fechamento** (AC: 4, 5, 6)
  - [ ] Suíte completa, sem regressão nos 2 testes já existentes.
  - [ ] File List e Change Log atualizados.
  - [ ] Anunciar conclusão e recomendar @qa.

## Dev Notes

- Código antes/depois exato do retry, estrutura do teste de corrida e do mutation check: **`docs/qa/planos-corrida-juventude/004-race-breadcrumb-insert-nao-atomico.md`** — ler por completo antes de editar.
- Avaliar se `except Exception:` genérico proposto mascara outros tipos de erro (ex.: erro de rede) que não são de conflito de constraint — se durante os testes ficar claro que isso é risco real, considerar restringir para um tipo de exceção mais específico (verificar se `postgrest-py`/`supabase-py` expõe exceção tipada pra violação de constraint) antes de prosseguir. Não é bloqueante, é um ponto de atenção do revisor.
- Depois desta correção, vale validar ao vivo (ou aguardar o próximo disparo em massa) se leads com resposta automática de WhatsApp Business passam a ter `ultimo_disparo` gravado e o bot passa a reconhecer o disparo recente.
- Se esse tipo de corrida (insert vs. upsert atômico) aparecer em outro lugar, considerar migrar `_gravar_breadcrumb_disparo` pra uma função RPC atômica no Postgres (mesmo padrão de `claim_evento_pontual`) — fora de escopo desta story.
- **Esta story BLOQUEIA a S-WM-56** (Plano 005): aquela adiciona um 3º chamador à mesma função cuja corrida esta story corrige — fazer 056 antes de 055 aumentaria a exposição à corrida em vez de reduzir. A S-WM-56 deve HALT se pega antes desta estar DONE.

### Testing
`cd worker && pytest tests/test_campanhas_engine.py -v` e depois `pytest tests/` (suíte completa).

## Dependências
Sem dependência técnica de entrada (é uma continuação direta da S-WM-31, já mergeada — não repete o trabalho dela). **Bloqueia a S-WM-56** — precisa estar DONE antes.

## Git workflow
Branch: `fix/race-breadcrumb-insert-nao-atomico`. Commit único, ex.: `fix(campanhas): corrige corrida no insert do breadcrumb de disparo via retry atomico`. Não dar push/PR sem autorização explícita.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-27 | 0.1 | Story criada a partir do Plano 004 (investigação "Corrida da Juventude", 2026-07-25). 4ª story da leva — sem dependência de entrada, mas bloqueia a S-WM-56 (precisa estar DONE antes dela). | @sm River |

## Dev Agent Record
_A ser preenchido pelo @dev durante a implementação._

## QA Results
_A ser preenchido pelo @qa após a implementação._
