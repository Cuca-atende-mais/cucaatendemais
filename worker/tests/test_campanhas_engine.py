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
from unittest.mock import MagicMock

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
