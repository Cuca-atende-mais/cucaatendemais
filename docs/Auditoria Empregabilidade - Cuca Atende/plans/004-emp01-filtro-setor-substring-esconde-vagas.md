# Plan 004: Filtro de setor por substring esconde vagas já na 1ª mensagem (EMP-01)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7b0b326..HEAD -- worker/intencao_detector.py worker/empregabilidade_engine.py worker/tests/test_intencao_detector.py`
> Se `intencao_detector.py` mudou desde que este plano foi escrito, compare
> os trechos da seção "Current state" contra o código ao vivo antes de
> prosseguir; se não bater, trate como STOP condition.
>
> **O teste já existe, não precisa ser escrito**: `worker/tests/test_intencao_detector.py::test_entregar_curriculo_nao_deveria_disparar_filtro_de_logistica` está no working tree local (não commitado — ver `docs/qa/AUDITORIA-empregabilidade-CONSOLIDADA-2026-07-29.md`), hoje **vermelho** (falha). O trabalho deste plano é só o fix — depois dele, o teste deve passar sem nenhuma alteração nele.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — troca uma checagem de substring por regex com limite de palavra, no mesmo formato de fix já usado no canal Institucional (AUD-05) pra essa mesma classe de bug. Não muda a lista de keywords nem o comportamento pra nenhuma menção real de setor.
- **Depends on**: none
- **Category**: bug (falso positivo esconde resultado)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

`worker/intencao_detector.py:280-284` (`extrair_setor_da_mensagem`) busca cada keyword de `_SETOR_KEYWORDS` como substring simples (`if keyword in t`). A keyword `"entrega"` → `"Logística"` (linha 228) bate dentro de **"entregar"**. "Quero **entregar** meu currículo" é frase natural de candidato logo na 1ª mensagem — não é menção a setor nenhum. O sistema filtra silenciosamente só vagas de Logística e, sem nenhuma, responde que não há vagas de "entrega" mesmo havendo vagas de sobra em outras áreas (`empregabilidade_engine.py:2500-2509`). Mesma classe de bug já corrigida no canal Institucional (AUD-05 — "barragem" continha "barra").

## Current state

`worker/intencao_detector.py:270-285` (confirmado ao vivo em 2026-07-29):
```python
def extrair_setor_da_mensagem(texto: str) -> tuple[str | None, str | None]:
    if not texto:
        return None, None
    t = texto.lower()
    for keyword, canonical in _SETOR_KEYWORDS:
        if keyword in t:
            if not canonical:  # guard para "banco de talentos"
                return None, None
            return keyword, canonical
    return None, None
```
`_SETOR_KEYWORDS` (lista de tuplas `(keyword, canonical)`) inclui, entre outras, `("entrega", "Logística")` na linha 228 — mas o problema é genérico: **qualquer** keyword da lista que seja substring de uma palavra maior tem o mesmo risco (ex.: se algum dia entrar `"casa"` como keyword e o texto tiver "aconteceu"... não é o caso hoje, mas o fix deve ser genérico, não um patch só pra "entrega").

Usado em `empregabilidade_engine.py:2500`:
```python
setor_kw, setor_canonical = extrair_setor_fn(texto) if extrair_setor_fn else (None, None)
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Teste específico deste achado | `cd worker && python -m pytest tests/test_intencao_detector.py::test_entregar_curriculo_nao_deveria_disparar_filtro_de_logistica -v` | passa (hoje falha) |
| Suíte completa do arquivo | `cd worker && python -m pytest tests/test_intencao_detector.py -v` | all pass, nenhuma regressão nas outras keywords |
| Sanity import | `cd worker && python -c "import intencao_detector"` | exits 0 |

## Scope

**In scope**: `worker/intencao_detector.py::extrair_setor_da_mensagem`.

**Out of scope**: qualquer outra função de `intencao_detector.py`; a lista `_SETOR_KEYWORDS` em si (não precisa editar as keywords, só como elas são comparadas contra o texto); EMP-02/03/04 (planos separados).

## Git workflow

- Branch: `fix/emp01-filtro-setor-word-boundary`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Trocar substring por regex com limite de palavra

Substituir o `if keyword in t` por uma checagem de palavra inteira, usando `\b` (funciona para keywords de 1 palavra; para keywords com espaço, tipo `"banco de talentos"` — que já tem guard próprio via `canonical` vazio — `\b` nas bordas do trecho inteiro continua correto):

```python
import re  # já importado no topo do arquivo? confirme antes de duplicar

def extrair_setor_da_mensagem(texto: str) -> tuple[str | None, str | None]:
    if not texto:
        return None, None
    t = texto.lower()
    for keyword, canonical in _SETOR_KEYWORDS:
        if re.search(r"\b" + re.escape(keyword) + r"\b", t):
            if not canonical:  # guard para "banco de talentos"
                return None, None
            return keyword, canonical
    return None, None
```
`re.escape(keyword)` é necessário porque nada garante que toda keyword futura seja livre de caracteres especiais de regex — não assumir.

**Verify**: `cd worker && python -c "import intencao_detector"` → exits 0.

## Test plan

Não escrever teste novo — `test_entregar_curriculo_nao_deveria_disparar_filtro_de_logistica` já existe e cobre exatamente este caso. Rodar a suíte completa de `test_intencao_detector.py` (não só o teste novo) pra confirmar que nenhuma keyword legítima parou de casar (ex.: `"vendas"`, `"motorista"` sozinhas em frase curta continuam funcionando).

**Verify**: `cd worker && python -m pytest tests/test_intencao_detector.py -v` → all pass.

## Done criteria

- [ ] `extrair_setor_da_mensagem` usa `re.search` com `\b`, não `in` puro
- [ ] `test_entregar_curriculo_nao_deveria_disparar_filtro_de_logistica` passa
- [ ] `cd worker && python -m pytest tests/test_intencao_detector.py -v` exits 0, sem regressão em nenhum teste existente
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] `plans/README.md` atualizado

## STOP conditions

- Alguma keyword existente em `_SETOR_KEYWORDS` tiver espaço ou pontuação que `\b` não lide bem (confirme rodando a suíte completa, não só o teste novo, antes de considerar terminado).
- Os números de linha citados aqui não baterem com o código ao vivo.

## Maintenance notes

- Esse mesmo padrão de bug (substring sem limite de palavra) se repete em EMP-02 (`_quer_encerrar`) — mas ali o fix é diferente (frase inteira precisa bater, não só limite de palavra), porque o problema lá é frase-dentro-de-frase-maior, não palavra-dentro-de-palavra. Não tentar unificar os dois fixes num só; são classes de bug relacionadas mas distintas.
