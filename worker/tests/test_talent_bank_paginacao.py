"""
Testes — S-EMP-GES-10.

AC7: a triagem lê todos os talentos disponíveis em páginas de 1.000 (o Supabase corta cada consulta
em 1.000 linhas), com a mesma ordem de antes (data_curriculo desc, nulos primeiro) e `id` como
desempate, sem perder nem repetir linhas, mesmo com datas repetidas e nulas.

AC6: o cadastro existente do currículo público mantém o status (um "contratado" não volta a
"disponivel"); só o cadastro novo nasce "disponivel".
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

os.environ.setdefault("SUPABASE_URL", "http://teste")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "chave-teste")
os.environ.setdefault("OPENAI_API_KEY", "sk-teste")

import talent_bank_matcher as tbm  # noqa: E402
import empregabilidade_engine as emp  # noqa: E402


def _chave_ordem(linha):
    """Mesma ordem do banco: data_curriculo desc com nulos primeiro, depois id asc."""
    data = linha["data_curriculo"]
    return (0 if data is None else 1, "" if data is None else _inverte(data), linha["id"])


def _inverte(texto):
    # desc para string ISO: inverte cada caractere (datas de mesmo tamanho)
    return "".join(chr(0x10FFFF - ord(c)) for c in texto)


class _ConsultaFalsa:
    """Imita o construtor do supabase-py: filtros, order e range, aplicados a uma lista em memória."""

    def __init__(self, linhas, registro, limite=1000):
        self._linhas = linhas
        self._registro = registro
        self._limite = limite
        self._eq = []
        self._ordem = []
        self._range = None

    def select(self, _campos):
        return self

    def eq(self, coluna, valor):
        self._eq.append((coluna, valor))
        return self

    def order(self, coluna, desc=False, nullsfirst=False):
        self._ordem.append((coluna, desc, nullsfirst))
        return self

    def range(self, inicio, fim):
        assert self._range is None, "range chamado duas vezes na mesma consulta"
        self._range = (inicio, fim)
        return self

    def execute(self):
        self._registro.append({"eq": list(self._eq), "ordem": list(self._ordem), "range": self._range})
        dados = [l for l in self._linhas if all(l.get(c) == v for c, v in self._eq)]
        dados.sort(key=_chave_ordem)
        inicio, fim = self._range if self._range else (0, len(dados) - 1)
        fim = min(fim, inicio + self._limite - 1)  # o servidor corta em 1.000
        return MagicMock(data=dados[inicio:fim + 1])


def _base_falsa(monkeypatch, linhas):
    registro = []
    sb = MagicMock()
    sb.table.side_effect = lambda _nome: _ConsultaFalsa(linhas, registro)
    monkeypatch.setattr(tbm, "supabase", sb)
    return registro


def _talentos(n):
    linhas = []
    for i in range(n):
        if i % 3 == 0:
            data = None  # muitos sem data, como em produção
        elif i % 3 == 1:
            data = "2026-10-01T00:00:00+00:00"  # data repetida
        else:
            data = f"2026-0{1 + i % 9}-15T00:00:00+00:00"
        linhas.append({"id": f"{i:08d}-0000-4000-8000-000000000000", "status": "disponivel", "data_curriculo": data})
    linhas.append({"id": "ffffffff-0000-4000-8000-000000000000", "status": "contratado", "data_curriculo": None})
    return linhas


def test_le_todos_os_disponiveis_em_paginas_sem_perder_nem_repetir(monkeypatch):
    linhas = _talentos(2507)
    registro = _base_falsa(monkeypatch, linhas)

    todos = tbm._ler_talentos_disponiveis({})

    ids = [t["id"] for t in todos]
    assert len(ids) == 2507
    assert len(set(ids)) == 2507
    assert "ffffffff-0000-4000-8000-000000000000" not in ids  # contratado fica fora
    assert [r["range"] for r in registro] == [(0, 999), (1000, 1999), (2000, 2999)]


def test_ordem_igual_a_de_antes_com_desempate_por_id(monkeypatch):
    linhas = _talentos(30)
    registro = _base_falsa(monkeypatch, linhas)

    todos = tbm._ler_talentos_disponiveis({})

    assert registro[0]["ordem"] == [("data_curriculo", True, True), ("id", False, False)]
    esperados = sorted([l for l in linhas if l["status"] == "disponivel"], key=_chave_ordem)
    assert [t["id"] for t in todos] == [l["id"] for l in esperados]
    assert todos[0]["data_curriculo"] is None  # nulos primeiro, como o desc do Postgres


def test_filtros_da_tela_vao_em_todas_as_paginas(monkeypatch):
    linhas = _talentos(1500)
    for l in linhas:
        l["genero"] = "Feminino"
    registro = _base_falsa(monkeypatch, linhas)

    tbm._ler_talentos_disponiveis({"genero": "Feminino", "pcd": None})

    assert len(registro) == 2
    for r in registro:
        assert ("status", "disponivel") in r["eq"]
        assert ("genero", "Feminino") in r["eq"]
        assert not any(c == "pcd" for c, _ in r["eq"])


def test_exatamente_1000_faz_uma_consulta_a_mais_e_para(monkeypatch):
    registro = _base_falsa(monkeypatch, [l for l in _talentos(1000) if l["status"] == "disponivel"])
    todos = tbm._ler_talentos_disponiveis({})
    assert len(todos) == 1000
    assert len(registro) == 2


class _TabelaTalentosFalsa:
    def __init__(self, existentes, ops):
        self._existentes = existentes
        self._ops = ops
        self._acao = None

    def select(self, _c):
        self._acao = ("select", None)
        return self

    def eq(self, *_a):
        return self

    def limit(self, _n):
        return self

    def update(self, dados):
        self._acao = ("update", dados)
        return self

    def insert(self, dados):
        self._acao = ("insert", dados)
        return self

    def execute(self):
        tipo, dados = self._acao
        if tipo == "select":
            return MagicMock(data=self._existentes)
        self._ops.append((tipo, dados))
        return MagicMock(data=[{"id": "novo"}] if tipo == "insert" else [])


def _banco_engine(monkeypatch, existentes):
    ops = []
    sb = MagicMock()
    sb.table.side_effect = lambda _nome: _TabelaTalentosFalsa(existentes, ops)
    monkeypatch.setattr(emp, "supabase", sb)
    return ops


def test_curriculo_publico_cadastro_existente_mantem_status(monkeypatch):
    ops = _banco_engine(monkeypatch, [{"id": "t1"}])
    talent_id = emp._criar_ou_recuperar_talent_bank("Fulana", "5585987654321")
    assert talent_id == "t1"
    assert ops == [("update", {"nome": "Fulana", "telefone": "85987654321"})]


def test_curriculo_publico_cadastro_novo_nasce_disponivel(monkeypatch):
    ops = _banco_engine(monkeypatch, [])
    talent_id = emp._criar_ou_recuperar_talent_bank("Fulana", "85987654321")
    assert talent_id == "novo"
    assert ops == [("insert", {"nome": "Fulana", "telefone": "85987654321", "status": "disponivel"})]
