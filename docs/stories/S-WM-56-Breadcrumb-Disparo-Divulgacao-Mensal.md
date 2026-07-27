# S-WM-56 — Disparo de divulgação/programação mensal também grava o breadcrumb `ultimo_disparo`

## Status
Ready for Review

## Origem
Investigação "Corrida da Juventude" (disparo de 724 leads, 24/07/2026) — `docs/qa/DIAGNOSTICO-disparo-corrida-juventude-2026-07-27.md`, achado #3b + diagnóstico arquitetural (seção 4). Plano técnico completo, com o diff exato dos 2 pontos de mudança, preservado integralmente em `docs/qa/planos-corrida-juventude/005-breadcrumb-disparo-divulgacao-mensal.md` — usar esse arquivo como referência técnica primária, não este resumo. Elaborado em 2026-07-26 (commit base `256d547`), retomando uma pergunta direta do Junior sobre paridade entre os 3 motores de disparo que compartilham o número Institucional. Formalizada em story por @sm em 2026-07-27, setup de teste ("Equipe Interna — QA") já criado e confirmado.

## Complexidade
**S** — 1 campo a mais numa query (`id`) + 1 bloco de breadcrumb a mais, espelhando um padrão já existente nos outros 2 motores.

## Prioridade
P2 — lacuna de paridade (feature nunca existiu nesse motor, não é regressão), mas mesma classe de sintoma do achado #5: lead que responde logo após o disparo de divulgação mensal não tem reconhecimento de disparo recente.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd worker && python -m pytest tests/test_campanhas_engine.py -v → todos passam, incluindo os 3 testes novos
  - cd worker && python -m pytest tests/ -v → suíte completa sem regressão
  - grep -n '"id, telefone, nome"' worker/campanhas_engine.py → confirma _query_leads_divulgacao_sync atualizada
  - grep -n 'divulgacao_mensal' worker/campanhas_engine.py → confirma o novo tipo de breadcrumb
  - Envio real de validação (se houver): SOMENTE para a categoria "Equipe Interna — QA" (id 6e39d871-c640-41f8-b19d-ed3a3a97a9f8) — nunca para a base real de leads
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que o disparo de divulgação/programação mensal também grave o breadcrumb `metadata.ultimo_disparo` na conversa do lead,
**para que** os 3 motores que compartilham o número Institucional (eventos_pontuais, ouvidoria_eventos, divulgação mensal) tenham paridade — hoje só os 2 primeiros gravam esse campo, e sem ele o mecanismo `deveReconhecerDisparoRecente` (motor-agente) não tem como reconhecer que o lead acabou de receber um disparo nosso.

## Contexto e Problema

Três mecanismos mandam WhatsApp pelo mesmo número Institucional e leem/escrevem a mesma `conversas`: (1) `eventos_pontuais`, (2) `ouvidoria_eventos`, (3) divulgação/programação mensal. Os 2 primeiros gravam `metadata.ultimo_disparo` logo após um envio bem-sucedido; o 3º não grava nada. `deveReconhecerDisparoRecente()` e o bloco de prompt `CONTEXTO_DISPARO` (`supabase/functions/motor-agente/index.ts`) dependem inteiramente desse campo estar presente pra deixar o bot reconhecer "você acabou de receber um disparo nosso" em vez de cair numa resposta canned de cortesia. Um lead que responde logo depois do disparo mensal não tem nenhum desse reconhecimento — mesma classe de sintoma do achado #5, por razão estrutural (campo nunca escrito), não corrida.

`motor-agente/index.ts` **não precisa mudar**: `deveReconhecerDisparoRecente`/`CONTEXTO_DISPARO` só leem `metadata.ultimo_disparo.enviado_em`/`.titulo`, não brancham no campo `tipo` do breadcrumb.

## Escopo

### IN
1. `_query_leads_divulgacao_sync` (`worker/campanhas_engine.py`) — adicionar `id` ao select (hoje só `telefone, nome`), necessário pra ter `lead_id` disponível no loop.
2. `_processar_disparo_divulgacao_interno` — no branch `if ok:` do envio, adicionar a gravação do breadcrumb via `_gravar_breadcrumb_disparo(lead_id, phone_number_id, breadcrumb)`, com `breadcrumb = {"ultimo_disparo": {"tipo": "divulgacao_mensal", "id": str(disparo_id), "titulo": f"Programação de {mes_nome}", "enviado_em": ...}}` — mesmo padrão do `eventos_pontuais`, sempre em `try/except` próprio (`logger.warning`), nunca deixando uma falha de breadcrumb virar erro contado nas métricas de disparo (`enviados`/`erros`).
3. Testes: 1 confirmando que a query seleciona `id`; 1 confirmando que o breadcrumb é gravado após envio bem-sucedido com o `tipo`/`id` corretos; 1 confirmando que **não** é gravado quando o envio falha.

### OUT
- `_gravar_breadcrumb_disparo` internamente — território da S-WM-55, esta story só adiciona um **3º chamador**, não muda a função.
- `_processar_item_disparo_interno` / `eventos_pontuais` / `ouvidoria_eventos` — já corretos, não mexer.
- `supabase/functions/motor-agente/index.ts` — confirmado que não precisa mudar; se durante a implementação parecer que precisa, é sinal de que uma premissa desta story está errada — parar e reportar, não seguir sozinho.
- Qualquer mudança em `disparos_divulgacao`/`_update_metricas_sync` — bookkeeping de métricas não muda.

## Acceptance Criteria

1. **Given** `_query_leads_divulgacao_sync()` após a mudança, **when** inspecionado, **then** o select inclui `id` além de `telefone, nome`.
2. **Given** um envio de divulgação mensal bem-sucedido, **when** processado, **then** `_gravar_breadcrumb_disparo` é chamado com `breadcrumb["ultimo_disparo"]["tipo"] == "divulgacao_mensal"` e `["id"] == str(disparo_id)`.
3. **Given** um envio que falha, **when** processado, **then** `_gravar_breadcrumb_disparo` **não** é chamado, e o bookkeeping de `erros` continua incrementando normalmente.
4. **Given** qualquer validação com envio real (não mock), **when** executada, **then** é feita **exclusivamente** contra a categoria "Equipe Interna — QA" (4 números confirmados, id da categoria `6e39d871-c640-41f8-b19d-ed3a3a97a9f8`) — nunca contra a base real de leads.
5. `python -m pytest tests/test_campanhas_engine.py -v` e depois `tests/` completo → todos passam, incluindo os 3 testes novos.
6. Nenhum arquivo fora de `worker/campanhas_engine.py` e `worker/tests/test_campanhas_engine.py` é modificado.

## Tasks / Subtasks

- [x] **Task 0 — Confirmar pré-requisito** (bloqueante)
  - [x] Confirmado que a S-WM-55 (Plano 004) está `Done` (mergeada em `main`, `cuca-worker` redeployado) antes de iniciar qualquer código.
- [x] **Task 1 — Query com `id`** (AC: 1)
  - [x] Adicionado `id` ao select de `_query_leads_divulgacao_sync`.
- [x] **Task 2 — Breadcrumb no disparo mensal** (AC: 2, 3)
  - [x] Adicionada a gravação do breadcrumb no branch `if ok:`, em `try/except` próprio (mesmo padrão do `eventos_pontuais`).
- [x] **Task 3 — Testes + mutation check** (AC: 2, 3, 5)
  - [x] 3 testes: select com `id`, breadcrumb gravado em sucesso, breadcrumb não gravado em falha.
  - [x] Mutation check: Step 1 revertido → teste de select falhou; restaurado → passou. Step 2 revertido → teste de sucesso falhou (0 chamadas); restaurado → passou.
- [x] **Task 4 — Fechamento** (AC: 4, 5, 6)
  - [x] Suíte completa sem regressão: 147 passed (144 baseline + 3 novos), 3 falhas pré-existentes (fora de escopo) inalteradas.
  - [x] Validação com envio real fica para etapa posterior ao @qa, exclusivamente contra "Equipe Interna — QA" — não faz parte do trabalho de implementação (confirmado com a Junior).
  - [x] File List e Change Log atualizados.
  - [x] Anunciado conclusão e recomendado @qa.

## Dev Notes

- Código antes/depois exato dos 2 pontos de mudança (`_query_leads_divulgacao_sync`, `_processar_disparo_divulgacao_interno`) e estrutura dos 3 testes: **`docs/qa/planos-corrida-juventude/005-breadcrumb-disparo-divulgacao-mensal.md`** — ler por completo antes de editar.
- Modelo de mock a seguir: `test_breadcrumb_cria_conversa_nova_quando_lead_nunca_falou_com_o_bot` (estilo de mock de `supabase`) e `test_query_leads_com_categorias_alvo_usa_rpc_nao_monta_lista_de_ids` (estilo de mock de `_query_*`) — ambos já em `worker/tests/test_campanhas_engine.py`.
- Monkeypatch `_gravar_breadcrumb_disparo` diretamente (MagicMock) nos testes desta story, em vez de mockar o `supabase` interno que ela usa — o foco aqui é a "fiação" do chamador (argumentos certos), não o comportamento interno da função (já coberto pelos testes da S-WM-55).
- Se um 4º motor de disparo for adicionado no futuro no mesmo número Institucional, considerar extrair "enviar + gravar breadcrumb" num helper único — não faz parte desta story, mantém o diff mínimo.
- **Dependência real, não só sequenciamento:** esta story adiciona um 3º chamador a `_gravar_breadcrumb_disparo`, cuja corrida no ramo de criação a S-WM-55 corrige. Rodar esta story antes da S-WM-55 estar DONE aumenta a exposição à corrida em vez de reduzi-la — por isso Task 0 é bloqueante.

### Testing
`cd worker && python -m pytest tests/test_campanhas_engine.py -v` e depois `python -m pytest tests/ -v` (suíte completa).

## Dependências
**BLOQUEADA pela S-WM-55** — precisa estar `Done` antes de iniciar. Sem essa dependência satisfeita, esta story não deve avançar além da Task 0.

## Git workflow
Branch: `fix/breadcrumb-divulgacao-mensal`. Commit único, ex.: `feat(campanhas): grava breadcrumb de disparo tambem no envio de divulgacao mensal`. Não dar push/PR sem autorização explícita.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-27 | 0.1 | Story criada a partir do Plano 005 (investigação "Corrida da Juventude", 2026-07-26). 5ª story da leva — BLOQUEADA até a S-WM-55 fechar (adiciona 3º chamador à função cuja corrida aquela story corrige). | @sm River |
| 2026-07-27 | 0.2 | Implementada em branch isolada `fix/breadcrumb-divulgacao-mensal` (a partir de `origin/main`, já com S-WM-52 a S-WM-55). Sem drift. 3 testes novos + mutation check duplo. Suíte: 147/0/3(pré-existentes). Status Draft → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- Pré-requisito confirmado: S-WM-55 mergeada em `main`, `cuca-worker` redeployado (comunicado pela Junior antes de iniciar).
- Drift check (`git diff --stat 256d547..HEAD -- worker/campanhas_engine.py worker/tests/test_campanhas_engine.py`): mostra as S-WM-52/53/55 (esperado — S-WM-53/54 não tocam este arquivo). `_query_leads_divulgacao_sync` e `_processar_disparo_divulgacao_interno` conferidos linha a linha contra o "Current state" do plano — idênticos.
- Baseline: `pytest tests/test_campanhas_engine.py -q` → 19 passed. `pytest tests/ -q` → 144 passed, 3 failed (pré-existentes).
- Implementado: `id` adicionado ao select de `_query_leads_divulgacao_sync`; bloco de breadcrumb adicionado ao branch `if ok:` de `_processar_disparo_divulgacao_interno`, com `try/except` próprio (`logger.warning`), nunca afetando `enviados`/`erros`.
- 3 testes novos: `test_query_leads_divulgacao_seleciona_id`, `test_disparo_divulgacao_grava_breadcrumb_apos_envio_com_sucesso`, `test_disparo_divulgacao_nao_grava_breadcrumb_quando_envio_falha` — monkeypatch direto de `_gravar_breadcrumb_disparo` (não mock do `supabase` interno dela), conforme os Dev Notes pediam; `supabase` mockado só pro lookup de `meta_templates` que a função faz antes do loop.
- Suíte pós-mudança: `pytest tests/test_campanhas_engine.py -q` → 22 passed (19 + 3 novos). `pytest tests/ -q` → 147 passed, mesmas 3 falhas pré-existentes.
- Mutation check: Step 1 revertido (removido `id` do select, isolando só essa função — `_query_leads_sync` tem a mesma string de select coincidentemente, tomei cuidado de reverter só o bloco certo) → `test_query_leads_divulgacao_seleciona_id` falhou (`select('telefone, nome')` != esperado `select('id, telefone, nome')`). Restaurado → passou. Step 2 revertido (bloco de breadcrumb inteiro removido) → `test_disparo_divulgacao_grava_breadcrumb_apos_envio_com_sucesso` falhou ("Called 0 times"); o teste de falha continuou passando (esperado, é uma asserção negativa que também é verdade sem o bloco). Restaurado → ambos passaram.
- `grep -n '"id, telefone, nome"'` → 2 ocorrências (linha 156 pré-existente de `_query_leads_sync`, linha 173 desta story em `_query_leads_divulgacao_sync`). `grep -n "divulgacao_mensal"` → 1 ocorrência, o `tipo` do breadcrumb novo.

### Completion Notes List
- Implementado exatamente como especificado no plano preservado (`docs/qa/planos-corrida-juventude/005-breadcrumb-disparo-divulgacao-mensal.md`), sem drift real.
- `motor-agente/index.ts` não precisou de nenhuma mudança, confirmando a premissa do plano.
- Nenhuma validação com envio real foi feita nesta etapa — é posterior ao gate do @qa, exclusivamente contra "Equipe Interna — QA", conforme instruído. Esta implementação não abriu nenhum ponto de disparo novo além do já existente (mesmo `phone_number_id`/template institucional dos outros 2 motores) — nada adicional a considerar nesse teste posterior.
- Nenhum arquivo fora de `worker/campanhas_engine.py` e `worker/tests/test_campanhas_engine.py` foi modificado.

### File List
- `worker/campanhas_engine.py` (modificado: `id` no select de `_query_leads_divulgacao_sync`; bloco de breadcrumb em `_processar_disparo_divulgacao_interno`)
- `worker/tests/test_campanhas_engine.py` (modificado: 3 testes novos + helper `_mock_supabase_com_template_divulgacao`, import de `AsyncMock`)

## QA Results
_A ser preenchido pelo @qa após a implementação._
