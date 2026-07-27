# Plan 007: Registrar quem recebeu o quê (ledger por destinatário) + consumir os avisos de status da Meta

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 256d547..HEAD -- worker/campanhas_engine.py worker/meta_adapter_inbound.py worker/main.py`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on
> a mismatch, treat it as a STOP condition.
>
> **Verification note (read before starting):** unlike `plans/006-merge-atomico-metadata-conversas.md`, this plan's exact diff was **not** dry-run executed end-to-end before being written (no disposable Postgres instance was available to apply the migration against, and this plan's control-flow changes are larger than a mechanical find-replace). Every excerpt below was produced by directly reading the cited files at commit `256d547` (not by delegating to a subagent), and the design was cross-checked against the existing test suite's mocking conventions — but you should treat the Python changes with more scrutiny than Plan 006's, and lean harder on the new tests in Step 6 to catch mistakes before considering this done.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED — the change is designed to be **purely additive to observable dispatch behavior**: it does not change when a campaign pauses, resumes, or how leads are selected. It only (a) records what was sent and to whom, (b) captures the Meta message ID (`wamid`) for each send, and (c) reacts to delivery-status webhooks that are today silently discarded. If you find yourself needing to change *when* something pauses/resumes/retries to make this plan work, STOP — that's `plans/008` (not yet written), a deliberate follow-up, not part of this plan.
- **Depends on**: `plans/005-breadcrumb-disparo-divulgacao-mensal.md` — that plan adds `id` to `_query_leads_divulgacao_sync`'s select list (currently `telefone, nome` only, see "Current state"), which this plan's Step 4 needs (`lead.get("id")` must exist to write a ledger row). Land 005 first. Also benefits from `plans/006-merge-atomico-metadata-conversas.md` landing first (unrelated file, no hard dependency, just good sequencing since both touch high-traffic paths).
- **Category**: tech-debt / observability (the architectural gap identified as achados B and C in `docs/qa/RELATORIO-10-panorama-disparo-corrida-juventude-2026-07-26.md`'s "Diagnóstico arquitetural" section)
- **Planned at**: commit `256d547`, 2026-07-26

## Why this matters

Today, when a mass dispatch (eventos_pontuais, ouvidoria, or the monthly divulgação) sends a WhatsApp template message, the code only knows whether the Graph API's **HTTP request** succeeded (`_enviar_template_meta` returns `bool`) — it never captures the `wamid` (WhatsApp message ID) the Meta API returns, and it never reads the `statuses[]` array the Meta webhook sends afterward for each message (delivered / read / failed / undeliverable). `worker/meta_adapter_inbound.py`'s webhook handler explicitly discards any webhook event that doesn't carry `messages[]` (line 562-565: *"Ignorar eventos de status (delivery, read) sem messages[]"*), which today includes 100% of delivery-status events — there is no path anywhere in the codebase that reads `statuses[]`.

Two concrete consequences, both already observed in the 24/07 "Corrida da Juventude" dispatch investigation:
1. **No way to tell "accepted by Meta" from "delivered to the person"** — `disparos.total_enviados` counts HTTP 200/201 responses, not delivery confirmations. If a number is unreachable, blocked the business, or Meta silently drops it, this system has no record of that ever happening.
2. **No visibility into number quality risk** — WhatsApp Business restricts/bans numbers based on block/report rates that Meta communicates partly through these same status events (and the `quality_rating`/`messaging_limit_tier` columns already present in `meta_phone_numbers` but never populated by anything in this repo, confirmed by `git grep`). Today the only way to notice a quality problem is a human noticing complaints after the fact.

This plan adds the missing piece: a per-recipient ledger row for every dispatch attempt (capturing the `wamid`), and a webhook consumer that updates that row's status when Meta reports delivery/read/failure. This is the foundation the panorama report's "maior alavanca" recommendation asked for. It deliberately does **not** attempt to fix the separate, already-documented truncation bug (achado C: `daily_limit` truncation gets marked `"concluida"` instead of resumed) — that fix needs a product decision about auto-resume semantics and is left for a future `plans/008`, built on top of the ledger this plan creates.

**Update (2026-07-27):** the ledger table this plan writes to is `public.logs_disparo` — an existing, currently-unused table (0 rows in production), not a new one. See Step 1 for how this was discovered and why reactivating it (via `ALTER TABLE`) is preferred over creating a 3rd overlapping table.

## Current state

### `_enviar_template_meta` — needs to also return the `wamid`

`worker/campanhas_engine.py:200-233` (full function body):
```python
async def _enviar_template_meta(
    phone_number_id: str,
    to: str,
    token: str,
    template_name: str,
    components: list,
) -> bool:
    """POST Graph API v23.0 com type=template. Retorna True em sucesso."""
    numero = _normalizar_numero_meta(to)
    url = f"https://graph.facebook.com/v23.0/{phone_number_id}/messages"
    body = {
        "messaging_product": "whatsapp",
        "to": numero,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": "pt_BR"},
            "components": components,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=body,
            )
        if resp.status_code in (200, 201):
            return True
        logger.warning(f"[Meta] HTTP {resp.status_code} para {to}: {resp.text[:200]}")
        return False
    except Exception as exc:
        logger.error(f"[Meta] Erro ao enviar template {template_name!r} para {to}: {type(exc).__name__}")
        return False
```
On success, the WhatsApp Cloud API's response body has the shape `{"messaging_product": "whatsapp", "contacts": [...], "messages": [{"id": "wamid.XXXX"}]}` — the `wamid` is not read or returned today.

**4 call sites today, all treating the return as a plain `bool`** (confirmed by direct read, not a subagent):
- `worker/campanhas_engine.py:405` — `ok = await _enviar_template_meta(phone_number_id, numero, meta_token, template_name, components)` — inside `_processar_item_disparo_interno` (eventos_pontuais/ouvidoria).
- `worker/campanhas_engine.py:601-603` — inside `_processar_disparo_divulgacao_interno` (divulgação mensal).
- `worker/main.py:330-332` — inside a manual single-send endpoint (`/send-manual` or similar) — **not part of a mass campaign, not in scope for the ledger, just needs to keep compiling**.
- `worker/meta_adapter_inbound.py:457-460` — inside a transbordo (handover) notification helper — **also not a mass campaign, same as above, just needs to keep compiling**.

Only 1 existing test touches this function, and it doesn't depend on the return shape: `worker/tests/test_meta_adapter_inbound.py:1075-1084` mocks `fake_camp._enviar_template_meta = mock_enviar` and asserts `mock_enviar.assert_not_called()` in a scenario where it shouldn't fire — safe against this plan's change (confirmed by direct read).

### `_processar_item_disparo_interno` — `disparos` row is created only AFTER the loop finishes

`worker/campanhas_engine.py:322-347` (leads query and the 0-leads fast path — **this branch is correct today and needs NO change**, it already creates its `disparos` row immediately with `total_destinatarios: 0`):
```python
    leads_res = await asyncio.to_thread(_query_leads_sync, unidade, categorias_alvo)
    leads = leads_res.data or []
    total = len(leads)

    if total == 0:
        logger.info(f"Item {item_id}: Sem leads para disparar. Marcando como concluída.")
        tipo_disparo_vazio = "pontual" if origem == "eventos_pontuais" else "mensal"
        disparo_id_vazio = await asyncio.to_thread(_criar_disparo_sync, {
            "tipo": tipo_disparo_vazio,
            "evento_id": item_id if origem == "eventos_pontuais" else None,
            "campanha_mensal_id": item_id if origem == "campanhas_mensais" else None,
            "instancia_uazapi": phone_number_id,
            "mensagem_template": template_name,
            "midia_url": None,
            "total_destinatarios": 0,
            "total_enviados": 0,
            "total_erros": 0,
            "status": "concluida",
            "iniciado_em": datetime.now(timezone.utc).isoformat(),
            "concluido_em": datetime.now(timezone.utc).isoformat(),
        })
        await asyncio.to_thread(_update_db_sync, origem, item_id, {
            "status": "concluida",
            "disparo_id": disparo_id_vazio,
        })
        return
```

`worker/campanhas_engine.py:374-452` (the send loop, error-threshold pause, and end-of-function bookkeeping — **this is what changes**):
```python
    for i, lead in enumerate(leads):
        if i >= daily_limit:
            logger.warning(f"Limite diário atingido ({daily_limit}). Pausando.")
            break

        sleep_time = random.uniform(delay_min / 1000.0, delay_max / 1000.0)
        await asyncio.sleep(sleep_time)

        nome_lead = lead.get("nome") or "cidadão"
        numero = normalizar_telefone(lead["telefone"])

        # (monta components, omitido — sem mudança)

        ok = await _enviar_template_meta(phone_number_id, numero, meta_token, template_name, components)
        if ok:
            sucessos += 1
            # Breadcrumb na conversa do lead
            lead_id = lead.get("id")
            if lead_id:
                # (grava breadcrumb via _gravar_breadcrumb_disparo — sem mudança, ver Plano 004)
                ...
        else:
            erros += 1

        if (i + 1) > 5:
            taxa_erro = (erros / (i + 1)) * 100
            if taxa_erro > error_threshold:
                logger.error(f"Taxa de erro {taxa_erro:.1f}% > {error_threshold}%. Pausando!")
                await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
                return

    tipo_disparo = "pontual" if origem == "eventos_pontuais" else "mensal"
    disparo_id = await asyncio.to_thread(_criar_disparo_sync, {
        "tipo": tipo_disparo,
        "evento_id": item_id if origem == "eventos_pontuais" else None,
        "campanha_mensal_id": item_id if origem == "campanhas_mensais" else None,
        "instancia_uazapi": phone_number_id,
        "mensagem_template": template_name,
        "midia_url": None,
        "total_destinatarios": total,
        "total_enviados": sucessos,
        "total_erros": erros,
        "status": "concluida",
        "iniciado_em": datetime.now(timezone.utc).isoformat(),
        "concluido_em": datetime.now(timezone.utc).isoformat(),
    })
    await asyncio.to_thread(_update_db_sync, origem, item_id, {
        "status": "concluida",
        "disparo_id": disparo_id,
    })
    logger.info(f"Disparo {item_id} concluído. Sucessos: {sucessos} | Erros: {erros}")
```
Note the `disparos` row (`_criar_disparo_sync`) is only created **after** the whole loop finishes — meaning today, if the loop pauses early (`error_threshold`) or truncates (`daily_limit`), **no `disparos` row is ever created** for that partial run (the `error_threshold` branch `return`s before ever reaching `_criar_disparo_sync`; the `daily_limit` `break` falls through to it, so it silently reports `total_destinatarios: total` — the FULL intended count — even though only `daily_limit` were attempted; this exact mismatch is the already-documented achado C, left for `plans/008`). This plan needs a `disparo_id` to exist **before** the loop starts, so each per-lead ledger row (Step 3 below) can reference it from the first send onward — that requires moving disparo creation earlier, which is this plan's one real control-flow change to this function.

### `_processar_disparo_divulgacao_interno` — `disparo_id` already exists before the loop (simpler case)

Unlike the function above, `disparo_id` here is a **parameter**, already created by whatever enqueues `disparos_divulgacao` rows and claimed via `_claim_disparo_divulgacao_sync` before `_processar_disparo_divulgacao_interno` is ever called (`worker/campanhas_engine.py:507-527`, the caller `processar_disparos_divulgacao`). No control-flow change is needed here to make a `disparo_id` available — Step 4 only adds a ledger write per send.

`worker/campanhas_engine.py:570-608` (leads query and send loop):
```python
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
**This function requires `plans/005` to have landed first** — today `_query_leads_divulgacao_sync` (`worker/campanhas_engine.py:136-143`) only selects `telefone, nome`, no `id`; Plan 005 adds `id` to that select. Without it, this plan's Step 4 has no `lead_id` to write into the ledger.

### The webhook status discard point

`worker/meta_adapter_inbound.py:554-565` (inside `processar_webhook_meta`):
```python
    try:
        value = payload["entry"][0]["changes"][0]["value"]
        phone_number_id: str = value["metadata"]["phone_number_id"]
        messages = value.get("messages", [])
    except (KeyError, IndexError):
        logger.warning("[meta-inbound] Estrutura entry/changes/value inesperada — descartado")
        return

    # Ignorar eventos de status (delivery, read) sem messages[]
    if not messages:
        logger.info("[meta-inbound] Evento sem messages[] (status update) — ignorado")
        return
```
The WhatsApp Cloud API sends status updates as `value.statuses` (an array), structurally: `{"id": "wamid.XXXX", "status": "sent" | "delivered" | "read" | "failed", "timestamp": "...", "recipient_id": "...", "errors": [{"code": ..., "title": ...}]}` (present only on `"failed"`). This is where the new consumption logic goes, **before** the current early-return.

### Repo conventions to match

- Mocking style for `supabase` in worker tests: `worker/tests/test_campanhas_engine.py` (see e.g. `test_breadcrumb_cria_conversa_nova_quando_lead_nunca_falou_com_o_bot`, lines 165-185) — a `MagicMock()` with `monkeypatch.setattr(camp, "supabase", mock_sb)`, chained `.table().insert().execute()` etc.
- Migration style: plain `LANGUAGE sql` or `plpgsql` functions, `CREATE TABLE IF NOT EXISTS` for new tables in this repo's migrations is not used elsewhere (existing table migrations use plain `CREATE TABLE`, since each migration file runs once) — follow `supabase/migrations/20260704200000_wm20_wamid_dedupe_mensagens.sql` for an index-adding example and `supabase/migrations/20260706000000_claim_atomico_disparos_race_condition.sql` for function style.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Run worker test suite | `cd worker && python -m pytest tests/test_campanhas_engine.py tests/test_meta_adapter_inbound.py -v` | all pass, including new tests from Step 6 |
| Full worker suite | `cd worker && python -m pytest tests/ -v` | all pass (confirms nothing else regressed) |
| Sanity import check | `cd worker && python -c "import campanhas_engine; import meta_adapter_inbound"` | exits 0 |

No live Supabase project is available in this environment to apply the migration or run an end-to-end test against real Postgres — the migration (Step 1) can only be verified by careful visual review against the exemplars cited above, matching this repo's existing pattern of migrations awaiting manual application (see `supabase/migrations/20260708000001_aud06_versiona_rpcs_motor_agente.sql`'s note "NÃO aplicar automaticamente").

## Scope

**In scope**:
- New migration file (Step 1).
- `worker/campanhas_engine.py` — `_enviar_template_meta` signature (Step 2), `_processar_item_disparo_interno` (Step 3), `_processar_disparo_divulgacao_interno` (Step 4).
- `worker/main.py` — the one call site needing to unpack the new tuple return (Step 2).
- `worker/meta_adapter_inbound.py` — the one call site needing to unpack the new tuple return (Step 2), and the new `statuses[]` handling (Step 5).
- `worker/tests/test_campanhas_engine.py`, `worker/tests/test_meta_adapter_inbound.py` — new tests (Step 6).

**Out of scope** (do NOT touch, even though related):
- The `daily_limit` truncation / `error_threshold` pause **semantics** — do not change when a campaign pauses or add any auto-resume logic. This plan only ensures a `disparos` row exists and is correctly finalized (with accurate counts) whenever the loop ends, for any reason — it does not change what happens next. Auto-resume is `plans/008` (not yet written), a deliberate, separate, higher-risk decision (see STOP conditions).
- `meta_phone_numbers.quality_rating` / `messaging_limit_tier` — these columns already exist and were flagged as never populated; populating them from the Meta Graph API's phone-number-status endpoint (a different API call, not the `statuses[]` webhook) is a different, separate piece of work, not part of this plan.
- `_gravar_breadcrumb_disparo` and anything in `plans/004`/`plans/005`'s scope — unrelated concern (conversation state), do not touch.
- `supabase/functions/motor-agente/index.ts` — not touched by this plan.

## Git workflow

- Branch: `feat/ledger-entrega-status-meta`
- Commit per step (this plan is larger than 002-006 — prefer several small, reviewable commits over one large one), conventional-commits style, e.g. `feat(campanhas): captura wamid do envio Meta`, `feat(campanhas): grava ledger de destinatarios por disparo`, `feat(worker): consome statuses[] do webhook Meta`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Migration — reactivate the abandoned `logs_disparo` table instead of creating a new one

**Update (2026-07-27):** this plan originally proposed a brand-new table (`disparos_destinatarios`). While cross-checking an independent proposal Valmir's own Claude session made about the breadcrumb race (`plans/004`'s territory), it surfaced that **a table for exactly this purpose already exists, unused**: `public.logs_disparo` (`id, disparo_id, lead_id, telefone, status, erro, enviado_em, created_at`), confirmed live against production — **0 rows**, only 2 indexes (`logs_disparo_pkey` on `id`, `idx_logs_disparo_disparo_id` on `disparo_id`), no foreign keys defined on any column. The code that used to write to it was removed in commit `b8282cd` (S-WM-05, the UAZAPI→Meta migration, 2026-06-26) and never reinstated. Reusing it avoids a 3rd, overlapping "dispatch log" table in the schema. **This step now reactivates `logs_disparo` via `ALTER TABLE`, it does not create a new table.**

Create `supabase/migrations/20260727000000_reativa_logs_disparo_ledger.sql`:

```sql
-- Reativa a tabela logs_disparo (id, disparo_id, lead_id, telefone, status, erro, enviado_em,
-- created_at) — existia desde antes da migração pra Meta, mas o código que escrevia nela foi
-- removido no commit b8282cd (S-WM-05, 2026-06-26) e nunca foi refeito; está com 0 linhas em
-- produção (confirmado por consulta direta, 2026-07-27). Em vez de criar uma 3ª tabela de "log
-- de disparo por lead" do zero, esta migração adiciona as colunas que faltam pra cobrir também
-- o caminho de divulgação mensal (disparo_divulgacao_id) e a correlação com o wamid retornado
-- pela Meta (necessária pra casar com os eventos statuses[] do webhook, ver worker/meta_adapter_inbound.py).
--
-- Achado B/C do diagnóstico arquitetural (docs/qa/RELATORIO-10-panorama-disparo-corrida-juventude-2026-07-26.md):
-- hoje o sistema só sabe se o POST pra API da Meta teve sucesso HTTP, nunca se a mensagem foi de
-- fato entregue, lida ou falhou do lado do destinatário — os eventos statuses[] que a Meta manda
-- pra isso são descartados sem leitura.

ALTER TABLE public.logs_disparo
  ADD COLUMN disparo_divulgacao_id uuid,
  ADD COLUMN wamid text,
  ADD COLUMN atualizado_em timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.logs_disparo
  ADD CONSTRAINT logs_disparo_um_disparo_check CHECK (
    (disparo_id IS NOT NULL AND disparo_divulgacao_id IS NULL) OR
    (disparo_id IS NULL AND disparo_divulgacao_id IS NOT NULL)
  );

CREATE INDEX idx_logs_disparo_wamid ON public.logs_disparo (wamid) WHERE wamid IS NOT NULL;
CREATE INDEX idx_logs_disparo_lead_id ON public.logs_disparo (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_logs_disparo_disparo_divulgacao_id ON public.logs_disparo (disparo_divulgacao_id) WHERE disparo_divulgacao_id IS NOT NULL;
```

No `REFERENCES` (foreign key) added on `disparo_id`, `disparo_divulgacao_id`, or `lead_id` — matches this table's existing convention (confirmed live: `disparo_id` and `lead_id` have no FK today), not introduced fresh by this plan. The `ADD CONSTRAINT ... CHECK` above is safe to add against a 0-row table (no existing data to validate).

`status` values this plan writes: `'enviado'` (HTTP accepted), `'falhou'` (HTTP rejected/exception in `_enviar_template_meta`) at write time; `'entregue'`, `'lido'`, `'falhou'` (overwriting `'enviado'`, with the existing `erro` column populated) when a `statuses[]` webhook event arrives (Step 5). The new CHECK constraint enforces exactly one of the two disparo foreign keys is set, matching the two independent dispatch paths.

**Verify**: visual review only (see "Commands you will need" note about no live Postgres available). Before writing the `ALTER TABLE`, re-run `select count(*) from logs_disparo;` — if it's no longer `0`, STOP (see STOP conditions): something started writing to this table between this plan being written and executed, and blindly adding a CHECK constraint could break on existing rows that don't have exactly one of the two IDs set.

### Step 2: Capture the `wamid` from `_enviar_template_meta`

Change the function (`worker/campanhas_engine.py:200-233`) to return `tuple[bool, str | None]`:

```python
async def _enviar_template_meta(
    phone_number_id: str,
    to: str,
    token: str,
    template_name: str,
    components: list,
) -> tuple[bool, str | None]:
    """POST Graph API v23.0 com type=template. Retorna (sucesso, wamid)."""
    numero = _normalizar_numero_meta(to)
    url = f"https://graph.facebook.com/v23.0/{phone_number_id}/messages"
    body = {
        "messaging_product": "whatsapp",
        "to": numero,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": "pt_BR"},
            "components": components,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=body,
            )
        if resp.status_code in (200, 201):
            wamid = None
            try:
                wamid = resp.json().get("messages", [{}])[0].get("id")
            except Exception:
                pass
            return True, wamid
        logger.warning(f"[Meta] HTTP {resp.status_code} para {to}: {resp.text[:200]}")
        return False, None
    except Exception as exc:
        logger.error(f"[Meta] Erro ao enviar template {template_name!r} para {to}: {type(exc).__name__}")
        return False, None
```

Update all 4 call sites to unpack the tuple:
- `worker/campanhas_engine.py:405` → `ok, wamid = await _enviar_template_meta(phone_number_id, numero, meta_token, template_name, components)` (Step 3 uses `wamid`).
- `worker/campanhas_engine.py:601-603` → `ok, wamid = await _enviar_template_meta(...)` (Step 4 uses `wamid`).
- `worker/main.py:330-332` → `ok, _wamid = await _enviar_template_meta(...)` (unused, keep behavior otherwise identical).
- `worker/meta_adapter_inbound.py:457-460` → `ok, _wamid = await _enviar_template_meta(...)` (unused, keep behavior otherwise identical).

**Verify**: `cd worker && python -c "import campanhas_engine; import meta_adapter_inbound; import main"` → exits 0. `cd worker && python -m pytest tests/ -v` → all pass (this alone shouldn't break anything yet, since Step 6 hasn't added assertions on the ledger; the point of running the full suite here is to confirm the signature change didn't break any of the 4 call sites).

### Step 3: `_processar_item_disparo_interno` — create `disparo_id` before the loop, write a ledger row per send

Move the `disparos` row creation from the end of the function (currently lines 433-447) to immediately after `total = len(leads)` is computed and the 0-leads branch is handled (after line 347's `return`), so it exists before the loop starts:

```python
    tipo_disparo = "pontual" if origem == "eventos_pontuais" else "mensal"
    disparo_id = await asyncio.to_thread(_criar_disparo_sync, {
        "tipo": tipo_disparo,
        "evento_id": item_id if origem == "eventos_pontuais" else None,
        "campanha_mensal_id": item_id if origem == "campanhas_mensais" else None,
        "instancia_uazapi": phone_number_id,
        "mensagem_template": template_name,
        "midia_url": None,
        "total_destinatarios": total,
        "total_enviados": 0,
        "total_erros": 0,
        "status": "em_andamento",
        "iniciado_em": datetime.now(timezone.utc).isoformat(),
        "concluido_em": None,
    })
```

Then, inside the loop, right after `ok, wamid = await _enviar_template_meta(...)` (Step 2's change), add the ledger write — after the existing `if ok: sucessos += 1; ...` / `else: erros += 1` block, regardless of which branch:

```python
        lead_id_ledger = lead.get("id")
        if lead_id_ledger:
            try:
                await asyncio.to_thread(
                    lambda: supabase.table("logs_disparo").insert({
                        "disparo_id": disparo_id,
                        "lead_id": lead_id_ledger,
                        "telefone": numero,
                        "wamid": wamid,
                        "status": "enviado" if ok else "falhou",
                    }).execute()
                )
            except Exception as ledger_err:
                logger.warning(f"[Ledger] Erro ao gravar logs_disparo: {ledger_err}")
```

Wrap in its own `try/except` (matching the existing breadcrumb-write pattern a few lines above it) so a ledger failure never turns a successful send into a counted error or stops the loop.

Finally, replace the two places that finalize the item today:

1. The error-threshold pause branch (currently lines 428-431) — add a `disparos` row finalization alongside the existing `eventos_pontuais`/`ouvidoria_eventos` item update:
   ```python
        if (i + 1) > 5:
            taxa_erro = (erros / (i + 1)) * 100
            if taxa_erro > error_threshold:
                logger.error(f"Taxa de erro {taxa_erro:.1f}% > {error_threshold}%. Pausando!")
                await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
                await asyncio.to_thread(_update_db_sync, "disparos", disparo_id, {
                    "status": "pausada",
                    "total_enviados": sucessos,
                    "total_erros": erros,
                    "concluido_em": datetime.now(timezone.utc).isoformat(),
                })
                return
   ```
2. The end-of-function block (currently lines 433-447, the `_criar_disparo_sync` call) — since `disparo_id` now already exists, change this from an INSERT to an UPDATE of the same row:
   ```python
    await asyncio.to_thread(_update_db_sync, "disparos", disparo_id, {
        "status": "concluida",
        "total_enviados": sucessos,
        "total_erros": erros,
        "concluido_em": datetime.now(timezone.utc).isoformat(),
    })
    await asyncio.to_thread(_update_db_sync, origem, item_id, {
        "status": "concluida",
        "disparo_id": disparo_id,
    })
    logger.info(f"Disparo {item_id} concluído. Sucessos: {sucessos} | Erros: {erros}")
   ```
   Note `total_destinatarios` no longer needs to be set here — it's already correct from the creation at the top of the function (`total`, computed once, doesn't change).

**Verify**: `cd worker && python -c "import campanhas_engine"` → exits 0 (syntax sanity; full behavior verified by Step 6's tests).

### Step 4: `_processar_disparo_divulgacao_interno` — write a ledger row per send

Simpler than Step 3 — `disparo_id` is already a parameter, created before this function is even called. After `ok, wamid = await _enviar_template_meta(...)` (currently lines 601-603, Step 2's change), add:

```python
        lead_id_ledger = lead.get("id")
        if lead_id_ledger:
            try:
                await asyncio.to_thread(
                    lambda: supabase.table("logs_disparo").insert({
                        "disparo_divulgacao_id": disparo_id,
                        "lead_id": lead_id_ledger,
                        "telefone": telefone,
                        "wamid": wamid,
                        "status": "enviado" if ok else "falhou",
                    }).execute()
                )
            except Exception as ledger_err:
                logger.warning(f"[Ledger] Erro ao gravar logs_disparo (divulgacao): {ledger_err}")
```

Requires `lead.get("id")` to exist — confirmed available only after `plans/005` lands (see "Depends on" and "Current state" above). If `plans/005` has not landed when you reach this step, STOP (see STOP conditions) rather than also patching `_query_leads_divulgacao_sync` yourself — that's Plan 005's change to make, not this plan's.

**Verify**: `cd worker && python -c "import campanhas_engine"` → exits 0.

### Step 5: Consume `statuses[]` in the webhook handler

In `worker/meta_adapter_inbound.py`, inside `processar_webhook_meta` (around lines 554-565), add status handling **before** the existing `if not messages: ... return` early exit, so status-only events (which have no `messages[]`) get processed instead of just logged-and-discarded:

```python
    try:
        value = payload["entry"][0]["changes"][0]["value"]
        phone_number_id: str = value["metadata"]["phone_number_id"]
        messages = value.get("messages", [])
        statuses = value.get("statuses", [])
    except (KeyError, IndexError):
        logger.warning("[meta-inbound] Estrutura entry/changes/value inesperada — descartado")
        return

    if statuses:
        supabase_status = _get_supabase()
        _STATUS_MAP = {"sent": "enviado", "delivered": "entregue", "read": "lido", "failed": "falhou"}
        for status_evt in statuses:
            wamid_status = status_evt.get("id")
            status_meta = status_evt.get("status")
            if not wamid_status or status_meta not in _STATUS_MAP:
                continue
            erro_codigo = None
            if status_meta == "failed":
                erros_lista = status_evt.get("errors") or []
                if erros_lista:
                    erro_codigo = str(erros_lista[0].get("code", ""))
            try:
                supabase_status.table("logs_disparo").update({
                    "status": _STATUS_MAP[status_meta],
                    "erro": erro_codigo,
                    "atualizado_em": datetime.now(timezone.utc).isoformat(),
                }).eq("wamid", wamid_status).execute()
            except Exception as exc:
                logger.warning(f"[meta-inbound] Erro ao atualizar status de wamid={wamid_status!r}: {exc}")

    # Ignorar eventos de status (delivery, read) sem messages[]
    if not messages:
        logger.info("[meta-inbound] Evento sem messages[] (status update) — ignorado")
        return
```

Check the top of `worker/meta_adapter_inbound.py` for an existing `datetime`/`timezone` import before adding the `datetime.now(timezone.utc)` call above — if not already imported, add `from datetime import datetime, timezone` alongside the file's existing imports (do not duplicate if already present).

This must stay best-effort and fast: it runs inside the same background task that also handles inbound messages, and Meta's webhook delivery expects a quick 200 (already handled upstream by `main.py`'s immediate-200-then-background-task pattern — this code runs after that response is already sent, so latency here doesn't block the Meta-facing response, but keep the try/except so a lookup failure never raises out of the background task).

**Verify**: `cd worker && python -c "import meta_adapter_inbound"` → exits 0.

### Step 6: Tests

Neither `_processar_item_disparo_interno` nor `_processar_disparo_divulgacao_interno` has any existing test (confirmed by reading `worker/tests/test_campanhas_engine.py` in full — it only tests `_montar_parametros_named`, `_gravar_breadcrumb_disparo`, and `_query_leads_sync`). Add, in `worker/tests/test_campanhas_engine.py`, modeling the mocking style after `test_breadcrumb_cria_conversa_nova_quando_lead_nunca_falou_com_o_bot` (lines 165-185):

1. `test_enviar_template_meta_retorna_wamid_em_sucesso` — mock `httpx.AsyncClient` (or monkeypatch the client construction) to return a 200 response with a JSON body containing `{"messages": [{"id": "wamid.ABC123"}]}`; assert the function returns `(True, "wamid.ABC123")`.
2. `test_enviar_template_meta_retorna_none_em_falha` — mock a non-200 response; assert `(False, None)`.
3. `test_disparo_pontual_grava_ledger_por_destinatario` — mock `supabase`, `_get_phone_by_canal_tipo_sync`, `_query_leads_sync` (returns 1-2 leads with `id`), `_enviar_template_meta` (monkeypatched to return `(True, "wamid.XYZ")`); call `_processar_item_disparo_interno`; assert `supabase.table("logs_disparo").insert` was called with a payload containing `disparo_id`, the lead's `id`, and `"wamid.XYZ"`.
4. `test_disparo_pontual_cria_disparo_antes_do_loop_nao_depois` — same setup; assert `_criar_disparo_sync`-equivalent insert into `"disparos"` happens with `status: "em_andamento"` before any `logs_disparo` insert (order matters — assert via call order on the mock, e.g. comparing indices in `mock_sb.table.call_args_list`).
5. `test_disparo_divulgacao_grava_ledger_por_destinatario` — same shape as #3, for `_processar_disparo_divulgacao_interno`.
6. In `worker/tests/test_meta_adapter_inbound.py`, add `test_webhook_statuses_atualiza_ledger_por_wamid` — POST a payload shaped like `{"entry": [{"changes": [{"value": {"metadata": {...}, "statuses": [{"id": "wamid.ABC", "status": "delivered"}]}}]}]}` through `processar_webhook_meta` (or the relevant entry point this test file already uses for webhook payloads — follow the existing pattern for constructing a fake Meta payload in this file rather than inventing a new one) and assert `supabase.table("logs_disparo").update` was called with `status: "entregue"` and `.eq("wamid", "wamid.ABC")`.

**Verify**: `cd worker && python -m pytest tests/test_campanhas_engine.py tests/test_meta_adapter_inbound.py -v` → all pass, including the 6 new tests. Then `cd worker && python -m pytest tests/ -v` → full suite green.

## Test plan

- The 6 tests listed in Step 6, covering: wamid extraction on success/failure, ledger write for both dispatch paths, disparo-created-before-loop ordering, and webhook status consumption.
- Structural pattern: `worker/tests/test_campanhas_engine.py`'s existing `MagicMock` + `monkeypatch.setattr(camp, "supabase", mock_sb)` style.
- Verification: `cd worker && python -m pytest tests/ -v` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd worker && python -c "import campanhas_engine; import meta_adapter_inbound; import main"` exits 0
- [ ] `cd worker && python -m pytest tests/ -v` exits 0, including the 6 new tests from Step 6
- [ ] `grep -n "def _enviar_template_meta" -A 2 worker/campanhas_engine.py | grep "tuple\[bool, str | None\]"` matches (signature updated)
- [ ] `grep -c "logs_disparo" worker/campanhas_engine.py` returns at least 2 (both dispatch functions write to it)
- [ ] `grep -n "statuses" worker/meta_adapter_inbound.py` shows the new handling block
- [ ] `supabase/migrations/20260727000000_reativa_logs_disparo_ledger.sql` exists and adds `disparo_divulgacao_id`, `wamid`, `atualizado_em` to `public.logs_disparo`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for Plan 007 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `select count(*) from logs_disparo;` returns anything other than `0` when you reach Step 1 — this plan's migration assumes the table is still empty (confirmed 2026-07-27); if something started writing to it since, adding the CHECK constraint blindly could fail against existing rows, and the reactivation plan needs re-review before proceeding.
- `plans/005-breadcrumb-disparo-divulgacao-mensal.md` has not landed yet (check its status in `plans/README.md`) when you reach Step 4 — you need `lead.get("id")` from `_query_leads_divulgacao_sync`, which only exists after that plan's change. Do not patch that function yourself as a shortcut.
- Any of the current-state excerpts in this plan don't match the live code at the cited line numbers — the codebase has drifted since this plan was written (see drift check at the top).
- You find yourself wanting to change what happens when `daily_limit` truncates a dispatch or `error_threshold` pauses it (e.g., adding auto-resume, or changing what status a paused item gets claimed under) — that is `plans/008` (not yet written), a deliberate follow-up requiring a product decision about auto-resume semantics that is out of scope here. Implement only the ledger and status-consumption pieces described in this plan.
- A step's verification fails twice after a reasonable fix attempt.
- You discover `_enviar_template_meta` has more than 4 call sites, or that any of the 4 cited call sites' surrounding code doesn't match what's quoted in "Current state" — this plan's call-site list was produced by `grep -rn "_enviar_template_meta" worker/` at commit `256d547`; a 5th call site would mean the codebase has changed since.

## Maintenance notes

- **This plan is the foundation for `plans/008` (not yet written)**: fixing the `daily_limit` truncation bug (achado C — a dispatch that hits the daily cap gets marked `"concluida"` instead of resumed) needs this ledger to exist first, so a future "resume" claim can query `logs_disparo WHERE disparo_id = X AND status = 'enviado'` (or whichever recipients have no ledger row yet) to know exactly who still needs a message, without re-querying and re-sending to everyone. Do not attempt that fix as part of this plan — it also requires a product decision (should a daily-limit-paused campaign resume automatically on the next loop tick, or only when a human re-approves it?) that belongs in a separate conversation, not baked silently into this plan.
- A reviewer should scrutinize: that the ledger writes (Steps 3-4) are wrapped in their own try/except and never affect `sucessos`/`enviados`/`erros` counters or stop a loop; that Step 3's move of `disparo_id` creation to before the loop doesn't change the `total_destinatarios` value that gets recorded (it shouldn't — `total` is computed once, before either the old or new creation point); and that Step 5's webhook handling never raises an exception that could propagate out of the background task.
- Once `meta_phone_numbers.quality_rating`/`messaging_limit_tier` populate from a real source (separate future work, out of scope here), that data plus this ledger's per-recipient failure codes together would let a future anti-ban check pause a campaign based on **actual delivery failure rate**, not just HTTP failure rate (`error_threshold` today) — noted here so whoever builds that doesn't have to rediscover this connection.
