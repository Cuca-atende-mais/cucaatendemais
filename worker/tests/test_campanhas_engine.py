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
"""
import os
import sys
import types
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

if "supabase" not in sys.modules:
    _fake_supabase_pkg = types.ModuleType("supabase")
    _fake_supabase_pkg.create_client = MagicMock(return_value=MagicMock())
    _fake_supabase_pkg.Client = MagicMock
    sys.modules["supabase"] = _fake_supabase_pkg

from campanhas_engine import _montar_parametros_named  # noqa: E402


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
