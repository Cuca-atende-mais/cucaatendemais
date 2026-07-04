"""
Testes — Motor de Empregabilidade (S-WM-20: harness mínimo pré-Task 3).

empregabilidade_engine.py faz `from supabase import create_client, Client` no
topo do módulo, e o pacote `supabase` não está instalado neste ambiente de
teste (mesma limitação de campanhas_engine.py — nenhum dos dois tinha suíte
própria antes desta story). Stub mínimo de sys.modules antes do import real
permite testar a lógica interna do módulo (não só o dispatch via módulo fake,
como os testes existentes de meta_adapter_*.py já fazem para outros fins).

Cobre:
- Os 6 cenários de regressão de S-EMP-01-01 já têm suíte própria e completa em
  test_intencao_detector.py (candidato direto, banco de talentos, upload,
  empresa, saudação ambígua, keyword composta) — não duplicados aqui.
- Bug 4 do relatório (intenção invertida) — adicionado a test_intencao_detector.py.
- Bugs 1, 3 e 5 do relatório, caracterizados aqui. Resolvidos pelo classificador
  semântico da Task 3 (S-WM-20): `avaliar_mensagem_contextual` mockado via
  `intencao_detector._chamar_gpt_contextual` para provar a fiação (wiring) —
  a qualidade real do GPT em produção (ele de fato classificar corretamente
  frases ambíguas reais) depende de validação em staging com a API key da Meta
  e OpenAI configuradas, fora do alcance deste ambiente de teste.
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

import empregabilidade_engine as emp  # noqa: E402


def _fluxo_mock(etapa: str, extra: dict | None = None):
    """Substitui _get_fluxo/_set_fluxo por fakes baseados em dict simples —
    mais simples e robusto que mockar a cadeia real de supabase.table('conversas')."""
    estado = {"etapa": etapa, **(extra or {})}

    def _get(conversa_id):
        return dict(estado)

    def _set(conversa_id, novo_fluxo):
        estado.clear()
        estado.update(novo_fluxo)

    return estado, _get, _set


@pytest.fixture(autouse=True)
def _isola_enviar(monkeypatch):
    """Nenhum teste deve tentar enviar HTTP real — captura em vez de disparar."""
    mock_enviar = AsyncMock(return_value=True)
    monkeypatch.setattr(emp, "_enviar", mock_enviar)
    return mock_enviar


# ─────────────────────────────────────────────────────────────────────────────
# Task 2 — escape hatch em aguardando_id_candidato (bug 3, parte corrigida)
# ─────────────────────────────────────────────────────────────────────────────

class TestEscapeHatchAguardandoIdCandidato:

    @pytest.mark.asyncio
    async def test_tchau_agora_encerra_o_fluxo(self, monkeypatch, _isola_enviar):
        """Task 2: exclusão de etapa removida — 'tchau' agora encerra mesmo em
        aguardando_id_candidato (antes ficava preso, bug 3 parcial)."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_id_candidato")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        await emp._processar_candidato(
            "tchau", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1"
        )

        _isola_enviar.assert_called_once()
        texto_enviado = _isola_enviar.call_args.args[3]
        assert "despedida" not in texto_enviado.lower()  # smoke: mensagem de encerramento foi enviada
        assert estado == {}  # _encerrar_fluxo limpa o fluxo

    @pytest.mark.asyncio
    async def test_negacao_mudanca_assunto_ainda_nao_sai_do_estado(self, monkeypatch):
        """Bug 3 (relatório): 'nao nao, sou uma empresa' deveria sair do estado
        aguardando_id_candidato — hoje o classificador semântico (Task 3, S-WM-20)
        reconhece a mudança de assunto e reroteia para o fluxo de empresa, em vez
        de cair no parser sintático e responder 'não encontrei candidatura'."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_id_candidato")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.ilike.return_value \
            .order.return_value.limit.return_value.execute.return_value.data = []
        monkeypatch.setattr(emp, "supabase", mock_sb)

        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector

        async def mock_gpt(texto, perfil, etapa, ultima_msg_bot):
            return {"intencao": "empresa", "quer_sair": False, "mudou_de_assunto": True}

        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt)

        await emp._processar_candidato(
            "nao nao, sou uma empresa", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1"
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "não encontrei candidatura" not in texto_enviado.lower()
        assert estado.get("perfil") == "empresa"
        assert estado.get("etapa") == "aguardando_cnpj"


# ─────────────────────────────────────────────────────────────────────────────
# Bug 5 do relatório — gate sim/não por substring isolada + despedida dupla
# ─────────────────────────────────────────────────────────────────────────────

class TestOfertaBancoTalentos:

    @pytest.mark.asyncio
    async def test_negacao_com_mudanca_assunto_nao_deveria_encerrar(self, monkeypatch):
        """'nao nao, eu sou uma empresa e gostava de subir uma vaga aqui' — frase real
        do relatório e observada ao vivo (conversa 5b437a1b-...) — antes encerrava o
        fluxo pela substring 'nao'. O gate semântico da Task 3 (S-WM-20) reconhece a
        mudança de assunto e reroteia para o fluxo de empresa em vez de encerrar."""
        estado, fake_get, fake_set = _fluxo_mock("oferta_banco_talentos")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector

        async def mock_gpt(texto, perfil, etapa, ultima_msg_bot):
            return {"intencao": "empresa", "quer_sair": False, "mudou_de_assunto": True}

        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt)

        await emp._processar_publico(
            "nao nao, eu sou uma empresa e gostava de subir uma vaga aqui",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado != {}
        assert estado.get("perfil") == "empresa"
        assert estado.get("etapa") == "aguardando_cnpj"

    @pytest.mark.asyncio
    async def test_recusa_dispara_apenas_uma_despedida(self, monkeypatch):
        """Recusa legítima ('não', sem intenção de mudar de assunto) não deveria
        disparar 2 despedidas distintas na mesma transição do branch else de
        oferta_banco_talentos — bug 5 do relatório (mensagem inline + _encerrar_fluxo).
        A Task 3 consolidou o branch else em uma única chamada a _encerrar_fluxo."""
        estado, fake_get, fake_set = _fluxo_mock("oferta_banco_talentos")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector

        async def mock_gpt(texto, perfil, etapa, ultima_msg_bot):
            return {"intencao": "ambiguo", "quer_sair": True, "mudou_de_assunto": False}

        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt)

        await emp._processar_publico(
            "não", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert mock_enviar.call_count == 1

    @pytest.mark.asyncio
    async def test_negacao_com_keyword_banco_nao_cai_no_fast_path(self, monkeypatch):
        """Risco residual apontado pelo @qa no gate da Task 3/4 (S-WM-20 Task 5):
        'não quero banco de talentos, sou uma empresa' contém 'banco'/'talentos'/
        'quero', batendo no fast-path `quer_banco` por keyword ANTES de chegar ao
        gate semântico — roteava errado para coleta de nome do banco de talentos
        mesmo com negação e mudança de assunto explícitas. Reproduzido com uma
        simulação pura da condição (sem LLM) confirmando `quer_banco=True` antes
        do fix. Corrigido: presença de negação desativa o fast-path."""
        estado, fake_get, fake_set = _fluxo_mock("oferta_banco_talentos")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector

        async def mock_gpt(texto, perfil, etapa, ultima_msg_bot):
            return {"intencao": "empresa", "quer_sair": False, "mudou_de_assunto": True}

        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt)

        await emp._processar_publico(
            "não quero banco de talentos, sou uma empresa e queria divulgar uma vaga",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") != "coletando_nome_candidato"
        assert estado.get("perfil") == "empresa"
        assert estado.get("etapa") == "aguardando_cnpj"

    @pytest.mark.asyncio
    async def test_aceite_simples_sem_negacao_usa_fast_path_sem_llm(self, monkeypatch):
        """Caso comum (sem negação) deve continuar usando o fast-path por keyword,
        sem chamar o LLM — preserva o custo/latência do atalho para a maioria dos
        casos, só desativado quando há negação (risco residual corrigido acima)."""
        estado, fake_get, fake_set = _fluxo_mock("oferta_banco_talentos")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector

        async def mock_gpt_nao_deveria_ser_chamado(texto, perfil, etapa, ultima_msg_bot):
            raise AssertionError("LLM não deveria ser chamado no fast-path")

        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt_nao_deveria_ser_chamado)

        await emp._processar_publico(
            "sim, quero", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") == "coletando_nome_candidato"
        assert estado.get("banco_talentos") is True


# ─────────────────────────────────────────────────────────────────────────────
# Bug 1 do relatório — fallback ambíguo no primeiro contato
# ─────────────────────────────────────────────────────────────────────────────

class TestFallbackAmbiguoPrimeiroContato:

    @pytest.mark.asyncio
    async def test_ambiguo_mostra_menu_determinístico_em_vez_de_pedir_cnpj(self, monkeypatch):
        """Bug 1 (relatório): antes, uma mensagem ambígua na primeira interação
        podia ser mal-classificada (ex.: 'empresa' sem confiança real) e o fluxo
        pulava direto para pedir CNPJ. Agora, quando o classificador retorna
        'ambiguo', o fluxo oferece o menu numérico determinístico em vez de uma
        pergunta aberta sem rede de segurança."""
        estado, fake_get, fake_set = _fluxo_mock("inicio")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._rotear_por_intencao(
            {"intencao": "ambiguo", "nome": None},
            "bom dia", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "CNPJ" not in texto_enviado
        assert "1️⃣" in texto_enviado
        assert estado.get("etapa") == "menu_inicial"


# ─────────────────────────────────────────────────────────────────────────────
# S-WM-20 Task 5 — risco residual: _quer_banco_talentos (SQS-53) intercepta
# antes de qualquer etapa, com o mesmo problema de substring isolada do bug 5
# ─────────────────────────────────────────────────────────────────────────────

class TestQuerBancoTalentosNegacao:

    def test_negacao_explicita_nao_dispara_correcao_sqs53(self):
        """'não quero banco de talentos, sou uma empresa...' batia em 'banco de
        talentos' e disparava a correção de rota da SQS-53 (_quer_banco_talentos)
        ANTES de qualquer dispatch por etapa — interceptando a mensagem antes até
        do gate semântico de oferta_banco_talentos (Task 3) ter chance de rodar.
        Encontrado ao testar o risco residual apontado pelo @qa: a correção local
        em oferta_banco_talentos não era suficiente porque esse guard roda antes."""
        assert emp._quer_banco_talentos(
            "não quero banco de talentos, sou uma empresa e queria divulgar uma vaga",
            "listou_vagas", {},
        ) is False

    def test_frase_legitima_com_nao_continua_funcionando(self):
        """Guarda contra regressão do próprio fix: 'não encontrei' e 'não tem
        nada' são gatilhos legítimos da SQS-53 que já contêm 'não'/'nao' por
        design — um filtro cego de negação quebraria exatamente o cenário que a
        SQS-53 existe para cobrir (Task 5 exige não regredir esse patch)."""
        assert emp._quer_banco_talentos("não encontrei nenhuma vaga que me interessou", "listou_vagas", {}) is True
        assert emp._quer_banco_talentos("não tem nada pra mim aqui", "listou_vagas", {}) is True

    def test_correcao_legitima_sem_negacao_continua_funcionando(self):
        """Cenário original da SQS-53 (sem negação) preservado: lead erra o menu
        inicial e depois escreve 'banco de talentos' — ainda redireciona."""
        assert emp._quer_banco_talentos("banco de talentos", "listou_vagas", {}) is True
