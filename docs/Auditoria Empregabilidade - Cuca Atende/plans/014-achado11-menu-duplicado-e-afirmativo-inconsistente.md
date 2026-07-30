# Plan 014: Menu de 4 opções duplicado 10x (1 cópia já divergiu) + 7 tuplas de afirmativo inconsistentes (achado #11)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `grep -n "Cadastrar nova vaga" worker/empregabilidade_engine.py`
> deve retornar 10 linhas em 2026-07-29 (`:387,404,456,541,643,687,929,2659,2693,2725`)
> — se o número mudou, reconte antes de prosseguir.
>
> **Este plano é revisão etapa-a-etapa, não find-replace cego** — a auditoria
> é explícita sobre isso: consolidar essas duplicatas exige ler cada
> ocorrência no contexto da etapa onde ela vive, porque pelo menos 1 já
> divergiu silenciosamente (a de `:646`) e nada garante que as outras 9 sejam
> 100% intercambiáveis sem essa leitura.

## Status

- **Priority**: P3
- **Effort**: S/M
- **Risk**: MED — tocar em 10 pontos + 7 tuplas espalhados pelo arquivo, mesmo que mecanicamente simples, tem superfície grande pra erro de copy-paste ao consolidar. Mitigado por fazer 1 constante por vez, com a suíte completa rodando entre cada mudança.
- **Depends on**: none
- **Category**: tech-debt (duplicação já divergiu — bug latente)
- **Confidence**: HIGH (as 10 ocorrências do menu e a divergência em `:646` confirmadas ao vivo; as 7 tuplas de afirmativo também confirmadas ao vivo, todas realmente diferentes entre si)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

O bloco de menu de 4 opções (`1️⃣ Cadastrar nova vaga / 2️⃣ Consultar status de uma vaga / 3️⃣ Editar uma vaga / 4️⃣ Cancelar uma vaga`) está copiado como string literal em **10 lugares** do arquivo. Confirmei ao vivo: **1 cópia já divergiu** — `:646` diz `"4️⃣ Encerrar"` em vez de `"4️⃣ Cancelar uma vaga"` (as outras 9 dizem "Cancelar uma vaga"). Isso é exatamente o tipo de inconsistência que duplicação de string sem fonte única produz — e mais uma pode aparecer a qualquer edição futura sem ninguém perceber, porque não há teste comparando as 10 cópias entre si.

Separadamente, existem **7 tuplas diferentes** de "resposta afirmativa" espalhadas pelo arquivo (`:616,826,872,913,2291,2340,2351`), todas com conjuntos de palavras distintos — confirmei ao vivo que nenhuma das 7 é igual a outra. Não é necessariamente um bug (cada etapa pode ter motivo legítimo pra aceitar palavras diferentes), mas é tech-debt real: se alguém decidir adicionar uma palavra nova de confirmação (ex.: "positivo"), hoje precisa lembrar de tocar em 7 lugares manualmente, e nada avisa se esquecer um.

## Current state

Menu de 4 opções, confirmado ao vivo em 2026-07-29 (10 ocorrências):
```
:387, :404, :456, :541, :643, :687, :929, :2659, :2693, :2725
```
Todas dizem `"4️⃣ Cancelar uma vaga\n\n"` **exceto** `:646`, que diz `"4️⃣ Encerrar\n\n"`.

7 tuplas de afirmativo, confirmadas ao vivo:
```python
:616:  ("sim", "s", "confirmo", "confirmar", "ok", "yes")
:826:  ("sim", "s", "confirmar", "confirmo", "correto", "ok", "certo", "isso")
:872:  ("sim", "s", "confirmar", "confirmo", "ok")
:913:  ("sim", "s", "quero", "vou", "yes", "ok", "1")
:2291: ("sim", "s", "isso", "confirmo", "correto", "certo", "ok", "exato")
:2340: ("sim", "s", "não", "nao", "n", "✅", "❌")  # mista — trata sim E não
:2351: string check separado, não tupla
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |
| Contagem de progresso | `grep -c "Cadastrar nova vaga" worker/empregabilidade_engine.py` | cai conforme cada ocorrência vira referência à constante |

## Scope

**In scope**: consolidar o bloco de menu de 4 opções numa constante de módulo; decidir (com quem revisar) se `:646` deveria dizer "Cancelar uma vaga" (alinhar com as outras 9) ou se "Encerrar" era intencional ali (não presumir sozinho); documentar as 7 tuplas de afirmativo com comentário explicando por que cada uma é diferente (ou consolidar as que forem genuinamente idênticas em intenção).

**Out of scope**: mudar o texto/opções do menu em si (além de resolver a divergência pontual); qualquer refactor maior de estrutura do arquivo.

## Git workflow

- Branch: `refactor/achado11-consolidar-menu-e-afirmativo`
- Commits separados: 1 pra constante do menu, 1 pra revisão das tuplas de afirmativo.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Constante de módulo pro menu de 4 opções

```python
_MENU_ACOES_EMPRESA = (
    "1️⃣ Cadastrar nova vaga\n"
    "2️⃣ Consultar status de uma vaga\n"
    "3️⃣ Editar uma vaga\n"
    "4️⃣ Cancelar uma vaga\n\n"
    "Responda com *1*, *2*, *3* ou *4*."
)
```
Ler cada uma das 10 ocorrências **no contexto da etapa** antes de substituir por `_MENU_ACOES_EMPRESA` — confirmar que a linha de "Responda com..." logo depois de cada bloco também é idêntica nas 9 que não divergem (não assumido nesta consolidação, confirme ao editar).

**Decisão do sócio (2026-07-29), não é mais pergunta em aberto:** `:646` vira `"4️⃣ Cancelar uma vaga"`, alinhado com as outras 9 — "Encerrar" não era intencional. Consolidar as 10 ocorrências (incluindo a antiga `:646`) direto em `_MENU_ACOES_EMPRESA`, sem STOP condition nem pergunta adicional para essa divergência específica.

**Verify** (a cada substituição): `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

### Step 2: Revisão das 7 tuplas de afirmativo

Não consolidar cegamente numa tupla única — ler o contexto de cada uma primeiro. Se, depois de ler, 2+ forem genuinamente a mesma intenção (ex.: `:826` e `:872` parecem próximas — `:826` tem 2 palavras a mais), considerar uma constante `_AFIRMATIVO_BASE` reaproveitada + extensões pontuais por etapa quando houver motivo real. Documentar com comentário por que cada etapa que ficar com uma lista própria precisa dela (ex.: `:913` inclui `"quero"`/`"vou"`/`"1"` — provavelmente contexto onde essas palavras fazem sentido como confirmação e nas outras etapas não fariam).

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

## Test plan

Adicionar 1 teste de regressão confirmando que a etapa antes divergente em `:646` agora envia `"Cancelar uma vaga"` (decisão do sócio, ver Step 1) — fixa a decisão tomada, não deixa implícito.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

## Done criteria

- [ ] `_MENU_ACOES_EMPRESA` criada e usada nas 10 ocorrências (ou 9 + a divergente resolvida deliberadamente)
- [ ] Divergência de `:646` resolvida — texto alinhado com "Cancelar uma vaga" (decisão do sócio, 2026-07-29)
- [ ] 7 tuplas de afirmativo revisadas, com comentário explicando diferenças remanescentes ou consolidação onde fizer sentido
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0
- [ ] `plans/README.md` atualizado

## STOP conditions

- Alguma das 10 ocorrências do menu tiver texto de contexto diferente ao redor que dependa da mensagem exata do menu de um jeito não óbvio (ex.: teste existente fazendo assert de substring específica) — não quebrar esses testes silenciosamente.

## Maintenance notes

- Este é exatamente o tipo de achado que uma constante de módulo previne no futuro — depois de consolidado, uma mudança no texto do menu passa a precisar de 1 edição, não 10.
