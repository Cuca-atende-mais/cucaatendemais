# Plan 008: Cobertura de teste nos 3 fluxos de maior risco + mocks passam a verificar o payload da query (TEST-01 + achado #14)

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
> **Por que TEST-01 e achado #14 estão no mesmo plano**: #14 (mocks nunca
> verificam o payload da query, só o retorno) é definido na auditoria como
> "complementa TEST-01" — a forma certa de escrever os testes que faltam
> (TEST-01) já É escrevê-los verificando o payload exato (`assert_called_with`
> ou inspeção de `call_args`), não escrever testes soltos e depois voltar pra
> "adicionar" a verificação. Não retrofita os testes já existentes no arquivo
> (isso seria um esforço muito maior, fora de escopo) — só as 6 novas.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW — só adiciona testes, não muda nenhum código de produção. Risco real é de outra natureza: se esses testes revelarem que o comportamento atual não é o que a auditoria assumiu, pare e reporte em vez de "consertar" o código de produção por conta própria (não é o escopo deste plano).
- **Depends on**: none (mas é pré-requisito recomendado do Plan 010, BUG-02/PERF-01 — ver `plans/README.md`)
- **Category**: tests (rede de segurança ausente nos 3 fluxos que fazem escrita irreversível/sensível)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

`grep -c "confirmando_cancelamento\|confirmando_cadastro\b" worker/tests/test_empregabilidade_engine.py` retorna **0** (confirmado ao vivo em 2026-07-29) — nenhum teste cobre as 3 etapas que fazem a escrita mais sensível do arquivo inteiro:
- `confirmando_cancelamento` — marca uma vaga real como `cancelada`, **irreversível** (o próprio bot avisa: "*não pode ser reativada*").
- `confirmando_cadastro` (+ `confirmando_cadastro_com_correcao`) — insere uma empresa real na base.
- Confirmação/recusa de convite de entrevista (`processar_mensagem_empregabilidade`, bloco SQS-40 Task 3.4) — grava `candidaturas.status`, usado por processos de seleção reais.

Não é bug hoje — é ausência de rede de segurança pra qualquer mudança futura nesses 3 fluxos, incluindo os fixes já planejados neste diretório (001-007) e principalmente o BUG-02/PERF-01 (refactor grande, L, que a própria auditoria recomenda não fazer sem essa rede primeiro).

Separadamente, `grep -c "assert_called_with\|assert_called_once_with" worker/tests/test_empregabilidade_engine.py` retorna **0** em todo o arquivo — nenhum teste, nem os já existentes, confirma que a query foi montada com a coluna/filtro certo (só confirma o *efeito* — a mensagem enviada, a etapa final). Um bug de coluna errada num `.eq()` passaria despercebido por toda a suíte atual. Os 6 testes novos deste plano devem ser a prova de conceito desse padrão mais rigoroso.

## Current state

**`confirmando_cancelamento`** (`worker/empregabilidade_engine.py:608-694`, confirmado ao vivo):
- `"sim"/"s"/"confirmo"/"confirmar"/"ok"/"yes"` → lê `vagas.historico_alteracoes/created_by/unidade_cuca` (`:619-621`), grava `vagas.update({status: "cancelada", historico_alteracoes: [...], updated_at: ...})` (`:633-637`), tenta notificar o lead via Meta (`:650-673`, dentro de `try/except`, não deve derrubar o fluxo se falhar), muda etapa pra `menu_empresa_acoes` (`:675-682`).
- Qualquer outra resposta → aborta, mensagem "Cancelamento abortado", etapa volta pra `menu_empresa_acoes` (`:683-694`), **nenhuma escrita em `vagas`**.

**`confirmando_cadastro`** (`:820-864`):
- `"sim"/"s"/"confirmar"/"confirmo"/"correto"/"ok"/"certo"/"isso"` → `empresas.insert({...}).execute()` (`:828-838`), lê `emp_insert.data[0]["id"]`, etapa vira `aguardando_criar_vaga`.
- Qualquer outra resposta → **não insere nada**, guarda a correção em `dados_rf["correcao"]`, etapa vira `confirmando_cadastro_com_correcao` (`:855-863`).

**`confirmando_cadastro_com_correcao`** (`:866+`, mesmo padrão de insert, mas só dispara com confirmação depois da correção — não repetido aqui, ver código ao vivo antes de escrever o teste 6).

**Confirmação/recusa de entrevista** (`worker/empregabilidade_engine.py:2223-2281`, dentro de `processar_mensagem_empregabilidade`, **não** dentro de `_processar_empresa`/`_processar_candidato` — roda antes do roteamento por perfil):
- Lê `candidaturas` filtrando por `telefone` (sem DDI) + `status="convite_enviado"` (`:2227-2233`).
- `"1"/"1."/"sim"/"sim!"/"confirmar"/"confirmado"` → `candidaturas.update({status: "entrevista_confirmada"}).eq("id", cand_id)` (`:2241`), etapa vira `{"perfil": "encerrado"}`.
- `"2"/"2."/"não"/"nao"/"não posso"/"nao posso"/"recusar"` → mesma coisa com `"entrevista_recusada"` (`:2251`).
- **Atenção**: esta função lê `conversas.metadata` logo no topo (`:2166`, antes mesmo de chegar no bloco de entrevista) — qualquer teste que chame `processar_mensagem_empregabilidade` diretamente precisa mockar essa leitura também, não só `candidaturas` (ver padrão já usado em `TestEscapeHatchAguardandoCnpj::test_confirmar_troca_de_rota_com_sim_executa_o_reroteamento`, `worker/tests/test_empregabilidade_engine.py:494-518`, que já lida com isso).

**Padrão de mock já estabelecido no arquivo** (`_fluxo_mock`, `worker/tests/test_empregabilidade_engine.py:41-53`) — reaproveitar, não inventar um novo mecanismo de fluxo.

**Não existe hoje** nenhum helper pra mockar múltiplas tabelas do Supabase com retornos diferentes por tabela (`grep -n "side_effect" worker/tests/test_empregabilidade_engine.py` → vazio) — os 3 fluxos deste plano precisam disso (cada um lê/escreve em 1-2 tabelas diferentes na mesma chamada). Este plano cria esse helper.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass, incluindo os 6 novos |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 (nenhuma mudança de produção neste plano, só confirma que nada quebrou o import) |

## Scope

**In scope**: `worker/tests/test_empregabilidade_engine.py` — 1 helper novo + 6 testes novos (2 por fluxo). **Nenhuma mudança em código de produção.**

**Out of scope**: `worker/empregabilidade_engine.py` (não deveria precisar mudar nada — se um teste revelar comportamento inesperado, é achado novo, não conserto silencioso); retrofit dos testes já existentes com `assert_called_with` (esforço muito maior, não é o que a auditoria pede pra #14); BUG-02/PERF-01 (Plan 010, depende deste).

## Git workflow

- Branch: `test/test01-emp14-cobertura-fluxos-criticos`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Helper de mock multi-tabela

Adicionar perto de `_fluxo_mock` (`:41-53`):
```python
def _mock_sb_multi_tabela(tabelas: dict[str, MagicMock]) -> MagicMock:
    """Mock de supabase onde .table(nome) retorna um MagicMock diferente por
    tabela — necessário quando um fluxo lê/escreve em mais de 1 tabela na
    mesma chamada (ex.: confirmando_cancelamento lê e escreve 'vagas', tenta
    ler 'leads'). `tabelas` deve ter 1 entrada por nome de tabela usado pelo
    fluxo testado; usar MagicMock() solto pra tabelas cujo retorno não importa
    pro teste (ex.: a notificação best-effort do lead)."""
    mock_sb = MagicMock()
    mock_sb.table.side_effect = lambda nome: tabelas.get(nome, MagicMock())
    return mock_sb
```

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0 (helper não afeta o import, só confere que nada foi quebrado por engano na edição).

### Step 2: Testes de `confirmando_cancelamento`

```python
class TestConfirmandoCancelamento:

    @pytest.mark.asyncio
    async def test_sim_cancela_vaga_com_payload_correto(self, monkeypatch):
        """TEST-01 + achado #14: cobre o fluxo irreversível de cancelamento,
        verificando o payload exato do update (não só o efeito colateral)."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_cancelamento", {
            "perfil": "empresa", "empresa_id": "emp-1",
            "vaga_cancelar_id": "vaga-1", "vaga_cancelar_titulo": "Vendedor",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_vagas = MagicMock()
        mock_vagas.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "historico_alteracoes": [], "created_by": None, "unidade_cuca": "Barra",
        }
        mock_sb = _mock_sb_multi_tabela({"vagas": mock_vagas})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_empresa(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        update_call = mock_vagas.update.call_args
        payload = update_call.args[0]
        assert payload["status"] == "cancelada"
        assert len(payload["historico_alteracoes"]) == 1
        assert payload["historico_alteracoes"][0]["tipo"] == "cancelamento"
        mock_vagas.update.return_value.eq.assert_called_with("id", "vaga-1")
        assert estado.get("etapa") == "menu_empresa_acoes"

    @pytest.mark.asyncio
    async def test_nao_aborta_sem_escrever_em_vagas(self, monkeypatch):
        """Resposta diferente de confirmação não deve tocar a tabela vagas —
        vaga precisa continuar ativa."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_cancelamento", {
            "perfil": "empresa", "empresa_id": "emp-1",
            "vaga_cancelar_id": "vaga-1", "vaga_cancelar_titulo": "Vendedor",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_vagas = MagicMock()
        mock_sb = _mock_sb_multi_tabela({"vagas": mock_vagas})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_empresa(
            "não, mudei de ideia", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_vagas.update.assert_not_called()
        assert estado.get("etapa") == "menu_empresa_acoes"
```

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py::TestConfirmandoCancelamento -v` → passa.

### Step 3: Testes de `confirmando_cadastro`

```python
class TestConfirmandoCadastro:

    @pytest.mark.asyncio
    async def test_sim_insere_empresa_com_payload_correto(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("confirmando_cadastro", {
            "cnpj": "12345678000199",
            "dados_rf": {"nome": "Empresa Teste LTDA", "nome_fantasia": "Teste", "email": "a@b.com",
                          "telefone": "8533334444", "endereco": "Rua X, 1", "setor": "Comércio", "porte": "ME"},
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_empresas = MagicMock()
        mock_empresas.insert.return_value.execute.return_value.data = [{"id": "empresa-abc"}]
        mock_sb = _mock_sb_multi_tabela({"empresas": mock_empresas})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_empresa(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        payload = mock_empresas.insert.call_args.args[0]
        assert payload["cnpj"] == "12345678000199"
        assert payload["nome"] == "Empresa Teste LTDA"
        assert payload["ativa"] is True
        assert estado.get("etapa") == "aguardando_criar_vaga"
        assert estado.get("empresa_id") == "empresa-abc"

    @pytest.mark.asyncio
    async def test_correcao_nao_insere_e_muda_etapa(self, monkeypatch):
        """Resposta de correção não deve inserir nada ainda — só depois da
        confirmação em confirmando_cadastro_com_correcao."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_cadastro", {
            "cnpj": "12345678000199",
            "dados_rf": {"nome": "Empresa Teste LTDA"},
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_empresas = MagicMock()
        mock_sb = _mock_sb_multi_tabela({"empresas": mock_empresas})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_empresa(
            "na verdade o telefone está errado, é 8599990000",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_empresas.insert.assert_not_called()
        assert estado.get("etapa") == "confirmando_cadastro_com_correcao"
        assert "errado" in estado.get("dados_rf", {}).get("correcao", "")
```

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py::TestConfirmandoCadastro -v` → passa.

### Step 4: Testes de confirmação/recusa de entrevista

```python
class TestConfirmacaoEntrevista:

    @pytest.mark.asyncio
    async def test_confirmar_presenca_grava_status_correto(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_conversas = MagicMock()
        mock_conversas.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"metadata": {}}
        mock_cands = MagicMock()
        mock_cands.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": "cand-1", "nome": "Fulano"}
        ]
        mock_sb = _mock_sb_multi_tabela({"conversas": mock_conversas, "candidaturas": mock_cands})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp.processar_mensagem_empregabilidade(
            "1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra", "Fulano",
        )

        payload = mock_cands.update.call_args.args[0]
        assert payload["status"] == "entrevista_confirmada"
        mock_cands.update.return_value.eq.assert_called_with("id", "cand-1")
        assert estado.get("perfil") == "encerrado"

    @pytest.mark.asyncio
    async def test_recusar_presenca_grava_status_correto(self, monkeypatch):
        """Espelho do teste acima — confirma que '2'/'não' grava
        'entrevista_recusada', não confunde com o branch de confirmação."""
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_conversas = MagicMock()
        mock_conversas.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"metadata": {}}
        mock_cands = MagicMock()
        mock_cands.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": "cand-2", "nome": "Ciclana"}
        ]
        mock_sb = _mock_sb_multi_tabela({"conversas": mock_conversas, "candidaturas": mock_cands})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp.processar_mensagem_empregabilidade(
            "não posso", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra", "Ciclana",
        )

        payload = mock_cands.update.call_args.args[0]
        assert payload["status"] == "entrevista_recusada"
        assert estado.get("perfil") == "encerrado"
```

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py::TestConfirmacaoEntrevista -v` → passa.

Se algum dos 6 testes falhar **não por erro de mock, mas porque o comportamento real diverge do assumido aqui** (ex.: `_montar_historico` ou algum outro side-effect não mockado quebra a chamada), isso é informação nova — reporte antes de alterar o teste pra "fazer passar" às cegas.

## Test plan

Os 6 testes acima **são** o entregável deste plano — não há "teste do teste". Rodar a suíte completa do arquivo ao final, não só as classes novas, pra garantir que os testes existentes continuam passando (o helper novo não deveria afetar nada fora das classes novas).

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

## Done criteria

- [ ] Helper `_mock_sb_multi_tabela` criado
- [ ] 6 testes novos, 2 por fluxo (`TestConfirmandoCancelamento`, `TestConfirmandoCadastro`, `TestConfirmacaoEntrevista`)
- [ ] Todos os 6 verificam payload exato da escrita (`assert_called_with`/inspeção de `call_args`), não só o efeito colateral (mensagem/etapa)
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0, sem regressão em nenhum teste existente
- [ ] Nenhum arquivo de produção modificado (`git status` só mostra o arquivo de teste)
- [ ] `plans/README.md` atualizado

## STOP conditions

- Qualquer um dos 6 testes revelar que o comportamento real diverge do descrito na seção "Current state" — reporte como achado novo, não ajuste o código de produção silenciosamente (fora de escopo deste plano).
- Os números de linha citados aqui não baterem com o código ao vivo.
- `processar_mensagem_empregabilidade` precisar de mocks adicionais além de `conversas`/`candidaturas` pra rodar sem erro (ex.: outra tabela lida antes do bloco de entrevista) — adicione ao helper, mas registre no PR que precisou de mock extra não previsto aqui.

## Maintenance notes

- Este plano **não** retrofita os testes já existentes no arquivo com `assert_called_with` — só estabelece o padrão nos 6 novos. Se o time decidir que vale a pena retrofitar os existentes depois, é um plano novo (esforço bem maior, achado #14 mesmo cita isso como "todos os testes existentes", não só os novos).
- Depois deste plano, o Plan 010 (BUG-02/PERF-01) tem a rede de segurança mínima recomendada pela auditoria pra prosseguir com o refactor grande.
