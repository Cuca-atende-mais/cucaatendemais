# Plan 019: Parâmetro `token` de `_enviar()` nunca é usado — sempre lê de env direto (achado cosmético)

> **Executor instructions**: Plano cosmético, sem risco funcional. Se o tempo
> for curto, este é o primeiro a ficar de fora sem perda real — mas incluído
> aqui pra pasta ficar completa.

## Status

- **Priority**: P5 (cosmético, mencionado na auditoria sem esforço/confiança atribuídos)
- **Effort**: S
- **Risk**: LOW — decisão entre remover o parâmetro (breaking change de assinatura, exige atualizar todos os call sites) ou só documentar por que ele existe e não é usado.
- **Depends on**: none
- **Category**: tech-debt (assinatura enganosa)
- **Confidence**: HIGH (confirmado ao vivo em 2026-07-29)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

`_enviar(instance_name, token, phone, texto, ...)` (`worker/empregabilidade_engine.py:96`) recebe um parâmetro `token` que **nunca é lido dentro da função** — ela sempre usa `os.getenv("META_SYSTEM_USER_TOKEN", "")` diretamente (`:102`). Quem chama `_enviar` (dezenas de call sites no arquivo) sempre passa algum valor de `token` como se fizesse diferença — não faz. Enganoso pra quem for mexer depois e assumir que passar um token diferente muda o comportamento do envio.

## Current state

`worker/empregabilidade_engine.py:96-103` (confirmado ao vivo):
```python
async def _enviar(instance_name: str, token: str, phone: str, texto: str, conversa_id: str = "", lead_id: str = "") -> bool:
    from meta_adapter_outbound import _meta_enviar  # noqa: PLC0415
    ok = await _meta_enviar(
        instance_name,
        phone,
        texto,
        os.getenv("META_SYSTEM_USER_TOKEN", ""),
    )
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Contagem de call sites | `grep -c "_enviar(" worker/empregabilidade_engine.py` | referência de quantos lugares seriam afetados por remover o parâmetro |
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |

## Scope

**In scope**: decisão entre (a) remover `token` da assinatura de `_enviar` e de todos os call sites, ou (b) manter o parâmetro mas documentar com comentário por que ele existe e não é usado (ex.: se for pensado pra suportar múltiplos tokens no futuro).

**Out of scope**: mudar `_meta_enviar` (`meta_adapter_outbound.py`) ou a forma como o token real é resolvido.

## Git workflow

- Branch: `chore/achado-cosmetico-token-nao-usado`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Opção A: Remover o parâmetro (mais correto, mais invasivo)

Remover `token: str` da assinatura de `_enviar` e ajustar **todos** os call sites (`grep -n "_enviar(" worker/empregabilidade_engine.py` lista todos) pra não passar mais esse argumento. Cuidado: `_enviar` é chamada com argumentos posicionais na maioria dos call sites (`_enviar(instance_name, token, phone, texto, ...)`) — remover o parâmetro do meio da assinatura muda a posição de `phone`/`texto` em todos eles, não é só apagar 1 palavra.

### Opção B: Manter e documentar (mais simples, menos invasivo)

```python
async def _enviar(instance_name: str, token: str, phone: str, texto: str, conversa_id: str = "", lead_id: str = "") -> bool:
    """... `token` é aceito por compatibilidade de assinatura com os call
    sites existentes, mas não é usado — o token real vem sempre de
    META_SYSTEM_USER_TOKEN (env), resolvido dentro desta função. Não confundir
    quem chamar aqui pensando que passar um token diferente muda o envio."""
```

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Nenhum teste novo necessário — mudança cosmética (assinatura/comentário), não de comportamento.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

## Done criteria

- [ ] Decisão tomada entre Opção A e B
- [ ] Se A: todos os call sites atualizados, suíte passa
- [ ] Se B: comentário adicionado explicando o parâmetro não usado
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0
- [ ] `plans/README.md` atualizado

## STOP conditions

- Ao tentar a Opção A, descobrir que algum call site depende de passar posicionalmente um valor que colidiria com outro parâmetro depois da remoção — pare e confira cada call site individualmente, não faça find-replace às cegas.

## Maintenance notes

- Esforço tão baixo que pode ser feito como parte de qualquer outro PR que já esteja mexendo perto de `_enviar`, em vez de um PR isolado só pra isso — julgamento de quem for executar.
