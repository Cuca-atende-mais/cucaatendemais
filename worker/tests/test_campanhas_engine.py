"""
Testes unitários — _montar_parametros_named() (S-WM-19 Task 6)

Débito registrado em S-WM-18 (Change Log, 2026-07-04): a função nunca teve
cobertura própria, apesar de ser usada em 4 call sites reais que dependem dela
para não repetir o bug 2 de S-WM-18 (HTTP 400 "(#100) Parameter name is missing
or empty" — templates Meta NAMED exigem parameter_name por posição).

campanhas_engine.py faz `from supabase import create_client, Client` e
`create_client(SUPABASE_URL, SUPABASE_KEY)` no topo do módulo. O pacote
`supabase` não está instalado neste ambiente de teste — mesma limitação já
documentada em test_empregabilidade_engine.py (S-WM-20). Reaproveito aqui o
mesmo stub de sys.modules já usado lá, em vez de instalar o pacote real: uma
tentativa de instalar `supabase==2.7.4` durante esta task rebaixou `httpx`
(dependência compartilhada) e quebrou a coleta de test_empregabilidade_engine.py
(create_client real exige SUPABASE_URL, ausente neste ambiente) — revertido.

S-WM-55 (Plano 004): campanhas_engine.py também faz
`from postgrest.exceptions import APIError` — mesma limitação, `postgrest` não
está instalado aqui (transitivo de `supabase`). Stub abaixo replica a forma real
de `postgrest.exceptions.APIError` (construtor recebe um dict e expõe
`.code`/`.message`/`.hint`/`.details`, confirmado contra o pacote real
instalado em outro projeto local, postgrest 2.27.2) — suficiente pros testes
que checam `exc.code`, sem precisar do pacote real.
"""
import os
import sys
import types
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

if "supabase" not in sys.modules:
    _fake_supabase_pkg = types.ModuleType("supabase")
    _fake_supabase_pkg.create_client = MagicMock(return_value=MagicMock())
    _fake_supabase_pkg.Client = MagicMock
    sys.modules["supabase"] = _fake_supabase_pkg

if "postgrest" not in sys.modules:
    class _FakeAPIError(Exception):
        """Stub de postgrest.exceptions.APIError — mesma forma da classe real."""

        def __init__(self, error: dict):
            self.code = error.get("code")
            self.message = error.get("message")
            self.hint = error.get("hint")
            self.details = error.get("details")
            super().__init__(self.message or self.code)

    _fake_postgrest_pkg = types.ModuleType("postgrest")
    _fake_postgrest_exceptions_mod = types.ModuleType("postgrest.exceptions")
    _fake_postgrest_exceptions_mod.APIError = _FakeAPIError
    _fake_postgrest_pkg.exceptions = _fake_postgrest_exceptions_mod
    sys.modules["postgrest"] = _fake_postgrest_pkg
    sys.modules["postgrest.exceptions"] = _fake_postgrest_exceptions_mod

from campanhas_engine import _montar_parametros_named, _gravar_breadcrumb_disparo  # noqa: E402
from postgrest.exceptions import APIError  # noqa: E402


def test_ordena_por_posicao_independente_da_ordem_de_entrada():
    # variaveis fora de ordem de posição — a função deve reordenar, não confiar na ordem da lista
    variaveis = [
        {"posicao": 2, "descricao": "mes"},
        {"posicao": 1, "descricao": "nome"},
    ]
    valores = ["Ana", "Julho"]

    parametros = _montar_parametros_named(variaveis, valores)

    assert parametros == [
        {"type": "text", "parameter_name": "nome", "text": "Ana"},
        {"type": "text", "parameter_name": "mes", "text": "Julho"},
    ]


def test_transbordo_3_variaveis_named():
    """Call site real: worker/meta_adapter_inbound.py::_notificar_transbordo."""
    variaveis = [
        {"posicao": 1, "descricao": "nome"},
        {"posicao": 2, "descricao": "lead"},
        {"posicao": 3, "descricao": "modulo"},
    ]
    valores = ["Equipe", "Maria Souza", "Empregabilidade"]

    parametros = _montar_parametros_named(variaveis, valores)

    assert [p["parameter_name"] for p in parametros] == ["nome", "lead", "modulo"]
    assert [p["text"] for p in parametros] == valores
    assert all(p["type"] == "text" for p in parametros)


def test_divulgacao_mensal_2_variaveis_named():
    """Call site real: worker/campanhas_engine.py::processar_disparos_divulgacao."""
    variaveis = [
        {"posicao": 1, "descricao": "nome"},
        {"posicao": 2, "descricao": "mes"},
    ]
    valores = ["Carlos", "Agosto"]

    parametros = _montar_parametros_named(variaveis, valores)

    assert parametros == [
        {"type": "text", "parameter_name": "nome", "text": "Carlos"},
        {"type": "text", "parameter_name": "mes", "text": "Agosto"},
    ]


def test_evento_pontual_6_variaveis_named():
    """Call site real: worker/campanhas_engine.py::_processar_item_disparo_interno (ramo padrão)."""
    variaveis = [{"posicao": i, "descricao": f"campo{i}"} for i in range(1, 7)]
    valores = ["titulo", "descricao", "01/08/2026", "19h", "unidade X", "Institucional"]

    parametros = _montar_parametros_named(variaveis, valores)

    assert len(parametros) == 6
    assert [p["text"] for p in parametros] == valores


def test_variaveis_none_retorna_lista_vazia():
    assert _montar_parametros_named(None, ["qualquer"]) == []


def test_variaveis_sem_valores_retorna_lista_vazia():
    variaveis = [{"posicao": 1, "descricao": "nome"}]
    assert _montar_parametros_named(variaveis, []) == []


def test_descricao_ausente_usa_fallback_varN():
    variaveis = [{"posicao": 1}]  # sem "descricao"
    parametros = _montar_parametros_named(variaveis, ["valor"])
    assert parametros == [{"type": "text", "parameter_name": "var1", "text": "valor"}]


def test_valores_a_mais_que_variaveis_trunca_no_menor():
    """Caso de borda: mais valores do que variáveis declaradas — zip trunca, não deve estourar."""
    variaveis = [{"posicao": 1, "descricao": "nome"}]
    valores = ["Ana", "sobra_ignorada"]

    parametros = _montar_parametros_named(variaveis, valores)

    assert parametros == [{"type": "text", "parameter_name": "nome", "text": "Ana"}]


def test_variaveis_a_mais_que_valores_trunca_no_menor():
    """Caso de borda inverso: mais variáveis declaradas do que valores fornecidos."""
    variaveis = [
        {"posicao": 1, "descricao": "nome"},
        {"posicao": 2, "descricao": "mes"},
    ]
    valores = ["Ana"]

    parametros = _montar_parametros_named(variaveis, valores)

    assert parametros == [{"type": "text", "parameter_name": "nome", "text": "Ana"}]


# ---------------------------------------------------------------------------
# _gravar_breadcrumb_disparo (achado 2026-07-22 — breadcrumb de disparo
# sobrescrevia a coluna metadata inteira via upsert, apagando conversa_engajada/
# unidade_selecionada/aguardando_unidade gravados pelo motor-agente na S-WM-31)
# ---------------------------------------------------------------------------

import campanhas_engine as camp  # noqa: E402


def test_breadcrumb_preserva_metadata_existente_da_conversa_engajada(monkeypatch):
    """Reproduz o bug real de 2026-07-21: disparo de campanha não pode apagar
    conversa_engajada/unidade_selecionada gravados pelo motor-agente (S-WM-31)."""
    mock_sb = MagicMock()
    metadata_existente = {"conversa_engajada": True, "unidade_selecionada": "Pici"}
    mock_select_result = MagicMock(data=[{"id": "conversa-123", "metadata": metadata_existente}])
    (mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value
        .limit.return_value.execute.return_value) = mock_select_result
    monkeypatch.setattr(camp, "supabase", mock_sb)

    camp._gravar_breadcrumb_disparo(
        "lead-1", "phone-1", {"ultimo_disparo": {"tipo": "eventos_pontuais", "id": "evt-1"}}
    )

    update_call = mock_sb.table.return_value.update.call_args
    metadata_gravado = update_call.args[0]["metadata"]
    assert metadata_gravado["conversa_engajada"] is True
    assert metadata_gravado["unidade_selecionada"] == "Pici"
    assert metadata_gravado["ultimo_disparo"]["id"] == "evt-1"
    # status não deve ser tocado quando a conversa já existe
    assert "status" not in update_call.args[0]


def test_breadcrumb_cria_conversa_nova_quando_lead_nunca_falou_com_o_bot(monkeypatch):
    """Achado 2026-07-24: com .maybe_single(), 0 linhas fazia .execute() devolver
    None como o próprio retorno (não um objeto com .data=None) — o mock abaixo
    (.data=[] numa cadeia .limit(1).execute()) reproduz o formato real da resposta
    da lib para 0 linhas, ao contrário do mock antigo MagicMock(data=None) que deu
    falso positivo no PR #53."""
    mock_sb = MagicMock()
    mock_select_result = MagicMock(data=[])
    (mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value
        .limit.return_value.execute.return_value) = mock_select_result
    monkeypatch.setattr(camp, "supabase", mock_sb)

    camp._gravar_breadcrumb_disparo(
        "lead-2", "phone-1", {"ultimo_disparo": {"tipo": "eventos_pontuais", "id": "evt-1"}}
    )

    insert_call = mock_sb.table.return_value.insert.call_args
    payload = insert_call.args[0]
    assert payload["status"] == "ativa"
    assert payload["metadata"] == {"ultimo_disparo": {"tipo": "eventos_pontuais", "id": "evt-1"}}
    assert payload["lead_id"] == "lead-2"


def test_breadcrumb_recupera_de_corrida_quando_insert_falha_por_conflito(monkeypatch):
    """Achado 2026-07-25 (S-WM-55, Plano 004): se o INSERT falhar (linha criada por
    outra escrita entre o SELECT e o INSERT — corrida real com o fluxo inbound,
    caso real da Glauwênya), o breadcrumb precisa ser salvo via retry (update),
    não perdido silenciosamente. Simula a exceção real que o postgrest-py levanta
    (APIError com code=23505, SQLSTATE de unique_violation), não uma Exception
    genérica — é exatamente essa distinção que o retry usa pra decidir se é
    corrida ou erro real."""
    mock_sb = MagicMock()

    # 1º select: não encontra a conversa (decide ir pro ramo de INSERT)
    primeiro_select = MagicMock(data=[])
    # INSERT falha com APIError(code=23505) — violação real de UNIQUE(lead_id, origem_id)
    mock_sb.table.return_value.insert.return_value.execute.side_effect = APIError({
        "code": "23505",
        "message": 'duplicate key value violates unique constraint "conversas_lead_id_origem_id_key"',
    })
    # 2º select (retry): agora encontra a linha, criada pela "outra escrita"
    segundo_select = MagicMock(data=[{"id": "conversa-race-1", "metadata": {"conversa_engajada": True}}])

    (mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value
        .limit.return_value.execute.side_effect) = [primeiro_select, segundo_select]

    monkeypatch.setattr(camp, "supabase", mock_sb)

    camp._gravar_breadcrumb_disparo(
        "lead-race", "phone-1", {"ultimo_disparo": {"tipo": "eventos_pontuais", "id": "evt-race"}}
    )

    update_call = mock_sb.table.return_value.update.call_args
    metadata_gravado = update_call.args[0]["metadata"]
    assert metadata_gravado["conversa_engajada"] is True
    assert metadata_gravado["ultimo_disparo"]["id"] == "evt-race"


def test_breadcrumb_nao_mascara_erro_que_nao_e_violacao_de_unique(monkeypatch):
    """S-WM-55 (Plano 004), resolução do STOP condition original: um `except
    Exception:` genérico mascararia QUALQUER erro do INSERT como se fosse a
    corrida esperada — inclusive um erro real do Postgres que não é violação de
    UNIQUE (ex.: NOT NULL, FK, permissão). Cenário adversarial: o retry encontra
    uma linha (por qualquer motivo, não necessariamente a corrida) — um
    `except Exception:` genérico prosseguiria e mesclaria metadata nela mesmo
    assim, mascarando o erro real; a checagem de `APIError.code` tem que
    interromper ANTES disso, sem nunca chegar a olhar o retry."""
    mock_sb = MagicMock()

    # 1º select: não encontra a conversa (decide ir pro ramo de INSERT)
    primeiro_select = MagicMock(data=[])
    # INSERT falha com um código de erro Postgres DIFERENTE de unique_violation
    # (23502 = not_null_violation) — não é a corrida esperada, tem que propagar.
    mock_sb.table.return_value.insert.return_value.execute.side_effect = APIError({
        "code": "23502",
        "message": 'null value in column "agente_tipo" violates not-null constraint',
    })
    # 2º select (retry): encontra uma linha — adversarial de propósito (existe por
    # qualquer motivo, não pela corrida); um except genérico usaria isso pra
    # "recuperar" silenciosamente do erro real, que é o comportamento errado.
    segundo_select = MagicMock(data=[{"id": "conversa-nao-relacionada", "metadata": {}}])

    (mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value
        .limit.return_value.execute.side_effect) = [primeiro_select, segundo_select]

    monkeypatch.setattr(camp, "supabase", mock_sb)

    with pytest.raises(APIError) as exc_info:
        camp._gravar_breadcrumb_disparo(
            "lead-erro-real", "phone-1", {"ultimo_disparo": {"tipo": "eventos_pontuais", "id": "evt-x"}}
        )
    assert exc_info.value.code == "23502"
    # não deve ter tentado nenhum update — o erro real precisa subir antes de
    # sequer olhar o resultado do retry select
    mock_sb.table.return_value.update.assert_not_called()


# ---------------------------------------------------------------------------
# Trava de regressão — nenhuma das 3 funções corrigidas em 2026-07-24 pode
# voltar a usar .maybe_single() sem proteção. Um mock de biblioteca não
# reproduz com confiança o comportamento real de 0-linhas do postgrest-py
# (foi exatamente esse tipo de mock que deu o falso positivo original) — a
# forma robusta de travar isso é inspecionar o código-fonte real da função.
# ---------------------------------------------------------------------------

import inspect  # noqa: E402


@pytest.mark.parametrize("funcao", [
    camp._gravar_breadcrumb_disparo,
    camp._processar_item_disparo_interno,
    camp._processar_disparo_divulgacao_interno,
])
def test_funcoes_de_disparo_nao_usam_maybe_single_sem_protecao(funcao):
    codigo_fonte = inspect.getsource(funcao)
    assert ".maybe_single(" not in codigo_fonte, (
        f"{funcao.__name__} voltou a usar .maybe_single() — com 0 linhas isso devolve "
        "None como o próprio retorno de .execute() (não um objeto com .data=None), "
        "quebrando com AttributeError (achado 2026-07-24). Use .limit(1).execute() "
        "e acesse .data[0]."
    )


# ---------------------------------------------------------------------------
# _query_leads_sync (achado 2026-07-24 — disparo real pra categoria "Teste Interno"
# com 722 leads quebrava: .in_("id", lead_ids) montava um GET com todos os UUIDs na
# URL, passava do limite do gateway/PostgREST, API devolvia corpo inválido e o
# disparo inteiro caía em "pausada" sem enviar nada. Corrigido com a RPC
# buscar_leads_por_categoria — join feito no Postgres, corpo da requisição (POST)
# só carrega os UUIDs de categoria, nunca a lista de leads que fizer match.)
# ---------------------------------------------------------------------------

def test_query_leads_com_categorias_alvo_usa_rpc_nao_monta_lista_de_ids(monkeypatch):
    mock_sb = MagicMock()
    mock_rpc_result = MagicMock(data=[{"id": "lead-1", "telefone": "5585999999999", "nome": "Fulano"}])
    mock_sb.rpc.return_value.execute.return_value = mock_rpc_result
    monkeypatch.setattr(camp, "supabase", mock_sb)

    resultado = camp._query_leads_sync(unidade=None, categorias_alvo=["cat-1", "cat-2"])

    mock_sb.rpc.assert_called_once_with("buscar_leads_por_categoria", {
        "p_categorias": ["cat-1", "cat-2"],
        "p_unidade": None,
    })
    # achado 2026-07-24: nunca mais pode montar a lista de leads client-side
    mock_sb.table.assert_not_called()
    assert resultado.data == [{"id": "lead-1", "telefone": "5585999999999", "nome": "Fulano"}]


def test_query_leads_com_categorias_alvo_e_unidade_repassa_p_unidade(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.rpc.return_value.execute.return_value = MagicMock(data=[])
    monkeypatch.setattr(camp, "supabase", mock_sb)

    camp._query_leads_sync(unidade="Cuca Barra", categorias_alvo=["cat-1"])

    mock_sb.rpc.assert_called_once_with("buscar_leads_por_categoria", {
        "p_categorias": ["cat-1"],
        "p_unidade": "Cuca Barra",
    })


def test_query_leads_sem_categorias_alvo_usa_tabela_leads_direto(monkeypatch):
    """Regressão: sem categorias_alvo, comportamento original (query direta em leads
    com opt_in/bloqueado) precisa continuar valendo — não é afetado pelo achado."""
    mock_sb = MagicMock()
    mock_query = mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value
    mock_query.execute.return_value = MagicMock(data=[{"id": "lead-2", "telefone": "5585988888888", "nome": "Ciclana"}])
    monkeypatch.setattr(camp, "supabase", mock_sb)

    resultado = camp._query_leads_sync(unidade=None, categorias_alvo=None)

    mock_sb.rpc.assert_not_called()
    mock_sb.table.assert_called_with("leads")
    assert resultado.data == [{"id": "lead-2", "telefone": "5585988888888", "nome": "Ciclana"}]


# ---------------------------------------------------------------------------
# S-WM-56 (Plano 005): disparo de divulgação mensal ganha paridade com
# eventos_pontuais/ouvidoria_eventos — passa a gravar o breadcrumb
# `ultimo_disparo` após envio bem-sucedido, mesmo mecanismo que a S-WM-55 já
# corrigiu (retry atômico via APIError.code em _gravar_breadcrumb_disparo).
# ---------------------------------------------------------------------------

def test_query_leads_divulgacao_seleciona_id(monkeypatch):
    """Sem `id` no select, não há lead_id disponível no loop do disparo de
    divulgação mensal pra gravar o breadcrumb."""
    mock_sb = MagicMock()
    mock_query = mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value
    mock_query.execute.return_value = MagicMock(data=[])
    monkeypatch.setattr(camp, "supabase", mock_sb)

    camp._query_leads_divulgacao_sync()

    mock_sb.table.return_value.select.assert_called_with("id, telefone, nome")


def _mock_supabase_com_template_divulgacao():
    """Mock de supabase configurado só pra resolver o lookup de meta_templates que
    _processar_disparo_divulgacao_interno faz antes do loop de envio — comum aos
    3 testes async abaixo."""
    mock_sb = MagicMock()
    (mock_sb.table.return_value.select.return_value.eq.return_value.contains.return_value
        .eq.return_value.eq.return_value.limit.return_value.execute.return_value.data) = [
        {"nome": "tpl_divulgacao", "corpo_texto": "Oi {{nome}}, programação de {{mes}}: {{link}}", "variaveis": []}
    ]
    return mock_sb


@pytest.mark.asyncio
async def test_disparo_divulgacao_grava_breadcrumb_apos_envio_com_sucesso(monkeypatch):
    """Achado 2026-07-26: paridade com eventos_pontuais/ouvidoria_eventos — após um
    envio bem-sucedido, o breadcrumb ultimo_disparo precisa ser gravado com
    tipo='divulgacao_mensal', sem o qual deveReconhecerDisparoRecente
    (motor-agente) não tem como reconhecer o disparo recente."""
    monkeypatch.setattr(camp, "supabase", _mock_supabase_com_template_divulgacao())
    monkeypatch.setattr(camp, "_get_phone_by_canal_tipo_sync", lambda canal_tipo: ("phone-div-1", "token-div-1"))
    monkeypatch.setattr(
        camp, "_query_leads_divulgacao_sync",
        lambda: MagicMock(data=[{"id": "lead-div-1", "telefone": "5585999999999", "nome": "Fulano"}]),
    )
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(True, "wamid.TESTE123")))
    mock_breadcrumb = MagicMock()
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", mock_breadcrumb)
    monkeypatch.setattr(camp, "_update_metricas_sync", MagicMock())

    await camp._processar_disparo_divulgacao_interno(
        disparo_id="disparo-div-1", mes_nome="Agosto",
        delay_min=0, delay_max=0, daily_limit=10, error_threshold=100,
    )

    mock_breadcrumb.assert_called_once()
    lead_id_arg, phone_arg, breadcrumb_arg = mock_breadcrumb.call_args.args
    assert lead_id_arg == "lead-div-1"
    assert phone_arg == "phone-div-1"
    assert breadcrumb_arg["ultimo_disparo"]["tipo"] == "divulgacao_mensal"
    assert breadcrumb_arg["ultimo_disparo"]["id"] == "disparo-div-1"


@pytest.mark.asyncio
async def test_disparo_divulgacao_nao_grava_breadcrumb_quando_envio_falha(monkeypatch):
    """Uma falha de envio não pode gravar breadcrumb nenhum (o lead não recebeu
    nada), e o bookkeeping de erros continua incrementando normalmente — a
    gravação do breadcrumb nunca deve afetar o que já é contado hoje."""
    monkeypatch.setattr(camp, "supabase", _mock_supabase_com_template_divulgacao())
    monkeypatch.setattr(camp, "_get_phone_by_canal_tipo_sync", lambda canal_tipo: ("phone-div-1", "token-div-1"))
    monkeypatch.setattr(
        camp, "_query_leads_divulgacao_sync",
        lambda: MagicMock(data=[{"id": "lead-div-2", "telefone": "5585988888888", "nome": "Beltrana"}]),
    )
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(False, None)))
    mock_breadcrumb = MagicMock()
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", mock_breadcrumb)
    mock_metricas = MagicMock()
    monkeypatch.setattr(camp, "_update_metricas_sync", mock_metricas)

    await camp._processar_disparo_divulgacao_interno(
        disparo_id="disparo-div-2", mes_nome="Agosto",
        delay_min=0, delay_max=0, daily_limit=10, error_threshold=100,
    )

    mock_breadcrumb.assert_not_called()
    # _update_metricas_sync(disparo_id, enviados, erros, stop, status) — erros=1
    metricas_call = mock_metricas.call_args
    assert metricas_call.args[2] == 1, "erro do envio falho precisa continuar contado normalmente"


# ---------------------------------------------------------------------------
# S-WM-57 (Plano 007): ledger por destinatário (logs_disparo) + captura de wamid.
# Fecha o loop com o PR #55 (deveReconhecerDisparoRecente) e dá visibilidade real
# de entrega (HTTP aceito != entregue/lido pelo destinatário).
# ---------------------------------------------------------------------------

def _mock_httpx_async_client(mock_resp=None, side_effect=None):
    """Mock de httpx.AsyncClient (pacote real, instalado neste ambiente — ao
    contrário de supabase/postgrest) pro contexto `async with ... as client`."""
    mock_client_instance = AsyncMock()
    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_client_instance.__aexit__ = AsyncMock(return_value=False)
    if side_effect:
        mock_client_instance.post = AsyncMock(side_effect=side_effect)
    else:
        mock_client_instance.post = AsyncMock(return_value=mock_resp)
    return MagicMock(return_value=mock_client_instance)


@pytest.mark.asyncio
async def test_enviar_template_meta_retorna_wamid_em_sucesso(monkeypatch):
    """Achado B (diagnóstico arquitetural): hoje _enviar_template_meta só sabe se o
    HTTP foi aceito, nunca captura o wamid — sem ele não dá pra casar com os
    statuses[] que a Meta manda depois (entregue/lido/falhou)."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"messages": [{"id": "wamid.ABC123"}]}
    monkeypatch.setattr(camp.httpx, "AsyncClient", _mock_httpx_async_client(mock_resp=mock_resp))

    resultado = await camp._enviar_template_meta("phone-1", "5585999999999", "token-1", "tpl", [])

    assert resultado == (True, "wamid.ABC123")


@pytest.mark.asyncio
async def test_enviar_template_meta_retorna_none_em_falha(monkeypatch):
    """Falha HTTP (não 200/201) → (False, None), sem wamid nenhum pra correlacionar."""
    mock_resp = MagicMock()
    mock_resp.status_code = 400
    mock_resp.text = '{"error": "template nao aprovado"}'
    monkeypatch.setattr(camp.httpx, "AsyncClient", _mock_httpx_async_client(mock_resp=mock_resp))

    resultado = await camp._enviar_template_meta("phone-1", "5585999999999", "token-1", "tpl", [])

    assert resultado == (False, None)


def _mock_supabase_disparo_pontual(template_data, disparo_id_criado="disparo-pontual-1"):
    """Mock de supabase com tabelas independentes por nome (via side_effect em
    .table()) — necessário porque este fluxo grava em 2 tabelas diferentes
    (disparos, logs_disparo) e os testes precisam inspecionar cada uma
    separadamente, não um único .table.return_value compartilhado."""
    mock_sb = MagicMock()
    tabelas: dict[str, MagicMock] = {}

    def _table(nome):
        if nome not in tabelas:
            tabelas[nome] = MagicMock()
        return tabelas[nome]

    mock_sb.table = MagicMock(side_effect=_table)
    (tabelas.setdefault("meta_templates", MagicMock()).select.return_value.eq.return_value
        .contains.return_value.eq.return_value.eq.return_value.limit.return_value
        .execute.return_value.data) = template_data
    tabelas.setdefault("disparos", MagicMock()).insert.return_value.execute.return_value.data = [
        {"id": disparo_id_criado}
    ]
    return mock_sb, tabelas


@pytest.mark.asyncio
async def test_disparo_pontual_grava_ledger_por_destinatario(monkeypatch):
    """Achado B: cada envio (eventos_pontuais/ouvidoria) precisa deixar um rastro
    por destinatário — quem recebeu o quê, com o wamid pra casar com o status
    real de entrega que chega depois pelo webhook."""
    mock_sb, tabelas = _mock_supabase_disparo_pontual(
        [{"nome": "tpl_pontual", "corpo_texto": "...", "variaveis": []}]
    )
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "_get_phone_by_canal_tipo_sync", lambda canal_tipo: ("phone-pontual-1", "token-1"))
    monkeypatch.setattr(
        camp, "_query_leads_sync",
        lambda unidade, categorias_alvo: MagicMock(
            data=[{"id": "lead-pontual-1", "telefone": "5585999999999", "nome": "Fulano"}]
        ),
    )
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(True, "wamid.XYZ")))
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())

    item = {"id": "evento-1", "titulo": "Evento Teste", "descricao": "desc"}
    await camp._processar_item_disparo_interno(item, "eventos_pontuais", 0, 0, 10, 100)

    logs_disparo_insert = tabelas["logs_disparo"].insert.call_args
    assert logs_disparo_insert is not None, "logs_disparo.insert nunca foi chamado"
    payload = logs_disparo_insert.args[0]
    assert payload["disparo_id"] == "disparo-pontual-1"
    assert payload["lead_id"] == "lead-pontual-1"
    assert payload["wamid"] == "wamid.XYZ"
    assert payload["status"] == "enviado"


@pytest.mark.asyncio
async def test_disparo_pontual_cria_disparo_antes_do_loop_nao_depois(monkeypatch):
    """Achado C (pré-requisito estrutural): o disparo_id precisa existir ANTES do
    1º envio (não só no fim), senão o ledger não tem o que referenciar se o loop
    pausar/truncar no meio. A linha 'disparos' é criada 1x (INSERT, status
    em_andamento) e finalizada 1x (UPDATE, status concluida) — nunca um 2º INSERT."""
    mock_sb, tabelas = _mock_supabase_disparo_pontual(
        [{"nome": "tpl_pontual", "corpo_texto": "...", "variaveis": []}]
    )
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "_get_phone_by_canal_tipo_sync", lambda canal_tipo: ("phone-pontual-1", "token-1"))
    monkeypatch.setattr(
        camp, "_query_leads_sync",
        lambda unidade, categorias_alvo: MagicMock(
            data=[{"id": "lead-pontual-1", "telefone": "5585999999999", "nome": "Fulano"}]
        ),
    )
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(True, "wamid.XYZ")))
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())

    item = {"id": "evento-1", "titulo": "Evento Teste", "descricao": "desc"}
    await camp._processar_item_disparo_interno(item, "eventos_pontuais", 0, 0, 10, 100)

    # ordem: "disparos" precisa aparecer em .table() antes de "logs_disparo"
    nomes_tabela_em_ordem = [c.args[0] for c in mock_sb.table.call_args_list]
    assert "disparos" in nomes_tabela_em_ordem and "logs_disparo" in nomes_tabela_em_ordem
    assert nomes_tabela_em_ordem.index("disparos") < nomes_tabela_em_ordem.index("logs_disparo"), (
        "disparo_id precisa ser criado ANTES do 1º envio, não depois"
    )

    disparo_inserts = tabelas["disparos"].insert.call_args_list
    assert len(disparo_inserts) == 1, "disparos só pode ser criado (INSERT) 1 vez, antes do loop"
    assert disparo_inserts[0].args[0]["status"] == "em_andamento"

    disparo_updates = tabelas["disparos"].update.call_args_list
    assert len(disparo_updates) == 1, "finalização precisa ser UPDATE (não um 2º INSERT)"
    assert disparo_updates[0].args[0]["status"] == "concluida"
    assert disparo_updates[0].args[0]["total_enviados"] == 1
    assert disparo_updates[0].args[0]["total_erros"] == 0


@pytest.mark.asyncio
async def test_disparo_divulgacao_grava_ledger_por_destinatario(monkeypatch):
    """Mesmo achado B, motor de divulgação mensal — disparo_id já é parâmetro
    (S-WM-56), então aqui só precisa gravar o ledger por envio, sem mover nada."""
    mock_sb = _mock_supabase_com_template_divulgacao()
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "_get_phone_by_canal_tipo_sync", lambda canal_tipo: ("phone-div-1", "token-div-1"))
    monkeypatch.setattr(
        camp, "_query_leads_divulgacao_sync",
        lambda: MagicMock(data=[{"id": "lead-div-ledger-1", "telefone": "5585999999999", "nome": "Fulano"}]),
    )
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(True, "wamid.DIV1")))
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())
    monkeypatch.setattr(camp, "_update_metricas_sync", MagicMock())

    await camp._processar_disparo_divulgacao_interno(
        disparo_id="disparo-div-ledger-1", mes_nome="Agosto",
        delay_min=0, delay_max=0, daily_limit=10, error_threshold=100,
    )

    insert_call = mock_sb.table.return_value.insert.call_args
    assert insert_call is not None, "logs_disparo.insert nunca foi chamado"
    payload = insert_call.args[0]
    assert payload["disparo_divulgacao_id"] == "disparo-div-ledger-1"
    assert payload["lead_id"] == "lead-div-ledger-1"
    assert payload["wamid"] == "wamid.DIV1"
    assert payload["status"] == "enviado"


# ---------------------------------------------------------------------------
# Plano 008 / S-WM-60: daily_limit deixa de mentir "concluída"/"concluido" (Steps 1-2),
# retomada manual sem duplicar quem já recebeu (Step 3), disparo travado em em_andamento
# vira log crítico (Step 5), daily_limit passa a ser por phone_number_id (Step 6).
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_daily_limit_pausa_item_em_vez_de_concluir(monkeypatch):
    """Step 1 (AC1): daily_limit atingido no meio do loop pausa com
    'pausada_limite_diario' — achado original do plano (era só um break silencioso,
    finalizando com 'concluida' falso e total_destinatarios != total_enviados sem sinal)."""
    mock_sb, tabelas = _mock_supabase_disparo_pontual(
        [{"nome": "tpl_pontual", "corpo_texto": "...", "variaveis": []}]
    )
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "_get_phone_by_canal_tipo_sync", lambda canal_tipo: ("phone-pontual-1", "token-1"))
    leads = [{"id": f"lead-{i}", "telefone": "5585999999999", "nome": "Fulano"} for i in range(5)]
    monkeypatch.setattr(camp, "_query_leads_sync", lambda unidade, categorias_alvo: MagicMock(data=leads))
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(True, "wamid.XYZ")))
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())

    item = {"id": "evento-1", "titulo": "Evento Teste", "descricao": "desc"}
    await camp._processar_item_disparo_interno(item, "eventos_pontuais", 0, 0, 3, 100)

    disparo_updates = tabelas["disparos"].update.call_args_list
    assert len(disparo_updates) == 1
    assert disparo_updates[0].args[0]["status"] == "pausada_limite_diario"
    assert disparo_updates[0].args[0]["total_enviados"] == 3, "só os 3 dentro do limite, não os 5 elegíveis"

    item_updates = tabelas["eventos_pontuais"].update.call_args_list
    assert len(item_updates) == 1
    assert item_updates[0].args[0]["status"] == "pausada_limite_diario"


@pytest.mark.asyncio
async def test_error_threshold_continua_pausando_como_antes(monkeypatch):
    """Regressão: error_threshold continua pausando com status 'pausada' (não
    'pausada_limite_diario') — branch pré-existente, não alterada pelo Plano 008."""
    mock_sb, tabelas = _mock_supabase_disparo_pontual(
        [{"nome": "tpl_pontual", "corpo_texto": "...", "variaveis": []}]
    )
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "_get_phone_by_canal_tipo_sync", lambda canal_tipo: ("phone-pontual-1", "token-1"))
    leads = [{"id": f"lead-{i}", "telefone": "5585999999999", "nome": "Fulano"} for i in range(10)]
    monkeypatch.setattr(camp, "_query_leads_sync", lambda unidade, categorias_alvo: MagicMock(data=leads))
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(False, None)))
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())

    item = {"id": "evento-1", "titulo": "Evento Teste", "descricao": "desc"}
    await camp._processar_item_disparo_interno(item, "eventos_pontuais", 0, 0, 100, 10)

    disparo_updates = tabelas["disparos"].update.call_args_list
    assert len(disparo_updates) == 1
    assert disparo_updates[0].args[0]["status"] == "pausada"


@pytest.mark.asyncio
async def test_divulgacao_marca_pausado_limite_diario_quando_elegiveis_excede_limite(monkeypatch):
    """Step 2 (AC2): daily_limit < leads elegíveis pausa com 'pausado_limite_diario' —
    achado original do plano (bomba-relógio silenciosa: total = min(len(leads),
    daily_limit) sempre terminava 'concluido', sem sinal de quem ficou de fora)."""
    mock_sb = _mock_supabase_com_template_divulgacao()
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "_get_phone_by_canal_tipo_sync", lambda canal_tipo: ("phone-div-1", "token-div-1"))
    leads = [{"id": f"lead-div-{i}", "telefone": "5585999999999", "nome": "Fulano"} for i in range(5)]
    monkeypatch.setattr(camp, "_query_leads_divulgacao_sync", lambda: MagicMock(data=leads))
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(True, "wamid.DIV")))
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())
    mock_metricas = MagicMock()
    monkeypatch.setattr(camp, "_update_metricas_sync", mock_metricas)

    await camp._processar_disparo_divulgacao_interno(
        disparo_id="disparo-div-1", mes_nome="Agosto",
        delay_min=0, delay_max=0, daily_limit=3, error_threshold=100,
    )

    assert mock_metricas.call_count == 1
    call = mock_metricas.call_args
    # _update_metricas_sync(disparo_id, enviados, erros, stop, status)
    assert call.args[1] == 3, "só os 3 dentro do limite devem ser contados como enviados"
    assert call.args[4] == "pausado_limite_diario"


def _mock_supabase_retomada_pontual(item_data, ja_tentados_ids, template_data):
    """Mock multi-tabela pra retomar_disparo_pausado: eventos_pontuais/ouvidoria_eventos
    (item pausado), logs_disparo (já tentados via select simples + contagem cumulativa via
    select com count='exact' — chains distintas por método encadeado, configuradas
    separadamente), meta_templates (lookup de template)."""
    mock_sb = MagicMock()
    tabelas: dict[str, MagicMock] = {}

    def _table(nome):
        if nome not in tabelas:
            tabelas[nome] = MagicMock()
        return tabelas[nome]

    mock_sb.table = MagicMock(side_effect=_table)

    item_tbl = tabelas.setdefault(item_data.get("_origem_tabela", "eventos_pontuais"), MagicMock())
    item_tbl.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [item_data]

    logs_tbl = tabelas.setdefault("logs_disparo", MagicMock())
    logs_tbl.select.return_value.eq.return_value.execute.return_value.data = [
        {"lead_id": lid} for lid in ja_tentados_ids
    ]
    logs_tbl.select.return_value.eq.return_value.neq.return_value.execute.return_value.count = 0
    logs_tbl.select.return_value.eq.return_value.in_.return_value.execute.return_value.count = 0

    tpl_tbl = tabelas.setdefault("meta_templates", MagicMock())
    (tpl_tbl.select.return_value.eq.return_value.contains.return_value
        .eq.return_value.eq.return_value.limit.return_value.execute.return_value.data) = template_data

    return mock_sb, tabelas


@pytest.mark.asyncio
async def test_retomar_disparo_pausado_envia_so_pendentes(monkeypatch):
    """Step 3 (AC3): retomada envia só pra quem ainda não tem linha em logs_disparo pro
    disparo_id — nunca duplica quem já recebeu."""
    item_data = {
        "id": "evento-1", "titulo": "Evento Teste", "descricao": "desc",
        "status": "pausada_limite_diario", "disparo_id": "disparo-retomada-1",
        "unidade_cuca": None, "categorias_alvo": None,
    }
    mock_sb, tabelas = _mock_supabase_retomada_pontual(
        item_data, ja_tentados_ids=["lead-1", "lead-2"],
        template_data=[{"nome": "tpl_pontual", "corpo_texto": "...", "variaveis": []}],
    )
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "_get_phone_by_canal_tipo_sync", lambda canal_tipo: ("phone-pontual-1", "token-1"))
    todos_leads = [{"id": f"lead-{i}", "telefone": "5585999999999", "nome": "Fulano"} for i in range(1, 6)]
    monkeypatch.setattr(camp, "_query_leads_sync", lambda unidade, categorias_alvo: MagicMock(data=todos_leads))
    mock_enviar = AsyncMock(return_value=(True, "wamid.RETOMADA"))
    monkeypatch.setattr(camp, "_enviar_template_meta", mock_enviar)
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())

    resultado = await camp.retomar_disparo_pausado("evento-1", "eventos_pontuais", 0, 0, 100, 100)

    assert resultado["pendentes_encontrados"] == 3
    assert mock_enviar.call_count == 3, "só os 3 leads sem logs_disparo (lead-3,4,5) deveriam ser enviados"
    enviados_para = {c.args[1] for c in mock_enviar.call_args_list}
    assert "5585999999999" in enviados_para  # todos normalizados pro mesmo número no mock — checagem de call_count já é a garantia real


@pytest.mark.asyncio
async def test_retomar_disparo_pausado_rejeita_item_nao_pausado(monkeypatch):
    """Retomada só é válida pra item com status='pausada_limite_diario' — qualquer outro
    status (ex.: 'concluida') retorna erro sem enviar nada, sem side-effect."""
    item_data = {"id": "evento-2", "status": "concluida", "disparo_id": "disparo-x"}
    mock_sb, tabelas = _mock_supabase_retomada_pontual(item_data, ja_tentados_ids=[], template_data=[])
    monkeypatch.setattr(camp, "supabase", mock_sb)
    mock_enviar = AsyncMock()
    monkeypatch.setattr(camp, "_enviar_template_meta", mock_enviar)

    resultado = await camp.retomar_disparo_pausado("evento-2", "eventos_pontuais", 0, 0, 100, 100)

    assert resultado["status"] == "erro"
    mock_enviar.assert_not_called()


@pytest.mark.asyncio
async def test_campanhas_loop_loga_critical_para_disparo_travado(monkeypatch, caplog):
    """Step 5 (AC5): disparo preso em 'em_andamento' há mais de 2h gera log CRITICAL
    (DISPARO-TRAVADO) — sem nenhuma chamada de .update() (visibilidade, não ação)."""
    mock_sb = MagicMock()
    stuck_row = {"id": "disparo-travado-1", "tipo": "pontual", "iniciado_em": "2026-07-29T00:00:00+00:00"}
    (mock_sb.table.return_value.select.return_value.eq.return_value.lt.return_value
        .execute.return_value.data) = [stuck_row]
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "get_config", AsyncMock(side_effect=lambda chave, default: default))
    monkeypatch.setattr(camp, "_claim_evento_pontual_sync", lambda: MagicMock(data=[]))
    monkeypatch.setattr(camp, "_claim_ouvidoria_evento_sync", lambda: MagicMock(data=[]))
    monkeypatch.setattr(camp, "processar_disparos_divulgacao", AsyncMock())

    # A 1ª chamada de asyncio.sleep é o `await asyncio.sleep(5)` antes do `while True` — deixa
    # passar normalmente. A 2ª é o `await asyncio.sleep(30)` no fim da 1ª iteração do loop —
    # aí sim interrompe, depois que o corpo da iteração (incluindo o check de travado) rodou.
    sleep_calls = {"n": 0}

    async def _sleep_side_effect(*args, **kwargs):
        sleep_calls["n"] += 1
        if sleep_calls["n"] == 1:
            return None
        raise camp.asyncio.CancelledError()

    monkeypatch.setattr(camp.asyncio, "sleep", AsyncMock(side_effect=_sleep_side_effect))

    with caplog.at_level("CRITICAL"):
        try:
            await camp.campanhas_loop()
        except camp.asyncio.CancelledError:
            pass

    assert any("DISPARO-TRAVADO" in rec.message and "disparo-travado-1" in rec.message for rec in caplog.records)
    mock_sb.table.return_value.update.assert_not_called()


def test_daily_limit_resolvido_por_phone_number_id(monkeypatch):
    """Step 6: 2 phone_number_id distintos com daily_limit diferentes em
    meta_phone_numbers — cada um resolve o próprio valor, não um global compartilhado."""
    mock_sb = MagicMock()
    respostas = {
        "phone-A": MagicMock(data=[{"daily_limit": 100}]),
        "phone-B": MagicMock(data=[{"daily_limit": 2000}]),
    }

    def _eq(campo, valor):
        assert campo == "phone_number_id"
        chain = MagicMock()
        chain.limit.return_value.execute.return_value = respostas[valor]
        return chain

    mock_sb.table.return_value.select.return_value.eq = MagicMock(side_effect=_eq)
    monkeypatch.setattr(camp, "supabase", mock_sb)

    assert camp._get_daily_limit_by_phone_sync("phone-A") == 100
    assert camp._get_daily_limit_by_phone_sync("phone-B") == 2000


def test_daily_limit_fallback_quando_nao_configurado(monkeypatch):
    """Step 6: phone_number_id com daily_limit NULL cai no fallback conservador (500) —
    decisão confirmada com Junior (2026-07-29): não bloqueia o disparo."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"daily_limit": None}
    ]
    monkeypatch.setattr(camp, "supabase", mock_sb)

    assert camp._get_daily_limit_by_phone_sync("phone-sem-limite") == 500


def test_daily_limit_fallback_quando_numero_nao_encontrado(monkeypatch):
    """Mesmo fallback (500) quando o phone_number_id nem existe em meta_phone_numbers —
    cobertura extra além do pedido explícito do plano, mesma função de fallback."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    monkeypatch.setattr(camp, "supabase", mock_sb)

    assert camp._get_daily_limit_by_phone_sync("phone-inexistente") == 500


@pytest.mark.asyncio
async def test_retomada_resolve_daily_limit_por_numero(monkeypatch):
    """Step 6: retomar_disparo_pausado, chamado com daily_limit=None (como o endpoint
    /retomar-disparo sempre chama pós-Step 6), resolve o limite por phone_number_id — não
    usa mais um valor global fixo."""
    item_data = {
        "id": "evento-3", "titulo": "Evento", "descricao": "desc",
        "status": "pausada_limite_diario", "disparo_id": "disparo-retomada-2",
        "unidade_cuca": None, "categorias_alvo": None,
    }
    mock_sb, tabelas = _mock_supabase_retomada_pontual(
        item_data, ja_tentados_ids=[],
        template_data=[{"nome": "tpl_pontual", "corpo_texto": "...", "variaveis": []}],
    )
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "_get_phone_by_canal_tipo_sync", lambda canal_tipo: ("phone-retomada-1", "token-1"))
    monkeypatch.setattr(camp, "_query_leads_sync", lambda unidade, categorias_alvo: MagicMock(
        data=[{"id": "lead-1", "telefone": "5585999999999", "nome": "Fulano"}]
    ))
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(True, "wamid.X")))
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())
    mock_resolver = MagicMock(return_value=7)
    monkeypatch.setattr(camp, "_get_daily_limit_by_phone_sync", mock_resolver)
    monkeypatch.setattr(camp, "_warn_if_daily_limit_above_tier_sync", MagicMock())

    await camp.retomar_disparo_pausado("evento-3", "eventos_pontuais", 0, 0, None, 100)

    mock_resolver.assert_called_once_with("phone-retomada-1")
