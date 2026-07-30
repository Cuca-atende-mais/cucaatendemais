# Plan 005: `_quer_encerrar` por substring encerra conversa que só continha um agradecimento de passagem (EMP-02 / achado #8)

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
> **O teste já existe, não precisa ser escrito**: `worker/tests/test_empregabilidade_engine.py::TestQuerEncerrarSubstringSemLimiteDePalavra::test_obrigado_no_meio_de_pergunta_nao_deveria_encerrar_candidato` está no working tree local (não commitado — ver `docs/qa/AUDITORIA-empregabilidade-CONSOLIDADA-2026-07-29.md`), hoje **vermelho**. O trabalho deste plano é só o fix.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED — `_quer_encerrar` é chamada em 3 fluxos (candidato, empresa, público); o fix é na função raiz, então afeta os 3 de uma vez. Mitigado por rodar a suíte completa (não só o teste novo) antes de considerar terminado — qualquer legítima frase de despedida precisa continuar encerrando.
- **Depends on**: none
- **Category**: bug (falso positivo encerra conversa sem aviso)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

`_quer_encerrar` (`worker/empregabilidade_engine.py:191-193`) casa qualquer uma das frases de `_PALAVRAS_ENCERRAR` (`:24-28`, ex.: `"obrigado"`, `"tchau"`, `"ok pode fechar"`) como **substring solta**, em qualquer lugar da mensagem — não exige que seja a mensagem inteira. "Muito **obrigado**! mas ainda tenho uma dúvida sobre X" contém "obrigado" e encerra a conversa na hora, mesmo a mensagem claramente pedindo pra continuar.

É chamada no topo de 3 fluxos:
- **Candidato** (`:1267`) — **sem nenhuma exceção de etapa**, e roda **antes** de `candidato_consultado` ter chance de rodar seu próprio escape semântico.
- **Empresa** (`:374`) — exceção cobre só 3 de ~14 etapas (`aguardando_cnpj`, `confirmando_cadastro`, `confirmando_cadastro_com_correcao`).
- **Público** (`:1494`) — exceção cobre só 3 etapas (`coletando_nome_candidato`, `confirmando_terceiro`, `pos_candidatura`).

O próprio código já reconhece essa classe de bug e já a corrigiu em outro lugar: `_quer_banco_talentos` (`:1416-1455`) remove os trechos que deram match e só decide com base no que sobra da frase — mas essa correção nunca foi replicada para `_quer_encerrar`.

## Current state

`worker/empregabilidade_engine.py:24-28` e `:191-193` (confirmado ao vivo em 2026-07-29):
```python
_PALAVRAS_ENCERRAR = {
    "tchau", "até mais", "até logo", "encerrar", "finalizar", "obrigado",
    "obrigada", "valeu", "pronto", "pode fechar", "ok pode fechar",
    "nada mais", "só isso", "era isso",
}

def _quer_encerrar(texto: str) -> bool:
    t = texto.strip().lower()
    return t in _PALAVRAS_ENCERRAR or any(p in t for p in _PALAVRAS_ENCERRAR)
```
Chamadas: `:374` (empresa, com exceção parcial), `:1267` (candidato, sem exceção), `:1494` (público, com exceção parcial).

**Diferença de classe de bug em relação a EMP-01**: ali o problema é palavra-dentro-de-palavra ("entrega" dentro de "entregar") — resolvido com `\b`. Aqui o problema é **frase-dentro-de-mensagem-maior** ("só isso" dentro de "só isso que eu queria confirmar, tenho mais uma pergunta") — `\b` sozinho não resolve, porque "só isso" É uma frase de bordas de palavra válidas ali, só que embutida numa mensagem que não é uma despedida. O fix certo aqui é exigir que a frase de encerramento seja a mensagem **inteira** (ou quase), não apenas qualquer trecho dela — mesma direção sugerida na auditoria.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Teste específico deste achado | `cd worker && python -m pytest "tests/test_empregabilidade_engine.py::TestQuerEncerrarSubstringSemLimiteDePalavra::test_obrigado_no_meio_de_pergunta_nao_deveria_encerrar_candidato" -v` | passa (hoje falha) |
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass, nenhuma regressão em nenhum dos 3 fluxos |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: `worker/empregabilidade_engine.py::_quer_encerrar` (função raiz, única mudança necessária — os 3 call sites não precisam ser tocados, ver "Por que não mexer nas exceções por etapa" abaixo).

**Out of scope**: as listas de exceção de etapa em `:374` e `:1494` (podem continuar existindo como camada extra de segurança, não fazem mal, e removê-las não é necessário pro fix); `_quer_banco_talentos` (já está correto, só serve de referência); EMP-01/03/04 (planos separados).

## Por que não mexer nas exceções por etapa

Corrigir na raiz (`_quer_encerrar` só aceita a mensagem inteira, não substring solta) resolve o problema nos 3 call sites de uma vez — as listas de exceção parcial em `:374`/`:1494` deixam de ser necessárias pra este bug específico (mas não fazem mal continuar lá; são defesa em profundidade pra outros casos, não deste plano).

## Git workflow

- Branch: `fix/emp02-quer-encerrar-frase-inteira`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `_quer_encerrar` passa a exigir a mensagem inteira (normalizada), não substring solta

```python
def _quer_encerrar(texto: str) -> bool:
    t = texto.strip().lower().rstrip("!.?,;: ")
    return t in _PALAVRAS_ENCERRAR
```
`rstrip` remove pontuação final comum (`"Obrigado!"`, `"Tchau."`) sem precisar de regex — mantém o comportamento pra despedidas reais, elimina o falso positivo de frase embutida numa mensagem maior.

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Não escrever teste novo — `TestQuerEncerrarSubstringSemLimiteDePalavra::test_obrigado_no_meio_de_pergunta_nao_deveria_encerrar_candidato` já existe e cobre este caso. Rodar a suíte completa (não só o teste novo) — em especial qualquer teste que hoje dependa de `_quer_encerrar` reconhecer uma despedida real com pontuação (`"Obrigado!"`, `"Tchau."`) ou dentro de uma frase mínima diferente do valor exato do set.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, sem regressão nos 3 fluxos (candidato, empresa, público).

## Done criteria

- [ ] `_quer_encerrar` compara a mensagem inteira normalizada contra `_PALAVRAS_ENCERRAR`, não substring
- [ ] `TestQuerEncerrarSubstringSemLimiteDePalavra::test_obrigado_no_meio_de_pergunta_nao_deveria_encerrar_candidato` passa
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0, sem regressão em nenhum teste existente dos 3 fluxos
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] `plans/README.md` atualizado

## STOP conditions

- Algum teste existente (não o novo) começar a falhar depois do fix — provavelmente uma despedida real que dependia do comportamento de substring (ex.: mensagem com emoji ou pontuação não coberta por `rstrip`). Não amplie o `rstrip` às cegas; leia o teste que quebrou e entenda o caso real antes de ajustar.
- Os números de linha citados aqui não baterem com o código ao vivo.

## Maintenance notes

- Se no futuro `_PALAVRAS_ENCERRAR` ganhar frases com emoji ou variações de pontuação mais exóticas, o `rstrip` fixo pode não ser suficiente — considerar nesse momento (não agora, não é o escopo deste plano) usar uma normalização mais robusta (remover toda pontuação, não só a lista fixa em `rstrip`).
