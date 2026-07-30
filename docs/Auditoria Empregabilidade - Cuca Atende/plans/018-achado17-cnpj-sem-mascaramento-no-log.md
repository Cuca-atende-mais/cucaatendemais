# Plan 018: CNPJ completo aparece em log de erro, sem o mascaramento que telefone já tem (achado #17)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: confirme que `worker/empregabilidade_engine.py:138`
> ainda loga `cnpj_limpo` sem máscara antes de prosseguir.

## Status

- **Priority**: P4
- **Effort**: S
- **Risk**: LOW — troca de 1 linha de log, sem efeito funcional.
- **Depends on**: none
- **Category**: security (dado sensível em log)
- **Confidence**: HIGH (confirmado ao vivo em 2026-07-29)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

O padrão já estabelecido no arquivo é mascarar telefone em log (`phone[:6] + "****"`, usado em `:2172`, `:2205`, `:2491`). CNPJ, que também é dado que identifica uma entidade real, não recebe o mesmo tratamento: `:138` loga o CNPJ **completo** num warning de erro de consulta à API externa. Inconsistência pontual — CNPJ de empresa é informação menos sensível que telefone pessoal (é público por natureza, inclusive consultável em `publica.cnpj.ws`), mas ainda assim vale alinhar com o padrão já adotado no resto do arquivo, já que logs podem ser acessados por mais gente/ferramentas do que o necessário pra ver o dado completo.

## Current state

`worker/empregabilidade_engine.py:135-139` (confirmado ao vivo):
```python
                return res.json()
            return None
    except Exception as e:
        logger.warning(f"[CNPJ API] Erro ao consultar {cnpj_limpo}: {e}")
        return None
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: `worker/empregabilidade_engine.py:138` (a linha de log citada).

**Out of scope**: qualquer outro log do arquivo não citado; mudança na lógica de consulta ao CNPJ em si.

## Git workflow

- Branch: `fix/achado17-mascarar-cnpj-log`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Mascarar o CNPJ no log, mesmo padrão do telefone

```python
    except Exception as e:
        logger.warning(f"[CNPJ API] Erro ao consultar {cnpj_limpo[:6]}********: {e}")
        return None
```
CNPJ tem 14 dígitos — mascarar os 6 primeiros (raiz do CNPJ, identifica a empresa em bases públicas de qualquer forma) e ocultar os 8 restantes segue o mesmo espírito do `phone[:6] + "****"` já usado no arquivo.

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Não é estritamente necessário um teste novo pra uma troca de string de log — mas se quiser garantir que não regride, adicionar 1 teste checando (via `caplog` do pytest) que o CNPJ completo não aparece na mensagem de log quando a consulta à API falha.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

## Done criteria

- [ ] Log de `:138` mascara o CNPJ, mesmo padrão do telefone
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0
- [ ] `plans/README.md` atualizado

## STOP conditions

- O número de linha não bater com o código ao vivo.

## Maintenance notes

- Nenhuma.
