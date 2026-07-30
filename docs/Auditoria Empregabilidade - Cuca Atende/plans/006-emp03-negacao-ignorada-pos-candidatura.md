# Plan 006: Negação ignorada em `pos_candidatura` reabre busca de vagas que o lead queria encerrar (EMP-03)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7b0b326..HEAD -- worker/empregabilidade_engine.py worker/tests/test_empregabilidade_engine.py`
> Se `empregabilidade_engine.py` mudou desde que este plano foi escrito,
> compare os trechos da seção "Current state" contra o código ao vivo antes
> de prosseguir; se não bater, trate como STOP condition.
>
> **O teste já existe, não precisa ser escrito**: `worker/tests/test_empregabilidade_engine.py::TestPosCandidaturaNegacaoIgnorada::test_nao_quero_mais_vagas_nao_deveria_reabrir_busca_de_vagas` está no working tree local (não commitado — ver `docs/qa/AUDITORIA-empregabilidade-CONSOLIDADA-2026-07-29.md`), hoje **vermelho**. O trabalho deste plano é só o fix.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — replica um padrão de fix já existente e testado (`oferta_banco_talentos`) para uma etapa vizinha; muda só a condição de 2 variáveis booleanas, não a estrutura do branch.
- **Depends on**: none
- **Category**: bug (negação ignorada, ação oposta ao pedido do lead)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

Na etapa `pos_candidatura` (`worker/empregabilidade_engine.py:1585-1601`), `quer_mais_vagas` é calculado checando se qualquer uma de várias palavras (`"outra"`, `"mais"`, `"vagas"`, `"quero"`, `"ok"`, etc.) aparece na mensagem — **sem checar negação**. "**Não** quero mais vagas, obrigado" contém "quero" e "mais" e "vagas" → `quer_mais_vagas = True`, reabrindo a busca de vagas com uma resposta completamente descolada do que o lead pediu (que era encerrar).

A etapa seguinte, `oferta_banco_talentos` (`:1619-1629`), já tem exatamente essa correção para o mesmo padrão de ambiguidade ("não quero banco de talentos, sou empresa" batia em "banco"/"talentos"): calcula `tem_negacao` primeiro e usa isso pra **desativar** o fast-path positivo. O comentário ali (`:1620-1625`) até cita o "bug 5 do relatório anterior" como motivo — mas essa correção nunca foi replicada de volta pra `pos_candidatura`.

## Current state

`worker/empregabilidade_engine.py:1583-1601` (confirmado ao vivo em 2026-07-29):
```python
    # --- ETAPA: pos_candidatura (S37C-01) ---
    if etapa == "pos_candidatura":
        quer_mais_vagas = any(p in t_lower for p in (
            "outra", "mais", "ver vagas", "outras vagas", "vagas", "vaga", "sim", "quero", "ok"
        ))
        quer_encerrar_claro = any(p in t_lower for p in (
            "não", "nao", "encerrar", "tchau", "até mais", "até logo", "finalizar", "pode fechar"
        ))

        if quer_mais_vagas:
            ...
        elif quer_encerrar_claro:
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        else:
            ...
```
Padrão de referência já correto, em `:1619-1629`:
```python
    # --- ETAPA: oferta_banco_talentos ---
    if etapa == "oferta_banco_talentos":
        tem_negacao = any(p in t_lower for p in ("não", "nao"))
        quer_banco = not tem_negacao and any(
            p in t_lower for p in ("sim", "quero", "ok", "claro", "pode", "banco", "talentos", "cadastrar")
        )
```
Note que `quer_encerrar_claro` (linha 1588-1590) **já inclui** `"não"`/`"nao"` na sua própria lista — ou seja, "não quero mais vagas, obrigado" já seria corretamente identificado como pedido de encerramento pelo `elif`, se `quer_mais_vagas` não roubasse a decisão primeiro (o `if` é checado antes do `elif`, e hoje `quer_mais_vagas` vem `True` incondicionalmente).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Teste específico deste achado | `cd worker && python -m pytest "tests/test_empregabilidade_engine.py::TestPosCandidaturaNegacaoIgnorada::test_nao_quero_mais_vagas_nao_deveria_reabrir_busca_de_vagas" -v` | passa (hoje falha) |
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: `worker/empregabilidade_engine.py`, etapa `pos_candidatura` (`:1584-1590` especificamente — só as 2 linhas que calculam `quer_mais_vagas`/adicionam `tem_negacao`).

**Out of scope**: `oferta_banco_talentos` (já correta, só referência); o branch `else` (escape semântico) desta mesma etapa; EMP-01/02/04 (planos separados).

## Git workflow

- Branch: `fix/emp03-negacao-pos-candidatura`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replicar o padrão `tem_negacao` de `oferta_banco_talentos`

```python
    if etapa == "pos_candidatura":
        tem_negacao = any(p in t_lower for p in ("não", "nao"))
        quer_mais_vagas = not tem_negacao and any(p in t_lower for p in (
            "outra", "mais", "ver vagas", "outras vagas", "vagas", "vaga", "sim", "quero", "ok"
        ))
        quer_encerrar_claro = any(p in t_lower for p in (
            "não", "nao", "encerrar", "tchau", "até mais", "até logo", "finalizar", "pode fechar"
        ))
```
Só a linha de `quer_mais_vagas` muda (ganha `not tem_negacao and`); `quer_encerrar_claro` fica exatamente igual — já cobre o caso corretamente assim que `quer_mais_vagas` parar de interceptar primeiro.

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Não escrever teste novo — `TestPosCandidaturaNegacaoIgnorada::test_nao_quero_mais_vagas_nao_deveria_reabrir_busca_de_vagas` já existe e cobre este caso. Rodar a suíte completa pra confirmar que nenhum teste existente dependia do comportamento antigo (ex.: uma mensagem tipo "quero mais vagas, não sei bem quais" — que tem "não" mas quer mesmo mais vagas — passaria a cair no `elif`/`else` em vez do `if`; confirme se há teste cobrindo esse tipo de ambiguidade e se o comportamento resultante ainda é aceitável).

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

## Done criteria

- [ ] `quer_mais_vagas` em `pos_candidatura` é `not tem_negacao and (...)`, mesmo padrão de `oferta_banco_talentos`
- [ ] `TestPosCandidaturaNegacaoIgnorada::test_nao_quero_mais_vagas_nao_deveria_reabrir_busca_de_vagas` passa
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0, sem regressão
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] `plans/README.md` atualizado

## STOP conditions

- Um teste existente quebrar por causa da mudança — leia o caso real antes de decidir se é regressão genuína ou comportamento antigo incorreto que devia mudar mesmo.
- Os números de linha citados aqui não baterem com o código ao vivo.

## Maintenance notes

- Esse é o 2º lugar (depois de `oferta_banco_talentos`) onde esse padrão de negação precisou ser aplicado manualmente — se aparecer um 3º caso no futuro, vale considerar extrair um helper `_tem_negacao(t_lower)` reutilizável em vez de repetir a lista `("não", "nao")` a cada novo ponto (não fazer isso agora, fora de escopo deste plano específico).
