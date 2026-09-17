"""
Testes do porteiro da confirmação de presença — S-AE-CONF-03.

Os cenários abaixo são os mesmos 11 combinados com o Junior na story (seção "Cenários de
teste"), com os telefones reais do caso de 17/09: o convite saiu para `5585991733321` e a Meta
devolveu a resposta como `558591733321`.
"""
import os
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from academia_enem_porteiro import (  # noqa: E402
    RESPOSTA_CONFIRMOU,
    RESPOSTA_NAO_VAI,
    campanha_aberta,
    classificar_resposta,
    origem_da_resposta,
    registrar_resposta,
    variantes_telefone,
)

TEL_CONVITE = "5585991733321"   # 13 dígitos, como o convite saiu
TEL_RESPOSTA = "558591733321"   # 12 dígitos, como a Meta devolveu
EVENTO = "697646e3-f558-4f4f-a187-f6242f190d5e"
CATEGORIA = "cat-simulado-01"
LEAD_CONVIDADO = "lead-convidado"
LEAD_DUPLICADO = "lead-duplicado"
DISPARO = "disparo-lote-1"


# ── AC2.2 — reconhecer a pessoa, não o texto do telefone ────────────────────

def test_variantes_cobrem_as_duas_escritas_do_caso_real():
    """O defeito de 17/09: `_normalizar_telefone_br` testava `telefone[4] != '9'` e o índice 4
    já era um 9 (do antigo 9173-3321). Aqui as duas direções têm que casar."""
    assert TEL_RESPOSTA in variantes_telefone(TEL_CONVITE)
    assert TEL_CONVITE in variantes_telefone(TEL_RESPOSTA)


def test_formato_inesperado_vira_comparacao_exata():
    assert variantes_telefone("5511987654321012") == ["5511987654321012"]
    assert variantes_telefone("351912345678") == ["351912345678"]


# ── AC3/AC4 — classificação ────────────────────────────────────────────────

@pytest.mark.parametrize("texto,esperado", [
    ("Sim, eu vou!", RESPOSTA_CONFIRMOU),          # rótulo exato do botão
    ("Nao poderei comparecer", RESPOSTA_NAO_VAI),  # rótulo exato do botão
    ("sim, vou", RESPOSTA_CONFIRMOU),
    ("confirmo minha presença", RESPOSTA_CONFIRMOU),
    ("não vou poder ir", RESPOSTA_NAO_VAI),
    ("não sei se confirmo", RESPOSTA_NAO_VAI),     # decisão do Junior: negação manda
    ("qual o endereço?", None),                    # AC4
    ("obrigado pela informação", None),            # AC4
    ("", None),
])
def test_classificacao(texto, esperado):
    assert classificar_resposta(texto) == esperado


def test_origem_botao_vs_texto():
    assert origem_da_resposta("Sim, eu vou!") == "botao"
    assert origem_da_resposta("sim, vou") == "texto"


# ── AC2.1 — a campanha tem fim ─────────────────────────────────────────────

def test_campanha_aberta_respeita_fuso_de_fortaleza():
    cfg = {"fechamento": "2026-09-20T12:00:00-03:00"}
    assert campanha_aberta(cfg, datetime(2026, 9, 20, 14, 59, tzinfo=timezone.utc)) is True
    assert campanha_aberta(cfg, datetime(2026, 9, 20, 15, 1, tzinfo=timezone.utc)) is False


def test_sem_data_configurada_a_campanha_esta_fechada():
    assert campanha_aberta({}) is False


# ── Fake do supabase, só com o que o porteiro usa ──────────────────────────

class _Query:
    def __init__(self, dados):
        self._dados = dados

    def select(self, *_a, **_k):
        return self

    def eq(self, campo, valor):
        self._dados = [r for r in self._dados if r.get(campo) == valor]
        return self

    def in_(self, campo, valores):
        self._dados = [r for r in self._dados if r.get(campo) in valores]
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return MagicMock(data=list(self._dados))


class _FakeSupabase:
    def __init__(self, *, na_categoria=True, entregas=None, leads=None, config=None):
        self.gravado = []
        self.tabelas = {
            "configuracoes": [{"chave": "academia_enem_confirmacao", "valor": config if config is not None else {
                "evento_id": EVENTO,
                "categoria_evento_id": CATEGORIA,
                "fechamento": "2026-09-20T12:00:00-03:00",
                "lotes": {DISPARO: "Lote 1"},
            }}],
            "leads": leads if leads is not None else [
                {"id": LEAD_CONVIDADO, "telefone": TEL_CONVITE},
                {"id": LEAD_DUPLICADO, "telefone": TEL_RESPOSTA},
            ],
            "lead_interesses": ([{"lead_id": LEAD_CONVIDADO, "categoria_id": CATEGORIA}] if na_categoria else []),
            "disparos": [{"id": DISPARO, "evento_id": EVENTO}],
            "logs_disparo": entregas if entregas is not None else [
                {"lead_id": LEAD_CONVIDADO, "disparo_id": DISPARO, "status": "entregue", "created_at": "2026-09-17T01:22:23Z"},
            ],
        }

    def table(self, nome):
        self._atual = nome
        q = _Query(self.tabelas.get(nome, []))
        q.upsert = lambda linha, **_k: self._upsert(linha)  # type: ignore[attr-defined]
        return q

    def _upsert(self, linha):
        self.gravado.append(linha)
        return MagicMock(execute=lambda: MagicMock(data=[linha]))


AGORA_ABERTA = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _congela_o_tempo(monkeypatch):
    """Campanha aberta em todos os cenários, menos onde o teste diz o contrário."""
    import academia_enem_porteiro as mod
    monkeypatch.setattr(mod, "campanha_aberta", lambda cfg, agora=None: True)


def _registrar(fake, mensagem=" Sim, eu vou!", telefone=TEL_RESPOSTA):
    return registrar_resposta(
        fake, lead_id_respondente=LEAD_DUPLICADO, telefone=telefone, mensagem=mensagem.strip(),
    )


# ── Cenários 1, 2, 3, 5 — o caminho feliz ──────────────────────────────────

def test_cenario_1_resposta_do_duplicado_e_anotada_no_lead_convidado():
    fake = _FakeSupabase()
    linha = _registrar(fake)
    assert linha is not None
    assert linha["lead_id"] == LEAD_CONVIDADO          # o que recebeu o convite
    assert linha["lead_respondente_id"] == LEAD_DUPLICADO
    assert linha["resposta"] == RESPOSTA_CONFIRMOU
    assert linha["origem"] == "botao"
    assert linha["lote"] == "Lote 1"


def test_cenario_3_recusa_por_botao():
    fake = _FakeSupabase()
    linha = _registrar(fake, mensagem="Nao poderei comparecer")
    assert linha["resposta"] == RESPOSTA_NAO_VAI


# ── Cenário 4 — mensagem que não é sim nem não ─────────────────────────────

def test_cenario_4_pergunta_qualquer_nao_vira_resposta():
    fake = _FakeSupabase()
    assert _registrar(fake, mensagem="que horas começa?") is None
    assert fake.gravado == []


# ── Cenário 6 — lead fora da campanha ──────────────────────────────────────

def test_cenario_6_lead_fora_da_categoria_se_comporta_como_hoje():
    fake = _FakeSupabase(na_categoria=False)
    assert _registrar(fake) is None
    assert fake.gravado == []


# ── Cenário 7 — na categoria, sem entrega comprovada ───────────────────────

@pytest.mark.parametrize("status", ["enviado", "falhou", "aviso", "apagada"])
def test_cenario_7_sem_entrega_comprovada_nao_anota(status):
    fake = _FakeSupabase(entregas=[
        {"lead_id": LEAD_CONVIDADO, "disparo_id": DISPARO, "status": status, "created_at": "x"},
    ])
    assert _registrar(fake) is None
    assert fake.gravado == []


def test_entrega_de_disparo_de_outro_modulo_nao_conta():
    """Achado 6 do @po: `logs_disparo` é compartilhado — disparo fora do evento não vale."""
    fake = _FakeSupabase(entregas=[
        {"lead_id": LEAD_CONVIDADO, "disparo_id": "disparo-da-divulgacao", "status": "entregue", "created_at": "x"},
    ])
    assert _registrar(fake) is None


# ── Cenário 8 — depois do fechamento ───────────────────────────────────────

def test_cenario_8_depois_do_fechamento_nao_anota(monkeypatch):
    import academia_enem_porteiro as mod
    monkeypatch.setattr(mod, "campanha_aberta", lambda cfg, agora=None: False)
    fake = _FakeSupabase()
    assert _registrar(fake) is None
    assert fake.gravado == []


# ── Cenário 9 — chave ambígua ──────────────────────────────────────────────

def test_cenario_9_dois_convidados_com_a_mesma_chave_nao_anota_nenhum():
    fake = _FakeSupabase()
    fake.tabelas["lead_interesses"] = [
        {"lead_id": LEAD_CONVIDADO, "categoria_id": CATEGORIA},
        {"lead_id": LEAD_DUPLICADO, "categoria_id": CATEGORIA},
    ]
    fake.tabelas["logs_disparo"] = [
        {"lead_id": LEAD_CONVIDADO, "disparo_id": DISPARO, "status": "entregue", "created_at": "b"},
        {"lead_id": LEAD_DUPLICADO, "disparo_id": DISPARO, "status": "entregue", "created_at": "a"},
    ]
    assert _registrar(fake) is None
    assert fake.gravado == []


# ── Porteiro desligado ─────────────────────────────────────────────────────

def test_sem_configuracao_o_porteiro_nao_faz_nada():
    fake = _FakeSupabase()
    fake.tabelas["configuracoes"] = []
    assert _registrar(fake) is None


def test_categoria_nao_configurada_desliga_o_porteiro():
    fake = _FakeSupabase(config={"evento_id": EVENTO, "categoria_evento_id": None})
    assert _registrar(fake) is None


# ── Achado 1 do @qa — mensagem que não é sim nem não não toca no banco ──────

def test_mensagem_irrelevante_nao_faz_nenhuma_consulta():
    """~460 mensagens de lead por dia entram no Institucional; quase nenhuma é resposta da
    campanha. A classificação (que não usa banco) tem que vir antes de qualquer SELECT.

    O falso **conta** as tabelas consultadas em vez de levantar exceção — achado 7 do @qa: a
    primeira versão levantava `AssertionError`, que `carregar_config` engolia no seu próprio
    `try/except Exception`, e o teste passava com a ordem certa E com a errada. Uma lista não é
    engolida por except nenhum.
    """
    class _SupabaseContador:
        def __init__(self):
            self.consultadas: list[str] = []

        def table(self, nome):
            self.consultadas.append(nome)
            return _Query([])

    for texto in ("bom dia", "que horas começa?", "obrigado!", ""):
        fake = _SupabaseContador()
        assert registrar_resposta(
            fake, lead_id_respondente=LEAD_DUPLICADO, telefone=TEL_RESPOSTA, mensagem=texto,
        ) is None
        assert fake.consultadas == [], (
            f"O porteiro consultou {fake.consultadas} para a mensagem {texto!r}, que nunca "
            "viraria resposta da campanha"
        )
