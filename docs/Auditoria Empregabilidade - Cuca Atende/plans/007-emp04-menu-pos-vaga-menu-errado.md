# Plan 007: `menu_pos_vaga` reinterpreta a resposta contra o menu errado (EMP-04)

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
> **O teste já existe, não precisa ser escrito**: `worker/tests/test_empregabilidade_engine.py::TestMenuPosVagaReinterpretaResposta::test_resposta_3_para_encerrar_e_reinterpretada_como_editar_vaga` está no working tree local (não commitado — ver `docs/qa/AUDITORIA-empregabilidade-CONSOLIDADA-2026-07-29.md`), hoje **vermelho**. O trabalho deste plano é só o fix.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — dá a `menu_pos_vaga` seu próprio dispatch em vez de delegar cegamente; as opções "1" e "2" continuam chamando exatamente o mesmo código que já chamam hoje (via `menu_empresa_acoes`), só a opção "3" muda de comportamento (deixa de cair em "editar vaga" e passa a encerrar de verdade).
- **Depends on**: none
- **Category**: bug (UX — ação errada por reaproveitar dispatch de outro menu)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

Depois de criar uma vaga, a etapa vira `menu_pos_vaga` e o menu apresentado é (`:1076-1079`):
```
1️⃣ Divulgar outra vaga
2️⃣ Acompanhar candidatos desta vaga
3️⃣ Encerrar
```
Mas o dispatch dessa etapa (`:1101-1106`) não interpreta a resposta contra essas opções — só troca a etapa pra `menu_empresa_acoes` e reprocessa o **mesmo texto digitado**, cujo menu real é:
```
1️⃣ Cadastrar nova vaga
2️⃣ Consultar status de uma vaga
3️⃣ Editar uma vaga
4️⃣ Cancelar uma vaga
```
As opções "1" e "2" coincidem em intenção entre os 2 menus (por acaso, não por desenho) — mas **"3" não**: uma empresa que responde "3" pensando em "Encerrar" acaba, sem perceber, no fluxo de **edição de vaga**. É o único dos 3 números que diverge de fato.

## Current state

`worker/empregabilidade_engine.py:1101-1106` (confirmado ao vivo em 2026-07-29):
```python
    # --- ETAPA: menu_pos_vaga (redireciona para menu_empresa_acoes) ---
    if etapa == "menu_pos_vaga":
        fluxo["etapa"] = "menu_empresa_acoes"
        _set_fluxo(conversa_id, fluxo)
        await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return
```
Fluxo grava, ao entrar em `menu_pos_vaga` (`:1081-1088`): `empresa_id`, `empresa_nome`, `empresa_nome_exibicao`, `cnpj`, `ultima_vaga_id` — **não** grava `vaga_numero`/`vaga_titulo` (lidos de `fluxo_atual` em `:1063-1064` mas não persistidos de volta).

Handler de `menu_empresa_acoes` (referência, `:414-462`) — opção "1" (`:419-433`, coleta e-mail do responsável pra nova vaga), opção "2" (`:434-436`, chama `_processar_consulta_empresa("todas", ...)` — lista **todas** as vagas, não só a recém-criada), opção "3" (`:437-439`, vai pra `selecionando_vaga_edicao` — **este é o que rouba a intenção de "Encerrar"**).

`_encerrar_fluxo(conversa_id, instance_name, token, phone, perfil)` (`:200-207` em diante) é a função correta pra "3 = Encerrar".

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Teste específico deste achado | `cd worker && python -m pytest "tests/test_empregabilidade_engine.py::TestMenuPosVagaReinterpretaResposta::test_resposta_3_para_encerrar_e_reinterpretada_como_editar_vaga" -v` | passa (hoje falha) |
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: `worker/empregabilidade_engine.py`, o branch `if etapa == "menu_pos_vaga"` (`:1101-1106`).

**Out of scope**: o handler de `menu_empresa_acoes` em si (`:414-462`, não muda — vai continuar sendo usado por outros fluxos exatamente como hoje); tornar a opção "2" (Acompanhar candidatos) escopada só à vaga recém-criada em vez de "todas" — seria uma melhoria real (o menu promete "desta vaga", hoje mostraria todas), mas é incremento de escopo além do bug reportado; deixar registrado como possível follow-up, não fazer nesta rodada a menos que seja trivial confirmar (ver Maintenance notes).

## Git workflow

- Branch: `fix/emp04-menu-pos-vaga-dispatch-proprio`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Dispatch próprio para `menu_pos_vaga`

```python
    # --- ETAPA: menu_pos_vaga ---
    if etapa == "menu_pos_vaga":
        t = texto.strip().lower()
        if t in ("1", "nova vaga", "divulgar", "outra vaga"):
            # Mesma ação de menu_empresa_acoes opção 1 — reaproveita o handler
            # existente trocando a etapa antes de delegar (intenção idêntica
            # nos 2 menus, não é o bug reportado).
            fluxo["etapa"] = "menu_empresa_acoes"
            _set_fluxo(conversa_id, fluxo)
            await _processar_empresa("1", phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        elif t in ("2", "acompanhar", "candidatos", "consultar"):
            # Mesma ressalva de escopo: hoje lista todas as vagas, não só a
            # recém-criada — ver Maintenance notes.
            fluxo["etapa"] = "menu_empresa_acoes"
            _set_fluxo(conversa_id, fluxo)
            await _processar_empresa("2", phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        elif t in ("3", "encerrar", "não", "nao"):
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "empresa")
        else:
            await e(
                "Não entendi. Escolha uma das opções:\n\n"
                "1️⃣ Divulgar outra vaga\n"
                "2️⃣ Acompanhar candidatos desta vaga\n"
                "3️⃣ Encerrar\n\n"
                "Responda com *1*, *2* ou *3*."
            )
        return
```
Note que o texto passado adiante pra `_processar_empresa` nos ramos "1"/"2" é o **literal `"1"`/`"2"`** (não o `texto` original do usuário) — isso é proposital: garante que `menu_empresa_acoes` sempre recebe uma opção válida e reconhecida, independente de como o usuário escreveu (ex.: "quero divulgar outra" cai em "1" aqui e chega em `menu_empresa_acoes` já normalizado).

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Não escrever teste novo — `TestMenuPosVagaReinterpretaResposta::test_resposta_3_para_encerrar_e_reinterpretada_como_editar_vaga` já existe e cobre este caso (assert que `estado.get("etapa") != "selecionando_vaga_edicao"` depois de responder "3"). Rodar a suíte completa. Adicionalmente, testar manualmente (ou escrever teste extra, opcional) as respostas "1" e "2" pra confirmar que continuam levando às mesmas ações de antes (regressão silenciosa seria fácil de não notar aqui).

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

## Done criteria

- [ ] `menu_pos_vaga` tem dispatch próprio, não delega texto cru pra `menu_empresa_acoes`
- [ ] `TestMenuPosVagaReinterpretaResposta::test_resposta_3_para_encerrar_e_reinterpretada_como_editar_vaga` passa
- [ ] Respostas "1" e "2" continuam produzindo o mesmo resultado de antes (confirmado manualmente ou por teste)
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0, sem regressão
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] `plans/README.md` atualizado

## STOP conditions

- Os números de linha citados aqui não baterem com o código ao vivo — em especial o texto exato do menu (`:1076-1079`), que se ele mudou pode ter opções diferentes das assumidas aqui.
- Alguma etapa diferente de `menu_pos_vaga` também delegar cegamente pra `menu_empresa_acoes` do mesmo jeito (`grep -n "menu_empresa_acoes\"" worker/empregabilidade_engine.py` antes de considerar terminado) — se existir, é o mesmo bug em outro lugar, reporte antes de decidir se está no escopo deste plano.

## Maintenance notes

- A opção "2" (Acompanhar candidatos desta vaga) hoje lista **todas** as vagas da empresa, não só a recém-criada — o texto do menu promete "desta vaga" mas a ação não é escopada assim. Não é o bug corrigido por este plano (o bug era "3" cair no menu errado), mas é uma divergência real entre texto e comportamento — candidato a um achado/plano futuro separado, se vocês quiserem consertar. `fluxo["ultima_vaga_id"]` já está disponível pra isso quando alguém decidir fazer.
