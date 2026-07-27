# S-WM-53 — Logar `telefone`/`conversa_id` e se lead/conversa são novos, quando `motor-agente` rejeita com HTTP 400

## Status
Draft

## Origem
Investigação "Corrida da Juventude" (disparo de 724 leads, 24/07/2026) — `docs/qa/DIAGNOSTICO-disparo-corrida-juventude-2026-07-27.md`, achado #1. Plano técnico completo, com trechos de código antes/depois e comandos de verificação, preservado integralmente em `docs/qa/planos-corrida-juventude/002-log-telefone-vazio-motor-agente-400.md` — usar esse arquivo como referência técnica primária, não este resumo. Elaborado em 2026-07-25/26 (commit base `256d547`). Formalizada em story por @sm em 2026-07-27, setup de teste ("Equipe Interna — QA") já criado e confirmado.

## Complexidade
**S** — 2 pontos de instrumentação (logs), sem mudança de comportamento.

## Prioridade
P1 — 32 de ~69 chamadas do worker ao `motor-agente` falharam com HTTP 400 (`"telefone e agente_tipo sao obrigatorios"`) durante o disparo de 24/07 (46% de falha, 30 pessoas reais atingidas). Causa raiz **não confirmada** — este plano é só a instrumentação que vai fechar a causa na próxima ocorrência.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd worker && pytest tests/test_meta_adapter_inbound.py -v → todos passam, incluindo os 2 testes novos
  - cd worker && pytest tests/ -v → suíte completa sem regressão
  - grep -n "telefone=" worker/meta_adapter_inbound.py → pelo menos 1 ocorrência dentro de _chamar_motor_agente
  - grep -n "DIAG-achado1" worker/meta_adapter_inbound.py → pelo menos 2 ocorrências (log de sucesso + log do except)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que o worker logue `telefone`/`conversa_id` quando o `motor-agente` rejeita uma chamada com HTTP 400, e também se o lead/conversa envolvidos eram novos ou já existiam,
**para que** a próxima ocorrência real do bug de "telefone vazio" tenha o dado que falta pra fechar a causa raiz de vez — hoje não há acesso a SSH/`docker logs` do host pra reconstruir isso depois do fato.

## Contexto e Problema

`worker/meta_adapter_inbound.py::_chamar_motor_agente` (linha ~292) já loga toda falha não-2xx do `motor-agente`, mas **sem** `telefone`/`conversa_id` — exatamente os 2 dados que faltam pra saber se o problema é o valor vazio, truncado, ou outra coisa (o próprio erro devolvido já é literalmente `{"error": "telefone e agente_tipo sao obrigatorios"}`).

Achados que já restringem a busca, mas não fecham a causa: 27 de 32 casos têm 11-12,5s entre `leads.created_at` e a falha (bate com debounce 10s + processamento — forte correlação com "1ª mensagem de lead recém-criado"), mas **não é 100% determinístico** (alguns leads novos não falham) e o bug se repete fora de disparo em massa. Já descartado por leitura de código: corrida no debounce, estado compartilhado no FastAPI, tipo de mensagem não suportado, e triggers de banco em `leads`/`conversas`/`mensagens` (`information_schema.triggers` vazio para as 3 tabelas).

## Escopo

### IN
1. **Log de falha existente** (`_chamar_motor_agente`, bloco `if not resp.is_success:`) — adicionar `conversa_id` e `telefone` (via `contrato_v2.get("telefone")`, não `[...]`, e com `%r` não `%s` — se o valor for `None` em vez de `""`, isso aparece diferente no log e pode ser a pista).
2. **Log novo de diagnóstico** (`processar_webhook_meta`, logo depois do bloco "DB B" — conversa resolvida, antes do "DB C") — `[meta-inbound][DIAG-achado1]` indicando se lead e conversa foram criados agora (`created_at == updated_at`) ou já existiam, correlacionável com o log de falha via `conversa_id`. Dispara em **toda mensagem recebida**, não só nas que falham depois (proposital — precisa da taxa de falha entre "novo" vs "existente" nos dois grupos, não só nos que já falharam). Requer adicionar `created_at, updated_at` ao select de `conv_fresh`.
3. Testes: 1 confirmando que o log de falha inclui os 2 campos novos; 1 confirmando que o log `[DIAG-achado1]` aparece com `lead_novo=True` no cenário de lead novo.
4. Mutation check manual: reverter cada mudança isoladamente, confirmar que o teste correspondente falha; restaurar, confirmar que volta a passar.

### OUT
- Qualquer tentativa de corrigir a causa raiz do "telefone vazio" — **ainda não confirmada**. Corrigir às cegas seria chute; este plano é só o log que revela a causa na próxima ocorrência.
- `supabase/functions/motor-agente/index.ts` — a validação que rejeita com 400 está correta e não muda.
- Qualquer outro log/print do arquivo fora dos 2 pontos acima.
- Sentry ou qualquer alerta externo — não introduzir a dependência agora.

## Acceptance Criteria

1. **Given** o `motor-agente` responde HTTP 400, **when** `_chamar_motor_agente` loga a falha, **then** o log contém `conversa_id` e `telefone` (via `%r`, distinguindo `None` de `""`).
2. **Given** um webhook Meta processado, **when** lead e conversa são resolvidos, **then** um log `INFO` com tag `[DIAG-achado1]` registra `conversa_id`, `lead_id`, `lead_novo`, `conversa_nova` — em **toda** mensagem, não só nas que falham depois.
3. **Given** o teste do cenário 1 revertido (log volta ao formato antigo), **when** rodado, **then** falha — prova que o teste exercita a proteção de verdade. Mesmo para o cenário 2.
4. **Given** `created_at`/`updated_at` ausentes por qualquer motivo no retorno do supabase-py, **when** o cálculo de `lead_novo`/`conversa_nova` roda, **then** não quebra o fluxo normal (try/except em volta, log de warning).
5. `pytest tests/` (de dentro de `worker/`) sai com exit 0, incluindo os 2 testes novos.
6. Nenhum arquivo fora de `worker/meta_adapter_inbound.py` e `worker/tests/test_meta_adapter_inbound.py` é modificado.

## Tasks / Subtasks

- [ ] **Task 1 — Log de falha com telefone/conversa_id** (AC: 1, 3)
  - [ ] Adicionar os 2 campos ao log existente em `_chamar_motor_agente`.
  - [ ] Teste + mutation check (reverter → falha; restaurar → passa).
- [ ] **Task 2 — Log de diagnóstico lead_novo/conversa_nova** (AC: 2, 3, 4)
  - [ ] Adicionar `created_at, updated_at` ao select de `conv_fresh`.
  - [ ] Adicionar o bloco `[DIAG-achado1]` com try/except.
  - [ ] Teste + mutation check.
- [ ] **Task 3 — Fechamento** (AC: 5, 6)
  - [ ] Suíte completa (`pytest tests/`) sem regressão.
  - [ ] File List e Change Log atualizados.
  - [ ] Anunciar conclusão e recomendar @qa.

## Dev Notes

- Trechos de código antes/depois exatos (linhas 173-183, 199-222), estrutura completa dos 2 testes e do mutation check: **`docs/qa/planos-corrida-juventude/002-log-telefone-vazio-motor-agente-400.md`** — ler por completo antes de editar.
- Padrão de mock a reaproveitar: procurar testes já existentes de `_chamar_motor_agente` e de `processar_webhook_meta` completo no mesmo arquivo de teste — copiar o padrão de mock do cliente HTTP assíncrono, não inventar um novo. Se nenhum existir, **parar e perguntar** antes de criar um payload Meta mockado do zero (não é decisão pra tomar sozinho).
- Comparação `created_at == updated_at` é aproximação (ambos vêm de `now()` no mesmo INSERT; num UPDATE via upsert, só `updated_at` muda) — não precisa ser exata ao milissegundo, só classificar novo vs. existente.
- Esses logs são **temporários**, tag `[DIAG-achado1]` de propósito para filtrar/remover fácil quando a causa do achado #1 for confirmada. Quando a próxima ocorrência real acontecer: cruzar os 2 logs por `conversa_id` — se `lead_novo=True`/`conversa_nova=True` aparecer sempre que a falha disparar (e nunca quando não falha), causa confirmada; se aparecer misturado (como hoje, ~75-80%), o próximo passo é olhar o que mais difere dentro do subconjunto "lead novo".
- Sem dependência técnica com as demais stories da leva, mas **sequenciada antes da S-WM-54** (Plano 003) — mesmo arquivo (`worker/meta_adapter_inbound.py`), pra evitar conflito de merge. Mergear esta primeiro.

### Testing
`cd worker && pytest tests/test_meta_adapter_inbound.py -v` e depois `pytest tests/` (suíte completa).

## Dependências
Nenhuma tecnicamente. **Bloqueia (por sequenciamento, não por dependência técnica) a S-WM-54** — mesmo arquivo, mergear esta antes para evitar conflito.

## Git workflow
Branch: `fix/log-telefone-vazio-motor-agente-400`. Commit único: `fix(worker): loga telefone/conversa_id quando motor-agente rejeita requisicao com 400`. Não dar push/PR sem autorização explícita.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-27 | 0.1 | Story criada a partir do Plano 002 (investigação "Corrida da Juventude", 2026-07-25/26). 2ª story da leva — sem dependência técnica, mas sequenciada antes da S-WM-54 (mesmo arquivo). | @sm River |

## Dev Agent Record
_A ser preenchido pelo @dev durante a implementação._

## QA Results
_A ser preenchido pelo @qa após a implementação._
