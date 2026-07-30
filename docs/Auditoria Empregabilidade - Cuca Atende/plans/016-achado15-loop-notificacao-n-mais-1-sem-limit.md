# Plan 016: Loop de notificação faz N+1 de lead por conversa + query externa sem `.limit()` (achado #15)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7b0b326..HEAD -- worker/empregabilidade_engine.py`
> Confirme que `empregabilidade_notify_loop` (`:2595+`) ainda bate com a
> seção "Current state" antes de prosseguir.
>
> **Relacionado ao Plan 011** (achado #6, mesma função) e ao **Plan 009**
> (BUG-02/PERF-01, mesma função também precisa de `asyncio.to_thread`) —
> considere a ordem de execução entre os 3 pra evitar conflito de merge; não
> há dependência dura, mas tocam a mesma função.

## Status

- **Priority**: P3
- **Effort**: S/M
- **Risk**: MED — `empregabilidade_notify_loop` roda em background a cada 20s sem nenhum teste automatizado hoje (confirmar); mudanças aqui precisam de teste manual cuidadoso além do pytest.
- **Depends on**: none (mas ver nota de relacionamento acima)
- **Category**: performance (N+1 + query externa sem limite)
- **Confidence**: HIGH/MED (confirmado ao vivo em 2026-07-29)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

`empregabilidade_notify_loop` (`worker/empregabilidade_engine.py:2595-2799`) roda a cada 20s e:
1. Busca **todas** as conversas ativas do módulo Empregabilidade numa query sem `.limit()` (`:2606-2608`) — cresce sem limite conforme a base de conversas cresce.
2. Pra cada conversa elegível (dentro do `for`), faz **1 query separada** em `leads` só pra pegar o telefone (`:2631-2634`) — N+1 clássico, na mesma classe do achado #9.

Diferente do achado #9 (listas limitadas a 5-10 itens), este loop roda **constantemente** (a cada 20s, pra sempre, enquanto o worker estiver de pé) — o custo acumulado ao longo do tempo é maior, mesmo que cada execução individual seja rápida hoje.

## Current state

`worker/empregabilidade_engine.py:2604-2638` (confirmado ao vivo):
```python
    while True:
        try:
            res = supabase.table("conversas").select(
                "id, metadata, origem_id, lead_id"
            ).eq("agente_tipo", "Empregabilidade").in_("status", ["ativa", "aberta"]).execute()

            conversas = res.data or []
            for c in conversas:
                metadata = c.get("metadata") or {}
                fluxo = metadata.get("empreg_fluxo") or {}
                etapa_c = fluxo.get("etapa", "")

                if etapa_c not in ("aguardando_retorno_vaga", "aguardando_retorno_edicao",
                                   "aguardando_confirmacao_candidatura", "aguardando_retorno_selecao"):
                    continue

                conversa_id = c["id"]
                lead_id = c.get("lead_id", "")
                instance_name = c.get("origem_id", "")
                ...
                lead_phone_res = supabase.table("leads").select(
                    "telefone"
                ).eq("id", lead_id).single().execute()
                phone = (lead_phone_res.data or {}).get("telefone", "")
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |
| Teste manual | rodar o worker localmente com dados de teste, observar log `[empreg-notify]` | comportamento idêntico ao de antes, sem erro novo |

## Scope

**In scope**: `empregabilidade_notify_loop`, especificamente as 2 queries citadas.

**Out of scope**: mudar a lógica de quais etapas são monitoradas; a frequência do loop (20s); `asyncio.to_thread` (Plan 009) e a trava de concorrência (Plan 011) — coordenar ordem de execução, não fazer os 3 no mesmo commit sem necessidade.

## Git workflow

- Branch: `perf/achado15-notify-loop-n-mais-1`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Batch da busca de telefone por lead

```python
            conversas = res.data or []
            # Filtra primeiro as elegíveis, depois busca telefone em lote — evita
            # tanto o N+1 quanto buscar telefone de conversas que nem serão usadas.
            elegiveis = [
                c for c in conversas
                if (c.get("metadata") or {}).get("empreg_fluxo", {}).get("etapa", "") in (
                    "aguardando_retorno_vaga", "aguardando_retorno_edicao",
                    "aguardando_confirmacao_candidatura", "aguardando_retorno_selecao",
                )
            ]
            lead_ids = [c.get("lead_id") for c in elegiveis if c.get("lead_id")]
            leads_res = supabase.table("leads").select("id, telefone").in_("id", lead_ids).execute()
            telefone_por_lead = {row["id"]: row.get("telefone", "") for row in (leads_res.data or [])}

            for c in elegiveis:
                metadata = c.get("metadata") or {}
                fluxo = metadata.get("empreg_fluxo") or {}
                etapa_c = fluxo.get("etapa", "")
                conversa_id = c["id"]
                lead_id = c.get("lead_id", "")
                instance_name = c.get("origem_id", "")
                token = ""
                unidade_cuca = ""

                if not instance_name:
                    logger.warning("[empreg-notify] origem_id ausente na conversa %s — skipping", conversa_id)
                    continue

                phone = telefone_por_lead.get(lead_id, "")
                if not phone:
                    logger.warning("[empreg-notify] telefone do lead ausente — conversa %s skipped", conversa_id)
                    continue
                ...
```
Note que o filtro de etapa foi movido pra **antes** da busca de telefone (na list comprehension `elegiveis`) — isso já reduz quantos leads precisam ser buscados, além de resolver o N+1 (1 query em vez de N).

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

### Step 2: Limitar a query externa de conversas

```python
            res = supabase.table("conversas").select(
                "id, metadata, origem_id, lead_id"
            ).eq("agente_tipo", "Empregabilidade").in_("status", ["ativa", "aberta"]).limit(200).execute()
```
`.limit(200)` é um valor de partida conservador — a auditoria nota que "limitar a query externa pode precisar coluna gerada" (ex.: um índice/coluna que permita filtrar diretamente pela etapa do fluxo, já que hoje o filtro de etapa acontece em Python depois de trazer tudo). Se 200 não for suficiente pro volume real de conversas ativas simultâneas, considerar no futuro uma coluna gerada/índice em `metadata->>'empreg_fluxo'->>'etapa'` pra filtrar isso direto no Postgres — **fora de escopo deste plano**, só documentar a limitação.

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Não há teste automatizado hoje para `empregabilidade_notify_loop` (confirmar com `grep -n "empregabilidade_notify_loop" worker/tests/test_empregabilidade_engine.py` antes de assumir) — se não houver, considerar extrair o corpo do `while True` numa função testável (ex.: `_notify_loop_tick()`) executada 1x por chamada, e escrever 1-2 testes cobrindo: (a) 1 lead buscado em lote pra 2+ conversas elegíveis (não N chamadas separadas); (b) conversas não-elegíveis não geram busca de telefone alguma.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, incluindo os novos, se extraídos.

## Done criteria

- [ ] Busca de telefone por lead em lote (1 query, não N)
- [ ] Query de conversas ativas com `.limit()` explícito
- [ ] Testes cobrindo o batch (se a função foi extraída para ser testável)
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0
- [ ] Teste manual confirmando que o loop continua notificando corretamente
- [ ] `plans/README.md` atualizado

## STOP conditions

- Não existir hoje nenhuma forma prática de testar `empregabilidade_notify_loop` sem rodar o worker de verdade — nesse caso, ao menos documentar no PR que a validação foi manual, não pytest.
- Os números de linha não baterem com o código ao vivo.

## Maintenance notes

- O valor `.limit(200)` é um chute inicial — se o volume real de conversas ativas em `aguardando_retorno_*` já for maior que isso hoje, ajustar antes de aplicar (confirmar com uma consulta real ao banco antes de fixar o número).
