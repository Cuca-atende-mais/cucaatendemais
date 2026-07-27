# Plan 005: Disparo de divulgação/programação mensal também grava o breadcrumb `ultimo_disparo`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 256d547..HEAD -- worker/campanhas_engine.py worker/tests/test_campanhas_engine.py`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/004-race-breadcrumb-insert-nao-atomico.md` — that plan fixes a non-atomic race inside `_gravar_breadcrumb_disparo`'s "conversa nova" branch; this plan adds a **3rd caller** to the same function. Land 004 first so the new caller doesn't inherit a known race. If 004 is not yet DONE when this plan is picked up, STOP and say so instead of proceeding (see STOP conditions).
- **Category**: tech-debt (feature-parity gap between 3 dispatch paths that share the same WhatsApp number)
- **Planned at**: commit `256d547`, 2026-07-26

## Why this matters

Three different mechanisms send WhatsApp messages through the same Meta phone number (`canal_tipo="Institucional"`) and read/write the same `conversas` table for the institucional bot: (1) `eventos_pontuais`, (2) `ouvidoria_eventos`, and (3) the monthly "divulgação"/programação mensal dispatch. The first two write a `metadata.ultimo_disparo` breadcrumb on the lead's conversa row right after a successful send; the third does not write it at all. `supabase/functions/motor-agente/index.ts`'s `deveReconhecerDisparoRecente()` (and the `CONTEXTO_DISPARO` prompt block built from the same field, ~line 1683) depend entirely on that field being present to let the bot recognize "you just received a broadcast from us" instead of falling into a canned courtesy reply. Concretely: a lead who replies right after the monthly programação dispatch gets none of that recognition — the exact same class of awkward-courtesy-reply behavior documented in the "De novo, foi mal!" investigation (`docs/qa/INVESTIGACAO-comportamento-conversas-disparo-corrida-2026-07-25.md`, achado #5), just for a different dispatch path, and for a structural reason (field never written) rather than a race. This was previously noted and explicitly deferred as "not a regression, just a feature the monthly path never had" in `plans/README.md` (see the "Achados considerados e descartados" section) — this plan closes that gap by giving the monthly path the same breadcrumb write the other two already have.

## Current state

- `worker/campanhas_engine.py` — the file with all 3 dispatch paths and the shared breadcrumb writer.
- `worker/tests/test_campanhas_engine.py` — existing unit tests for `_gravar_breadcrumb_disparo`, `_query_leads_sync`, and template-variable helpers.
- `supabase/functions/motor-agente/index.ts` — **not touched by this plan**. `deveReconhecerDisparoRecente` (line 627) and `CONTEXTO_DISPARO` (line 1683) only read `metadata.ultimo_disparo.enviado_em` / `.titulo` — they don't branch on the breadcrumb's `tipo` field, so no motor-agente change is needed to make the monthly path benefit from this mechanism once the field is written.

The shared breadcrumb writer, already handling the merge-not-overwrite logic (do not modify — this is Plan 004's target, not this plan's):

```python
# worker/campanhas_engine.py:63-96
def _gravar_breadcrumb_disparo(lead_id: str, origem_id: str, breadcrumb: dict) -> None:
    existente = supabase.table("conversas").select("id, metadata").eq(
        "lead_id", lead_id
    ).eq("origem_id", origem_id).limit(1).execute()

    if existente.data:
        row = existente.data[0]
        metadata = row.get("metadata") or {}
        metadata.update(breadcrumb)
        supabase.table("conversas").update(
            {"metadata": metadata}
        ).eq("id", row["id"]).execute()
    else:
        supabase.table("conversas").insert({
            "lead_id": lead_id,
            "origem_id": origem_id,
            "agente_tipo": "Institucional",
            "canal_ativo": "meta",
            "status": "ativa",
            "metadata": breadcrumb,
        }).execute()
```

How `eventos_pontuais`/`ouvidoria_eventos` already call it, inside `_processar_item_disparo_interno` — this is the pattern to mirror:

```python
# worker/campanhas_engine.py:405-422
        ok = await _enviar_template_meta(phone_number_id, numero, meta_token, template_name, components)
        if ok:
            sucessos += 1
            # Breadcrumb na conversa do lead
            lead_id = lead.get("id")
            if lead_id:
                titulo_disparo = (item.get("titulo") or item.get("descricao", ""))[:80]
                tz_fortaleza = timezone(timedelta(hours=-3))
                breadcrumb = {"ultimo_disparo": {
                    "tipo": origem,
                    "id": str(item_id),
                    "titulo": titulo_disparo,
                    "enviado_em": datetime.now(tz_fortaleza).isoformat(),
                }}
                try:
                    _gravar_breadcrumb_disparo(lead_id, phone_number_id, breadcrumb)
                except Exception as bc_err:
                    logger.warning(f"[Breadcrumb] Erro ao gravar contexto: {bc_err}")
        else:
            erros += 1
```

Note `origem_id` passed to `_gravar_breadcrumb_disparo` is actually the Meta `phone_number_id` (the channel identifier), not an event/campaign id — that's already the variable name used inside `_processar_disparo_divulgacao_interno` too (see below), so no new lookup is needed for that argument.

The monthly path today — **no breadcrumb write anywhere in this function**:

```python
# worker/campanhas_engine.py:533-616 (_processar_disparo_divulgacao_interno, full body)
async def _processar_disparo_divulgacao_interno(
    disparo_id: str,
    mes_nome: str,
    delay_min: int,
    delay_max: int,
    daily_limit: int,
    error_threshold: int,
):
    canal_info = await asyncio.to_thread(_get_phone_by_canal_tipo_sync, "Institucional")
    ...
    phone_number_id, meta_token = canal_info
    ...
    leads_res = await asyncio.to_thread(_query_leads_divulgacao_sync)
    leads = leads_res.data or []
    total = min(len(leads), daily_limit)
    ...
    for i, lead in enumerate(leads[:total]):
        sleep_s = random.uniform(delay_min / 1000.0, delay_max / 1000.0)
        await asyncio.sleep(sleep_s)

        nome = lead.get("nome") or "jovem"
        telefone_raw = lead.get("telefone", "")
        if not telefone_raw:
            continue
        telefone = normalizar_telefone(telefone_raw)

        components = [{
            "type": "body",
            "parameters": _montar_parametros_named(
                variaveis_divulgacao, [nome, mes_nome, LINK_PROGRAMACAO_MENSAL]
            ),
        }]

        ok = await _enviar_template_meta(
            phone_number_id, telefone, meta_token, template_divulgacao, components
        )
        if ok:
            enviados += 1
        else:
            erros += 1
        ...
```

Note the leads query for this path currently only selects 2 columns — **no `id`**, which this plan must add before a breadcrumb can be written (there's no `lead_id` available in the loop today):

```python
# worker/campanhas_engine.py:136-143
def _query_leads_divulgacao_sync():
    return (
        supabase.table("leads")
        .select("telefone, nome")
        .eq("opt_in", True)
        .eq("bloqueado", False)
        .execute()
    )
```

Repo convention to match: breadcrumb writes are always wrapped in their own `try/except`, logged as a warning, and never allowed to turn a successful send into a counted error — see the `except Exception as bc_err: logger.warning(...)` in the exemplar above. Follow the same shape here; do not let a breadcrumb failure affect `enviados`/`erros` counters.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Run worker test suite | `cd worker && python -m pytest tests/test_campanhas_engine.py -v` | all tests pass, including new ones |
| Sanity import check | `cd worker && python -c "import campanhas_engine"` | exits 0, no `SUPABASE_URL`/import errors (matches how the existing test file stubs the `supabase` package — see its module docstring) |
| Confirm no other caller broke | `cd worker && python -m pytest tests/ -v` | all tests pass (full suite, not just this file) |

## Scope

**In scope** (the only files you should modify):
- `worker/campanhas_engine.py` — `_query_leads_divulgacao_sync` (add `id` to the select) and `_processar_disparo_divulgacao_interno` (add the breadcrumb write after a successful send).
- `worker/tests/test_campanhas_engine.py` — new tests covering the added behavior.

**Out of scope** (do NOT touch, even though they look related):
- `_gravar_breadcrumb_disparo`'s internals (lines 63-96) — its non-atomic INSERT branch is Plan 004's target; this plan only adds a new *caller*, it does not change the function itself.
- `_processar_item_disparo_interno` / `eventos_pontuais` / `ouvidoria_eventos` — already correct, do not touch.
- `supabase/functions/motor-agente/index.ts` — confirmed above that no change is needed there; if you find yourself wanting to edit it, that means an assumption in this plan is wrong — STOP (see STOP conditions).
- Any change to `disparos_divulgacao`/`_update_metricas_sync` — metrics bookkeeping is unrelated to the breadcrumb and must keep behaving exactly as today.

## Git workflow

- Branch: `fix/breadcrumb-divulgacao-mensal` (matches repo's `fix/<slug>` convention seen in recent history, e.g. `fix/breadcrumb-nao-reconhecido-cortesia`, `fix/leads-por-categoria-url-grande`)
- Single commit, conventional-commits style matching repo history (e.g. `fix(campanhas): breadcrumb de disparo para de apagar estado de conversa do motor-agente`): `feat(campanhas): grava breadcrumb de disparo tambem no envio de divulgacao mensal`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `id` to the divulgação leads query

In `worker/campanhas_engine.py`, change `_query_leads_divulgacao_sync` (currently lines 136-143) to select `id` alongside the existing columns:

```python
def _query_leads_divulgacao_sync():
    return (
        supabase.table("leads")
        .select("id, telefone, nome")
        .eq("opt_in", True)
        .eq("bloqueado", False)
        .execute()
    )
```

**Verify**: `cd worker && python -c "import campanhas_engine"` → exits 0.

### Step 2: Write the breadcrumb after a successful send in `_processar_disparo_divulgacao_interno`

In the same file, inside the `for i, lead in enumerate(leads[:total]):` loop of `_processar_disparo_divulgacao_interno` (currently lines 584-616), change the `if ok: enviados += 1` branch to also write the breadcrumb, mirroring the `eventos_pontuais` pattern shown in "Current state" above:

```python
        ok = await _enviar_template_meta(
            phone_number_id, telefone, meta_token, template_divulgacao, components
        )
        if ok:
            enviados += 1
            lead_id = lead.get("id")
            if lead_id:
                tz_fortaleza = timezone(timedelta(hours=-3))
                breadcrumb = {"ultimo_disparo": {
                    "tipo": "divulgacao_mensal",
                    "id": str(disparo_id),
                    "titulo": f"Programação de {mes_nome}",
                    "enviado_em": datetime.now(tz_fortaleza).isoformat(),
                }}
                try:
                    _gravar_breadcrumb_disparo(lead_id, phone_number_id, breadcrumb)
                except Exception as bc_err:
                    logger.warning(f"[Breadcrumb] Erro ao gravar contexto (divulgacao): {bc_err}")
        else:
            erros += 1
```

`timezone`/`timedelta` are already imported at module level (used by the `eventos_pontuais` path) — no new import needed. `disparo_id` and `mes_nome` are already in scope as function parameters.

**Verify**: `cd worker && python -c "import campanhas_engine"` → exits 0 (syntax/import sanity only; behavior is verified by the tests in Step 3).

### Step 3: Add tests

In `worker/tests/test_campanhas_engine.py`, add tests near the existing `_gravar_breadcrumb_disparo` tests (after line 185). Model the mocking style after `test_breadcrumb_cria_conversa_nova_quando_lead_nunca_falou_com_o_bot` (lines 165-185) and `test_query_leads_com_categorias_alvo_usa_rpc_nao_monta_lista_de_ids` (lines 223-237) for the query test:

1. `test_query_leads_divulgacao_seleciona_id` — asserts `_query_leads_divulgacao_sync()` selects a column list that includes `"id"` (inspect the mock's `.select.call_args` the same way the existing `_query_leads_sync` tests do, or assert on the built query chain call args).
2. `test_disparo_divulgacao_grava_breadcrumb_apos_envio_com_sucesso` — calls `_processar_disparo_divulgacao_interno` (async — use `pytest.mark.asyncio`, already a project dependency per `worker/requirements.txt`) with mocked `supabase`, `_get_phone_by_canal_tipo_sync` returning a fake `(phone_number_id, token)` tuple, `_query_leads_divulgacao_sync` returning one lead dict with `id`/`telefone`/`nome`, `_enviar_template_meta` monkeypatched to return `True`, and asserts `_gravar_breadcrumb_disparo` was called once with `(lead_id, phone_number_id, breadcrumb)` where `breadcrumb["ultimo_disparo"]["tipo"] == "divulgacao_mensal"` and `breadcrumb["ultimo_disparo"]["id"] == str(disparo_id)`. Monkeypatch `camp._gravar_breadcrumb_disparo` directly (a `MagicMock`) rather than mocking the underlying `supabase` calls it makes internally — this test is about the *caller* wiring the right arguments, not about `_gravar_breadcrumb_disparo`'s own behavior (that's already covered by the tests in Plan 004's scope).
3. `test_disparo_divulgacao_nao_grava_breadcrumb_quando_envio_falha` — same setup but `_enviar_template_meta` returns `False`; asserts `_gravar_breadcrumb_disparo` was NOT called and `erros` bookkeeping still increments (reuse the existing `_update_metricas_sync` mock pattern already visible elsewhere in the file, or assert via the mocked `_update_metricas_sync` call args).

**Verify**: `cd worker && python -m pytest tests/test_campanhas_engine.py -v` → all tests pass, including the 3 new ones.

## Test plan

- New tests: the 3 listed in Step 3, in `worker/tests/test_campanhas_engine.py`.
- Structural pattern to follow: `test_breadcrumb_cria_conversa_nova_quando_lead_nunca_falou_com_o_bot` (mocking style for `supabase`) and `test_query_leads_com_categorias_alvo_usa_rpc_nao_monta_lista_de_ids` (mocking style for a `_query_*` helper).
- Verification: `cd worker && python -m pytest tests/test_campanhas_engine.py -v` → all pass, including the 3 new tests; then `cd worker && python -m pytest tests/ -v` → full suite green (confirms nothing else regressed).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd worker && python -m pytest tests/test_campanhas_engine.py -v` exits 0, including the 3 new tests from Step 3
- [ ] `cd worker && python -m pytest tests/ -v` exits 0 (full worker suite)
- [ ] `grep -n '"id, telefone, nome"' worker/campanhas_engine.py` matches the updated `_query_leads_divulgacao_sync`
- [ ] `grep -n 'divulgacao_mensal' worker/campanhas_engine.py` matches the new breadcrumb `tipo` value inside `_processar_disparo_divulgacao_interno`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for Plan 005 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 004 is not yet DONE in `plans/README.md` when you pick this plan up — adding a 3rd caller to a function with a known unfixed race makes the race more likely to trigger, not less. Report this and wait rather than proceeding.
- The code at `worker/campanhas_engine.py:63-96`, `:136-143`, or `:533-616` doesn't match the excerpts in "Current state" (drift since this plan was written).
- You find that `deveReconhecerDisparoRecente` or `CONTEXTO_DISPARO` in `supabase/functions/motor-agente/index.ts` DO branch on `metadata.ultimo_disparo.tipo` (this plan's "Current state" section asserts they don't, based on a read of lines 627-637 and 1682-1727 at commit `256d547`) — if that assumption is false, the `tipo: "divulgacao_mensal"` value chosen in Step 2 may need to match an expected set of values instead of being free-form, and this needs a plan revision, not silent improvisation.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If a 4th dispatch path is ever added on the same Institucional number, it should call `_gravar_breadcrumb_disparo` the same way — consider extracting the "send + breadcrumb" pairing into one shared helper at that point rather than a 4th copy-paste. Not done in this plan to keep the diff minimal and low-risk.
- A reviewer should scrutinize: that the breadcrumb write happens strictly *after* `ok` is confirmed `True` (never on a failed send), and that it's wrapped in its own `try/except` so a breadcrumb failure never flips a successful send into a counted error in `disparos_divulgacao` metrics.
- This plan intentionally leaves `_gravar_breadcrumb_disparo`'s atomicity as-is (Plan 004's responsibility) — once 004 lands, this monthly path automatically inherits the fix with no further change needed here, since it calls the same shared function.
