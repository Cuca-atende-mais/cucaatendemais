# S-WM-57 — Ledger por destinatário de disparo (`logs_disparo`) + consumir `statuses[]` da Meta

## Status
Draft — **BLOQUEADA até a S-WM-56 (Plano 005) estar DONE.** Não iniciar Task 1 (migration) antes disso — ver Dependências.

## Origem
Investigação "Corrida da Juventude" (disparo de 724 leads, 24/07/2026) — `docs/qa/DIAGNOSTICO-disparo-corrida-juventude-2026-07-27.md`, achados arquiteturais nº 2 e nº 3 (seção 4) / achados B e C do diagnóstico arquitetural. Plano técnico completo, com a migration exata, os 6 passos e os 6 testes especificados, preservado integralmente em `docs/qa/planos-corrida-juventude/007-ledger-entrega-e-status-meta.md` — usar esse arquivo como referência técnica primária, não este resumo. Elaborado em 2026-07-26/27 (commit base `256d547`) — **não** dry-run executado ao vivo (sem Postgres disponível na sessão de origem); diff produzido por leitura direta do código, tratar com mais escrutínio que as demais stories da leva. Formalizada em story por @sm em 2026-07-27, setup de teste ("Equipe Interna — QA") já criado e confirmado.

## Complexidade
**L** — maior esforço da leva: 1 migration reativando tabela existente, mudança de assinatura de função com 4 call sites, 2 funções de disparo com novo controle de fluxo (criação de `disparos` antes do loop), novo consumo de webhook, 6 testes novos (nenhum teste prévio cobre as 2 funções de disparo em massa hoje).

## Prioridade
P1 — "maior alavanca" recomendada pelo diagnóstico arquitetural: hoje o sistema só sabe se o POST à Meta teve sucesso HTTP, nunca se a mensagem foi de fato entregue, lida ou falhou — sem isso, não há visibilidade de risco de qualidade/bloqueio do número.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd worker && python -c "import campanhas_engine; import meta_adapter_inbound; import main" → exit 0
  - cd worker && python -m pytest tests/ -v → exit 0, incluindo os 6 testes novos
  - grep -n "def _enviar_template_meta" -A 2 worker/campanhas_engine.py | grep "tuple\[bool, str | None\]" → assinatura atualizada
  - grep -c "logs_disparo" worker/campanhas_engine.py → pelo menos 2 (ambas as funções de disparo escrevem no ledger)
  - grep -n "statuses" worker/meta_adapter_inbound.py → novo bloco de tratamento
  - Query read-only em produção confirmando `logs_disparo` ainda com 0 linhas e sem FK, ANTES de escrever a migration do Step 1 (Task 0, ver abaixo)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** um ledger por destinatário de cada disparo (capturando o `wamid`) e o consumo dos eventos `statuses[]` que a Meta manda (entregue/lido/falhou),
**para que** o sistema saiba, pela primeira vez, distinguir "a Meta aceitou o HTTP" de "a mensagem realmente chegou/foi lida/falhou" — hoje esse dado existe no webhook e é descartado sem leitura.

## Contexto e Problema

Hoje, quando um disparo em massa manda um template WhatsApp, o código só sabe se o **HTTP** da Graph API teve sucesso (`_enviar_template_meta` retorna `bool`) — nunca captura o `wamid` (ID da mensagem Meta) nem lê o array `statuses[]` que o webhook manda depois (entregue/lido/falhou/não-entregue). O handler do webhook já descarta explicitamente todo evento sem `messages[]` (`"Ignorar eventos de status (delivery, read) sem messages[]"`) — hoje isso inclui 100% dos eventos de status.

Duas consequências já observadas na investigação de 24/07: (1) não há como distinguir "aceito pela Meta" de "entregue à pessoa" — se um número está bloqueado/inatingível, o sistema não registra isso; (2) não há visibilidade de risco de qualidade do número (`quality_rating`/`messaging_limit_tier` já existem em `meta_phone_numbers`, nunca populados por nada no repo) — hoje só se percebe um problema de qualidade por reclamação humana.

**Descoberta em 2026-07-27:** a tabela pra isso já existe, abandonada — `public.logs_disparo` (`id, disparo_id, lead_id, telefone, status, erro, enviado_em, created_at`), 0 linhas em produção, código que escrevia nela removido no commit `b8282cd` (S-WM-05, migração UAZAPI→Meta). Esta story **reativa** essa tabela via `ALTER TABLE`, em vez de criar uma 3ª tabela sobreposta no schema.

**Escopo deliberadamente aditivo:** esta story não muda quando uma campanha pausa, retoma ou como leads são selecionados — só registra o que foi enviado, pra quem, e reage a status. A correção do truncamento de `daily_limit` (achado C — campanha marcada "concluída" mesmo com gente faltando) fica pra uma story futura (Plano 008, ainda não escrito), que depende deste ledger e de uma decisão de produto (retomada automática ou manual) ainda não tomada.

## Escopo

### IN
1. **Migration** `supabase/migrations/20260727000000_reativa_logs_disparo_ledger.sql` — `ALTER TABLE logs_disparo ADD COLUMN disparo_divulgacao_id uuid, ADD COLUMN wamid text, ADD COLUMN atualizado_em timestamptz NOT NULL DEFAULT now()`, mais `CHECK` garantindo exatamente um entre `disparo_id`/`disparo_divulgacao_id`, mais 3 índices (`wamid`, `lead_id`, `disparo_divulgacao_id`, todos `WHERE ... IS NOT NULL`). Sem FK (mesmo padrão da tabela hoje).
2. `_enviar_template_meta` (`worker/campanhas_engine.py`) — mudar retorno de `bool` para `tuple[bool, str | None]` (captura `wamid` do body de sucesso da Graph API). Atualizar os **4 call sites** (`campanhas_engine.py:405` e `:601-603` usam o `wamid`; `main.py:330-332` e `meta_adapter_inbound.py:457-460` só desempacotam, ignoram).
3. `_processar_item_disparo_interno` — mover a criação da linha `disparos` (`_criar_disparo_sync`) para **antes** do loop de envio (status inicial `em_andamento`), permitindo que cada envio grave uma linha de ledger referenciando um `disparo_id` já existente desde o 1º envio. Finalizar via `UPDATE` (não `INSERT` novo) tanto no branch de pausa por `error_threshold` quanto no fim normal do loop.
4. `_processar_disparo_divulgacao_interno` — mais simples (`disparo_id` já é parâmetro, criado antes da função ser chamada): gravar 1 linha em `logs_disparo` por envio, com `disparo_divulgacao_id`.
5. Consumo de `statuses[]` em `worker/meta_adapter_inbound.py::processar_webhook_meta` — **antes** do early-return atual de "sem `messages[]`" — mapeando `sent/delivered/read/failed` para `enviado/entregue/lido/falhou`, atualizando `logs_disparo` por `wamid` (best-effort, `try/except`, nunca propaga exceção pra fora da task de background).
6. 6 testes novos (nenhuma das 2 funções de disparo em massa tem teste hoje): wamid em sucesso/falha, ledger gravado em ambos os motores de disparo, disparo criado **antes** do loop (não depois), consumo de status por webhook.

### OUT
- Mudar quando/como `daily_limit`/`error_threshold` pausam ou retomam uma campanha — isso é o Plano 008 (não escrito), decisão de produto separada. Se durante a implementação parecer necessário mudar esse comportamento pra "fazer esta story funcionar", é sinal de escopo indevido — parar e reportar.
- Popular `meta_phone_numbers.quality_rating`/`messaging_limit_tier` — API diferente (status do número, não `statuses[]` do webhook), trabalho separado.
- `_gravar_breadcrumb_disparo` e território da S-WM-55/S-WM-56 — não tocar.
- `supabase/functions/motor-agente/index.ts` — não tocado por esta story.

## Acceptance Criteria

1. **Given** `select count(*) from logs_disparo` executado no início da Task 0, **when** o resultado é `0` (confirmado), **then** a migration prossegue; **se for diferente de `0`**, a story para nesse ponto e é reportada para revisão antes de aplicar o `CHECK` (dado real pode não satisfazer a constraint).
2. **Given** um envio bem-sucedido via `_enviar_template_meta`, **when** a resposta da Graph API tem `messages[0].id`, **then** a função retorna `(True, wamid)`.
3. **Given** um disparo pontual (`eventos_pontuais`/`ouvidoria_eventos`) ou de divulgação mensal, **when** cada envio é processado (sucesso ou falha), **then** uma linha correspondente é gravada em `logs_disparo`, referenciando o `disparo_id`/`disparo_divulgacao_id` correto e o `wamid` quando houver.
4. **Given** o loop de `_processar_item_disparo_interno`, **when** inspecionado, **then** a linha `disparos` é criada **antes** do 1º envio (status `em_andamento`), não só ao final — inclusive quando o loop pausa por `error_threshold` (finalização via `UPDATE`, nunca deixa de existir uma linha `disparos` pra uma execução parcial).
5. **Given** um evento de webhook com `value.statuses[]` (sem `messages[]`), **when** processado, **then** `logs_disparo` é atualizado por `wamid` com o status mapeado (`delivered`→`entregue` etc.) — evento deixa de ser puramente descartado.
6. **Given** uma falha ao gravar o ledger (qualquer dos 2 motores) ou ao processar um status, **when** ocorre, **then** nunca afeta os contadores `sucessos`/`enviados`/`erros` nem propaga exceção pra fora do fluxo principal/background task.
7. `python -m pytest tests/ -v` (suíte completa do worker) → exit 0, incluindo os 6 testes novos.
8. Nenhum arquivo fora do escopo listado é modificado.

## Tasks / Subtasks

- [ ] **Task 0 — Confirmar pré-requisitos, bloqueante** (AC: 1)
  - [ ] Confirmar que a S-WM-56 (Plano 005) está `Done` — `_query_leads_divulgacao_sync` precisa retornar `id` antes desta story poder gravar `lead_id` no ledger de divulgação. Se não estiver, HALT.
  - [ ] Rodar `select count(*) from logs_disparo` (read-only, MCP Supabase) em produção — reportar o resultado nesta story **antes** de escrever a migration do Step 1. Se diferente de `0`, parar e trazer de volta para revisão (não aplicar o `CHECK` cegamente contra dado real).
- [ ] **Task 1 — Migration** (AC: 1)
  - [ ] Criar e aplicar (via MCP, produção `cuca`) a migration reativando `logs_disparo`.
- [ ] **Task 2 — `_enviar_template_meta` retorna wamid** (AC: 2)
  - [ ] Mudar assinatura, atualizar os 4 call sites.
  - [ ] `pytest tests/` → suíte passa sem regressão (confirma que os 4 sites foram todos ajustados).
- [ ] **Task 3 — Ledger no disparo pontual** (AC: 3, 4, 6)
  - [ ] Mover criação de `disparos` pra antes do loop.
  - [ ] Gravar `logs_disparo` por envio, em `try/except` próprio.
  - [ ] Finalizar via `UPDATE` em ambos os pontos de saída (pausa por erro, fim normal).
- [ ] **Task 4 — Ledger no disparo de divulgação mensal** (AC: 3, 6)
  - [ ] Gravar `logs_disparo` por envio (`disparo_divulgacao_id`), em `try/except` próprio.
- [ ] **Task 5 — Consumo de `statuses[]`** (AC: 5, 6)
  - [ ] Adicionar o bloco antes do early-return de "sem `messages[]`".
- [ ] **Task 6 — Testes** (AC: 2, 3, 4, 5, 7)
  - [ ] 6 testes conforme Dev Notes.
- [ ] **Task 7 — Fechamento** (AC: 7, 8)
  - [ ] Suíte completa sem regressão.
  - [ ] File List e Change Log atualizados.
  - [ ] Anunciar conclusão e recomendar @qa.

## Dev Notes

- Migration exata (Step 1), diff completo de todos os 6 Steps, código antes/depois de cada função tocada, e os 6 testes especificados na íntegra: **`docs/qa/planos-corrida-juventude/007-ledger-entrega-e-status-meta.md`** — ler por completo antes de editar, é o mais denso e arriscado dos 6 planos.
- **Este plano é o de maior risco da leva** — tratar as mudanças de Python com mais escrutínio que as demais stories: o diff não foi dry-run executado ao vivo antes de ser especificado (diferente da S-WM-52), só produzido por leitura direta do código. Apoiar-se fortemente nos 6 testes da Task 6 pra pegar erro antes de considerar concluído.
- Padrão de mock a seguir: `worker/tests/test_campanhas_engine.py`, estilo `MagicMock()` + `monkeypatch.setattr(camp, "supabase", mock_sb)`.
- Revisor deve escrutinar: (a) que as gravações de ledger (Tasks 3/4) nunca afetam contadores nem propagam exceção; (b) que mover a criação de `disparo_id` pra antes do loop não muda o valor de `total_destinatarios` gravado (não deve — `total` é computado 1 vez, antes de qualquer um dos 2 pontos de criação); (c) que o tratamento de `statuses[]` (Task 5) nunca deixa uma exceção escapar da background task.
- Esta story é a fundação do Plano 008 (não escrito) — a correção do truncamento de `daily_limit` vai usar este ledger pra saber quem ainda falta, sem reenviar pra todo mundo. Não implementar isso agora.
- **Dependência real, não só sequenciamento:** a Task 4 usa `lead.get("id")`, que só existe em `_query_leads_divulgacao_sync` depois da S-WM-56. Sem isso, não há `lead_id` pra gravar no ledger de divulgação — por isso Task 0 é bloqueante, não apenas recomendação de ordem.

### Testing
`cd worker && python -c "import campanhas_engine; import meta_adapter_inbound; import main"` (sanity) e depois `python -m pytest tests/ -v` (suíte completa).

## Dependências
**BLOQUEADA pela S-WM-56** — precisa estar `Done` antes de iniciar (Task 0 confirma isso e faz a query read-only de `logs_disparo` antes de qualquer migration).

## Git workflow
Branch: `feat/ledger-entrega-status-meta`. Commits por passo (plano maior que os demais — preferir vários commits pequenos e revisáveis a um único grande), ex.: `feat(campanhas): captura wamid do envio Meta`, `feat(campanhas): grava ledger de destinatarios por disparo`, `feat(worker): consome statuses[] do webhook Meta`. Não dar push/PR sem autorização explícita.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-27 | 0.1 | Story criada a partir do Plano 007 (investigação "Corrida da Juventude", 2026-07-26/27). 6ª e última story da leva — BLOQUEADA até a S-WM-56 fechar; Task 0 inclui verificação read-only obrigatória de `logs_disparo` antes da migration. | @sm River |

## Dev Agent Record
_A ser preenchido pelo @dev durante a implementação._

## QA Results
_A ser preenchido pelo @qa após a implementação._
