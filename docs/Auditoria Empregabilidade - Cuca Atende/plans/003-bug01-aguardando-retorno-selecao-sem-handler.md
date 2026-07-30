# Plan 003: `aguardando_retorno_selecao` ganha o mesmo tratamento de mensagem manual que as etapas irmãs já têm

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

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — adiciona um branch novo isolado, espelhando um padrão já existente e testado (`aguardando_retorno_vaga`). Não toca nenhum comportamento existente.
- **Depends on**: none
- **Category**: bug (regressão de UX — perde contexto da empresa)
- **Planned at**: commit `7b0b326`, 2026-07-29

## Why this matters

Quando a empresa escolhe "2️⃣ Marcar seleção" no menu `escolhendo_tipo_vaga`, a etapa vira `aguardando_retorno_selecao` enquanto aguarda o preenchimento de um formulário no portal. As 2 etapas irmãs (`aguardando_retorno_vaga`, `aguardando_retorno_edicao`) já têm um branch explícito que trata mensagem manual do usuário enquanto ele espera ("Ainda aguardando o preenchimento..."). `aguardando_retorno_selecao` **não tem** — nenhum `if etapa == "aguardando_retorno_selecao"` existe dentro de `_processar_empresa`, então qualquer mensagem cai no fallback genérico do final da função, que **reseta a conversa inteira** pra `solicitar_cnpj`. Uma empresa que manda "oi" ou "ainda aí?" nesse meio-tempo perde `empresa_id` e todo o contexto — só recupera digitando o CNPJ de novo do zero.

O loop de notificação assíncrono (`empregabilidade_notify_loop`, que roda a cada 20s e avisa quando o *portal* confirma o preenchimento) **já cobre** esta etapa corretamente (confirmado nesta auditoria: `"aguardando_retorno_selecao"` está na tupla de etapas monitoradas, `:2617-2618`) — o gap é só do lado síncrono (mensagem manual do usuário), não do assíncrono.

## Current state

`worker/empregabilidade_engine.py:1058-1099` (`aguardando_retorno_vaga` — o padrão a espelhar):
```python
    # --- ETAPA: aguardando_retorno_vaga (após link enviado) ---
    if etapa == "aguardando_retorno_vaga":
        # Verificar se o portal já notificou que a vaga foi criada
        fluxo_atual = _get_fluxo(conversa_id)
        vaga_criada_id = fluxo_atual.get("vaga_criada_id")
        vaga_numero = fluxo_atual.get("vaga_numero")
        vaga_titulo = fluxo_atual.get("vaga_titulo", "")
        empresa_id = fluxo_atual.get("empresa_id")
        empresa_nome_exibicao = fluxo_atual.get("empresa_nome_exibicao") or fluxo_atual.get("empresa_nome", "")

        if vaga_criada_id:
            numero_ref = f"#{vaga_numero}" if vaga_numero else f"...{vaga_criada_id[-6:].upper()}"
            await e(
                f"✅ *Vaga cadastrada com sucesso!*\n\n"
                f"📋 *Título:* {vaga_titulo}\n"
                f"🔢 *Número da vaga:* {numero_ref}\n\n"
                "Guarde esse número para acompanhar as candidaturas aqui no WhatsApp.\n\n"
                "O que deseja fazer agora?\n\n"
                "1️⃣ Divulgar outra vaga\n"
                "2️⃣ Acompanhar candidatos desta vaga\n"
                "3️⃣ Encerrar\n\n"
                "Responda com *1*, *2* ou *3*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "menu_pos_vaga",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo_atual.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome_exibicao,
                "cnpj": fluxo_atual.get("cnpj"),
                "ultima_vaga_id": vaga_criada_id,
            })
        else:
            # Formulário ainda não preenchido — reenviar link como lembrete
            empresa_id = fluxo.get("empresa_id")
            unidade_param = f"&unidade_cuca={quote(unidade_cuca)}" if unidade_cuca else ""
            link_vaga = f"{PORTAL_URL}/empregabilidade/vagas/nova?empresa_id={empresa_id}{unidade_param}"
            await e(
                "Ainda aguardando o preenchimento do formulário de vaga. 🕐\n\n"
                f"Caso precise do link novamente:\n🔗 {link_vaga}\n\n"
                "Se precisar de ajuda, entre em contato com a equipe da unidade. 🤝"
            )
        return

    # --- ETAPA: menu_pos_vaga (redireciona para menu_empresa_acoes) ---
    if etapa == "menu_pos_vaga":
```
Note que este bloco checa `vaga_criada_id` em `fluxo_atual` (relido do banco, fresco) — significa que este mesmo bloco **também** é o caminho que mostra a confirmação final quando a mensagem manual do usuário chega **depois** do portal já ter confirmado (não só o lembrete de "ainda aguardando"). O bloco novo para `aguardando_retorno_selecao` deve seguir a mesma lógica de 2 ramos, adaptada aos campos que a seleção grava (confirme quais campos o portal grava de volta pra uma seleção confirmada — ver o helper/webhook que popula isso, provavelmente análogo a `vaga_criada_id`/`vaga_numero`/`vaga_titulo` mas para seleção; **não assuma os nomes exatos, procure no código antes de escrever o Step 1**).

`worker/empregabilidade_engine.py:1113-1115` (o fallback genérico que hoje captura `aguardando_retorno_selecao` por engano):
```python
    # Fallback — iniciar fluxo empresa
    _set_fluxo(conversa_id, {"etapa": "solicitar_cnpj"})
    await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Worker test suite | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass, including new tests |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: um novo bloco `if etapa == "aguardando_retorno_selecao":` dentro de `_processar_empresa` (`worker/empregabilidade_engine.py`), inserido antes do fallback genérico (`:1113-1115`); testes novos.

**Out of scope**:
- `aguardando_retorno_vaga`/`aguardando_retorno_edicao` — não tocar, são só a referência a copiar.
- `empregabilidade_notify_loop` — já cobre esta etapa corretamente, não precisa de mudança.
- Qualquer outro achado desta auditoria.

## Git workflow

- Branch: `fix/bug01-aguardando-retorno-selecao-sem-handler`
- Commit único.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Descobrir quais campos o portal grava de volta pra uma seleção confirmada

Antes de escrever o bloco, procure no código (grep por `"selecao"` em contextos de `_set_fluxo`/`fluxo_atual.get(` e no schema/migrations relacionadas a seleção) quais campos equivalem a `vaga_criada_id`/`vaga_numero`/`vaga_titulo` para o fluxo de seleção — provavelmente algo como `selecao_criada_id`/`selecao_numero` ou nomes semelhantes. **Não invente nomes de campo** — se não encontrar nada que já grave esse retorno, isso é um problema mais profundo (o webhook do portal pra seleção pode nunca ter sido implementado do lado do worker) — nesse caso, STOP e reporte em vez de inventar um contrato de dados que não existe.

### Step 2: Adicionar o bloco, espelhando `aguardando_retorno_vaga`

```python
    # --- ETAPA: aguardando_retorno_selecao (após link enviado, BUG-01) ---
    if etapa == "aguardando_retorno_selecao":
        fluxo_atual = _get_fluxo(conversa_id)
        # (adaptar nomes de campo conforme descoberto no Step 1)
        selecao_criada_id = fluxo_atual.get("selecao_criada_id")
        empresa_id = fluxo_atual.get("empresa_id")

        if selecao_criada_id:
            await e(
                "✅ *Processo seletivo registrado com sucesso!*\n\n"
                # (adaptar o texto de confirmação — não copiar cegamente o texto de vaga,
                # que fala de "número da vaga"; seleção é um conceito diferente)
            )
            _set_fluxo(conversa_id, {
                "etapa": "menu_pos_vaga",  # ou etapa equivalente — confirmar se seleção usa o mesmo menu pós-ação
                "empresa_id": empresa_id,
                "empresa_nome": fluxo_atual.get("empresa_nome", ""),
                "empresa_nome_exibicao": fluxo_atual.get("empresa_nome_exibicao") or fluxo_atual.get("empresa_nome", ""),
                "cnpj": fluxo_atual.get("cnpj"),
            })
        else:
            unidade_param = f"&unidade_cuca={quote(unidade_cuca)}" if unidade_cuca else ""
            link_selecao = f"{PORTAL_URL}/empregabilidade/selecao/nova?empresa_id={empresa_id}{unidade_param}"
            await e(
                "Ainda aguardando o preenchimento do formulário de seleção. 🕐\n\n"
                f"Caso precise do link novamente:\n🔗 {link_selecao}\n\n"
                "Se precisar de ajuda, entre em contato com a equipe da unidade. 🤝"
            )
        return
```
Insira este bloco **antes** de `# Fallback — iniciar fluxo empresa` (`:1113`), no mesmo nível dos outros blocos `if etapa == ...` desta função.

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Modelar em testes existentes de `aguardando_retorno_vaga`, se houver (busque por `aguardando_retorno_vaga` em `worker/tests/test_empregabilidade_engine.py`); se não houver nenhum, modelar na estrutura de `_fluxo_mock` já usada em `TestEscapeHatchAguardandoCnpj`.

1. `test_aguardando_retorno_selecao_com_mensagem_manual_nao_reseta_empresa` — fluxo com `etapa: "aguardando_retorno_selecao"`, mensagem manual tipo "oi"; assert que **não** cai no fallback (`_set_fluxo` não é chamado com `{"etapa": "solicitar_cnpj"}`), e que uma mensagem de "ainda aguardando" é enviada.
2. `test_aguardando_retorno_selecao_com_selecao_ja_confirmada_avanca_para_menu` — mesmo estado, mas com o campo de "seleção criada" já preenchido (descoberto no Step 1); assert que avança pra `menu_pos_vaga` (ou etapa equivalente) com `empresa_id` preservado.
3. `test_aguardando_retorno_vaga_continua_funcionando_igual` — regressão: confirme que o comportamento de `aguardando_retorno_vaga` não mudou (mesmo teste que já deveria existir, ou um novo se não existir).

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, incluindo os novos.

## Done criteria

- [ ] `grep -n 'etapa == "aguardando_retorno_selecao"' worker/empregabilidade_engine.py` mostra o novo bloco
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0, incluindo os novos testes
- [ ] `empresa_id`/contexto preservado ao mandar mensagem manual nesta etapa (teste #1)
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] `plans/README.md` desta pasta atualizado

## STOP conditions

- Não existir, em lugar nenhum do código, um campo equivalente a "seleção confirmada pelo portal" — isso significaria que o webhook de retomo do portal pra seleção nunca foi implementado do lado do worker, um problema maior que este plano não resolve sozinho. Pare e reporte.
- O texto/menu pós-seleção precisar ser diferente do pós-vaga de um jeito que você não tem certeza — pergunte/registre a dúvida em vez de inventar copy.

## Maintenance notes

- Se no futuro existir uma 4ª etapa do tipo "aguardando retorno do portal" (ex.: um novo tipo de formulário), ela vai precisar do mesmo padrão — nesse ponto pode valer a pena extrair um helper comum em vez de copiar o bloco pela 4ª vez. Não fazer essa extração agora (escopo mínimo).
