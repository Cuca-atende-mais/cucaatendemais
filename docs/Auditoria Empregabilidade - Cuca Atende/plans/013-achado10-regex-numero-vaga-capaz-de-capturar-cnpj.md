# Plan 013: Regex de número de vaga pode capturar dígito de CNPJ/data (achado #10)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `grep -n 'r"\\b(\\d{1,4})\\b"' worker/empregabilidade_engine.py`
> deve retornar exatamente 3 linhas (487, 570, 1192) em 2026-07-29 — se o
> número ou as linhas mudaram, reavalie o escopo antes de prosseguir.
>
> **Nota de confiança**: a citação original da auditoria de 17/07 listava 6
> linhas (`:487`, `:570`, `:1192`, `:1775`, `:1812`, `:1888`) — só as 3
> primeiras usam o padrão exato `\b(\d{1,4})\b` citado como problemático;
> as outras 3, conferidas nesta consolidação, usam variantes mais restritas
> (`\b(\d{1,2})\b`, `\b([1-5])\b`) pra escolhas de menu curtas (categoria,
> unidade) — risco bem menor de capturar dígito de CNPJ por acidente, mas
> ainda vale considerar no Step 2 se quiser ser exaustivo.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW — regex mais específica, restringe o que já casa hoje; não deveria quebrar nenhum caso legítimo (número de vaga sozinho ou cercado de espaço continua batendo).
- **Depends on**: none
- **Category**: bug (falso positivo raro, mas real)
- **Confidence**: MED (herdado da auditoria de 17/07, 3 dos 6 pontos citados re-confirmados nesta consolidação; os outros 3 usam um padrão relacionado mas diferente)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

`\b(\d{1,4})\b` (`re.search`) usa `\b`, que marca fronteira entre caractere de palavra (`\w`) e não-palavra — mas **pontuação não conta como fronteira de palavra nem impede o match**, ela simplesmente já É uma não-palavra. Isso significa que `\b` não impede capturar um grupo de 1-4 dígitos que esteja cercado por pontuação em vez de espaço. Exemplo citado na auditoria: "CNPJ 12.345.678/0001-95, editar vaga 3" — o regex `\b(\d{1,4})\b` encontra o **primeiro** match da string, que seria "12" (do CNPJ), não "3" (o número da vaga que o usuário quis dizer), porque `re.search` para no primeiro match e "12" cercado por espaço/ponto já satisfaz `\b(\d{1,4})\b`.

## Current state

`worker/empregabilidade_engine.py` (confirmado ao vivo em 2026-07-29):
```python
:487:   match_num = re.search(r"\b(\d{1,4})\b", texto)
:570:   match_num = re.search(r"\b(\d{1,4})\b", texto)
:1192:  match_vaga = re.search(r"\b(\d{1,4})\b", texto)
```
Ler o contexto de cada um (etapas diferentes: consulta de vaga por número, edição, cancelamento) antes de editar — confirme que a mudança de regex não altera nenhum outro comportamento da etapa.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: as 3 ocorrências confirmadas de `r"\b(\d{1,4})\b"` (`:487`, `:570`, `:1192`).

**Out of scope**: as variantes `\b(\d{1,2})\b`/`\b([1-5])\b` usadas em menus de categoria/unidade (risco bem menor — números de 1-2 dígitos cercados por pontuação de CNPJ são menos prováveis de colidir, e a etapa ali já é mais restrita por natureza); qualquer outra regex do arquivo não citada aqui.

## Git workflow

- Branch: `fix/achado10-regex-numero-vaga-cnpj`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Regex com fronteira real (espaço/início/fim de string), não só `\b`

Trocar `\b(\d{1,4})\b` por uma variante que exige que o número esteja isolado por espaço ou borda da string, não por qualquer não-palavra (incluindo pontuação):
```python
re.search(r"(?:^|\s)(\d{1,4})(?:\s|$)", texto)
```
Isso ainda captura "3", "vaga 3", "editar vaga 3" — mas não captura "12" de "12.345.678/0001-95" (que está cercado por pontos, não espaço/borda).

Aplicar a mesma troca nos 3 pontos (`:487`, `:570`, `:1192`). Confirmar em cada um se o código usa `match.group(1)` (deveria continuar funcionando igual, já que o grupo capturado continua sendo só os dígitos).

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Adicionar 1 teste por ponto (ou 1 teste parametrizado cobrindo os 3, se preferir) confirmando: (a) "editar vaga 3" ainda encontra a vaga 3 normalmente (regressão do caso comum); (b) uma mensagem citando um CNPJ formatado junto com o número da vaga (ex.: "meu CNPJ é 12.345.678/0001-95, quero editar a vaga 3") encontra a vaga **3**, não a vaga **12**.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, incluindo os novos.

## Done criteria

- [ ] Os 3 pontos usam a regex com fronteira real (espaço/borda), não `\b` puro
- [ ] Teste novo prova que CNPJ na mesma mensagem não sequestra o match
- [ ] Teste novo prova que o caso comum (só o número da vaga) continua funcionando
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0
- [ ] `plans/README.md` atualizado

## STOP conditions

- Alguma etapa depender de `\b(\d{1,4})\b` casar números colados a outros caracteres além de pontuação de CNPJ (ex.: algum emoji ou marcador que hoje funciona por acidente) — leia o teste que quebrar antes de decidir se é regressão real.
- Os números de linha não baterem com o código ao vivo.

## Maintenance notes

- Se quiser fechar também os 3 pontos de risco menor (`\b(\d{1,2})\b`/`\b([1-5])\b`), é a mesma técnica — não fazer neste plano sem decidir isso separadamente, já que o esforço/risco de regressão em menus de categoria/unidade não foi avaliado aqui.
