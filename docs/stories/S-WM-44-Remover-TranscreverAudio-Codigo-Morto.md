# S-WM-44 — Remover `transcreverAudio` (código morto, superfície de SSRF)

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado SEC-02, Plano 003. Decisão do sócio (2026-07-18, ver `docs/qa/DIAGNOSTICO-motor-agente-2026-07-18.md`, "Decisões Finais"): **remover** (caminho 2a), sem plano de reativar transcrição de áudio direto na Edge Function. Base: **`origin/main`** (`99f4395`).

## Complexidade
**S**

## Prioridade
P2 — segurança (reduz superfície de ataque a zero), decisão já fechada.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - grep -n "transcreverAudio\|WHISPER_MODEL" index.ts → zero ocorrências após o fix
  - deno test --no-check --allow-env --allow-read --allow-net . → 0 failed
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** remover a função `transcreverAudio` e o branch morto que a invoca no `motor-agente`,
**para que** a superfície de SSRF (`fetch(audioUrl)` sem allowlist) deixe de existir, já que nenhum caller real usa esse caminho.

## Contexto e Problema

`transcreverAudio` (`index.ts:775-786`) faz `fetch(audioUrl)` sem allowlist de domínio, `audioUrl` vindo direto do body do request — superfície de SSRF alcançável por chamada direta com a anon key pública (mesma reachability documentada na S-WM-37).

**Confirmado, novamente, em `origin/main`:** `worker/meta_adapter_inbound.py` (`_parse_mensagem_meta`) já baixa e transcreve áudio inteiramente no worker, com o Bearer token correto que a Meta exige, retornando `midia_tipo="voz"` e `midia_url=None` — **nunca** `"audio"`/`"ptt"`, os únicos valores que ativam o branch em `motor-agente` (`index.ts:1069`, `if (midia_url && (midia_tipo === "audio" || midia_tipo === "ptt")) ...`). `grep -rn "midia_tipo" worker/` não retorna nenhuma atribuição de `"audio"`/`"ptt"`. Este branch é código morto da arquitetura pré-Meta.

## Escopo

### IN
1. Remover a função `transcreverAudio` (`index.ts:775-786`) e `WHISPER_MODEL` (`index.ts:6`, se não usado em mais nenhum lugar).
2. Simplificar `index.ts:1068-1069`:
```ts
const textoFinal = mensagem || "";
```
(mantendo `if (!textoFinal) return ...` na linha seguinte, sem mudança).

### OUT
- `worker/meta_adapter_inbound.py` — já está correto, não mexer.
- O header de autenticação ausente no antigo `fetch(audioUrl)` — vira irrelevante com a remoção, não precisa de correção.
- Deploy automático.

### ⚠️ Sequenciamento (achado na validação do @po)
Esta story toca a mesma região (linhas 1068-1069) que a **S-WM-43** (paralelizar Par 1). Mergear **esta story antes** da S-WM-43 — remove a chamada assíncrona que hoje fica entre `openaiKey` e `lead`, simplificando o Par 1 da S-WM-43.

## Acceptance Criteria

1. `grep -n "transcreverAudio" index.ts` não retorna nada.
2. `grep -n "WHISPER_MODEL" index.ts` não retorna nada (confirmar antes que não é usado em outro lugar).
3. `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed` (nenhum teste existente referenciava `transcreverAudio`, confirmado por grep prévio — achado TEST-02 da auditoria).
4. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Remover a função e o branch** (AC: 1, 2)
  - [x] Drift check: `grep -rn "midia_tipo" worker/` — único match é um helper defensivo de texto de fallback (`_texto_historico_para_midia_vazia`), não uma atribuição real; worker continua só produzindo `"voz"`. Confirmado código morto.
  - [x] Removido `transcreverAudio` (função inteira), `WHISPER_MODEL`, simplificado `textoFinal` para `const`.
- [x] **Task 2 — Regressão** (AC: 3)
  - [x] Suíte completa: 159 passed, 0 failed, 2 ignored — idêntico à baseline (nenhum teste referenciava `transcreverAudio`).
- [x] **Task 3 — Fechamento** (AC: 4)
  - [x] Nenhum deploy executado.

## Dev Notes
- **Plano 008 da auditoria** (cobertura de teste para `transcreverAudio`) fica **automaticamente REJECTED** com esta decisão — nada a testar depois da remoção. Não criar story para ele.
- Existe um rascunho local não-commitado (`docs/stories/S-WM-24-Bugs-Motor-Agente-AUD-08-11-15-16-17.md`, nunca chegou a `origin/main`/`origin/develop`, datado de 2026-07-15) que já identificava esta mesma remoção como "AUD-16" de uma auditoria anterior (07-07) — não editar aquele arquivo; esta S-WM-44 é a story válida e atual.
- Se no futuro alguém quiser reintroduzir transcrição de áudio direto na Edge Function, a decisão precisa vir com allowlist de domínio desde o início.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 003 da auditoria motor-agente (2026-07-16). Decisão de remoção confirmada pelo sócio em 2026-07-18. Base: origin/main. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO com ajuste aplicado**. Achado de sequenciamento: mesma região que S-WM-43 (Par 1) — nota de dependência adicionada (mergear esta antes). Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-39. Suíte: 159/0/2 (sem mudança, esperado). Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test`: 159 passed, 0 failed, 2 ignored (sem mudança em relação à S-WM-39 — confirma que nenhum teste dependia de `transcreverAudio`).
- `deno check`: 36 erros, idêntico à baseline.

### Completion Notes List
- Remoção limpa: função, constante e branch condicional removidos; `midia_url`/`midia_tipo` continuam desestruturados do body (fazem parte do contrato que o worker envia), mas não são mais usados em nenhum lugar — inofensivo, fora do escopo desta story mexer na desestruturação.

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: removidos `transcreverAudio`, `WHISPER_MODEL`, branch de mídia)
