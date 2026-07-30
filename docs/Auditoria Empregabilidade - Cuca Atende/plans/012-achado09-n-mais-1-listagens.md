# Plan 012: N+1 em 2 telas de listagem (candidaturas por vaga, título de vaga por candidatura) (achado #9)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7b0b326..HEAD -- worker/empregabilidade_engine.py`
> Confirme que `:1219-1237` e `:1349-1352` ainda batem com a seção "Current
> state" antes de prosseguir.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW — troca N queries por 1 query + agrupamento em Python; comportamento observável idêntico (mesmos números exibidos), só menos round-trips.
- **Depends on**: none
- **Category**: performance (N+1)
- **Confidence**: HIGH (confirmado ao vivo em 2026-07-29)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

2 pontos fazem 1 query extra **por item da lista**, dentro de um `for`:
- `:1219-1237` (listagem de vagas da empresa): pra cada vaga (até 10), 1 query separada em `candidaturas` só pra contar candidatos.
- `:1349-1352` (busca de candidatura por nome): pra cada candidatura encontrada (até 5), 1 query separada em `vagas` só pra pegar o título.

Nenhum dos dois é catastrófico no volume atual (listas pequenas, limitadas a 10/5), mas é desperdício de round-trip fácil de eliminar, e cresce proporcional ao uso.

## Current state

`worker/empregabilidade_engine.py:1219-1237` (confirmado ao vivo):
```python
    if empresa_id:
        vagas_res = supabase.table("vagas").select(
            "id, titulo, status, total_vagas, numero_vaga"
        ).eq("empresa_id", empresa_id).order("numero_vaga", desc=False).limit(10).execute()
        vagas = vagas_res.data or []
        ...
        linhas = ["📋 *Suas vagas cadastradas:*\n"]
        for v in vagas:
            cands = supabase.table("candidaturas").select("id", count="exact").eq("vaga_id", v["id"]).execute()
            ...
            linhas.append(f"• {numero_ref} *{v['titulo']}* — {v['status']} ({cands.count or 0} candidatos)")
```

`:1333-1352` (confirmado ao vivo):
```python
        cand_res = supabase.table("candidaturas").select(
            "id, status, vaga_id, created_at, observacoes, nome"
        ).ilike("nome", f"%{texto_limpo}%").order("created_at", desc=True).limit(5).execute()
        candidaturas_encontradas = cand_res.data or []
        ...
        linhas = ["📋 *Candidatura(s) encontrada(s):*\n"]
        for c in candidaturas_encontradas[:5]:
            vaga_res = supabase.table("vagas").select("titulo").eq("id", c["vaga_id"]).single().execute()
            titulo_vaga = (vaga_res.data or {}).get("titulo", "Vaga") if vaga_res.data else "Vaga"
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: os 2 pontos citados, `worker/empregabilidade_engine.py:1219-1237` e `:1333-1352`.

**Out of scope**: qualquer outro N+1 no arquivo não citado aqui; mudança de formato da mensagem exibida.

## Git workflow

- Branch: `perf/achado09-n-mais-1-listagens`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Contagem de candidatos por vaga em 1 query

```python
    if empresa_id:
        vagas_res = supabase.table("vagas").select(
            "id, titulo, status, total_vagas, numero_vaga"
        ).eq("empresa_id", empresa_id).order("numero_vaga", desc=False).limit(10).execute()
        vagas = vagas_res.data or []
        ...
        vaga_ids = [v["id"] for v in vagas]
        cands_res = supabase.table("candidaturas").select("vaga_id").in_("vaga_id", vaga_ids).execute()
        contagem_por_vaga: dict[str, int] = {}
        for row in (cands_res.data or []):
            contagem_por_vaga[row["vaga_id"]] = contagem_por_vaga.get(row["vaga_id"], 0) + 1

        linhas = ["📋 *Suas vagas cadastradas:*\n"]
        for v in vagas:
            numero_ref = f"#{v['numero_vaga']}" if v.get("numero_vaga") else f"...{v['id'][-6:].upper()}"
            linhas.append(
                f"• {numero_ref} *{v['titulo']}* — {v['status']} ({contagem_por_vaga.get(v['id'], 0)} candidatos)"
            )
```
Se `vagas` estiver vazia, `.in_("vaga_id", [])` pode se comportar de forma inesperada dependendo da versão do postgrest-py (algumas versões tratam lista vazia como erro/retorno vazio de formas diferentes) — o `if not vagas: ... return` logo acima (`:1226-1229`) já cobre esse caso antes de chegar aqui, então `vaga_ids` nunca deveria estar vazia neste ponto; confirme isso ao ler o código completo antes de editar.

### Step 2: Título de vaga por candidatura em 1 query

```python
        candidaturas_encontradas = cand_res.data or []
        ...
        vaga_ids_busca = [c["vaga_id"] for c in candidaturas_encontradas[:5] if c.get("vaga_id")]
        titulos_res = supabase.table("vagas").select("id, titulo").in_("id", vaga_ids_busca).execute()
        titulo_por_vaga = {row["id"]: row["titulo"] for row in (titulos_res.data or [])}

        linhas = ["📋 *Candidatura(s) encontrada(s):*\n"]
        for c in candidaturas_encontradas[:5]:
            titulo_vaga = titulo_por_vaga.get(c["vaga_id"], "Vaga")
```
Aqui `vaga_ids_busca` **pode** estar vazia (se nenhuma candidatura tiver `vaga_id` — improvável mas não impossível) — confirme o comportamento de `.in_("id", [])` com um teste antes de assumir que não quebra.

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Adicionar 2 testes: 1 confirmando que a listagem de vagas mostra a contagem certa de candidatos por vaga (com 2+ vagas, contagens diferentes, garantindo que não houve troca entre vagas no agrupamento); 1 confirmando que a busca por nome mostra o título certo por candidatura (2+ candidaturas de vagas diferentes). Ambos devem usar `assert_called_with`/inspeção de `call_args` pra confirmar que só 1 query foi feita em cada tabela (não N), seguindo o padrão do Plan 008.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, incluindo os 2 novos.

## Done criteria

- [ ] Os 2 pontos trocados de N queries por 1 query + agrupamento em Python
- [ ] 2 testes novos confirmando contagem/título corretos E que só 1 query foi feita por tabela
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0
- [ ] Mensagem exibida ao usuário idêntica à de antes (mesmos números, mesmo formato)
- [ ] `plans/README.md` atualizado

## STOP conditions

- `.in_("vaga_id", [])`/`.in_("id", [])` (lista vazia) se comportar de forma inesperada na versão do postgrest-py em uso — teste isso explicitamente antes de considerar terminado, não presuma.
- Os números de linha citados não baterem com o código ao vivo.

## Maintenance notes

- Nenhuma.
