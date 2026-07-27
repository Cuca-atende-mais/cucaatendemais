# S-WM-56 — Disparo de divulgação/programação mensal também grava o breadcrumb `ultimo_disparo`

## Status
Draft — **BLOQUEADA até a S-WM-55 (Plano 004) estar DONE.** Não iniciar Task 1 antes disso — ver Dependências.

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

- [ ] **Task 0 — Confirmar pré-requisito** (bloqueante)
  - [ ] Confirmar que a S-WM-55 (Plano 004) está com Status `Done` antes de iniciar qualquer código. Se não estiver, HALT e reportar — não seguir mesmo que pareça simples adicionar o 3º chamador antes.
- [ ] **Task 1 — Query com `id`** (AC: 1)
  - [ ] Adicionar `id` ao select de `_query_leads_divulgacao_sync`.
- [ ] **Task 2 — Breadcrumb no disparo mensal** (AC: 2, 3)
  - [ ] Adicionar a gravação do breadcrumb no branch `if ok:`, em `try/except` próprio.
- [ ] **Task 3 — Testes** (AC: 2, 3, 5)
  - [ ] 3 testes: select com `id`, breadcrumb gravado em sucesso, breadcrumb não gravado em falha.
- [ ] **Task 4 — Fechamento** (AC: 4, 5, 6)
  - [ ] Suíte completa sem regressão.
  - [ ] Se houver validação com envio real, confirmar categoria "Equipe Interna — QA" exclusivamente.
  - [ ] File List e Change Log atualizados.
  - [ ] Anunciar conclusão e recomendar @qa.

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

## Dev Agent Record
_A ser preenchido pelo @dev durante a implementação._

## QA Results
_A ser preenchido pelo @qa após a implementação._
