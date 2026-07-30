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
        reconhece a mudança de assunto e pergunta confirmação de troca de rota
        (ajuste 3, Task 5) em vez de cair no parser sintático e responder 'não
        encontrei candidatura'. Migrado para `_escape_semantico_ou_none` — antes
        desta migração, esta etapa reroteava em silêncio (cópia inline mais
        antiga que o helper compartilhado)."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_id_candidato")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.ilike.return_value \
            .order.return_value.limit.return_value.execute.return_value.data = []
        # Neutraliza o check de "convite de entrevista pendente" (SQS-40), que
        # roda incondicionalmente no topo de processar_mensagem_empregabilidade
        # (chamado abaixo para confirmar a troca de rota).
        mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
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
        assert "sim" in texto_enviado.lower()
        assert estado.get("etapa") == "confirmando_troca_rota"

        # Confirma a troca ("sim") — só então o reroteamento acontece de fato.
        mock_enviar.reset_mock()
        await emp.processar_mensagem_empregabilidade(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )
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
        mudança de assunto e pergunta confirmação (ajuste 3, Task 5) em vez de
        encerrar. Migrado para `_escape_semantico_ou_none` (antes era cópia inline
        mais antiga que o helper, sem a pergunta de confirmação)."""
        estado, fake_get, fake_set = _fluxo_mock("oferta_banco_talentos")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        monkeypatch.setattr(emp, "supabase", mock_sb)

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
        assert estado.get("etapa") == "confirmando_troca_rota"

        await emp.processar_mensagem_empregabilidade(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )
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
        do fix. Corrigido: presença de negação desativa o fast-path. Migrado para
        `_escape_semantico_ou_none` — agora pergunta confirmação (ajuste 3) antes
        de trocar de rota."""
        estado, fake_get, fake_set = _fluxo_mock("oferta_banco_talentos")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        monkeypatch.setattr(emp, "supabase", mock_sb)

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

        assert estado.get("etapa") == "confirmando_troca_rota"

        await emp.processar_mensagem_empregabilidade(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
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

    @pytest.mark.asyncio
    async def test_ambiguo_define_menu_inicial_com_dígito_restaurado(self, monkeypatch):
        """REGRESSÃO CRÍTICA (staging, 2026-07-04): a 1ª versão desta correção
        setava etapa='menu_inicial', cujo fallback fazia correspondência EXATA
        sem entender frase livre — uma mensagem ambígua travava a conversa. O
        fix daquela vez removeu o `_set_fluxo`, mas isso também quebrou o
        atalho de dígito puro (Junior encontrou: '3' voltava a mostrar o
        mesmo menu, sem nunca virar 'vagas'). S-WM-20 Task 5 (ajuste 1): o
        fallback de menu_inicial agora chama o classificador semântico em vez
        de travar — por isso voltou a ser seguro setar essa etapa aqui,
        restaurando o atalho de dígito. Ver TestMenuInicialFallbackSemantico
        para a prova de que o fallback não trava mais."""
        estado, fake_get, fake_set = _fluxo_mock("inicio")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._rotear_por_intencao(
            {"intencao": "ambiguo", "nome": None},
            "bom dia", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") == "menu_inicial"

    @pytest.mark.asyncio
    async def test_ambiguo_usa_saudacao_diferente_na_primeira_interacao(self, monkeypatch):
        """Apontamento do usuário: a mensagem 'Não entendi bem o que você
        precisa' não faz sentido quando é literalmente a 1ª mensagem da
        conversa (nada foi dito antes pra não ter sido entendido). Distingue
        via _ultima_mensagem_bot (None = nenhuma mensagem do bot ainda)."""
        estado, fake_get, fake_set = _fluxo_mock("inicio")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        monkeypatch.setattr(emp, "_ultima_mensagem_bot", lambda conversa_id: None)

        await emp._rotear_por_intencao(
            {"intencao": "ambiguo", "nome": None},
            "oi", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "Não entendi" not in texto_enviado
        assert "1️⃣" in texto_enviado


class TestMenuInicialFallbackSemantico:

    @pytest.mark.asyncio
    async def test_digito_puro_seleciona_a_opcao_sem_chamar_llm(self, monkeypatch):
        """Achado do Junior em staging: '3' (dígito puro) repetia o menu
        ambíguo em vez de escolher a opção 3 (Vagas). Confirma que o atalho
        determinístico continua funcionando sem chamar o LLM."""
        estado, fake_get, fake_set = _fluxo_mock("menu_inicial")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector

        async def _llm_nao_deveria_ser_chamado(texto, perfil, etapa, ultima_msg_bot):
            raise AssertionError("LLM não deveria ser chamado no atalho de dígito")

        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _llm_nao_deveria_ser_chamado)

        await emp._processar_menu_inicial(
            "3", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("perfil") == "publico"

    @pytest.mark.asyncio
    async def test_frase_livre_nao_reconhecida_nao_trava_mais(self, monkeypatch):
        """A causa raiz real do achado do Junior: o fallback de menu_inicial
        fazia só correspondência EXATA e travava em qualquer frase livre —
        agora chama o classificador semântico em vez de repetir o mesmo menu
        para sempre."""
        estado, fake_get, fake_set = _fluxo_mock("menu_inicial")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(
            intencao_detector, "_chamar_gpt_contextual",
            _mock_gpt(intencao="empresa"),
        )

        await emp._processar_menu_inicial(
            "gostaria de saber como faço para abrir uma vaga",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "Não entendi sua resposta" not in texto_enviado
        assert estado.get("perfil") == "empresa"
        assert estado.get("etapa") == "aguardando_cnpj"


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


# ─────────────────────────────────────────────────────────────────────────────
# S-WM-20 Task 5 — Hibridismo (parser-primeiro, semântica-na-falha) em todas
# as etapas de texto livre, achado adicional do Junior em staging: o escape
# hatch só cobria aguardando_id_candidato e oferta_banco_talentos; qualquer
# outra etapa com parser rígido (aguardando_cnpj, e-mail, telefone, menus por
# match exato) tinha o mesmo problema. Amostra representativa das ~14 etapas
# corrigidas — não exaustiva, mas cobre os padrões (a) parser-falha→semântico
# e (b) quer_sair de alta precisão em estados de nome livre.
# ─────────────────────────────────────────────────────────────────────────────

def _mock_gpt(intencao=None, quer_sair=False, mudou_de_assunto=False):
    async def _fn(texto, perfil, etapa, ultima_msg_bot):
        return {"intencao": intencao, "quer_sair": quer_sair, "mudou_de_assunto": mudou_de_assunto}
    return _fn


class TestEscapeHatchAguardandoCnpj:

    @pytest.mark.asyncio
    async def test_negacao_com_mudanca_assunto_pergunta_confirmacao_antes_de_trocar_rota(self, monkeypatch):
        """Achado do Junior em staging (teste real via WhatsApp): 'nao nao, eu
        sou uma empresa e gostava de subir uma vaga aqui' e 'no, quero fazer
        uma candidatura' repetiam 'CNPJ inválido' para sempre em
        aguardando_cnpj — _frases_nao_empresa só cobre NEGAÇÃO de ser empresa,
        não afirmação com mudança de assunto. Parser (14 dígitos) falha →
        classificador semântico assume. S-WM-20 Task 5 (ajuste 3): em vez de
        trocar de rota em silêncio, agora pergunta confirmação antes."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_cnpj", {"perfil": "empresa"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(
            intencao_detector, "_chamar_gpt_contextual",
            _mock_gpt(intencao="candidato_vaga", mudou_de_assunto=True),
        )

        await emp._processar_empresa(
            "no, quero fazer uma candidatura",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "CNPJ inválido" not in texto_enviado
        assert "candidatar" in texto_enviado.lower()
        assert "sim" in texto_enviado.lower()
        assert estado.get("etapa") == "confirmando_troca_rota"
        assert estado.get("_troca_rota_pendente", {}).get("intencao") == "candidato_vaga"

    @pytest.mark.asyncio
    async def test_confirmar_troca_de_rota_com_sim_executa_o_reroteamento(self, monkeypatch):
        """Continuação do cenário acima: depois da pergunta de confirmação, o
        lead responde 'sim' — só então a troca de rota acontece de fato."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_troca_rota", {
            "_troca_rota_pendente": {"intencao": "candidato_vaga", "quer_sair": False, "mudou_de_assunto": True, "nome": None},
            "_troca_rota_unidade_cuca": "Barra",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        # Neutraliza o check de "convite de entrevista pendente" (SQS-40),
        # que roda antes desta etapa em processar_mensagem_empregabilidade —
        # sem isso, o MagicMock de supabase faz `cands_convite` parecer não
        # vazio e "sim" seria interpretado (errado) como confirmação de entrevista.
        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp.processar_mensagem_empregabilidade(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("perfil") == "publico"

    @pytest.mark.asyncio
    async def test_nao_confirmar_troca_de_rota_mostra_menu_sem_travar(self, monkeypatch):
        """Se o lead não confirmar com um 'sim' claro, não trava repetindo a
        pergunta — volta pro menu geral."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_troca_rota", {
            "_troca_rota_pendente": {"intencao": "candidato_vaga", "quer_sair": False, "mudou_de_assunto": True, "nome": None},
            "_troca_rota_unidade_cuca": "Barra",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp.processar_mensagem_empregabilidade(
            "não, deixa quieto", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "1️⃣" in texto_enviado
        assert estado == {}

    @pytest.mark.asyncio
    async def test_frase_nao_empresa_nao_trava_mais_em_menu_inicial(self, monkeypatch):
        """Regressão da mesma classe já corrigida em _rotear_por_intencao: o
        escape de 'não sou empresa' aqui também setava etapa='menu_inicial'
        (match exato, sem entender frase livre) — travava a conversa. Corrigido
        para não definir nenhum fluxo."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_cnpj", {"perfil": "empresa"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_empresa(
            "não sou empresa", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") != "menu_inicial"
        assert estado == {}


class TestEscapeHatchMenuEmpresaAcoes:

    @pytest.mark.asyncio
    async def test_resposta_nao_reconhecida_nao_encerra_direto(self, monkeypatch):
        """Antes, qualquer texto fora do match exato ('1'/'nova vaga'/etc.)
        encerrava a conversa direto via _encerrar_fluxo — o caso mais agressivo
        de todos (nem repetia o menu, simplesmente acabava a conversa)."""
        estado, fake_get, fake_set = _fluxo_mock("menu_empresa_acoes", {"perfil": "empresa", "empresa_id": "e1"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(intencao="ambiguo"))

        await emp._processar_empresa(
            "quero ver como estao indo minhas vagas por favor",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "Até logo" not in texto_enviado
        assert estado != {}  # não encerrou o fluxo


class TestEscapeHatchNomeLivre:

    @pytest.mark.asyncio
    async def test_quer_sair_explicito_encerra_em_vez_de_aceitar_como_nome(self, monkeypatch):
        """Categoria (b): quer_sair de alta precisão — se o lead claramente
        pede pra sair no meio da coleta do nome, não deve engolir a frase como
        se fosse o nome dele."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_candidato", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=True))

        await emp._processar_publico(
            "na verdade desiste, obrigado", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "Esse currículo é para" not in texto_enviado  # não seguiu como se fosse nome
        assert estado == {}

    @pytest.mark.asyncio
    async def test_nome_incomum_nao_e_confundido_com_saida(self, monkeypatch):
        """Guarda contra falso-positivo: um nome incomum deve continuar sendo
        aceito normalmente — categoria (b) só checa quer_sair, nunca
        mudou_de_assunto (que teria mais falso-positivo aqui)."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_candidato", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "Xisto Wenceslau", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "Xisto Wenceslau" in texto_enviado
        assert estado.get("etapa") == "confirmando_terceiro"


# ─────────────────────────────────────────────────────────────────────────────
# Achados de auditoria (2026-07-09) — _quer_encerrar por substring sem limite
# de palavra, sem exceção nenhuma no fluxo de candidato; e negação ignorada em
# pos_candidatura (mesma classe de bug já corrigida em oferta_banco_talentos).
# ─────────────────────────────────────────────────────────────────────────────

class TestQuerEncerrarSubstringSemLimiteDePalavra:

    @pytest.mark.asyncio
    async def test_obrigado_no_meio_de_pergunta_nao_deveria_encerrar_candidato(self, monkeypatch):
        """_quer_encerrar (empregabilidade_engine.py:191-193) casa 'obrigado'
        como substring solta, sem checar limite de palavra nem se é a frase
        inteira. Em _processar_candidato (candidato_consultado) não há
        nenhuma exceção de etapa (diferente de pos_candidatura, que já tem
        exceção documentada como S37C-03) — uma mensagem de agradecimento que
        claramente CONTINUA a conversa ('muito obrigado! mas ainda tenho uma
        dúvida...') encerra o fluxo na hora, antes até de a etapa
        candidato_consultado ter chance de rodar seu próprio escape semântico."""
        estado, fake_get, fake_set = _fluxo_mock("candidato_consultado", {"perfil": "candidato"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_candidato(
            "muito obrigado! mas ainda queria saber se posso mudar meu telefone de contato",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert estado != {}, (
            "fluxo foi encerrado (_encerrar_fluxo limpa o estado) por causa da substring "
            "'obrigado', mesmo a mensagem claramente pedindo pra continuar"
        )
        assert "Boa sorte" not in texto_enviado  # mensagem de despedida do _encerrar_fluxo


class TestPosCandidaturaNegacaoIgnorada:

    @pytest.mark.asyncio
    async def test_nao_quero_mais_vagas_nao_deveria_reabrir_busca_de_vagas(self, monkeypatch):
        """Em pos_candidatura (empregabilidade_engine.py:1585-1601), 'quero'
        como substring marca quer_mais_vagas=True sem checar negação — 'não
        quero mais vagas, obrigado' contém 'quero' e é lido como pedido de
        mais vagas. A etapa seguinte (oferta_banco_talentos, linhas 1626-1629)
        já tem a proteção de negação para exatamente esse padrão, com
        comentário explicando o motivo — só não foi aplicada de volta aqui."""
        estado, fake_get, fake_set = _fluxo_mock("pos_candidatura", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        mock_sb = MagicMock()
        # Listagem de vagas abertas (fallthrough de _processar_publico)
        mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []
        # Candidaturas já feitas por este telefone
        mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_publico(
            "não quero mais vagas, obrigado",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "vagas abertas" not in texto_enviado.lower(), (
            "negação ('não quero mais vagas') foi ignorada e o fluxo reabriu a busca "
            "de vagas em vez de reconhecer que o lead está recusando"
        )


class TestMenuPosVagaReinterpretaResposta:

    @pytest.mark.asyncio
    async def test_resposta_3_para_encerrar_e_reinterpretada_como_editar_vaga(self, monkeypatch):
        """menu_pos_vaga oferece '3 = Encerrar', mas o dispatch
        (empregabilidade_engine.py:1101-1106) só troca a etapa para
        menu_empresa_acoes e reprocessa o MESMO texto ('3') contra um menu
        diferente, onde '3 = Editar uma vaga'. Uma empresa que responde '3'
        querendo encerrar acaba, sem saber, no fluxo de edição de vaga."""
        estado, fake_get, fake_set = _fluxo_mock(
            "menu_pos_vaga", {"perfil": "empresa", "empresa_id": "e1"}
        )
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        mock_sb = MagicMock()
        # _listar_vagas_para_acao: table("vagas").select(...).eq(...).not_.in_(...).order(...).limit(...).execute()
        mock_sb.table.return_value.select.return_value.eq.return_value.not_.in_.return_value \
            .order.return_value.limit.return_value.execute.return_value.data = []
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_empresa(
            "3", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert estado.get("etapa") != "selecionando_vaga_edicao", (
            "resposta '3' (que no menu de menu_pos_vaga significa 'Encerrar') foi "
            "reinterpretada contra o menu de menu_empresa_acoes, onde '3' significa "
            "'Editar uma vaga' — a empresa queria encerrar e caiu no fluxo de edição"
        )


# ─────────────────────────────────────────────────────────────────────────────
# BUG-01 (Plano 003) — aguardando_retorno_selecao sem handler síncrono
# ─────────────────────────────────────────────────────────────────────────────

class TestAguardandoRetornoSelecao:

    @pytest.mark.asyncio
    async def test_aguardando_retorno_selecao_com_mensagem_manual_nao_reseta_empresa(self, monkeypatch):
        """BUG-01: sem o handler desta etapa, qualquer mensagem manual do usuário
        caía no fallback genérico (`:1113-1115`), que reseta o fluxo pra
        solicitar_cnpj e perde empresa_id/contexto todo. O handler novo deve
        tratar 'oi' como lembrete de que o formulário do portal ainda não foi
        preenchido, sem resetar nada."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_retorno_selecao", {
            "perfil": "empresa", "empresa_id": "e1", "empresa_nome": "ACME",
            "cnpj": "12345678000199",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_empresa(
            "oi", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") == "aguardando_retorno_selecao", (
            "fluxo foi resetado (fallback genérico) em vez de tratar a etapa "
            "aguardando_retorno_selecao — empresa_id/contexto perdido"
        )
        texto_enviado = mock_enviar.call_args.args[3]
        assert "aguardando o preenchimento" in texto_enviado.lower()

    @pytest.mark.asyncio
    async def test_aguardando_retorno_selecao_com_selecao_ja_confirmada_avanca_para_menu(self, monkeypatch):
        """Quando o portal já gravou vaga_criada_id/vaga_numero/vaga_titulo (campo
        compartilhado com vaga, usado também pra seleção — confirmado em
        selecao/route.ts e no notify_loop, :2679), a mensagem manual do usuário
        deve mostrar a confirmação e avançar pra menu_pos_vaga, preservando
        empresa_id."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_retorno_selecao", {
            "perfil": "empresa", "empresa_id": "e1", "empresa_nome": "ACME",
            "empresa_nome_exibicao": "ACME", "cnpj": "12345678000199",
            "vaga_criada_id": "00000000-0000-0000-0000-0000000000ab",
            "vaga_numero": 42, "vaga_titulo": "Processo Seletivo — ACME",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_empresa(
            "oi", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") == "menu_pos_vaga"
        assert estado.get("empresa_id") == "e1", "empresa_id não pode se perder ao confirmar a seleção"
        texto_enviado = mock_enviar.call_args.args[3]
        assert "processo seletivo" in texto_enviado.lower()
        assert "#42" in texto_enviado

    @pytest.mark.asyncio
    async def test_aguardando_retorno_vaga_continua_funcionando_igual(self, monkeypatch):
        """Regressão: o novo bloco de aguardando_retorno_selecao não deve afetar
        o comportamento já existente de aguardando_retorno_vaga."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_retorno_vaga", {
            "perfil": "empresa", "empresa_id": "e1", "empresa_nome": "ACME",
            "cnpj": "12345678000199",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_empresa(
            "oi", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") == "aguardando_retorno_vaga"
        texto_enviado = mock_enviar.call_args.args[3]
        assert "aguardando o preenchimento" in texto_enviado.lower()


# ─────────────────────────────────────────────────────────────────────────────
# SEC-02 (Plano 002) — consulta de candidatura para de vazar dado de terceiro
# ─────────────────────────────────────────────────────────────────────────────

async def _mock_gpt_ambiguo_sem_escape(texto, perfil, etapa, ultima_msg_bot):
    return {"intencao": "ambiguo", "quer_sair": False, "mudou_de_assunto": False}


class TestConsultaCandidaturaExigeTelefoneDeQuemPergunta:

    @pytest.mark.asyncio
    async def test_busca_por_telefone_so_retorna_candidatura_do_proprio_telefone(self, monkeypatch):
        """SEC-02: telefone digitado bate com uma candidatura real, mas o dono
        dessa candidatura NÃO é quem está mandando a mensagem (phone
        diferente) — não deve vazar a candidatura de terceiro."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_id_candidato", {"perfil": "candidato"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt_ambiguo_sem_escape)

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.order.return_value.limit.return_value \
            .execute.return_value.data = [
                {"id": "c1", "status": "pendente", "vaga_id": "v1", "created_at": "2026-01-01",
                 "observacoes": "", "telefone": "8511112222"},
            ]
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_candidato(
            "8599990000", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "não encontrei candidatura" in texto_enviado.lower(), (
            "candidatura de outro telefone vazou pra quem não é o dono dela"
        )

    @pytest.mark.asyncio
    async def test_busca_por_telefone_retorna_quando_bate_com_proprio_telefone(self, monkeypatch):
        """Caso legítimo: telefone de quem pergunta bate com o telefone da
        candidatura — deve continuar funcionando normalmente (não regrediu)."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_id_candidato", {"perfil": "candidato"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt_ambiguo_sem_escape)

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.order.return_value.limit.return_value \
            .execute.return_value.data = [
                {"id": "c1", "status": "pendente", "vaga_id": "v1", "created_at": "2026-01-01",
                 "observacoes": "", "telefone": "8599990000"},
            ]
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value.data = {"titulo": "Vaga Teste"}
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_candidato(
            "8599990000", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1",
        )

        todo_texto_enviado = "\n".join(c.args[3] for c in mock_enviar.call_args_list).lower()
        assert "não encontrei candidatura" not in todo_texto_enviado, (
            "candidatura legítima (mesmo telefone) deveria continuar sendo encontrada"
        )
        assert "encontrada" in todo_texto_enviado

    @pytest.mark.asyncio
    async def test_busca_por_nome_nao_retorna_candidatura_de_telefone_diferente(self, monkeypatch):
        """SEC-02: nome bate, mas o telefone da candidatura é diferente do
        telefone de quem pergunta — não deve vazar."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_id_candidato", {"perfil": "candidato"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt_ambiguo_sem_escape)

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.ilike.return_value.order.return_value \
            .limit.return_value.execute.return_value.data = [
                {"id": "c1", "status": "pendente", "vaga_id": "v1", "created_at": "2026-01-01",
                 "observacoes": "", "nome": "Xisto Wenceslau", "telefone": "8511112222"},
            ]
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_candidato(
            "Xisto Wenceslau", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "não encontrei candidatura" in texto_enviado.lower(), (
            "candidatura de outro telefone vazou por busca de nome, mesmo o nome batendo"
        )

    @pytest.mark.asyncio
    async def test_busca_por_nome_retorna_quando_telefone_tambem_bate(self, monkeypatch):
        """Caso legítimo: nome bate E o telefone de quem pergunta bate com o
        telefone da candidatura — continua funcionando."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_id_candidato", {"perfil": "candidato"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt_ambiguo_sem_escape)

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.ilike.return_value.order.return_value \
            .limit.return_value.execute.return_value.data = [
                {"id": "c1", "status": "pendente", "vaga_id": "v1", "created_at": "2026-01-01",
                 "observacoes": "", "nome": "Xisto Wenceslau", "telefone": "8599990000"},
            ]
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value.data = {"titulo": "Vaga Teste"}
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_candidato(
            "Xisto Wenceslau", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1",
        )

        todo_texto_enviado = "\n".join(c.args[3] for c in mock_enviar.call_args_list).lower()
        assert "não encontrei candidatura" not in todo_texto_enviado
        assert "encontrada" in todo_texto_enviado

    @pytest.mark.asyncio
    async def test_busca_por_codigo_referencia_continua_funcionando_sem_checar_telefone(self, monkeypatch):
        """Regressão: busca por código de referência (6 chars, token-based) NÃO
        exige bater telefone — fora de escopo deste plano, já é razoavelmente
        segura (só quem recebeu a confirmação da candidatura teria o código)."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_id_candidato", {"perfil": "candidato"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt_ambiguo_sem_escape)

        mock_sb = MagicMock()
        # id termina em "AB12CD" (case-insensitive, comparado em upper())
        mock_sb.table.return_value.select.return_value.order.return_value.limit.return_value \
            .execute.return_value.data = [
                {"id": "00000000-0000-0000-0000-0000ab12cd", "status": "pendente", "vaga_id": "v1",
                 "created_at": "2026-01-01", "observacoes": "", "telefone": "8511112222"},
            ]
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value.data = {"titulo": "Vaga Teste"}
        monkeypatch.setattr(emp, "supabase", mock_sb)

        # Telefone de quem pergunta é DIFERENTE do telefone da candidatura —
        # e ainda assim deve encontrar, porque código de referência não checa telefone.
        await emp._processar_candidato(
            "AB12CD", "559999998888", "PHONE_ID", "token", "lead-1", "conv-1",
        )

        todo_texto_enviado = "\n".join(c.args[3] for c in mock_enviar.call_args_list).lower()
        assert "não encontrei candidatura" not in todo_texto_enviado, (
            "busca por código de referência não deveria exigir telefone bater"
        )
        assert "encontrada" in todo_texto_enviado

    @pytest.mark.asyncio
    async def test_busca_por_telefone_bate_mesmo_com_candidaturas_telefone_formatado(self, monkeypatch):
        """Decisão do sócio (2026-07-29): candidaturas.telefone tem formatação
        inconsistente em produção (46 puro-dígito, 78 formatadas). A
        normalização precisa cobrir os 2 lados — não só o `phone` do webhook."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_id_candidato", {"perfil": "candidato"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt_ambiguo_sem_escape)

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.order.return_value.limit.return_value \
            .execute.return_value.data = [
                {"id": "c1", "status": "pendente", "vaga_id": "v1", "created_at": "2026-01-01",
                 "observacoes": "", "telefone": "(85) 9999-0000"},
            ]
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value \
            .execute.return_value.data = {"titulo": "Vaga Teste"}
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_candidato(
            "8599990000", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1",
        )

        todo_texto_enviado = "\n".join(c.args[3] for c in mock_enviar.call_args_list).lower()
        assert "não encontrei candidatura" not in todo_texto_enviado, (
            "telefone formatado no banco não deveria impedir o match com o phone normalizado"
        )
        assert "encontrada" in todo_texto_enviado
