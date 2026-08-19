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
import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

if "supabase" not in sys.modules:
    _fake_supabase_pkg = types.ModuleType("supabase")
    _fake_supabase_pkg.create_client = MagicMock(return_value=MagicMock())
    _fake_supabase_pkg.Client = MagicMock
    sys.modules["supabase"] = _fake_supabase_pkg

import empregabilidade_engine as emp  # noqa: E402


@pytest.fixture(autouse=True)
def _classificador_troca_rota_ia_default(monkeypatch):
    """S-EMP-AUD-028: por padrão, em toda a suíte, o fallback de IA de troca de
    rota (`_classificar_troca_rota_ia`, usado por `_escape_literal_ou_none`
    quando o fast-path literal não bate) classifica como 'nome_valido' — evita
    chamada de rede real em testes que não têm relação com esse mecanismo
    (mesmo padrão do `_debounce_instantaneo` em conftest.py). Testes que
    efetivamente exercitam a classificação sobrescrevem este mock."""
    monkeypatch.setattr(
        emp, "_chamar_ia_classificar_troca_rota",
        AsyncMock(return_value={"classificacao": "nome_valido"}),
    )


def test_assinar_link_portal_inclui_sig_e_exp(monkeypatch):
    monkeypatch.setattr(emp, "PORTAL_URL", "https://portal.test")
    monkeypatch.setattr(emp, "_LINK_SECRET", "segredo-teste")

    link = emp._assinar_link_portal(
        "/empregabilidade/candidatura",
        {"nome": "Fulano de Tal", "origem_tel": "558599999999"},
    )

    assert link.startswith("https://portal.test/empregabilidade/candidatura?")
    assert "nome=Fulano+de+Tal" in link
    assert "origem_tel=558599999999" in link
    assert "exp=" in link
    assert "sig=" in link


@pytest.mark.asyncio
async def test_lock_fluxo_impede_notify_de_sobrescrever_dispatch(monkeypatch):
    conversa_id = "conv-lock-bloco-05"
    estado = {"etapa": "aguardando_retorno_vaga", "empresa_id": "emp-1"}

    def _get(_conversa_id):
        return dict(estado)

    def _set(_conversa_id, novo_fluxo):
        estado.clear()
        estado.update(novo_fluxo)

    monkeypatch.setattr(emp, "_get_fluxo", _get)
    monkeypatch.setattr(emp, "_set_fluxo", _set)

    async def dispatch_normal():
        async with emp._fluxo_lock_context(conversa_id):
            await asyncio.sleep(0.01)
            await emp._set_fluxo_async(
                conversa_id,
                {"etapa": "menu_empresa_acoes", "origem": "dispatch"},
            )

    async def notify_loop_stale():
        await asyncio.sleep(0.001)
        return await emp._set_fluxo_async(
            conversa_id,
            {"etapa": "menu_empresa_acoes", "origem": "notify"},
            etapa_esperada="aguardando_retorno_vaga",
        )

    _, notify_escreveu = await asyncio.gather(dispatch_normal(), notify_loop_stale())

    assert notify_escreveu is False
    assert estado == {"etapa": "menu_empresa_acoes", "origem": "dispatch"}


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


# ─────────────────────────────────────────────────────────────────────────────
# S-EMP-AUD-025 — copy do menu principal reescrita (separa Empresa de
# Candidato), consolidação da 2ª cópia duplicada em aguardando_cnpj.
# ─────────────────────────────────────────────────────────────────────────────

class TestS_EMP_AUD_025CopyMenuPrincipal:

    _COPY_FINAL = (
        "1️⃣ *Sou Empresa* — Quero divulgar uma vaga ou marcar seleção\n\n\n"
        "2️⃣ *Verificar como esta minha candidatura* - Quero acompanhar minha candidatura\n\n"
        "3️⃣ *Ver Vagas Abertas* — Quero ver vagas abertas\n\n"
        "4️⃣ *Enviar Currículo Banco de Talentos* — Quero deixar meu currículo (arquivo pronto) "
        "para futuras oportunidades\n\n"
        "5️⃣ *Criar meu Currículo agora* — Não tenho currículo pronto, quero montar um pelo celular\n\n"
        "Digite *1*, *2*, *3*, *4* ou *5*, ou simplesmente me conte o que você precisa."
    )

    @pytest.mark.asyncio
    async def test_texto_exato_da_copy_final_no_menu_inicial(self, monkeypatch):
        """AC1/AC2 — texto verbatim da versão final da story (seção 2),
        incluindo a linha em branco dupla entre a opção 1 e a 2, e
        'Talentos' (não 'Taletos')."""
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._mostrar_menu_opcoes(
            "PHONE_ID", "token", "558599990000", "conv-1", "lead-1",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert texto_enviado == f"Escolha uma das opções:\n\n{self._COPY_FINAL}"
        assert "Taletos" not in texto_enviado
        assert "Talentos" in texto_enviado

    @pytest.mark.asyncio
    async def test_copia_duplicada_em_aguardando_cnpj_agora_usa_a_mesma_fonte(self, monkeypatch):
        """AC3 — a 2ª ocorrência (fallback 'não sou empresa' durante coleta
        de CNPJ) não duplica mais o texto: chama `_mostrar_menu_opcoes`, com
        a mesma copy final (intro personalizada, resto idêntico)."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_cnpj", {"perfil": "empresa"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_empresa(
            "não sou empresa", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert texto_enviado == (
            "Sem problema! 😊 Vamos recomeçar.\n\nComo posso te ajudar?\n\n" + self._COPY_FINAL
        )
        assert estado == {}

    @pytest.mark.asyncio
    async def test_opcoes_1_2_3_continuam_chamando_o_mesmo_handler(self, monkeypatch):
        """AC4 — a copy nova não muda quantidade/ordem/roteamento das opções
        1 (empresa), 2 (candidato) e 3 (vagas), só o texto."""
        handlers_esperados = {
            "1": "_processar_empresa",
            "2": "_processar_candidato",
            "3": "_processar_publico",
        }
        for opcao, nome_handler in handlers_esperados.items():
            estado, fake_get, fake_set = _fluxo_mock("menu_inicial")
            monkeypatch.setattr(emp, "_get_fluxo", fake_get)
            monkeypatch.setattr(emp, "_set_fluxo", fake_set)
            mock_handler = AsyncMock(return_value=None)
            monkeypatch.setattr(emp, nome_handler, mock_handler)

            await emp._processar_menu_inicial(
                opcao, "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
            )

            mock_handler.assert_awaited_once(), f"opção {opcao} não chamou {nome_handler}"

    @pytest.mark.asyncio
    async def test_opcoes_4_e_5_continuam_indo_pra_etapas_distintas_de_coleta_de_nome(self, monkeypatch):
        """AC4 — opção 4 (currículo pronto) e 5 (montar currículo) continuam
        indo pra etapas diferentes entre si (SQS-58), só o texto do menu
        mudou."""
        destinos = {
            "4": "coletando_nome_candidato",
            "5": "coletando_nome_curriculo_publico",
        }
        for opcao, etapa_esperada in destinos.items():
            estado, fake_get, fake_set = _fluxo_mock("menu_inicial")
            monkeypatch.setattr(emp, "_get_fluxo", fake_get)
            monkeypatch.setattr(emp, "_set_fluxo", fake_set)
            mock_enviar = AsyncMock(return_value=True)
            monkeypatch.setattr(emp, "_enviar", mock_enviar)

            await emp._processar_menu_inicial(
                opcao, "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
            )

            assert estado.get("etapa") == etapa_esperada, f"opção {opcao} mudou de destino"
            assert estado.get("perfil") == "publico"


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

def _mock_gpt(
    intencao=None,
    quer_sair=False,
    mudou_de_assunto=False,
    quer_atendente_humano=False,
    quer_voltar=False,
):
    async def _fn(texto, perfil, etapa, ultima_msg_bot):
        return {
            "intencao": intencao,
            "quer_sair": quer_sair,
            "mudou_de_assunto": mudou_de_assunto,
            "quer_atendente_humano": quer_atendente_humano,
            "quer_voltar": quer_voltar,
        }
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
        # S-EMP-AUD-029 (AC4): este call site não passa mensagem_customizada —
        # continua recebendo a despedida genérica de sempre, sem regressão.
        assert "Boa sorte" in texto_enviado
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
# S-EMP-AUD-024 — fast-path literal de troca de rota nas 4 etapas de coleta
# de nome (DADO livre). Cobre AC1 (frases de alta precisão reroteiam, não são
# engolidas como nome) e reforça AC2 (nome incomum continua intocado — regra
# já coberta acima em TestEscapeHatchNomeLivre, aqui só garante que o fast-path
# não interfere nisso).
# ─────────────────────────────────────────────────────────────────────────────

class TestS_EMP_AUD_024EscapeLiteralTrocaRota:

    @pytest.mark.asyncio
    async def test_coletando_nome_candidato_quero_ver_vagas_reroteia(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_candidato", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "quero ver vagas", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "Esse currículo é para" not in texto_enviado  # não engoliu como nome
        assert "candidatar a uma vaga" in texto_enviado.lower()
        assert estado.get("etapa") == "confirmando_troca_rota"

    @pytest.mark.asyncio
    async def test_coletando_nome_curriculo_publico_quero_ver_vagas_reroteia(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_curriculo_publico", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "quero ver vagas", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "/empregabilidade/curriculo" not in texto_enviado  # não gerou link como se fosse nome
        assert estado.get("etapa") == "confirmando_troca_rota"

    @pytest.mark.asyncio
    async def test_coletando_nome_terceiro_quero_ver_vagas_reroteia(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_terceiro", {
            "perfil": "publico", "vaga_id_selecionada": "vaga-1", "banco_talentos": False,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "quero ver vagas", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "candidatar a uma vaga" in texto_enviado.lower()
        assert estado.get("etapa") == "confirmando_troca_rota"

    @pytest.mark.asyncio
    async def test_confirmando_presenca_nome_quero_ver_vagas_reroteia_em_vez_de_virar_nome(self, monkeypatch):
        """Caso mais sensível: 'quero ver vagas' tem 3 palavras — sem o
        fast-path, passaria batido pela checagem de nome_invalido (que só
        rejeita menos de 2 palavras) e seria gravado como se fosse o nome do
        candidato confirmando presença."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_nome", {
            "perfil": "publico", "tentativas_confirmacao_presenca": 0,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", MagicMock())
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "quero ver vagas", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("nome_confirmacao_presenca") is None  # não virou nome
        assert estado.get("etapa") == "confirmando_troca_rota"
        assert estado.get("tentativas_confirmacao_presenca", 0) == 0  # não contou como tentativa inválida

    @pytest.mark.asyncio
    async def test_sou_empresa_reroteia_para_rota_empresa(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_candidato", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "sou empresa", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "divulgar uma vaga" in texto_enviado.lower()
        assert estado.get("_troca_rota_pendente", {}).get("intencao") == "empresa"

    @pytest.mark.asyncio
    async def test_voltar_reroteia_com_mensagem_generica(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_terceiro", {
            "perfil": "publico", "vaga_id_selecionada": "vaga-1", "banco_talentos": False,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "voltar", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "outro assunto" in texto_enviado.lower()
        assert estado.get("etapa") == "confirmando_troca_rota"

    @pytest.mark.asyncio
    async def test_nome_incomum_com_2_palavras_continua_funcionando_em_confirmando_presenca(self, monkeypatch):
        """Regressão — garante que o fast-path não bloqueia nome real de 2+
        palavras (só bate com o conjunto fechado de frases literais)."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_nome", {
            "perfil": "publico", "tentativas_confirmacao_presenca": 0,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", MagicMock())
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "Xisto Wenceslau", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("nome_confirmacao_presenca") == "Xisto Wenceslau"
        assert estado.get("etapa") == "confirmando_presenca_telefone"

    def test_deteccao_literal_ignora_texto_que_nao_bate_exato(self):
        """Guard direto na função: substring não é suficiente, precisa bater
        a frase inteira normalizada — evita falso-positivo em nome que só
        contém uma dessas palavras (ex.: 'Vagner Voltar' não é 'voltar')."""
        assert emp._deteccao_literal_troca_rota("Vagner Voltar Souza") is None
        assert emp._deteccao_literal_troca_rota("Maria das Vagas") is None
        assert emp._deteccao_literal_troca_rota("voltar") is not None
        assert emp._deteccao_literal_troca_rota("  Quero Ver Vagas  ") is not None

    @pytest.mark.asyncio
    async def test_falar_com_atendente_continua_funcionando_em_coletando_nome_candidato(self, monkeypatch, _isola_enviar):
        """AC3 — o handover por palavra-chave é checado no topo de
        `processar_mensagem_empregabilidade`, antes de qualquer despacho por
        etapa (`_processar_publico`/fast-path literal desta story nunca é
        alcançado). Continua funcionando igual em qualquer uma das 4 etapas
        de coleta de nome — sem mudança de código aqui, só trava por teste."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_candidato", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_conversas = MagicMock()
        mock_conversas.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "metadata": {}
        }
        monkeypatch.setattr(emp, "supabase", _mock_multi_tabela({"conversas": mock_conversas}))

        import meta_adapter_inbound
        monkeypatch.setattr(meta_adapter_inbound, "_notificar_transbordo", AsyncMock(return_value=True))

        await emp.processar_mensagem_empregabilidade(
            "quero falar com atendente", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3].lower()
        assert "em breve você será atendido" in texto_enviado
        assert "Esse currículo é para" not in texto_enviado  # não engoliu como nome


# ─────────────────────────────────────────────────────────────────────────────
# S-EMP-AUD-028 — classificador de IA dedicado pra troca de rota, fallback do
# fast-path literal (S-EMP-AUD-024) quando ele não bate. Reproduzido ao vivo
# pelo Junior (conversa 108da528, 19/08): "Eu quero ver vagas" e "Quero ver
# vagas abertas" não batem com nenhuma frase exata da lista fixa.
# ─────────────────────────────────────────────────────────────────────────────
class TestS_EMP_AUD_028ClassificadorIADedicado:

    @pytest.mark.asyncio
    async def test_eu_quero_ver_vagas_reroteia_via_ia_caso_real_junior(self, monkeypatch):
        """AC1 — caso real 1 (conversa 108da528): 'Eu quero ver vagas' não bate
        com a lista fixa (tem 'eu' na frente), mas a IA classifica como troca
        de rota pra vagas."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_candidato", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        monkeypatch.setattr(
            emp, "_chamar_ia_classificar_troca_rota",
            AsyncMock(return_value={"classificacao": "troca_rota_vagas"}),
        )

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "Eu quero ver vagas", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "Esse currículo é para" not in texto_enviado  # não engoliu como nome
        assert estado.get("etapa") == "confirmando_troca_rota"
        assert estado.get("_troca_rota_pendente", {}).get("intencao") == "candidato_vaga"

    @pytest.mark.asyncio
    async def test_quero_ver_vagas_abertas_reroteia_via_ia_caso_real_junior(self, monkeypatch):
        """AC1 — caso real 2 (conversa 108da528): 'Quero ver vagas abertas'
        também não bate com nenhum item exato da lista fixa."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_nome", {
            "perfil": "publico", "tentativas_confirmacao_presenca": 0,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", MagicMock())
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        monkeypatch.setattr(
            emp, "_chamar_ia_classificar_troca_rota",
            AsyncMock(return_value={"classificacao": "troca_rota_vagas"}),
        )

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "Quero ver vagas abertas", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("nome_confirmacao_presenca") is None  # não virou nome
        assert estado.get("etapa") == "confirmando_troca_rota"

    @pytest.mark.asyncio
    async def test_frase_nova_nunca_vista_generaliza_via_ia(self, monkeypatch):
        """AC2 — ponto central da story: uma 3ª frase nunca vista antes (fora
        das listas fixas E diferente dos 2 casos reais) também é reconhecida
        corretamente — prova que o mecanismo generaliza, não decorou só os 2
        casos do Junior."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_curriculo_publico", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        monkeypatch.setattr(
            emp, "_chamar_ia_classificar_troca_rota",
            AsyncMock(return_value={"classificacao": "troca_rota_empresa"}),
        )

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "opa, na verdade eu tenho uma empresa e queria botar uma vaga aqui",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert "/empregabilidade/curriculo" not in mock_enviar.call_args.args[3]
        assert estado.get("etapa") == "confirmando_troca_rota"
        assert estado.get("_troca_rota_pendente", {}).get("intencao") == "empresa"

    @pytest.mark.asyncio
    async def test_nome_incomum_aciona_ia_e_continua_sendo_aceito(self, monkeypatch):
        """AC3 — regressão com nome incomum, desta vez confirmando que a
        camada de IA foi de fato acionada (fast-path não bate) e mesmo assim
        classificou como nome_valido — não travou/rerroteou."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_candidato", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        mock_ia = AsyncMock(return_value={"classificacao": "nome_valido"})
        monkeypatch.setattr(emp, "_chamar_ia_classificar_troca_rota", mock_ia)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "Xisto Wenceslau", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_ia.assert_awaited_once()  # a camada de IA foi de fato acionada
        assert estado.get("etapa") == "confirmando_terceiro"  # tratado como nome normalmente

    @pytest.mark.asyncio
    async def test_falha_da_ia_cai_para_nome_valido_fail_safe(self, monkeypatch):
        """AC4 — fail-safe: falha da IA (exceção) nunca trava o fluxo, cai
        pra nome_valido."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_candidato", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        monkeypatch.setattr(
            emp, "_chamar_ia_classificar_troca_rota",
            AsyncMock(side_effect=RuntimeError("timeout simulado")),
        )

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "Fulano da Silva Sauro", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") == "confirmando_terceiro"  # seguiu como nome, não travou

    @pytest.mark.asyncio
    async def test_fast_path_literal_nao_chama_ia(self, monkeypatch):
        """AC5 — quando o fast-path literal já resolve, a camada de IA nunca
        é chamada (custo/latência zero pro caso comum, mesmo padrão de
        S-EMP-AUD-024)."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_candidato", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        mock_ia = AsyncMock(return_value={"classificacao": "nome_valido"})
        monkeypatch.setattr(emp, "_chamar_ia_classificar_troca_rota", mock_ia)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "quero ver vagas", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_ia.assert_not_awaited()  # fast-path já resolveu, IA nem foi chamada
        assert estado.get("etapa") == "confirmando_troca_rota"

    @pytest.mark.asyncio
    async def test_classificar_troca_rota_ia_ignora_valor_fora_do_esperado(self, monkeypatch):
        """Fail-safe adicional: se a IA devolver algo fora das 3 categorias
        válidas (JSON mal formado semanticamente, alucinação), cai pra
        nome_valido — mesma lógica de `titulos_validos` em
        `_normalizar_cargos_via_ia`."""
        monkeypatch.setattr(
            emp, "_chamar_ia_classificar_troca_rota",
            AsyncMock(return_value={"classificacao": "categoria_inventada_pela_ia"}),
        )
        resultado = await emp._classificar_troca_rota_ia("texto qualquer")
        assert resultado == "nome_valido"


# ─────────────────────────────────────────────────────────────────────────────
# Achados de auditoria (2026-07-09) — _quer_encerrar por substring sem limite
# de palavra, sem exceção nenhuma no fluxo de candidato; e negação ignorada em
# pos_candidatura (mesma classe de bug já corrigida em oferta_banco_talentos).
# ─────────────────────────────────────────────────────────────────────────────

class TestQuerEncerrarSubstringSemLimiteDePalavra:

    def test_negacao_com_termo_forte_nao_deveria_encerrar(self):
        assert not emp._quer_encerrar("não quero encerrar, quero consultar outra candidatura")
        assert not emp._quer_encerrar("não pode fechar ainda, tenho outra dúvida")
        assert emp._quer_encerrar("quero encerrar por favor")

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

    @pytest.mark.asyncio
    async def test_despedida_real_continua_encerrando_candidato_empresa_e_publico(self, monkeypatch):
        async def assert_encerra(processar, args, etapa, perfil, texto):
            estado, fake_get, fake_set = _fluxo_mock(etapa, {"perfil": perfil, "empresa_id": "e1"})
            monkeypatch.setattr(emp, "_get_fluxo", fake_get)
            monkeypatch.setattr(emp, "_set_fluxo", fake_set)
            mock_enviar = AsyncMock(return_value=True)
            monkeypatch.setattr(emp, "_enviar", mock_enviar)

            await processar(texto, *args)

            assert estado == {}
            assert mock_enviar.await_count == 1

        await assert_encerra(
            emp._processar_candidato,
            ("558599990000", "PHONE_ID", "token", "lead-1", "conv-candidato"),
            "candidato_consultado",
            "candidato",
            "tchau",
        )
        await assert_encerra(
            emp._processar_empresa,
            ("558599990000", "PHONE_ID", "token", "lead-1", "conv-empresa", "Barra"),
            "menu_empresa_acoes",
            "empresa",
            "obrigado, pode fechar",
        )
        await assert_encerra(
            emp._processar_publico,
            ("558599990000", "PHONE_ID", "token", "lead-1", "conv-publico", "Barra"),
            "listou_vagas",
            "publico",
            "quero encerrar por favor",
        )


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

    @pytest.mark.asyncio
    async def test_resposta_1_em_menu_pos_vaga_continua_divulgando_outra_vaga(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock(
            "menu_pos_vaga", {
                "perfil": "empresa",
                "empresa_id": "e1",
                "empresa_nome": "Empresa Teste",
                "cnpj": "12345678000199",
            }
        )
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_empresa(
            "1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "e-mail" in texto_enviado.lower()
        assert estado.get("etapa") == "coletando_email_responsavel"

    @pytest.mark.asyncio
    async def test_resposta_2_em_menu_pos_vaga_continua_consultando_vagas(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock(
            "menu_pos_vaga", {"perfil": "empresa", "empresa_id": "e1"}
        )
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        mock_consulta = AsyncMock()
        monkeypatch.setattr(emp, "_processar_consulta_empresa", mock_consulta)

        await emp._processar_empresa(
            "2", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") == "consulta_empresa"
        mock_consulta.assert_awaited_once()
        assert mock_consulta.await_args.args[0] == "todas"


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


# ─────────────────────────────────────────────────────────────────────────────
# SEC-01 v2 (Plano 001) — empresa deixa de ser "autenticada" só pelo CNPJ
# ─────────────────────────────────────────────────────────────────────────────

def _mock_multi_tabela(por_tabela: dict) -> MagicMock:
    """supabase.table(nome) devolve um MagicMock diferente por nome de tabela
    (dict pré-populado nome_tabela -> MagicMock), permitindo configurar
    retornos diferentes por tabela na mesma chamada de função."""
    mock_sb = MagicMock()

    def _table(nome):
        if nome not in por_tabela:
            por_tabela[nome] = MagicMock()
        return por_tabela[nome]

    mock_sb.table.side_effect = _table
    return mock_sb


def _mock_sb_multi_tabela(tabelas: dict[str, MagicMock]) -> MagicMock:
    """Helper nomeado para os testes do Plano 008.

    Reaproveita o padrão multi-tabela já usado na suíte: cada chamada
    supabase.table(nome) recebe um mock dedicado, permitindo assertar payload
    e filtros reais em fluxos que leem/escrevem mais de uma tabela.
    """
    return _mock_multi_tabela(tabelas)


class TestConfirmandoCancelamento:

    @pytest.mark.asyncio
    async def test_sim_cancela_vaga_com_payload_correto(self, monkeypatch):
        """TEST-01 + achado #14: cobre o cancelamento irreversível e verifica
        payload/filtro do update, não só mensagem ou etapa final."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_cancelamento", {
            "perfil": "empresa",
            "empresa_id": "emp-1",
            "empresa_nome": "Empresa Teste LTDA",
            "empresa_nome_exibicao": "Empresa Teste",
            "cnpj": "12345678000199",
            "vaga_cancelar_id": "vaga-1",
            "vaga_cancelar_titulo": "Vendedor",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_vagas = MagicMock()
        mock_vagas.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "historico_alteracoes": [],
            "created_by": None,
            "unidade_cuca": "Barra",
        }
        mock_sb = _mock_sb_multi_tabela({"vagas": mock_vagas})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_empresa(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        payload = mock_vagas.update.call_args.args[0]
        assert payload["status"] == "cancelada"
        assert len(payload["historico_alteracoes"]) == 1
        assert payload["historico_alteracoes"][0]["tipo"] == "cancelamento"
        assert payload["historico_alteracoes"][0]["ator"] == {"empresa_id": "emp-1"}
        mock_vagas.select.return_value.eq.assert_called_with("id", "vaga-1")
        mock_vagas.update.return_value.eq.assert_called_with("id", "vaga-1")
        assert estado.get("etapa") == "menu_empresa_acoes"

    @pytest.mark.asyncio
    async def test_nao_aborta_sem_escrever_em_vagas(self, monkeypatch):
        """Resposta diferente de confirmação não deve tocar a tabela vagas."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_cancelamento", {
            "perfil": "empresa",
            "empresa_id": "emp-1",
            "vaga_cancelar_id": "vaga-1",
            "vaga_cancelar_titulo": "Vendedor",
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


class TestConfirmandoCadastro:

    @pytest.mark.asyncio
    async def test_sim_insere_empresa_com_payload_correto(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("confirmando_cadastro", {
            "perfil": "empresa",
            "cnpj": "12345678000199",
            "dados_rf": {
                "nome": "Empresa Teste LTDA",
                "nome_fantasia": "Teste",
                "email": "contato@empresa.test",
                "telefone": "8533334444",
                "endereco": "Rua X, 1",
                "setor": "Comércio",
                "porte": "ME",
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_empresas = MagicMock()
        mock_empresas.insert.return_value.execute.return_value.data = [{"id": "empresa-abc"}]
        mock_autorizados = MagicMock()
        mock_sb = _mock_sb_multi_tabela({
            "empresas": mock_empresas,
            "empresa_whatsapp_autorizados": mock_autorizados,
        })
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_empresa(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        payload = mock_empresas.insert.call_args.args[0]
        assert payload == {
            "nome": "Empresa Teste LTDA",
            "nome_fantasia": "Teste",
            "cnpj": "12345678000199",
            "email": "contato@empresa.test",
            "telefone": "8533334444",
            "endereco": "Rua X, 1",
            "setor": "Comércio",
            "porte": "ME",
            "ativa": True,
        }
        mock_empresas.insert.assert_called_once_with(payload)
        mock_autorizados.insert.assert_called_once_with({
            "empresa_id": "empresa-abc",
            "telefone": "558599990000",
            "autorizado_por": None,
        })
        assert estado.get("etapa") == "aguardando_criar_vaga"
        assert estado.get("empresa_id") == "empresa-abc"

    @pytest.mark.asyncio
    async def test_sim_com_correcao_insere_empresa_com_payload_correto(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("confirmando_cadastro_com_correcao", {
            "perfil": "empresa",
            "cnpj": "12345678000199",
            "dados_rf": {
                "nome": "Empresa Corrigida LTDA",
                "nome_fantasia": "",
                "email": "",
                "telefone": "8599990000",
                "endereco": "Rua Corrigida, 10",
                "setor": "Serviços",
                "porte": "EPP",
                "correcao": "telefone corrigido",
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_empresas = MagicMock()
        mock_empresas.insert.return_value.execute.return_value.data = [{"id": "empresa-corrigida"}]
        mock_autorizados = MagicMock()
        mock_sb = _mock_sb_multi_tabela({
            "empresas": mock_empresas,
            "empresa_whatsapp_autorizados": mock_autorizados,
        })
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_empresa(
            "confirmar", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        payload = mock_empresas.insert.call_args.args[0]
        assert payload == {
            "nome": "Empresa Corrigida LTDA",
            "nome_fantasia": None,
            "cnpj": "12345678000199",
            "email": None,
            "telefone": "8599990000",
            "endereco": "Rua Corrigida, 10",
            "setor": "Serviços",
            "porte": "EPP",
            "ativa": True,
        }
        mock_empresas.insert.assert_called_once_with(payload)
        mock_autorizados.insert.assert_called_once_with({
            "empresa_id": "empresa-corrigida",
            "telefone": "558599990000",
            "autorizado_por": None,
        })
        assert estado.get("etapa") == "aguardando_criar_vaga"
        assert estado.get("empresa_id") == "empresa-corrigida"


class TestConfirmacaoEntrevista:

    @pytest.mark.asyncio
    async def test_confirmar_presenca_grava_status_correto(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_conversas = MagicMock()
        mock_conversas.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "metadata": {}
        }
        mock_candidaturas = MagicMock()
        mock_candidaturas.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": "cand-1", "nome": "Fulano"}
        ]
        mock_sb = _mock_sb_multi_tabela({
            "conversas": mock_conversas,
            "candidaturas": mock_candidaturas,
        })
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp.processar_mensagem_empregabilidade(
            "1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra", "Fulano",
        )

        mock_candidaturas.select.return_value.eq.assert_called_with("telefone", "8599990000")
        mock_candidaturas.select.return_value.eq.return_value.eq.assert_called_with("status", "convite_enviado")
        mock_candidaturas.update.assert_called_once_with({"status": "entrevista_confirmada"})
        mock_candidaturas.update.return_value.eq.assert_called_once_with("id", "cand-1")
        assert estado == {"perfil": "encerrado"}

    @pytest.mark.asyncio
    async def test_recusar_presenca_grava_status_correto(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_conversas = MagicMock()
        mock_conversas.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "metadata": {}
        }
        mock_candidaturas = MagicMock()
        mock_candidaturas.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": "cand-2", "nome": "Ciclana"}
        ]
        mock_sb = _mock_sb_multi_tabela({
            "conversas": mock_conversas,
            "candidaturas": mock_candidaturas,
        })
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp.processar_mensagem_empregabilidade(
            "não posso", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra", "Ciclana",
        )

        mock_candidaturas.update.assert_called_once_with({"status": "entrevista_recusada"})
        mock_candidaturas.update.return_value.eq.assert_called_once_with("id", "cand-2")
        assert estado == {"perfil": "encerrado"}


# ─────────────────────────────────────────────────────────────────────────────
# SQS-56 — Seleção sem coleta prévia de currículo
# ─────────────────────────────────────────────────────────────────────────────

class TestSelecaoSemColetaCurriculo:

    @pytest.mark.asyncio
    async def test_cargo_escolhido_com_coleta_curriculo_false_desvia_para_confirmacao_presenca(self, monkeypatch, _isola_enviar):
        """AC4/AC5 — com coleta_curriculo=False, o candidato recebe a
        convocação imediata (empresa, cargo, data, local, observação) e vai
        para confirmando_presenca_nome, NUNCA para coletando_nome_candidato."""
        estado, fake_get, fake_set = _fluxo_mock("listando_cargos_selecao", {
            "perfil": "publico",
            "vaga_id_selecionada": "vaga-1",
            "cargos_disponiveis": [{"titulo": "Caixa", "quantidade": 2, "faixa_etaria": "Maior de 18 anos"}],
            "coleta_curriculo": False,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_vagas = MagicMock()
        mock_vagas.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "observacoes_selecao": "Levar RG e caneta",
            "datas_selecao": [{"data": "2026-09-12", "hora": "08:00"}],
            "local_entrevista": "CUCA Barra do Ceará",
            "empresa_id": "emp-1",
        }
        mock_empresas = MagicMock()
        mock_empresas.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "nome": "Empresa Teste LTDA", "nome_fantasia": "Empresa Teste",
        }
        mock_sb = _mock_multi_tabela({"vagas": mock_vagas, "empresas": mock_empresas})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_publico(
            "1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3]
        assert "convocado" in texto_enviado.lower()
        assert "Empresa Teste" in texto_enviado
        assert "Caixa" in texto_enviado
        assert "12/09/2026" in texto_enviado
        assert "CUCA Barra do Ceará" in texto_enviado
        assert "Levar RG e caneta" in texto_enviado
        assert "nome completo" in texto_enviado.lower()
        assert estado.get("etapa") == "confirmando_presenca_nome"
        assert estado.get("cargos_escolhidos") == ["Caixa"]
        assert estado.get("tentativas_confirmacao_presenca") == 0

    @pytest.mark.asyncio
    async def test_cargo_escolhido_sem_coleta_curriculo_no_fluxo_mantem_comportamento_atual(self, monkeypatch, _isola_enviar):
        """AC3/AC17 — fail-safe: fluxo sem a chave coleta_curriculo (seleção
        criada antes desta migration, ou qualquer coisa que não seja False
        literal) preserva o fluxo de candidatura normal, nunca desvia."""
        estado, fake_get, fake_set = _fluxo_mock("listando_cargos_selecao", {
            "perfil": "publico",
            "vaga_id_selecionada": "vaga-1",
            "cargos_disponiveis": [{"titulo": "Caixa", "quantidade": 2, "faixa_etaria": "Maior de 18 anos"}],
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", MagicMock())

        await emp._processar_publico(
            "1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") == "coletando_nome_candidato"
        texto_enviado = _isola_enviar.call_args.args[3]
        assert "convocado" not in texto_enviado.lower()

    @pytest.mark.asyncio
    async def test_confirmando_presenca_nome_recusa_afirmacao_isolada(self, monkeypatch, _isola_enviar):
        """AC6 — 'sim' sozinho não é um nome: reconduz sem registrar e sem
        avançar de etapa."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_nome", {
            "perfil": "publico", "tentativas_confirmacao_presenca": 0,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", MagicMock())

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3]
        assert "nome completo" in texto_enviado.lower()
        assert estado.get("etapa") == "confirmando_presenca_nome"
        assert estado.get("tentativas_confirmacao_presenca") == 1

    @pytest.mark.asyncio
    async def test_confirmando_presenca_nome_segunda_falha_aciona_transbordo(self, monkeypatch, _isola_enviar):
        """AC9 gatilho (a) — 2 respostas consecutivas não reconhecidas na
        mesma etapa disparam transbordo imediato + pausa da IA."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_nome", {
            "perfil": "publico", "tentativas_confirmacao_presenca": 1,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_conversas = MagicMock()
        mock_sb = _mock_multi_tabela({"conversas": mock_conversas})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        mock_notificar = AsyncMock(return_value=True)
        import meta_adapter_inbound
        monkeypatch.setattr(meta_adapter_inbound, "_notificar_transbordo", mock_notificar)

        await emp._processar_publico(
            "ok", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_conversas.update.assert_any_call({"status": "awaiting_human", "updated_at": "now()"})
        mock_notificar.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_confirmando_presenca_nome_nome_valido_avanca_para_telefone(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_nome", {
            "perfil": "publico", "tentativas_confirmacao_presenca": 0,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", MagicMock())

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False))

        await emp._processar_publico(
            "Maria da Silva", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3]
        assert "telefone" in texto_enviado.lower()
        assert estado.get("etapa") == "confirmando_presenca_telefone"
        assert estado.get("nome_confirmacao_presenca") == "Maria da Silva"
        assert estado.get("tentativas_confirmacao_presenca") == 0

    @pytest.mark.asyncio
    async def test_confirmando_presenca_nome_desistencia_recebe_mensagem_especifica(self, monkeypatch, _isola_enviar):
        """S-EMP-AUD-029 — regressão do caso real (conversa 49a165ec, LABISE):
        'não quero mais, obrigado' logo após 'Você está convocado(a)!' não
        pode receber a despedida genérica ('Boa sorte! 🎉'), que lê como se a
        recusa não tivesse sido ouvida."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_nome", {
            "perfil": "publico", "tentativas_confirmacao_presenca": 0,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", MagicMock())

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=True))

        await emp._processar_publico(
            "nao quero mais, obrigado", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3]
        assert "boa sorte" not in texto_enviado.lower()
        assert "🎉" not in texto_enviado
        assert "registrada" in texto_enviado.lower()
        assert estado == {}  # _encerrar_fluxo limpa o fluxo

    @pytest.mark.asyncio
    async def test_confirmando_presenca_telefone_rejeita_numero_fixo(self, monkeypatch, _isola_enviar):
        """AC7 — número fixo (dígito após DDD não é 6-9) não deve ser aceito
        como celular, mesmo depois de _normalizar_telefone_br inserir um '9'
        cego. Regressão do achado do advisor: 8532001234 nunca pode virar
        um celular válido só porque a normalização "conserta" o formato."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_telefone", {
            "perfil": "publico", "tentativas_confirmacao_presenca": 0,
            "nome_confirmacao_presenca": "Maria da Silva",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", MagicMock())

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=False, mudou_de_assunto=False))

        await emp._processar_publico(
            "8532001234", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3]
        assert "não consegui reconhecer" in texto_enviado.lower()
        assert estado.get("etapa") == "confirmando_presenca_telefone"
        assert estado.get("tentativas_confirmacao_presenca") == 1

    @pytest.mark.asyncio
    async def test_confirmando_presenca_telefone_valido_grava_candidatura_por_cargo(self, monkeypatch, _isola_enviar):
        """AC7/AC8 — celular válido sem o 9º dígito é normalizado e aceito;
        grava 1 candidatura por cargo escolhido, telefone = identidade
        (WhatsApp), telefone_contato = número digitado, status pendente,
        confirmacao_presenca preenchida."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_telefone", {
            "perfil": "publico", "tentativas_confirmacao_presenca": 0,
            "nome_confirmacao_presenca": "Maria da Silva",
            "cargos_escolhidos": ["Caixa", "Estoque"],
            "vaga_id_selecionada": "vaga-1",
            "empresa_nome_selecao": "Empresa Teste",
            "historico_vagas_aplicadas": [],
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_candidaturas = MagicMock()
        mock_candidaturas.select.return_value.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        mock_sb = _mock_multi_tabela({"candidaturas": mock_candidaturas})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_publico(
            "85 8173-3321", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert mock_candidaturas.insert.call_count == 2
        payloads = [call.args[0] for call in mock_candidaturas.insert.call_args_list]
        for p in payloads:
            assert p["vaga_id"] == "vaga-1"
            assert p["nome"] == "Maria da Silva"
            assert p["telefone"] == "8599990000"           # identidade — número do WhatsApp
            assert p["telefone_contato"] == "5585981733321"  # digitado, com 9º dígito inserido
            assert p["status"] == "pendente"
            assert p["confirmacao_presenca"] == "confirmado"
        assert {p["cargo_escolhido"] for p in payloads} == {"Caixa", "Estoque"}

        texto_enviado = _isola_enviar.call_args.args[3]
        assert "presença confirmada" in texto_enviado.lower()
        assert "outra" in texto_enviado.lower() and "encerrar" in texto_enviado.lower()
        assert estado.get("etapa") == "pos_candidatura"
        assert estado.get("perfil") == "publico"

    @pytest.mark.asyncio
    async def test_confirmando_presenca_telefone_nao_duplica_candidatura_ja_existente(self, monkeypatch, _isola_enviar):
        """Mesmo guard anti-duplicidade de candidaturas/route.ts — não há
        índice único no banco para (vaga_id, telefone, cargo_escolhido)."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_telefone", {
            "perfil": "publico", "tentativas_confirmacao_presenca": 0,
            "nome_confirmacao_presenca": "Maria da Silva",
            "cargos_escolhidos": ["Caixa"],
            "vaga_id_selecionada": "vaga-1",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_candidaturas = MagicMock()
        mock_candidaturas.select.return_value.eq.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"id": "ja-existe"}
        ]
        mock_sb = _mock_multi_tabela({"candidaturas": mock_candidaturas})
        monkeypatch.setattr(emp, "supabase", mock_sb)

        await emp._processar_publico(
            "85981733321", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_candidaturas.insert.assert_not_called()
        assert estado.get("etapa") == "pos_candidatura"


class TestAutorizacaoEmpresaPorNumeroWhatsapp:

    @pytest.mark.asyncio
    async def test_cnpj_novo_grava_autorizacao_automatica_no_cadastro(self, monkeypatch):
        """Cadastro de empresa nova (confirmando_cadastro): logo após o
        .insert() em empresas, o número de quem está cadastrando (phone) deve
        ser gravado em empresa_whatsapp_autorizados com autorizado_por=None
        (vínculo automático)."""
        estado, fake_get, fake_set = _fluxo_mock("confirmando_cadastro", {
            "perfil": "empresa",
            "dados_rf": {"nome": "ACME LTDA", "nome_fantasia": None},
            "cnpj": "12345678000199",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        mock_empresas = MagicMock()
        mock_empresas.insert.return_value.execute.return_value.data = [{"id": "e-nova"}]
        mock_autorizados = MagicMock()
        por_tabela = {"empresas": mock_empresas, "empresa_whatsapp_autorizados": mock_autorizados}
        monkeypatch.setattr(emp, "supabase", _mock_multi_tabela(por_tabela))

        await emp._processar_empresa(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_autorizados.insert.assert_called_once()
        payload = mock_autorizados.insert.call_args.args[0]
        assert payload["empresa_id"] == "e-nova"
        assert payload["telefone"] == "558599990000"
        assert payload["autorizado_por"] is None

    @pytest.mark.asyncio
    async def test_cnpj_existente_numero_ja_autorizado_concede_acesso_normal(self, monkeypatch):
        """Número que já está na lista de autorizados dessa empresa continua
        tendo acesso normal, sem fricção nova."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_cnpj", {"perfil": "empresa"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        mock_empresas = MagicMock()
        mock_empresas.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "e1", "nome": "ACME LTDA", "nome_fantasia": "ACME"}
        ]
        mock_autorizados = MagicMock()
        mock_autorizados.select.return_value.eq.return_value.execute.return_value.data = [
            {"telefone": "558599990000"}
        ]
        por_tabela = {"empresas": mock_empresas, "empresa_whatsapp_autorizados": mock_autorizados}
        monkeypatch.setattr(emp, "supabase", _mock_multi_tabela(por_tabela))

        await emp._processar_empresa(
            "12345678000199", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_autorizados.insert.assert_not_called()
        assert estado.get("etapa") == "aguardando_criar_vaga"
        assert estado.get("empresa_id") == "e1"
        texto_enviado = mock_enviar.call_args.args[3]
        assert "já está cadastrada" in texto_enviado

    @pytest.mark.asyncio
    async def test_cnpj_existente_lista_vazia_faz_backfill_e_concede_acesso(self, monkeypatch):
        """1º toque nesse CNPJ (nenhum número autorizado ainda) — vincula este
        número automaticamente E concede acesso nesta primeira vez, sem
        transbordo."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_cnpj", {"perfil": "empresa"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        mock_empresas = MagicMock()
        mock_empresas.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "e1", "nome": "ACME LTDA", "nome_fantasia": "ACME"}
        ]
        mock_autorizados = MagicMock()
        mock_autorizados.select.return_value.eq.return_value.execute.return_value.data = []
        por_tabela = {"empresas": mock_empresas, "empresa_whatsapp_autorizados": mock_autorizados}
        monkeypatch.setattr(emp, "supabase", _mock_multi_tabela(por_tabela))

        await emp._processar_empresa(
            "12345678000199", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_autorizados.insert.assert_called_once()
        payload = mock_autorizados.insert.call_args.args[0]
        assert payload["empresa_id"] == "e1"
        assert payload["telefone"] == "558599990000"
        assert payload["autorizado_por"] is None
        assert estado.get("etapa") == "aguardando_criar_vaga", (
            "backfill não deveria acionar transbordo — acesso concedido normalmente na 1ª vez"
        )

    @pytest.mark.asyncio
    async def test_cnpj_existente_numero_diferente_aciona_transbordo(self, monkeypatch):
        """Número diferente dos já autorizados para essa empresa aciona
        transbordo humano real — não recebe empresa_id, não pode agir."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_cnpj", {"perfil": "empresa"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        mock_empresas = MagicMock()
        mock_empresas.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "e1", "nome": "ACME LTDA", "nome_fantasia": "ACME"}
        ]
        mock_autorizados = MagicMock()
        mock_autorizados.select.return_value.eq.return_value.execute.return_value.data = [
            {"telefone": "5511999998888"}
        ]
        mock_conversas = MagicMock()
        por_tabela = {
            "empresas": mock_empresas,
            "empresa_whatsapp_autorizados": mock_autorizados,
            "conversas": mock_conversas,
        }
        monkeypatch.setattr(emp, "supabase", _mock_multi_tabela(por_tabela))

        import meta_adapter_inbound
        mock_notificar = AsyncMock(return_value=None)
        monkeypatch.setattr(meta_adapter_inbound, "_notificar_transbordo", mock_notificar)

        await emp._processar_empresa(
            "12345678000199", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "encaminhamos seu contato" in texto_enviado.lower()
        mock_conversas.update.assert_called_once_with({"status": "awaiting_human", "updated_at": "now()"})
        mock_conversas.update.return_value.eq.assert_called_once_with("id", "conv-1")
        mock_notificar.assert_called_once_with(
            "conv-1", "Empregabilidade", "Barra", "PHONE_ID", "558599990000",
        )
        assert estado == {}, "reset do fluxo — nenhum empresa_id deve sobrar em estado gravado"

    @pytest.mark.asyncio
    async def test_cnpj_existente_numero_diferente_falha_transbordo_nao_promete(self, monkeypatch, caplog):
        estado, fake_get, fake_set = _fluxo_mock("aguardando_cnpj", {"perfil": "empresa"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)
        caplog.set_level(logging.ERROR, logger="empregabilidade_engine")

        mock_empresas = MagicMock()
        mock_empresas.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "e1", "nome": "ACME LTDA", "nome_fantasia": "ACME"}
        ]
        mock_autorizados = MagicMock()
        mock_autorizados.select.return_value.eq.return_value.execute.return_value.data = [
            {"telefone": "5511999998888"}
        ]
        mock_conversas = MagicMock()
        monkeypatch.setattr(emp, "supabase", _mock_multi_tabela({
            "empresas": mock_empresas,
            "empresa_whatsapp_autorizados": mock_autorizados,
            "conversas": mock_conversas,
        }))

        import meta_adapter_inbound
        monkeypatch.setattr(meta_adapter_inbound, "_notificar_transbordo", AsyncMock(return_value=False))

        await emp._processar_empresa(
            "12345678000199", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3].lower()
        assert "não consegui confirmar" in texto_enviado
        assert "encaminhamos seu contato" not in texto_enviado
        assert estado == {"perfil": "empresa", "etapa": "aguardando_cnpj"}
        updates = [chamada.args[0] for chamada in mock_conversas.update.call_args_list]
        assert {"status": "awaiting_human", "updated_at": "now()"} in updates
        assert updates[-1] == {"status": "ativa", "updated_at": "now()"}
        assert "Falha ao acionar transbordo de Empregabilidade" in caplog.text


class TestHandoverEmpregabilidadeEndurecido:

    @pytest.mark.asyncio
    async def test_duvida_falha_transbordo_nao_promete_atendimento(self, monkeypatch, _isola_enviar, caplog):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        caplog.set_level(logging.ERROR, logger="empregabilidade_engine")

        mock_conversas = MagicMock()
        mock_conversas.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "metadata": {"ultima_intencao": "duvida"}
        }
        monkeypatch.setattr(emp, "supabase", _mock_multi_tabela({"conversas": mock_conversas}))

        import meta_adapter_inbound
        monkeypatch.setattr(meta_adapter_inbound, "_notificar_transbordo", AsyncMock(return_value=False))

        await emp.processar_mensagem_empregabilidade(
            "tenho uma dúvida", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3].lower()
        assert "não consegui confirmar" in texto_enviado
        assert "em breve você será atendido" not in texto_enviado
        updates = [chamada.args[0] for chamada in mock_conversas.update.call_args_list]
        assert {"status": "awaiting_human", "updated_at": "now()"} in updates
        assert updates[-1] == {"status": "ativa", "updated_at": "now()"}
        assert "Falha ao acionar transbordo de Empregabilidade" in caplog.text

    @pytest.mark.asyncio
    async def test_palavra_chave_falha_transbordo_nao_promete_atendimento(self, monkeypatch, _isola_enviar, caplog):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        caplog.set_level(logging.ERROR, logger="empregabilidade_engine")

        mock_conversas = MagicMock()
        mock_conversas.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "metadata": {}
        }
        monkeypatch.setattr(emp, "supabase", _mock_multi_tabela({"conversas": mock_conversas}))

        import meta_adapter_inbound
        monkeypatch.setattr(meta_adapter_inbound, "_notificar_transbordo", AsyncMock(return_value=False))

        await emp.processar_mensagem_empregabilidade(
            "quero falar com atendente", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3].lower()
        assert "não consegui confirmar" in texto_enviado
        assert "em breve você será atendido" not in texto_enviado
        assert estado == {"etapa": ""}
        updates = [chamada.args[0] for chamada in mock_conversas.update.call_args_list]
        assert {"status": "awaiting_human", "updated_at": "now()"} in updates
        assert updates[-1] == {"status": "ativa", "updated_at": "now()"}
        assert "Falha ao acionar transbordo de Empregabilidade" in caplog.text


# ─────────────────────────────────────────────────────────────────────────────
# Bloco 06 — Planos 012-019
# ─────────────────────────────────────────────────────────────────────────────

class _ResultadoFake:
    def __init__(self, data=None, count=None):
        self.data = data or []
        self.count = count


class _TabelaFake:
    def __init__(self, nome: str, banco: "_SupabaseFakeBloco6"):
        self.nome = nome
        self.banco = banco
        self.select_cols = ""
        self.filters = []
        self.in_filters = []
        self.limit_value = None

    def select(self, cols, **kwargs):
        self.select_cols = cols
        self.select_kwargs = kwargs
        return self

    def insert(self, payload):
        self.banco.inserts.append((self.nome, dict(payload)))
        self._insert_payload = payload
        return self

    def is_(self, coluna, valor):
        self.filters.append(("is", coluna, valor))
        return self

    def eq(self, coluna, valor):
        self.filters.append(("eq", coluna, valor))
        return self

    def ilike(self, coluna, valor):
        self.filters.append(("ilike", coluna, valor))
        return self

    def in_(self, coluna, valores):
        self.in_filters.append((coluna, list(valores)))
        self.banco.in_calls.append((self.nome, coluna, list(valores)))
        return self

    def order(self, *args, **kwargs):
        return self

    def limit(self, valor):
        self.limit_value = valor
        self.banco.limit_calls.append((self.nome, valor))
        return self

    def single(self):
        return self

    def maybe_single(self):
        return self

    @property
    def not_(self):
        return self

    def execute(self):
        self.banco.execute_calls.append((self.nome, self.select_cols, list(self.filters), list(self.in_filters), self.limit_value))
        if getattr(self, "_insert_payload", None) is not None:
            return _ResultadoFake([self._insert_payload])
        return self.banco.resultado_para(self)


class _SupabaseFakeBloco6:
    def __init__(self):
        self.in_calls = []
        self.limit_calls = []
        self.execute_calls = []
        self.candidaturas_por_vaga = []
        self.vagas_empresa = []
        self.candidaturas_busca = []
        self.vagas_titulos = []
        self.vagas_publicas = []
        self.unidades = []
        self.conversas = []
        self.leads = []
        # S-EMP-AUD-023 passo 2
        self.coleta_curriculo_por_vaga = {}
        self.empresas = []
        # S-EMP-AUD-023 passo 3
        self.inserts = []

    def table(self, nome):
        return _TabelaFake(nome, self)

    def resultado_para(self, tabela: _TabelaFake):
        if tabela.nome == "vagas" and tabela.select_cols == "coleta_curriculo":
            vaga_id = next((valor for tipo, coluna, valor in tabela.filters if tipo == "eq" and coluna == "id"), None)
            return _ResultadoFake({"coleta_curriculo": self.coleta_curriculo_por_vaga.get(vaga_id, True)})
        if tabela.nome == "empresas" and tabela.in_filters:
            ids = set(tabela.in_filters[0][1])
            return _ResultadoFake([emp for emp in self.empresas if emp["id"] in ids])
        if tabela.nome == "vagas" and "tipo, cargos_lista" in tabela.select_cols:
            return _ResultadoFake({"tipo": "vaga_normal"})
        if tabela.nome == "vagas" and "id, titulo, status, total_vagas, numero_vaga" in tabela.select_cols:
            return _ResultadoFake(self.vagas_empresa)
        if tabela.nome == "vagas" and "id, unidade_destino" in tabela.select_cols:
            vaga_id = next((valor for tipo, coluna, valor in tabela.filters if tipo == "eq" and coluna == "id"), None)
            vaga = next((v for v in self.vagas_publicas if v["id"] == vaga_id), {})
            return _ResultadoFake(vaga)
        if tabela.nome == "vagas" and tabela.in_filters and "id, titulo" in tabela.select_cols:
            ids = set(tabela.in_filters[0][1]) if tabela.in_filters else set()
            return _ResultadoFake([v for v in self.vagas_titulos if v["id"] in ids])
        if tabela.nome == "vagas":
            return _ResultadoFake(self.vagas_publicas)
        if tabela.nome == "candidaturas" and tabela.select_cols == "vaga_id":
            ids = set(tabela.in_filters[0][1]) if tabela.in_filters else set()
            return _ResultadoFake([c for c in self.candidaturas_por_vaga if c["vaga_id"] in ids])
        if tabela.nome == "candidaturas":
            return _ResultadoFake(self.candidaturas_busca)
        if tabela.nome == "unidades_cuca":
            return _ResultadoFake(self.unidades)
        if tabela.nome == "conversas":
            return _ResultadoFake(self.conversas)
        if tabela.nome == "leads":
            ids = set(tabela.in_filters[0][1]) if tabela.in_filters else set()
            return _ResultadoFake([lead for lead in self.leads if lead["id"] in ids])
        return _ResultadoFake([])


_SupabaseFakeBloco6.__module__ = "unittest.mock"


# ─────────────────────────────────────────────────────────────────────────────
# S-EMP-AUD-023 (Vaga Direta) — motor de agrupamento por cargo consolidado.
# Passo 1 da story: só o motor de dados, ainda não plugado no fluxo de
# conversa ao vivo. Fixture da seção 2.2 da story — dado real de produção,
# verbatim (4 seleções abertas em 2026-08-18).
# ─────────────────────────────────────────────────────────────────────────────

_UUID_UNIDADE_CENTRO = "11111111-1111-1111-1111-111111111111"
_UUID_UNIDADE_BARRA = "22222222-2222-2222-2222-222222222222"


def _vagas_fixture_producao_secao_2_2():
    """Verbatim da seção 2.2 da story — 4 seleções abertas em produção,
    2026-08-18. 'Porteiro' aparece 3x (30+20+20=70), mesma empresa
    SINGULAR, com unidade_cuca em 3 formatos diferentes (texto literal x2,
    UUID x1) — exatamente o achado 2.4 da story."""
    return [
        {
            "id": "vaga-17", "tipo": "selecao_evento", "empresa_id": "emp-singular",
            "unidade_cuca": "CUCA Jangurussu",
            "cargos_lista": [
                {"titulo": "Auxiliar de Serviços Gerais", "quantidade": 50},
                {"titulo": "Porteiro", "quantidade": 30},
                {"titulo": "Auxiliar de Manutenção", "quantidade": 20},
                {"titulo": "Auxiliar de Cozinha", "quantidade": 20},
            ],
        },
        {
            "id": "vaga-20", "tipo": "selecao_evento", "empresa_id": "emp-singular",
            "unidade_cuca": _UUID_UNIDADE_CENTRO,
            "cargos_lista": [
                {"titulo": "Auxiliar de serviços gerais", "quantidade": 50},
                {"titulo": "Auxiliar de menutenção", "quantidade": 20},  # erro de digitação real
                {"titulo": "Porteiro", "quantidade": 20},
                {"titulo": "Jardineiro", "quantidade": 20},
            ],
        },
        {
            "id": "vaga-21", "tipo": "selecao_evento", "empresa_id": "emp-singular",
            "unidade_cuca": "CUCA Pici",
            "cargos_lista": [
                {"titulo": "Auxiliar de serviços gerais", "quantidade": 50},
                {"titulo": "porteiro", "quantidade": 20},
                {"titulo": "jardineiro", "quantidade": 20},
                {"titulo": "auxiliar de manutenção", "quantidade": 20},
            ],
        },
        {
            "id": "vaga-38", "tipo": "selecao_evento", "empresa_id": "emp-labise",
            "unidade_cuca": _UUID_UNIDADE_BARRA,
            "cargos_lista": [
                {"titulo": "COSTUREIRA  OPERADORA OVERLOCK E GOLERA", "quantidade": "6"},
            ],
        },
    ]


_EMPRESAS_POR_ID_FIXTURE = {
    "emp-singular": "SINGULAR FACILITIES SERVICE S.A.",
    "emp-labise": "LABISE SERVIÇOS LTDA",
}
_UNIDADES_POR_ID_FIXTURE = {
    _UUID_UNIDADE_CENTRO: "CUCA Centro",
    _UUID_UNIDADE_BARRA: "CUCA Barra",
}


class TestS_EMP_AUD_023CargosConsolidados:

    def test_porteiro_soma_70_de_3_selecoes_dado_real_producao(self):
        """Cenário central da story (seção 2.2/pedido original do Junior):
        'Porteiro' em 3 seleções da mesma empresa, unidades em 3 formatos
        diferentes (2 literais, 1 UUID) — soma 30+20+20=70."""
        mapa = emp._construir_cargos_consolidados(
            _vagas_fixture_producao_secao_2_2(), {}, set(),
            _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
        )
        porteiro = next(g for g in mapa.values() if g["cargo_exibicao"].lower() == "porteiro")
        assert porteiro["quantidade_total"] == 70
        assert len(porteiro["ocorrencias"]) == 3
        rotulos = {oc["rotulo_tipo"] for oc in porteiro["ocorrencias"]}
        assert rotulos == {
            "Processo seletivo Cuca: CUCA Jangurussu",
            "Processo seletivo Cuca: CUCA Centro",  # UUID resolvido
            "Processo seletivo Cuca: CUCA Pici",
        }
        for oc in porteiro["ocorrencias"]:
            assert oc["empresa_nome"] == "SINGULAR FACILITIES SERVICE S.A."

    def test_maiuscula_minuscula_unifica_mas_erro_de_digitacao_nao(self):
        """Achado crítico 2.3 da story: pré-passo (sem IA) unifica só
        variação de caixa/espaço — 'Auxiliar de menutenção' (erro de
        digitação real) fica como cargo separado nesta etapa (normalização
        via IA é escopo de commit futuro)."""
        mapa = emp._construir_cargos_consolidados(
            _vagas_fixture_producao_secao_2_2(), {}, set(),
            _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
        )
        nomes = {g["cargo_exibicao"].lower(): g for g in mapa.values()}

        # Unifica por caixa/espaço (pré-passo)
        auxiliar_gerais = nomes["auxiliar de serviços gerais"]
        assert auxiliar_gerais["quantidade_total"] == 150  # 50+50+50
        assert len(auxiliar_gerais["ocorrencias"]) == 3

        jardineiro = nomes["jardineiro"]
        assert jardineiro["quantidade_total"] == 40  # 20+20
        assert len(jardineiro["ocorrencias"]) == 2

        # NÃO unifica erro de digitação (fica separado nesta etapa)
        assert "auxiliar de manutenção" in nomes
        assert "auxiliar de menutenção" in nomes  # cargo distinto, esperado
        assert nomes["auxiliar de manutenção"]["quantidade_total"] == 40  # 20+20
        assert nomes["auxiliar de menutenção"]["quantidade_total"] == 20

    def test_falso_positivo_critico_auxiliares_diferentes_nao_se_misturam(self):
        """Teste crítico do test plan (seção 10): Auxiliar de Serviços
        Gerais, Auxiliar de Manutenção e Auxiliar de Cozinha são cargos
        DIFERENTES que só compartilham a palavra 'Auxiliar' — não podem
        virar um grupo só."""
        mapa = emp._construir_cargos_consolidados(
            _vagas_fixture_producao_secao_2_2(), {}, set(),
            _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
        )
        nomes = {g["cargo_exibicao"].lower() for g in mapa.values()}
        assert "auxiliar de serviços gerais" in nomes
        assert "auxiliar de manutenção" in nomes
        assert "auxiliar de cozinha" in nomes
        assert len(nomes) == 7  # 7 cargos distintos no total do fixture, nenhum se fundiu por engano

    def test_ordem_alfabetica_por_cargo(self):
        """Pergunta 2 da story — ordem alfabética no Nível 1."""
        mapa = emp._construir_cargos_consolidados(
            _vagas_fixture_producao_secao_2_2(), {}, set(),
            _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
        )
        exibicoes = [mapa[k]["cargo_exibicao"].lower() for k in sorted(mapa, key=int)]
        assert exibicoes == sorted(exibicoes)

    def test_quantidade_como_string_no_json_e_convertida_sem_quebrar(self):
        """Dado real (vaga #38, LABISE): quantidade vem como string '6' no
        jsonb — não pode quebrar a soma."""
        mapa = emp._construir_cargos_consolidados(
            _vagas_fixture_producao_secao_2_2(), {}, set(),
            _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
        )
        costureira = next(g for g in mapa.values() if "costureira" in g["cargo_exibicao"].lower())
        assert costureira["quantidade_total"] == 6

    def test_selecao_evento_unidade_cuca_nulo_e_toda_a_rede(self):
        """Seção 3, regra 1 — unidade_cuca NULL → 'Toda a Rede'."""
        vagas = [{
            "id": "vaga-x", "tipo": "selecao_evento", "empresa_id": "emp-singular",
            "unidade_cuca": None,
            "cargos_lista": [{"titulo": "Atendente", "quantidade": 5}],
        }]
        mapa = emp._construir_cargos_consolidados(vagas, {}, set(), _EMPRESAS_POR_ID_FIXTURE, {})
        atendente = next(iter(mapa.values()))
        assert atendente["ocorrencias"][0]["rotulo_tipo"] == "Processo seletivo Cuca: Toda a Rede"

    def test_vaga_normal_global_e_vaga_individual_sem_sufixo(self):
        """Seção 3, regra 3 — vaga_normal + unidade_destino global →
        'Vaga individual', sem sufixo de unidade."""
        vagas = [{
            "id": "vaga-y", "tipo": "vaga_normal", "empresa_id": "emp-singular",
            "titulo": "Consultora de Vendas", "total_vagas": 1,
            "unidade_destino": "global",
        }]
        mapa = emp._construir_cargos_consolidados(vagas, {}, set(), _EMPRESAS_POR_ID_FIXTURE, {})
        consultora = next(iter(mapa.values()))
        assert consultora["ocorrencias"][0]["rotulo_tipo"] == "Vaga individual"
        assert consultora["quantidade_total"] == 1

    def test_vaga_normal_unidade_especifica_e_vaga_individual_com_sufixo(self):
        """Seção 3, regra 4 (resposta do Junior 2026-08-18) — vaga_normal +
        unidade específica → 'Vaga individual — {nome}', ex.: 'CUCA Pici'."""
        vagas = [{
            "id": "vaga-z", "tipo": "vaga_normal", "empresa_id": "emp-singular",
            "titulo": "Auxiliar Administrativo", "total_vagas": 2,
            "unidade_destino": _UUID_UNIDADE_CENTRO,
        }]
        mapa = emp._construir_cargos_consolidados(
            vagas, {}, set(), _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
        )
        aux = next(iter(mapa.values()))
        assert aux["ocorrencias"][0]["rotulo_tipo"] == "Vaga individual — CUCA Centro"

    def test_exclusao_por_ocorrencia_recalcula_quantidade_sem_sumir_cargo_inteiro(self):
        """Pergunta 5 da story (exemplo literal do Junior): candidato já
        candidatado a 2 das 3 ocorrências de Porteiro — quantidade
        recalculada só com a ocorrência restante, cargo NÃO some (ainda tem
        1 ocorrência disponível)."""
        cargos_ja_candidatados_por_vaga = {
            "vaga-17": {"Porteiro"},
            "vaga-20": {"Porteiro"},
        }
        mapa = emp._construir_cargos_consolidados(
            _vagas_fixture_producao_secao_2_2(), cargos_ja_candidatados_por_vaga, set(),
            _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
        )
        porteiro = next(g for g in mapa.values() if g["cargo_exibicao"].lower() == "porteiro")
        assert porteiro["quantidade_total"] == 20  # só a ocorrência da vaga-21 restou
        assert len(porteiro["ocorrencias"]) == 1
        assert porteiro["ocorrencias"][0]["vaga_id"] == "vaga-21"

    def test_exclusao_de_todas_as_ocorrencias_faz_cargo_sumir_do_mapa(self):
        """Pergunta 5 da story — quando TODAS as ocorrências de um cargo já
        foram candidatadas, o cargo inteiro some do Nível 1 (soma zero)."""
        cargos_ja_candidatados_por_vaga = {
            "vaga-17": {"Porteiro"},
            "vaga-20": {"Porteiro"},
            "vaga-21": {"porteiro"},
        }
        mapa = emp._construir_cargos_consolidados(
            _vagas_fixture_producao_secao_2_2(), cargos_ja_candidatados_por_vaga, set(),
            _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
        )
        assert all(g["cargo_exibicao"].lower() != "porteiro" for g in mapa.values())

    def test_vaga_normal_ja_candidatada_e_excluida_inteira(self):
        """vaga_normal não tem cargo_escolhido — candidatura bloqueia a vaga
        inteira (mesmo padrão já usado em `_buscar_vagas_abertas_e_candidaturas`)."""
        vagas = [{
            "id": "vaga-y", "tipo": "vaga_normal", "empresa_id": "emp-singular",
            "titulo": "Consultora de Vendas", "total_vagas": 1,
            "unidade_destino": "global",
        }]
        mapa = emp._construir_cargos_consolidados(vagas, {}, {"vaga-y"}, _EMPRESAS_POR_ID_FIXTURE, {})
        assert mapa == {}

    def test_resolver_nome_unidade_cuca_fail_safe_uuid_nao_encontrado(self):
        """Fail-safe (seção 2.4/3) — UUID que não bate com nenhuma unidade
        conhecida cai pro próprio valor bruto, em vez de quebrar."""
        uuid_desconhecido = "99999999-9999-9999-9999-999999999999"
        assert emp._resolver_nome_unidade_cuca(uuid_desconhecido, {}) == uuid_desconhecido

    def test_normalizar_cargo_basico_colapsa_espacos_duplos(self):
        assert emp._normalizar_cargo_basico("Costureira   Overlock") == "costureira overlock"
        assert emp._normalizar_cargo_basico("  Porteiro  ") == "porteiro"


# ─────────────────────────────────────────────────────────────────────────────
# S-EMP-AUD-023 passo 2/5 — plugagem do motor no fluxo real de conversa.
# ─────────────────────────────────────────────────────────────────────────────

class TestS_EMP_AUD_023Passo2FluxoReal:

    @pytest.mark.asyncio
    async def test_entrada_fresca_mostra_nivel1_cargo_consolidado(self, monkeypatch, _isola_enviar):
        """Ponto de entrada novo: 'ver vagas' não mostra mais categoria/setor
        — mostra o cargo consolidado direto (Nível 1)."""
        estado, fake_get, fake_set = _fluxo_mock("inicio", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [
            {
                "id": "vaga-17", "tipo": "selecao_evento", "empresa_id": "emp-singular",
                "unidade_cuca": None,
                "cargos_lista": [{"titulo": "Porteiro", "quantidade": 30}],
            },
        ]
        fake.empresas = [{"id": "emp-singular", "nome": "SINGULAR FACILITIES SERVICE S.A.", "nome_fantasia": ""}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico(
            "quero ver vagas", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3]
        assert "escolha um ou mais cargos" in texto_enviado.lower()
        assert "porteiro" in texto_enviado.lower()
        assert "categoria" not in texto_enviado.lower()
        assert estado["etapa"] == "listou_cargos_consolidados"
        assert estado["mapa_cargos_consolidados"]["1"]["cargo_exibicao"] == "Porteiro"

    @pytest.mark.asyncio
    async def test_escolha_nivel1_unico_cargo_mostra_nivel2(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("listou_cargos_consolidados", {
            "perfil": "publico",
            "mapa_cargos_consolidados": {
                "1": {
                    "cargo_exibicao": "Porteiro",
                    "quantidade_total": 30,
                    "ocorrencias": [{
                        "vaga_id": "vaga-17", "tipo": "selecao_evento",
                        "cargo_titulo_original": "Porteiro", "quantidade": 30,
                        "empresa_nome": "SINGULAR", "rotulo_tipo": "Processo seletivo Cuca: Toda a Rede",
                    }],
                },
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", _SupabaseFakeBloco6())

        await emp._processar_publico("1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        texto_enviado = _isola_enviar.call_args.args[3]
        assert "*Porteiro*" in texto_enviado
        assert "SINGULAR" in texto_enviado
        assert estado["etapa"] == "listou_ocorrencias_cargo"
        assert estado["mapa_ocorrencias"]["1"]["vaga_id"] == "vaga-17"

    @pytest.mark.asyncio
    async def test_escolha_nivel1_multipla_numera_ocorrencias_de_forma_continua(self, monkeypatch, _isola_enviar):
        """Decisão registrada nesta sessão: numeração contínua entre blocos
        (não reinicia em 1 a cada cargo) — evita ambiguidade de resposta."""
        estado, fake_get, fake_set = _fluxo_mock("listou_cargos_consolidados", {
            "perfil": "publico",
            "mapa_cargos_consolidados": {
                "1": {
                    "cargo_exibicao": "Porteiro", "quantidade_total": 50,
                    "ocorrencias": [
                        {"vaga_id": "v1", "tipo": "selecao_evento", "cargo_titulo_original": "Porteiro",
                         "quantidade": 30, "empresa_nome": "Empresa A", "rotulo_tipo": "Processo seletivo Cuca: Toda a Rede"},
                        {"vaga_id": "v2", "tipo": "selecao_evento", "cargo_titulo_original": "Porteiro",
                         "quantidade": 20, "empresa_nome": "Empresa B", "rotulo_tipo": "Processo seletivo Cuca: Toda a Rede"},
                    ],
                },
                "2": {
                    "cargo_exibicao": "Consultora de Vendas", "quantidade_total": 1,
                    "ocorrencias": [
                        {"vaga_id": "v3", "tipo": "vaga_normal", "cargo_titulo_original": "Consultora de Vendas",
                         "quantidade": 1, "empresa_nome": "Maraponga Mart Moda", "rotulo_tipo": "Vaga individual"},
                    ],
                },
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", _SupabaseFakeBloco6())

        await emp._processar_publico("1,2", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        mapa_ocorrencias = estado["mapa_ocorrencias"]
        assert mapa_ocorrencias["1"]["vaga_id"] == "v1"
        assert mapa_ocorrencias["2"]["vaga_id"] == "v2"
        # A ocorrência da Consultora continua a numeração (3), não reinicia em 1.
        assert mapa_ocorrencias["3"]["vaga_id"] == "v3"

    @pytest.mark.asyncio
    async def test_nivel2_selecao_evento_com_coleta_curriculo_pede_nome(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("listou_ocorrencias_cargo", {
            "perfil": "publico",
            "mapa_ocorrencias": {
                "1": {"vaga_id": "vaga-17", "tipo": "selecao_evento", "cargo_titulo_original": "Porteiro",
                      "quantidade": 30, "empresa_nome": "SINGULAR", "rotulo_tipo": "...", "cargo_exibicao": "Porteiro"},
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.coleta_curriculo_por_vaga = {"vaga-17": True}
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico("1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        assert estado["etapa"] == "coletando_nome_candidato"
        assert estado["cargos_escolhidos"] == ["Porteiro"]
        assert estado["vaga_id_selecionada"] == "vaga-17"

    @pytest.mark.asyncio
    async def test_nivel2_selecao_evento_sem_coleta_curriculo_pede_presenca(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("listou_ocorrencias_cargo", {
            "perfil": "publico",
            "mapa_ocorrencias": {
                "1": {"vaga_id": "vaga-17", "tipo": "selecao_evento", "cargo_titulo_original": "Porteiro",
                      "quantidade": 30, "empresa_nome": "SINGULAR", "rotulo_tipo": "...", "cargo_exibicao": "Porteiro"},
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.coleta_curriculo_por_vaga = {"vaga-17": False}
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico("1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        assert estado["etapa"] == "confirmando_presenca_nome"
        assert estado["cargos_escolhidos"] == ["Porteiro"]

    @pytest.mark.asyncio
    async def test_nivel2_vaga_normal_global_pergunta_unidade(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("listou_ocorrencias_cargo", {
            "perfil": "publico",
            "mapa_ocorrencias": {
                "1": {"vaga_id": "v3", "tipo": "vaga_normal", "cargo_titulo_original": "Consultora de Vendas",
                      "quantidade": 1, "empresa_nome": "Maraponga", "rotulo_tipo": "Vaga individual",
                      "cargo_exibicao": "Consultora de Vendas"},
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [{"id": "v3", "unidade_destino": "global"}]
        fake.unidades = [{"id": "u1", "nome": "Barra"}, {"id": "u2", "nome": "Mondubim"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico("1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        assert estado["etapa"] == "aguardando_escolha_unidade"
        texto_enviado = _isola_enviar.call_args.args[3]
        assert "toda a rede" in texto_enviado.lower()

    @pytest.mark.asyncio
    async def test_nivel2_vaga_normal_unidade_especifica_pede_nome(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("listou_ocorrencias_cargo", {
            "perfil": "publico",
            "mapa_ocorrencias": {
                "1": {"vaga_id": "v3", "tipo": "vaga_normal", "cargo_titulo_original": "Consultora de Vendas",
                      "quantidade": 1, "empresa_nome": "Maraponga", "rotulo_tipo": "Vaga individual — CUCA Pici",
                      "cargo_exibicao": "Consultora de Vendas"},
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [{"id": "v3", "unidade_destino": "unidade-pici"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico("1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        assert estado["etapa"] == "coletando_nome_candidato"
        assert estado["vaga_id_selecionada"] == "v3"

    @pytest.mark.asyncio
    async def test_nivel2_escolha_multipla_roteia_a_primeira_e_avisa(self, monkeypatch, _isola_enviar):
        """Seção 5, regra 5 — PARCIAL no passo 2: só a 1ª ocorrência é
        roteada; a fila que encadeia as demais é escopo do passo 3."""
        estado, fake_get, fake_set = _fluxo_mock("listou_ocorrencias_cargo", {
            "perfil": "publico",
            "mapa_ocorrencias": {
                "1": {"vaga_id": "v1", "tipo": "selecao_evento", "cargo_titulo_original": "Porteiro",
                      "quantidade": 30, "empresa_nome": "Empresa A", "rotulo_tipo": "...", "cargo_exibicao": "Porteiro"},
                "2": {"vaga_id": "v3", "tipo": "vaga_normal", "cargo_titulo_original": "Consultora de Vendas",
                      "quantidade": 1, "empresa_nome": "Maraponga", "rotulo_tipo": "Vaga individual",
                      "cargo_exibicao": "Consultora de Vendas"},
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.coleta_curriculo_por_vaga = {"v1": True}
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico("1,2", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        # 1ª mensagem: avisa que vai processar 1 de cada vez.
        primeira_msg = _isola_enviar.call_args_list[0].args[3]
        assert "porteiro" in primeira_msg.lower()
        # Roteou de fato só a 1ª ocorrência (selecao_evento → coletando nome).
        assert estado["etapa"] == "coletando_nome_candidato"
        assert estado["cargos_escolhidos"] == ["Porteiro"]

    @pytest.mark.asyncio
    async def test_voltar_de_ocorrencias_volta_pro_nivel1(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("listou_ocorrencias_cargo", {
            "perfil": "publico",
            "mapa_cargos_consolidados": {
                "1": {"cargo_exibicao": "Porteiro", "quantidade_total": 30, "ocorrencias": []},
            },
            "mapa_ocorrencias": {"1": {"vaga_id": "v1"}},
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", _SupabaseFakeBloco6())

        await emp._processar_publico("voltar", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        assert estado["etapa"] == "listou_cargos_consolidados"
        assert "mapa_ocorrencias" not in estado

    @pytest.mark.asyncio
    async def test_voltar_de_cargos_consolidados_volta_pro_menu_inicial(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("listou_cargos_consolidados", {
            "perfil": "publico",
            "mapa_cargos_consolidados": {"1": {"cargo_exibicao": "Porteiro", "quantidade_total": 30, "ocorrencias": []}},
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", _SupabaseFakeBloco6())

        await emp._processar_publico("voltar", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        assert estado["etapa"] == "inicio"

    @pytest.mark.asyncio
    async def test_exclusao_por_ocorrencia_nao_esconde_outros_cargos_da_mesma_selecao(self, monkeypatch, _isola_enviar):
        """Corretude que o passo 2 corrige em relação ao filtro antigo: o lead
        já se candidatou ao cargo 'Porteiro' desta seleção (registrado no
        banco), mas os OUTROS cargos da mesma seleção continuam visíveis —
        pergunta 5 da story, exclusão por ocorrência, não pela vaga inteira."""
        estado, fake_get, fake_set = _fluxo_mock("inicio", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [
            {
                "id": "vaga-17", "tipo": "selecao_evento", "empresa_id": "emp-singular",
                "unidade_cuca": None,
                "cargos_lista": [
                    {"titulo": "Porteiro", "quantidade": 30},
                    {"titulo": "Jardineiro", "quantidade": 10},
                ],
            },
        ]
        fake.candidaturas_busca = [
            {"vaga_id": "vaga-17", "status": "pendente", "cargo_escolhido": "Porteiro"},
        ]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico(
            "quero ver vagas", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mapa_cargos = estado["mapa_cargos_consolidados"]
        nomes = {g["cargo_exibicao"] for g in mapa_cargos.values()}
        assert "Jardineiro" in nomes
        assert "Porteiro" not in nomes

    @pytest.mark.asyncio
    async def test_escape_semantico_dispara_em_listou_cargos_consolidados(self, monkeypatch, _isola_enviar):
        """Seção 5, regra 7 / item do test plan (seção 10): escape semântico
        precisa estar ligado desde o nascimento da etapa nova — não repetir o
        gap que a S-EMP-AUD-024 corrigiu. Entrada não numérica força o parser
        determinístico a falhar, caindo no classificador semântico; com
        quer_sair=True, encerra o fluxo em vez de só re-exibir a lista."""
        estado, fake_get, fake_set = _fluxo_mock("listou_cargos_consolidados", {
            "perfil": "publico",
            "mapa_cargos_consolidados": {
                "1": {"cargo_exibicao": "Porteiro", "quantidade_total": 30, "ocorrencias": []},
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", _SupabaseFakeBloco6())

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=True))

        await emp._processar_publico(
            "na verdade desiste, obrigado", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        # _encerrar_fluxo limpa o estado — só acontece se o classificador
        # semântico foi de fato chamado e seu quer_sair foi honrado (o
        # parser determinístico de número, sozinho, nunca zera o fluxo).
        assert estado == {}

    @pytest.mark.asyncio
    async def test_escape_semantico_dispara_em_listou_ocorrencias_cargo(self, monkeypatch, _isola_enviar):
        """Mesma cobertura da regra 7 pro Nível 2."""
        estado, fake_get, fake_set = _fluxo_mock("listou_ocorrencias_cargo", {
            "perfil": "publico",
            "mapa_ocorrencias": {
                "1": {"vaga_id": "v1", "tipo": "selecao_evento", "cargo_titulo_original": "Porteiro",
                      "quantidade": 30, "empresa_nome": "Empresa A", "rotulo_tipo": "...", "cargo_exibicao": "Porteiro"},
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", _SupabaseFakeBloco6())

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(quer_sair=True))

        await emp._processar_publico(
            "na verdade desiste, obrigado", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado == {}


# ─────────────────────────────────────────────────────────────────────────────
# S-EMP-AUD-023 passo 3/5 — fila_candidaturas_pendentes (seção 5, regra 5).
# ─────────────────────────────────────────────────────────────────────────────

class TestS_EMP_AUD_023Passo3FilaCandidaturas:

    @pytest.mark.asyncio
    async def test_escolha_multipla_no_nivel2_popula_a_fila_com_o_restante(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("listou_ocorrencias_cargo", {
            "perfil": "publico",
            "mapa_ocorrencias": {
                "1": {"vaga_id": "v1", "tipo": "selecao_evento", "cargo_titulo_original": "Porteiro",
                      "quantidade": 30, "empresa_nome": "Empresa A", "rotulo_tipo": "...", "cargo_exibicao": "Porteiro"},
                "2": {"vaga_id": "v3", "tipo": "vaga_normal", "cargo_titulo_original": "Consultora de Vendas",
                      "quantidade": 1, "empresa_nome": "Maraponga", "rotulo_tipo": "Vaga individual",
                      "cargo_exibicao": "Consultora de Vendas"},
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.coleta_curriculo_por_vaga = {"v1": True}
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico("1,2", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        # 1ª ocorrência roteada de imediato (seleção → coletando nome).
        assert estado["etapa"] == "coletando_nome_candidato"
        assert estado["cargos_escolhidos"] == ["Porteiro"]
        # 2ª ocorrência guardada na fila, pronta pra ser consumida ao final.
        fila = estado["fila_candidaturas_pendentes"]
        assert len(fila) == 1
        assert fila[0]["vaga_id"] == "v3"

    @pytest.mark.asyncio
    async def test_conclusao_de_candidatura_por_link_encadeia_proxima_da_fila_automaticamente(self, monkeypatch, _isola_enviar):
        """Ponto de conclusão: aguardando_confirmacao_candidatura (vaga_normal
        / link). Com fila pendente, não oferece 'outra/encerrar' — já roteia
        a próxima ocorrência sozinho."""
        proxima = {
            "vaga_id": "v9", "tipo": "vaga_normal", "cargo_titulo_original": "Auxiliar",
            "quantidade": 2, "empresa_nome": "Empresa X", "rotulo_tipo": "Vaga individual",
            "cargo_exibicao": "Auxiliar",
        }
        estado, fake_get, fake_set = _fluxo_mock("aguardando_confirmacao_candidatura", {
            "perfil": "publico",
            "banco_talentos": False,
            "candidatura_criada_id": "cand-1",
            "candidatura_codigo": "ABC123",
            "vaga_id_selecionada": "v1",
            "nome_candidato": "Maria Silva",
            "historico_vagas_aplicadas": [],
            "fila_candidaturas_pendentes": [proxima],
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [{"id": "v9", "unidade_destino": "unidade-x"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico("oi", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        # Não caiu em pos_candidatura (que ofereceria "outra/encerrar") — foi
        # direto pra rota da próxima ocorrência (vaga_normal específica → pede nome).
        assert estado["etapa"] == "coletando_nome_candidato"
        assert estado["vaga_id_selecionada"] == "v9"
        # Fila consumida — item processado sai da lista.
        assert estado["fila_candidaturas_pendentes"] == []
        # Histórico da candidatura concluída foi salvo antes de seguir.
        assert "v1" in estado["historico_vagas_aplicadas"]

    @pytest.mark.asyncio
    async def test_fila_nunca_reaproveita_nome_entre_candidaturas_diferentes(self, monkeypatch, _isola_enviar):
        """Seção 5, regra 5, literal: 'nunca reaproveitando nome/dados entre
        elas'. Mesmo com nome_candidato_prefill de uma candidatura anterior
        disponível no fluxo, o item dequeueado da fila pede nome de novo."""
        proxima = {
            "vaga_id": "v9", "tipo": "vaga_normal", "cargo_titulo_original": "Auxiliar",
            "quantidade": 2, "empresa_nome": "Empresa X", "rotulo_tipo": "Vaga individual",
            "cargo_exibicao": "Auxiliar",
        }
        estado, fake_get, fake_set = _fluxo_mock("aguardando_confirmacao_candidatura", {
            "perfil": "publico",
            "banco_talentos": False,
            "candidatura_criada_id": "cand-1",
            "candidatura_codigo": "ABC123",
            "vaga_id_selecionada": "v1",
            "nome_candidato": "Maria Silva",
            "nome_candidato_prefill": "Maria Silva",  # já existia de antes
            "historico_vagas_aplicadas": [],
            "fila_candidaturas_pendentes": [proxima],
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [{"id": "v9", "unidade_destino": "unidade-x"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico("oi", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        # Se tivesse reaproveitado o prefill, teria ido direto pro link
        # (_enviar_link_candidatura → aguardando_confirmacao_candidatura),
        # pulando a coleta de nome. Confirma que pediu nome de novo.
        assert estado["etapa"] == "coletando_nome_candidato"

    @pytest.mark.asyncio
    async def test_fila_com_vaga_global_tambem_nao_reaproveita_nome(self, monkeypatch, _isola_enviar):
        """Achado do @qa (revisão do passo 3): o caso acima só cobria vaga
        individual de unidade ESPECÍFICA. O branch de vaga GLOBAL (pergunta
        unidade antes de pedir nome) tem seu próprio ponto de limpeza do
        prefill — sem este teste, remover essa limpeza não quebrava nenhum
        teste (confirmado pelo @qa desligando o código na mão). Aqui a
        próxima ocorrência da fila é uma vaga_normal global; com
        nome_candidato_prefill de uma candidatura anterior no fluxo, confirma
        que a etapa seguinte (aguardando_escolha_unidade) NÃO carrega esse
        prefill — só assim, quando a unidade for escolhida, o handler
        genérico de aguardando_escolha_unidade vai pedir o nome de novo em
        vez de pular direto pro link com o nome antigo."""
        proxima_global = {
            "vaga_id": "v9", "tipo": "vaga_normal", "cargo_titulo_original": "Auxiliar",
            "quantidade": 2, "empresa_nome": "Empresa X", "rotulo_tipo": "Vaga individual",
            "cargo_exibicao": "Auxiliar",
        }
        estado, fake_get, fake_set = _fluxo_mock("aguardando_confirmacao_candidatura", {
            "perfil": "publico",
            "banco_talentos": False,
            "candidatura_criada_id": "cand-1",
            "candidatura_codigo": "ABC123",
            "vaga_id_selecionada": "v1",
            "nome_candidato": "Maria Silva",
            "nome_candidato_prefill": "Maria Silva",  # já existia de antes
            "historico_vagas_aplicadas": [],
            "fila_candidaturas_pendentes": [proxima_global],
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [{"id": "v9", "unidade_destino": "global"}]
        fake.unidades = [{"id": "u1", "nome": "Barra"}, {"id": "u2", "nome": "Mondubim"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico("oi", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        assert estado["etapa"] == "aguardando_escolha_unidade"
        # A prova real do achado: se o prefill não fosse limpo aqui, ficaria
        # "Maria Silva" (herdado da candidatura anterior) — pediria unidade
        # e, ao escolher, iria direto pro link sem pedir nome de novo.
        assert estado["nome_candidato_prefill"] == ""

    @pytest.mark.asyncio
    async def test_conclusao_de_selecao_encadeia_proxima_da_fila_automaticamente(self, monkeypatch, _isola_enviar):
        """Ponto de conclusão: confirmando_presenca_telefone (SQS-56, seleção
        sem coleta de currículo). Com fila pendente, encadeia a próxima."""
        proxima = {
            "vaga_id": "v9", "tipo": "selecao_evento", "cargo_titulo_original": "Jardineiro",
            "quantidade": 10, "empresa_nome": "Empresa Y", "rotulo_tipo": "Processo seletivo Cuca: Toda a Rede",
            "cargo_exibicao": "Jardineiro",
        }
        estado, fake_get, fake_set = _fluxo_mock("confirmando_presenca_telefone", {
            "perfil": "publico",
            "nome_confirmacao_presenca": "João Souza",
            "cargos_escolhidos": ["Porteiro"],
            "vaga_id_selecionada": "v1",
            "empresa_nome_selecao": "Empresa A",
            "historico_vagas_aplicadas": [],
            "fila_candidaturas_pendentes": [proxima],
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.coleta_curriculo_por_vaga = {"v9": True}
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico(
            "85999998888", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        # Não caiu em pos_candidatura — encadeou a próxima ocorrência da fila
        # (seleção, coleta_curriculo=True → coletando_nome_candidato).
        assert estado["etapa"] == "coletando_nome_candidato"
        assert estado["cargos_escolhidos"] == ["Jardineiro"]
        assert estado["fila_candidaturas_pendentes"] == []

    @pytest.mark.asyncio
    async def test_sem_fila_mantem_comportamento_antigo_de_outra_ou_encerrar(self, monkeypatch, _isola_enviar):
        """Regressão: sem fila pendente, o fluxo de conclusão continua
        oferecendo 'outra'/'encerrar' como sempre — passo 3 não muda o
        caminho comum (1 candidatura só)."""
        estado, fake_get, fake_set = _fluxo_mock("aguardando_confirmacao_candidatura", {
            "perfil": "publico",
            "banco_talentos": False,
            "candidatura_criada_id": "cand-1",
            "candidatura_codigo": "ABC123",
            "vaga_id_selecionada": "v1",
            "nome_candidato": "Maria Silva",
            "historico_vagas_aplicadas": [],
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "supabase", _SupabaseFakeBloco6())

        await emp._processar_publico("oi", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra")

        assert estado["etapa"] == "pos_candidatura"


# ─────────────────────────────────────────────────────────────────────────────
# S-EMP-AUD-023 passo 4/5 — normalização de cargo via IA (seção 8.1, passo 2).
# ─────────────────────────────────────────────────────────────────────────────

class TestS_EMP_AUD_023Passo4NormalizacaoIA:

    def setup_method(self):
        emp._CACHE_NORMALIZACAO_CARGOS.clear()

    @pytest.mark.asyncio
    async def test_menos_de_2_titulos_nao_chama_ia(self, monkeypatch):
        mock_ia = AsyncMock()
        monkeypatch.setattr(emp, "_chamar_ia_normalizacao_cargos", mock_ia)

        resultado = await emp._normalizar_cargos_via_ia(["Porteiro"])

        assert resultado == {}
        mock_ia.assert_not_called()

    @pytest.mark.asyncio
    async def test_aplica_grupo_retornado_pela_ia(self, monkeypatch):
        mock_ia = AsyncMock(return_value={
            "grupos": [
                {"canonico": "Auxiliar de Manutenção", "membros": [
                    "Auxiliar de Manutenção", "Auxiliar de menutenção",
                ]},
            ],
        })
        monkeypatch.setattr(emp, "_chamar_ia_normalizacao_cargos", mock_ia)

        resultado = await emp._normalizar_cargos_via_ia(
            ["Auxiliar de Manutenção", "Auxiliar de menutenção", "Porteiro"]
        )

        assert resultado["auxiliar de manutenção"] == "Auxiliar de Manutenção"
        assert resultado["auxiliar de menutenção"] == "Auxiliar de Manutenção"
        # "Porteiro" não fazia parte de nenhum grupo — não deve aparecer no mapa.
        assert "porteiro" not in resultado

    @pytest.mark.asyncio
    async def test_ignora_titulo_que_a_ia_inventou_fora_da_lista_original(self, monkeypatch):
        """Fail-safe contra alucinação: a IA respondeu com um membro que não
        estava na lista enviada — esse membro é descartado, não vira uma
        chave nova e imprevisível no mapa."""
        mock_ia = AsyncMock(return_value={
            "grupos": [
                {"canonico": "Auxiliar de Manutenção", "membros": [
                    "Auxiliar de Manutenção", "Cargo Que Não Existia Na Lista",
                ]},
            ],
        })
        monkeypatch.setattr(emp, "_chamar_ia_normalizacao_cargos", mock_ia)

        resultado = await emp._normalizar_cargos_via_ia(["Auxiliar de Manutenção", "Porteiro"])

        assert resultado == {"auxiliar de manutenção": "Auxiliar de Manutenção"}

    @pytest.mark.asyncio
    async def test_ignora_canonico_sem_relacao_com_titulos_originais(self, monkeypatch):
        """Fail-safe de conteúdo: a IA juntou 2 títulos reais, mas devolveu um
        `canonico` sem nenhuma palavra em comum com os títulos originais do
        grupo — texto sintetizado desconexo do dado enviado, não pode virar
        nome exibido pro candidato."""
        mock_ia = AsyncMock(return_value={
            "grupos": [
                {"canonico": "Vaga Incrível Imperdível", "membros": [
                    "Auxiliar de Manutenção", "Auxiliar de Manutençao",
                ]},
            ],
        })
        monkeypatch.setattr(emp, "_chamar_ia_normalizacao_cargos", mock_ia)

        resultado = await emp._normalizar_cargos_via_ia(
            ["Auxiliar de Manutenção", "Auxiliar de Manutençao"]
        )

        assert resultado == {}

    @pytest.mark.asyncio
    async def test_ignora_grupo_com_menos_de_2_membros(self, monkeypatch):
        mock_ia = AsyncMock(return_value={
            "grupos": [{"canonico": "Porteiro", "membros": ["Porteiro"]}],
        })
        monkeypatch.setattr(emp, "_chamar_ia_normalizacao_cargos", mock_ia)

        resultado = await emp._normalizar_cargos_via_ia(["Porteiro", "Jardineiro"])

        assert resultado == {}

    @pytest.mark.asyncio
    async def test_fail_safe_quando_ia_lanca_excecao(self, monkeypatch):
        async def _falha(titulos):
            raise RuntimeError("timeout simulado")

        monkeypatch.setattr(emp, "_chamar_ia_normalizacao_cargos", _falha)

        resultado = await emp._normalizar_cargos_via_ia(["Auxiliar de Manutenção", "Porteiro"])

        assert resultado == {}

    @pytest.mark.asyncio
    async def test_cache_evita_2a_chamada_de_ia_pro_mesmo_conjunto_de_titulos(self, monkeypatch):
        mock_ia = AsyncMock(return_value={"grupos": []})
        monkeypatch.setattr(emp, "_chamar_ia_normalizacao_cargos", mock_ia)

        titulos = ["Auxiliar de Manutenção", "Porteiro"]
        await emp._normalizar_cargos_via_ia(titulos)
        await emp._normalizar_cargos_via_ia(list(reversed(titulos)))  # mesma lista, ordem diferente

        mock_ia.assert_awaited_once()

    def test_construir_cargos_consolidados_funde_erro_de_digitacao_via_mapa_ia(self):
        """Cenário real de produção (seção 2.2): 'Auxiliar de Manutenção'
        (vaga-17, 20) + 'auxiliar de manutenção' (vaga-21, 20, já unificado
        pelo pré-passo) + 'Auxiliar de menutenção' (vaga-20, 20, erro de
        digitação real — NÃO unifica só com o pré-passo, precisa da IA) —
        com o mapa da IA, os 3 somam 60."""
        mapa_ia = {
            "auxiliar de manutenção": "Auxiliar de Manutenção",
            "auxiliar de menutenção": "Auxiliar de Manutenção",
        }
        mapa = emp._construir_cargos_consolidados(
            _vagas_fixture_producao_secao_2_2(), {}, set(),
            _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
            mapa_normalizacao_ia=mapa_ia,
        )
        grupo_manutencao = next(g for g in mapa.values() if g["cargo_exibicao"] == "Auxiliar de Manutenção")
        assert grupo_manutencao["quantidade_total"] == 60
        assert len(grupo_manutencao["ocorrencias"]) == 3

    def test_construir_cargos_consolidados_falso_positivo_nao_agrupa_auxiliares_diferentes(self):
        """Teste crítico do test plan (seção 10): mesmo com o mapa da IA
        presente, 'Auxiliar de Serviços Gerais' e 'Auxiliar de Cozinha'
        continuam separados de 'Auxiliar de Manutenção' — a IA só juntou o
        que realmente é o mesmo cargo (erro de digitação), nunca por
        similaridade genérica de palavra ('Auxiliar')."""
        mapa_ia = {
            "auxiliar de manutenção": "Auxiliar de Manutenção",
            "auxiliar de menutenção": "Auxiliar de Manutenção",
        }
        mapa = emp._construir_cargos_consolidados(
            _vagas_fixture_producao_secao_2_2(), {}, set(),
            _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
            mapa_normalizacao_ia=mapa_ia,
        )
        nomes = {g["cargo_exibicao"] for g in mapa.values()}
        assert "Auxiliar de Serviços Gerais" in nomes
        assert "Auxiliar de Cozinha" in nomes
        assert "Auxiliar de Manutenção" in nomes
        # 3 grupos distintos — nenhum se fundiu com outro só por "Auxiliar".
        grupo_servicos = next(g for g in mapa.values() if g["cargo_exibicao"] == "Auxiliar de Serviços Gerais")
        grupo_cozinha = next(g for g in mapa.values() if g["cargo_exibicao"] == "Auxiliar de Cozinha")
        assert grupo_servicos["quantidade_total"] == 150  # 50+50+50, 3 seleções, pré-passo já unifica caixa
        assert grupo_cozinha["quantidade_total"] == 20

    def test_mapa_normalizacao_ia_ausente_preserva_comportamento_do_passo1(self):
        """Sem mapa (default None), o resultado é idêntico ao passo 1 — a
        'Auxiliar de menutenção' (erro de digitação) continua separada."""
        mapa = emp._construir_cargos_consolidados(
            _vagas_fixture_producao_secao_2_2(), {}, set(),
            _EMPRESAS_POR_ID_FIXTURE, _UNIDADES_POR_ID_FIXTURE,
        )
        nomes = {g["cargo_exibicao"].lower() for g in mapa.values()}
        assert "auxiliar de menutenção" in nomes  # não unificou — sem IA, esperado

    @pytest.mark.asyncio
    async def test_entrada_fresca_usa_normalizacao_ia_na_listagem(self, monkeypatch, _isola_enviar):
        """Fim a fim: o ponto de entrada ('ver vagas') chama a IA e usa o
        resultado — 'Porteiro' e 'porteiro' (grafias diferentes) aparecem
        consolidados num único cargo com o nome canônico da IA."""
        estado, fake_get, fake_set = _fluxo_mock("inicio", {"perfil": "publico"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [
            {
                "id": "vaga-1", "tipo": "selecao_evento", "empresa_id": "emp-x",
                "unidade_cuca": None,
                "cargos_lista": [{"titulo": "Aux. de Cozinha", "quantidade": 10}],
            },
            {
                "id": "vaga-2", "tipo": "selecao_evento", "empresa_id": "emp-x",
                "unidade_cuca": None,
                "cargos_lista": [{"titulo": "Auxiliar de Cozinha", "quantidade": 5}],
            },
        ]
        monkeypatch.setattr(emp, "supabase", fake)

        mock_ia = AsyncMock(return_value={
            "grupos": [{"canonico": "Auxiliar de Cozinha", "membros": ["Aux. de Cozinha", "Auxiliar de Cozinha"]}],
        })
        monkeypatch.setattr(emp, "_chamar_ia_normalizacao_cargos", mock_ia)

        await emp._processar_publico(
            "quero ver vagas", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mapa_cargos = estado["mapa_cargos_consolidados"]
        assert len(mapa_cargos) == 1
        grupo = next(iter(mapa_cargos.values()))
        assert grupo["cargo_exibicao"] == "Auxiliar de Cozinha"
        assert grupo["quantidade_total"] == 15
        mock_ia.assert_awaited_once()


class TestBloco6PerformanceEParsers:

    @pytest.mark.asyncio
    async def test_listagem_empresa_agrega_contagens_sem_n_mais_1(self, monkeypatch, _isola_enviar):
        fake = _SupabaseFakeBloco6()
        fake.vagas_empresa = [
            {"id": "vaga-1", "titulo": "Atendente", "status": "aberta", "numero_vaga": 1},
            {"id": "vaga-2", "titulo": "Auxiliar", "status": "aberta", "numero_vaga": 2},
        ]
        fake.candidaturas_por_vaga = [
            {"vaga_id": "vaga-1"},
            {"vaga_id": "vaga-1"},
            {"vaga_id": "vaga-2"},
        ]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_consulta_empresa(
            "todas", "558599990000", "PHONE_ID", "token",
            {"empresa_id": "emp-1"}, "conv-1",
        )

        assert ("candidaturas", "vaga_id", ["vaga-1", "vaga-2"]) in fake.in_calls
        assert [call for call in fake.execute_calls if call[0] == "candidaturas" and call[1] == "vaga_id"]
        texto = _isola_enviar.call_args.args[3]
        assert "Atendente" in texto and "(2 candidatos)" in texto
        assert "Auxiliar" in texto and "(1 candidatos)" in texto

    @pytest.mark.asyncio
    async def test_busca_candidatura_nome_busca_titulos_em_lote(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("aguardando_id_candidato", {"perfil": "candidato"})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "_escape_semantico_ou_none", AsyncMock(return_value=False))

        def _normalizar_fake(valor):
            digitos = "".join(ch for ch in (valor or "") if ch.isdigit())
            if digitos.startswith("55") and len(digitos) > 11:
                return digitos[2:]
            return digitos

        monkeypatch.setattr(emp, "_telefone_normalizado_para_comparacao", _normalizar_fake)

        fake = _SupabaseFakeBloco6()
        fake.candidaturas_busca = [
            {"id": "cand-1", "status": "pendente", "vaga_id": "vaga-1", "created_at": "2026-01-01", "observacoes": "", "nome": "Maria Silva", "telefone": "8599990000"},
            {"id": "cand-2", "status": "pendente", "vaga_id": "vaga-2", "created_at": "2026-01-02", "observacoes": "", "nome": "Maria Silva", "telefone": "8599990000"},
        ]
        fake.vagas_titulos = [
            {"id": "vaga-1", "titulo": "Recepção"},
            {"id": "vaga-2", "titulo": "Cozinha"},
        ]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_candidato(
            "Maria Silva", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1",
        )

        chamada_vagas = next(call for call in fake.in_calls if call[0] == "vagas" and call[1] == "id")
        assert set(chamada_vagas[2]) == {"vaga-1", "vaga-2"}
        texto = "\n".join(c.args[3] for c in _isola_enviar.call_args_list)
        assert "Recepção" in texto
        assert "Cozinha" in texto
        assert estado.get("etapa") == "candidato_consultado"

    @pytest.mark.asyncio
    async def test_numero_vaga_ignora_partes_de_cnpj_e_usa_numero_isolado(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("selecionando_vaga_edicao", {
            "perfil": "empresa",
            "empresa_id": "emp-1",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        mock_vagas = MagicMock()
        mock_vagas.select.return_value.eq.return_value.not_.in_.return_value.execute.return_value.data = [
            {"id": "vaga-12", "titulo": "Errada", "status": "aberta", "numero_vaga": 12},
            {"id": "vaga-2", "titulo": "Certa", "status": "aberta", "numero_vaga": 2},
        ]
        monkeypatch.setattr(emp, "supabase", _mock_sb_multi_tabela({"vagas": mock_vagas}))

        await emp._processar_empresa(
            "meu cnpj é 12.345.678/0001-99, quero editar a vaga 2",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("vaga_edicao_id") == "vaga-2"
        assert "Certa" in _isola_enviar.call_args.args[3]


class TestBloco6OrdemEnvioEstado:

    @pytest.mark.asyncio
    async def test_vaga_normal_nao_avanca_estado_quando_envio_nome_falha(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("listou_vagas", {
            "perfil": "publico",
            "mapa_vagas": {"1": "vaga-1"},
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "_enviar", AsyncMock(return_value=False))

        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [
            {"id": "vaga-1", "titulo": "Atendente", "setor": ["Geral"], "unidade_destino": "Barra"},
        ]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico(
            "1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado["etapa"] == "listou_vagas"
        assert "vaga_id_selecionada" not in estado

    @pytest.mark.asyncio
    async def test_vaga_global_nao_avanca_estado_quando_envio_unidades_falha(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("listou_vagas", {
            "perfil": "publico",
            "mapa_vagas": {"1": "vaga-1"},
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "_enviar", AsyncMock(return_value=False))

        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [
            {"id": "vaga-1", "titulo": "Atendente", "setor": ["Geral"], "unidade_destino": "global"},
        ]
        fake.unidades = [{"id": "u1", "nome": "Barra"}, {"id": "u2", "nome": "Mondubim"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._processar_publico(
            "1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado["etapa"] == "listou_vagas"
        assert "unidades_opcoes" not in estado


class TestBloco6RotearPorIntencao:

    @pytest.mark.asyncio
    async def test_rota_empresa_pede_cnpj_e_define_fluxo(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        await emp._rotear_por_intencao(
            {"intencao": "empresa", "nome": "Ana"},
            "sou empresa", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado == {"perfil": "empresa", "etapa": "aguardando_cnpj"}
        assert "CNPJ" in _isola_enviar.call_args.args[3]

    @pytest.mark.asyncio
    async def test_rota_candidato_vaga_lista_vagas(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [{"id": "vaga-1", "titulo": "Atendente", "descricao": "Atendimento"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._rotear_por_intencao(
            {"intencao": "candidato_vaga", "nome": "Ana"},
            "quero vaga", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
            lambda _texto: (None, None),
        )

        assert estado["perfil"] == "publico"
        assert estado["etapa"] == "listou_vagas"
        assert estado["mapa_vagas"] == {"1": "vaga-1"}
        assert "Atendente" in _isola_enviar.call_args.args[3]

    @pytest.mark.asyncio
    async def test_rota_banco_talentos_pergunta_contexto(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        await emp._rotear_por_intencao(
            {"intencao": "banco_talentos"},
            "quero deixar curriculo", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado == {"perfil": "publico", "etapa": "inicio"}
        assert "Banco de Talentos" in _isola_enviar.call_args.args[3]

    @pytest.mark.asyncio
    async def test_rota_upload_pergunta_contexto_e_marca_arquivo_pendente(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        await emp._rotear_por_intencao(
            {"intencao": "upload"},
            "segue curriculo", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado == {"perfil": "publico", "etapa": "inicio", "arquivo_pendente": True}
        assert "subir seu currículo" in _isola_enviar.call_args.args[3]


class TestBloco6NotifyLoop:

    @pytest.mark.asyncio
    async def test_notify_tick_usa_limit_e_busca_telefones_em_lote(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        fake = _SupabaseFakeBloco6()
        fake.conversas = [
            {
                "id": "conv-1",
                "origem_id": "PHONE_ID",
                "lead_id": "lead-1",
                "metadata": {"empreg_fluxo": {
                    "etapa": "aguardando_retorno_vaga",
                    "empresa_id": "emp-1",
                    "vaga_criada_id": "00000000-0000-0000-0000-000000000123",
                    "vaga_numero": 7,
                    "vaga_titulo": "Atendente",
                }},
            },
            {
                "id": "conv-2",
                "origem_id": "PHONE_ID",
                "lead_id": "lead-2",
                "metadata": {"empreg_fluxo": {"etapa": "inicio"}},
            },
        ]
        fake.leads = [
            {"id": "lead-1", "telefone": "558599990000"},
            {"id": "lead-2", "telefone": "558588880000"},
        ]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._empregabilidade_notify_tick()

        assert ("conversas", 200) in fake.limit_calls
        assert ("leads", "id", ["lead-1"]) in fake.in_calls
        assert mock_enviar.await_count == 1

    # ─────────────────────────────────────────────────────────────────────
    # S-EMP-AUD-026: as 6 chamadas de _enviar do loop proativo precisam
    # passar conversa_id/lead_id, senão a mensagem nunca é gravada em
    # `mensagens` e não aparece no portal, mesmo tendo sido enviada com
    # sucesso pelo WhatsApp (causa raiz confirmada por leitura de código).
    # ─────────────────────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_notify_tick_vaga_criada_passa_conversa_id_e_lead_id(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        fake = _SupabaseFakeBloco6()
        fake.conversas = [{
            "id": "conv-1",
            "origem_id": "PHONE_ID",
            "lead_id": "lead-1",
            "metadata": {"empreg_fluxo": {
                "etapa": "aguardando_retorno_vaga",
                "empresa_id": "emp-1",
                "vaga_criada_id": "00000000-0000-0000-0000-000000000123",
                "vaga_numero": 7,
                "vaga_titulo": "Atendente",
            }},
        }]
        fake.leads = [{"id": "lead-1", "telefone": "558599990000"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._empregabilidade_notify_tick()

        assert mock_enviar.await_count == 1
        _, kwargs = mock_enviar.call_args
        assert kwargs.get("conversa_id") == "conv-1"
        assert kwargs.get("lead_id") == "lead-1"

    @pytest.mark.asyncio
    async def test_notify_tick_selecao_criada_passa_conversa_id_e_lead_id(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        fake = _SupabaseFakeBloco6()
        fake.conversas = [{
            "id": "conv-2",
            "origem_id": "PHONE_ID",
            "lead_id": "lead-2",
            "metadata": {"empreg_fluxo": {
                "etapa": "aguardando_retorno_selecao",
                "empresa_id": "emp-2",
                "vaga_criada_id": "00000000-0000-0000-0000-000000000456",
                "vaga_numero": 9,
                "vaga_titulo": "Processo Seletivo Porteiro",
            }},
        }]
        fake.leads = [{"id": "lead-2", "telefone": "558588880000"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._empregabilidade_notify_tick()

        assert mock_enviar.await_count == 1
        _, kwargs = mock_enviar.call_args
        assert kwargs.get("conversa_id") == "conv-2"
        assert kwargs.get("lead_id") == "lead-2"

    @pytest.mark.asyncio
    async def test_notify_tick_edicao_confirmada_passa_conversa_id_e_lead_id(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        fake = _SupabaseFakeBloco6()
        fake.conversas = [{
            "id": "conv-3",
            "origem_id": "PHONE_ID",
            "lead_id": "lead-3",
            "metadata": {"empreg_fluxo": {
                "etapa": "aguardando_retorno_edicao",
                "empresa_id": "emp-3",
                "vaga_editada_id": "00000000-0000-0000-0000-000000000789",
                "vaga_editada_titulo": "Atendente",
                "vaga_editada_unidade": "Pici",
            }},
        }]
        fake.leads = [{"id": "lead-3", "telefone": "558577770000"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._empregabilidade_notify_tick()

        assert mock_enviar.await_count == 1
        _, kwargs = mock_enviar.call_args
        assert kwargs.get("conversa_id") == "conv-3"
        assert kwargs.get("lead_id") == "lead-3"

    @pytest.mark.asyncio
    async def test_notify_tick_banco_talentos_confirmado_passa_conversa_id_e_lead_id(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        fake = _SupabaseFakeBloco6()
        fake.conversas = [{
            "id": "conv-4",
            "origem_id": "PHONE_ID",
            "lead_id": "lead-4",
            "metadata": {"empreg_fluxo": {
                "etapa": "aguardando_confirmacao_candidatura",
                "banco_talentos": True,
                "candidatura_criada_id": "cand-1",
            }},
        }]
        fake.leads = [{"id": "lead-4", "telefone": "558566660000"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._empregabilidade_notify_tick()

        assert mock_enviar.await_count == 1
        _, kwargs = mock_enviar.call_args
        assert kwargs.get("conversa_id") == "conv-4"
        assert kwargs.get("lead_id") == "lead-4"

    @pytest.mark.asyncio
    async def test_notify_tick_candidatura_recebida_passa_conversa_id_e_lead_id_nas_2_mensagens(self, monkeypatch):
        """Etapa 'aguardando_confirmacao_candidatura' (fora do banco de
        talentos) dispara 2 mensagens (S37C-02) — as duas precisam do
        conversa_id/lead_id, não só a primeira."""
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        fake = _SupabaseFakeBloco6()
        fake.conversas = [{
            "id": "conv-5",
            "origem_id": "PHONE_ID",
            "lead_id": "lead-5",
            "metadata": {"empreg_fluxo": {
                "etapa": "aguardando_confirmacao_candidatura",
                "banco_talentos": False,
                "candidatura_criada_id": "cand-2",
                "candidatura_codigo": "ABC123",
            }},
        }]
        fake.leads = [{"id": "lead-5", "telefone": "558555550000"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._empregabilidade_notify_tick()

        assert mock_enviar.await_count == 2
        for call in mock_enviar.await_args_list:
            _, kwargs = call
            assert kwargs.get("conversa_id") == "conv-5"
            assert kwargs.get("lead_id") == "lead-5"


def test_consultar_cnpj_mascara_cnpj_em_warning(monkeypatch, caplog):
    class _ClientFake:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            raise RuntimeError("boom")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    httpx_fake = types.SimpleNamespace(AsyncClient=_ClientFake)
    monkeypatch.setitem(sys.modules, "httpx", httpx_fake)

    caplog.set_level("WARNING", logger="empregabilidade_engine")
    asyncio.run(emp._consultar_cnpj("12.345.678/0001-99"))

    texto_logs = "\n".join(record.getMessage() for record in caplog.records)
    assert "123456********" in texto_logs
    assert "12345678000199" not in texto_logs


# ─────────────────────────────────────────────────────────────────────────────
# SQS-58 (correção) — opção 5 separada da opção 4, sem travar telefone
# ─────────────────────────────────────────────────────────────────────────────

class TestOpcao5CriarCurriculoAgora:

    @pytest.mark.asyncio
    async def test_opcao_4_continua_indo_para_upload_de_arquivo(self, monkeypatch):
        """Opção 4 (arquivo pronto + triagem da IA) não pode voltar a apontar
        para o formulário público — regressão do desvio incorreto corrigido
        nesta sessão."""
        estado, fake_get, fake_set = _fluxo_mock("menu_inicial")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_menu_inicial(
            "4", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") == "coletando_nome_candidato"
        assert estado.get("banco_talentos") is True

    @pytest.mark.asyncio
    async def test_opcao_5_pede_nome_para_montar_curriculo_pelo_link(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("menu_inicial")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_menu_inicial(
            "5", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado.get("etapa") == "coletando_nome_curriculo_publico"
        texto_enviado = mock_enviar.call_args.args[3]
        assert "nome completo" in texto_enviado.lower()

    @pytest.mark.asyncio
    async def test_coletando_nome_curriculo_publico_envia_link_sem_travar_telefone(self, monkeypatch):
        """Nome vem preenchido no link; telefone e demais campos ficam livres
        para o candidato preencher no formulário — pode abrir o link de um
        WhatsApp diferente do número que deve constar no currículo (decisão
        do Junior, 2026-08-12)."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_curriculo_publico")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "PORTAL_URL", "https://portal.test")
        monkeypatch.setattr(emp, "_LINK_SECRET", "segredo-teste")
        monkeypatch.setattr(emp, "_criar_ou_recuperar_talent_bank", lambda nome, telefone: "talent-1")

        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_publico(
            "Fulano de Tal", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "/empregabilidade/curriculo?" in texto_enviado
        assert "talent_id=talent-1" in texto_enviado
        assert "nome=Fulano" in texto_enviado
        assert estado.get("etapa") == "aguardando_confirmacao_candidatura"
        assert estado.get("banco_talentos") is True
        assert estado.get("talent_id") == "talent-1"

    @pytest.mark.asyncio
    async def test_coletando_nome_curriculo_publico_faz_retry_em_falha_de_envio(self, monkeypatch):
        """Achado em produção 2026-08-13: ConnectTimeout esporádico pro Graph API
        deixava o candidato travado (etapa avançava mesmo sem o link ter sido
        enviado, `_enviar` nunca checado). Cobre o retry único e o fallback."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_curriculo_publico")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "PORTAL_URL", "https://portal.test")
        monkeypatch.setattr(emp, "_LINK_SECRET", "segredo-teste")
        monkeypatch.setattr(emp, "_criar_ou_recuperar_talent_bank", lambda nome, telefone: "talent-1")

        # 1ª tentativa falha (timeout simulado), 2ª tentativa funciona.
        mock_enviar = AsyncMock(side_effect=[False, True])
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_publico(
            "Fulano de Tal", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert mock_enviar.call_count == 2
        assert estado.get("etapa") == "aguardando_confirmacao_candidatura"
        assert estado.get("talent_id") == "talent-1"

    @pytest.mark.asyncio
    async def test_coletando_nome_curriculo_publico_duas_falhas_ainda_avanca_com_link_salvo(self, monkeypatch):
        """Se as duas tentativas falharem, a etapa não pode ficar em
        coletando_nome_curriculo_publico (a próxima mensagem do candidato seria
        mal-interpretada como nome novo) — avança mesmo assim, com
        `link_candidatura` salvo, pro fallback de reenvio existente em
        aguardando_confirmacao_candidatura cobrir a entrega."""
        estado, fake_get, fake_set = _fluxo_mock("coletando_nome_curriculo_publico")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "PORTAL_URL", "https://portal.test")
        monkeypatch.setattr(emp, "_LINK_SECRET", "segredo-teste")
        monkeypatch.setattr(emp, "_criar_ou_recuperar_talent_bank", lambda nome, telefone: "talent-1")

        mock_enviar = AsyncMock(return_value=False)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._processar_publico(
            "Fulano de Tal", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert mock_enviar.call_count == 2
        assert estado.get("etapa") == "aguardando_confirmacao_candidatura"
        assert estado.get("link_candidatura", "").startswith("https://portal.test/empregabilidade/curriculo?")

    @pytest.mark.asyncio
    async def test_notify_tick_dispara_proativo_pro_curriculo_publico_sem_candidatura_id(self, monkeypatch):
        """Achado do Junior 2026-08-13: o currículo público (SQS-58, opção 5) só
        preenche curriculo_publico_salvo, nunca candidatura_criada_id — sem esse
        branch, o loop proativo nunca disparava e o candidato só recebia a
        confirmação se mandasse outra mensagem no WhatsApp (fallback reativo)."""
        estado, fake_get, fake_set = _fluxo_mock("", {})
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        fake = _SupabaseFakeBloco6()
        fake.conversas = [
            {
                "id": "conv-1",
                "origem_id": "PHONE_ID",
                "lead_id": "lead-1",
                "metadata": {"empreg_fluxo": {
                    "etapa": "aguardando_confirmacao_candidatura",
                    "banco_talentos": True,
                    "curriculo_publico_salvo": True,
                    "talent_id": "talent-1",
                    "nome_candidato": "Fulano de Tal",
                }},
            },
        ]
        fake.leads = [{"id": "lead-1", "telefone": "558599990000"}]
        monkeypatch.setattr(emp, "supabase", fake)

        await emp._empregabilidade_notify_tick()

        assert mock_enviar.await_count == 1
        texto_enviado = mock_enviar.call_args.args[3]
        assert "banco de talentos" in texto_enviado.lower()


class TestAguardandoConfirmacaoCandidaturaEscapeHatch:

    @pytest.mark.asyncio
    async def test_nao_quero_mais_enviar_encerra_por_escape_semantico(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("aguardando_confirmacao_candidatura", {
            "perfil": "publico",
            "link_candidatura": "https://portal.test/candidatura",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        import intencao_detector

        async def mock_gpt(texto, perfil, etapa, ultima_msg_bot):
            return {"intencao": "ambiguo", "quer_sair": True, "mudou_de_assunto": False}

        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt)

        await emp._processar_publico(
            "não quero mais enviar",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3]
        assert "ainda aguardando" not in texto_enviado.lower()
        assert estado == {}

    @pytest.mark.asyncio
    async def test_quero_ver_outras_vagas_reabre_listagem_sem_llm(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("aguardando_confirmacao_candidatura", {
            "perfil": "publico",
            "link_candidatura": "https://portal.test/candidatura",
            "historico_vagas_aplicadas": ["vaga-ja-vista"],
            "nome_candidato_prefill": "Fulano de Tal",
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        fake = _SupabaseFakeBloco6()
        fake.vagas_publicas = [
            {"id": "vaga-1", "titulo": "Atendente", "setor": ["Atendimento"], "unidade_destino": "Barra"},
        ]
        monkeypatch.setattr(emp, "supabase", fake)

        import intencao_detector

        async def mock_gpt_nao_deveria_ser_chamado(texto, perfil, etapa, ultima_msg_bot):
            raise AssertionError("LLM não deveria ser chamado no atalho determinístico de vagas")

        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt_nao_deveria_ser_chamado)

        await emp._processar_publico(
            "Quero ver outras vagas",
            "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = _isola_enviar.call_args.args[3]
        assert "vagas abertas" in texto_enviado.lower()
        assert estado["perfil"] == "publico"
        # S-EMP-AUD-023 passo 2: ponto de entrada agora é o cargo consolidado
        # (Nível 1), não mais o menu por categoria/setor.
        assert estado["etapa"] == "listou_cargos_consolidados"
        assert estado["historico_vagas_aplicadas"] == ["vaga-ja-vista"]
        assert estado["nome_candidato_prefill"] == "Fulano de Tal"


class TestTransbordoHumanoFlexivelAud022:

    @pytest.mark.asyncio
    async def test_typo_real_falar_com_atendendte_aciona_transbordo_sem_confirmacao(self, monkeypatch, _isola_enviar):
        """Regressão da conversa 6a9af3ca-...: pedido com typo deve ir direto
        para atendimento humano quando o parser da etapa falha."""
        estado, fake_get, fake_set = _fluxo_mock("listando_cargos_selecao", {
            "perfil": "publico",
            "vaga_id_selecionada": "vaga-1",
            "cargos_disponiveis": [{"titulo": "Auxiliar Administrativo"}],
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "_ultima_mensagem_bot", lambda conversa_id: "Digite o número do cargo.")

        import intencao_detector
        monkeypatch.setattr(
            intencao_detector,
            "_chamar_gpt_contextual",
            _mock_gpt(intencao="ambiguo", quer_atendente_humano=True),
        )
        mock_transbordo = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_acionar_transbordo_empregabilidade", mock_transbordo)

        await emp._processar_publico(
            "falar com atendendte", "558599990000", "PHONE_ID", "token", "lead-1",
            "6a9af3ca-regressao", "Barra",
        )

        mock_transbordo.assert_awaited_once()
        assert mock_transbordo.await_args.kwargs["motivo"] == "pedido_atendente_humano"
        assert "Não entendi" not in (_isola_enviar.call_args.args[3] if _isola_enviar.call_args else "")
        assert estado["etapa"] == "listando_cargos_selecao"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("etapa", "extra"),
        [
            ("listou_categorias", {
                "perfil": "publico",
                "mapa_categorias": {
                    "1": {"categoria": "Administrativo", "vagas": [{"id": "vaga-1", "titulo": "Auxiliar"}]},
                },
            }),
            ("listando_cargos_selecao", {
                "perfil": "publico",
                "vaga_id_selecionada": "vaga-1",
                "cargos_disponiveis": [{"titulo": "Auxiliar Administrativo"}],
            }),
            ("aguardando_escolha_unidade", {
                "perfil": "publico",
                "vaga_id_selecionada": "vaga-1",
                "unidades_opcoes": [{"id": "unidade-1", "nome": "CUCA Barra"}],
            }),
        ],
    )
    async def test_duas_falhas_na_mesma_etapa_oferecem_atendente(self, etapa, extra, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock(etapa, extra)
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "_ultima_mensagem_bot", lambda conversa_id: "Escolha uma opção.")

        import intencao_detector
        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", _mock_gpt(intencao="ambiguo"))

        await emp._processar_publico(
            "resposta inválida", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )
        assert estado["etapa"] == etapa
        assert estado["falhas_atendente_etapa"] == 1

        _isola_enviar.reset_mock()
        await emp._processar_publico(
            "resposta inválida", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado["etapa"] == "oferecendo_atendente_humano"
        assert estado["_oferta_atendente_contexto"]["etapa_anterior"] == etapa
        assert "atendente" in _isola_enviar.call_args.args[3].lower()

    @pytest.mark.asyncio
    async def test_contador_zerado_ao_mudar_de_etapa(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("listou_categorias", {
            "perfil": "publico",
            "falhas_atendente_nome_etapa": "listou_categorias",
            "falhas_atendente_etapa": 1,
            "mapa_categorias": {
                "1": {
                    "categoria": "Administrativo",
                    "vagas": [{"id": "vaga-1", "titulo": "Auxiliar", "unidade_destino": "Barra"}],
                },
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        await emp._processar_publico(
            "1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado["etapa"] == "listou_vagas"
        assert "falhas_atendente_etapa" not in estado
        assert "falhas_atendente_nome_etapa" not in estado

    @pytest.mark.asyncio
    async def test_sim_na_oferta_aciona_transbordo(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("oferecendo_atendente_humano", {
            "perfil": "publico",
            "_oferta_atendente_contexto": {
                "etapa_anterior": "listou_categorias",
                "fluxo_anterior": {"perfil": "publico", "etapa": "listou_categorias", "mapa_categorias": {}},
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_transbordo = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_acionar_transbordo_empregabilidade", mock_transbordo)

        await emp._processar_publico(
            "sim", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_transbordo.assert_awaited_once()
        assert mock_transbordo.await_args.kwargs["motivo"] == "oferta_proativa_falhas"
        assert estado["etapa"] == "oferecendo_atendente_humano"

    @pytest.mark.asyncio
    async def test_nao_na_oferta_restaura_etapa_anterior_com_contador_zerado(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("oferecendo_atendente_humano", {
            "perfil": "publico",
            "_oferta_atendente_contexto": {
                "etapa_anterior": "aguardando_escolha_unidade",
                "fluxo_anterior": {
                    "perfil": "publico",
                    "etapa": "aguardando_escolha_unidade",
                    "vaga_id_selecionada": "vaga-1",
                    "unidades_opcoes": [{"id": "unidade-1", "nome": "CUCA Barra"}],
                    "falhas_atendente_nome_etapa": "aguardando_escolha_unidade",
                    "falhas_atendente_etapa": 1,
                },
            },
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_transbordo = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_acionar_transbordo_empregabilidade", mock_transbordo)

        await emp._processar_publico(
            "não", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        mock_transbordo.assert_not_awaited()
        assert estado["etapa"] == "aguardando_escolha_unidade"
        assert "falhas_atendente_etapa" not in estado
        assert "falhas_atendente_nome_etapa" not in estado
        assert "seguimos por aqui" in _isola_enviar.call_args.args[3].lower()


def _nav_mapa_categorias():
    return {
        "1": {
            "categoria": "Administrativo",
            "vagas": [
                {"id": "vaga-1", "titulo": "Auxiliar Administrativo", "unidade_destino": "Barra"},
                {"id": "vaga-2", "titulo": "Recepcionista", "unidade_destino": "global"},
            ],
        },
        "2": {
            "categoria": "Serviços Gerais",
            "vagas": [
                {"id": "vaga-3", "titulo": "Auxiliar de Serviços Gerais", "unidade_destino": "Barra"},
            ],
        },
    }


def _nav_fluxo(etapa: str, extra: dict | None = None):
    mapa = _nav_mapa_categorias()
    categoria = mapa["1"]
    base = {
        "perfil": "publico",
        "etapa": etapa,
        "mapa_categorias": mapa,
        "categoria_escolhida": categoria,
        "mapa_vagas": {"1": "vaga-1", "2": "vaga-2"},
        "ultima_vaga_id": "vaga-2",
        "_vagas_meta": {v["id"]: v for v in categoria["vagas"]},
        "historico_vagas_aplicadas": ["vaga-ja-vista"],
        "nome_candidato_prefill": "Fulano de Tal",
    }
    if etapa == "listando_cargos_selecao":
        base.update({
            "vaga_id_selecionada": "vaga-1",
            "cargos_disponiveis": [{"titulo": "Auxiliar Administrativo"}],
        })
    if etapa == "aguardando_escolha_unidade":
        base.update({
            "vaga_id_selecionada": "vaga-2",
            "unidades_opcoes": [{"id": "unidade-1", "nome": "CUCA Barra"}],
        })
    if extra:
        base.update(extra)
    return base


class TestVoltarNavegacaoAud021:

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("etapa", "etapa_esperada", "texto_esperado"),
        [
            ("listou_categorias", "inicio", "Empresa"),
            ("listou_vagas", "listou_categorias", "Escolha uma categoria"),
            ("listando_cargos_selecao", "listou_vagas", "Vagas disponíveis"),
            ("aguardando_escolha_unidade", "listou_vagas", "Vagas disponíveis"),
        ],
    )
    async def test_voltar_deterministico_nas_quatro_etapas_sem_llm(
        self, etapa, etapa_esperada, texto_esperado, monkeypatch, _isola_enviar,
    ):
        extra = {"categoria_escolhida": None} if etapa == "listou_categorias" else {}
        estado, fake_get, fake_set = _fluxo_mock(etapa, _nav_fluxo(etapa, extra))
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        import intencao_detector

        async def mock_gpt_nao_deveria_ser_chamado(texto, perfil, etapa, ultima_msg_bot):
            raise AssertionError("LLM não deveria ser chamado para voltar determinístico")

        monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt_nao_deveria_ser_chamado)

        await emp._processar_publico(
            "voltar", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado["etapa"] == etapa_esperada
        assert estado["historico_vagas_aplicadas"] == ["vaga-ja-vista"]
        assert texto_esperado.lower() in _isola_enviar.call_args.args[3].lower()

    @pytest.mark.asyncio
    async def test_regressao_bb65d04a_quero_ver_outras_vagas_volta_para_lista_de_vagas(
        self, monkeypatch, _isola_enviar,
    ):
        estado, fake_get, fake_set = _fluxo_mock(
            "listando_cargos_selecao",
            _nav_fluxo("listando_cargos_selecao"),
        )
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "_ultima_mensagem_bot", lambda conversa_id: "Digite o número do cargo.")

        import intencao_detector
        monkeypatch.setattr(
            intencao_detector,
            "_chamar_gpt_contextual",
            _mock_gpt(intencao="ambiguo", quer_voltar=True),
        )

        await emp._processar_publico(
            "Quero ver outras vagas", "558599990000", "PHONE_ID", "token", "lead-1",
            "bb65d04a-4aed-473a-a6f2-4eb88886da68", "Barra",
        )

        assert estado["etapa"] == "listou_vagas"
        assert "Não entendi" not in _isola_enviar.call_args.args[3]
        assert "Auxiliar Administrativo" in _isola_enviar.call_args.args[3]
        assert "voltar" in _isola_enviar.call_args.args[3].lower()

    @pytest.mark.asyncio
    async def test_aguardando_escolha_unidade_agora_aceita_voltar_semantico(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock(
            "aguardando_escolha_unidade",
            _nav_fluxo("aguardando_escolha_unidade"),
        )
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "_ultima_mensagem_bot", lambda conversa_id: "Escolha a unidade.")

        import intencao_detector
        monkeypatch.setattr(
            intencao_detector,
            "_chamar_gpt_contextual",
            _mock_gpt(intencao="ambiguo", quer_voltar=True),
        )

        await emp._processar_publico(
            "quero ver outras opções", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado["etapa"] == "listou_vagas"
        assert "Auxiliar Administrativo" in _isola_enviar.call_args.args[3]

    @pytest.mark.asyncio
    async def test_quer_voltar_semantico_fora_do_mapa_nao_intercepta_escape(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("confirmando_terceiro", {
            "perfil": "publico",
            "nome_candidato": "Fulano de Tal",
            "vaga_id_selecionada": "vaga-1",
            "banco_talentos": False,
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        monkeypatch.setattr(emp, "_ultima_mensagem_bot", lambda conversa_id: "Esse currículo é para você?")

        import intencao_detector
        monkeypatch.setattr(
            intencao_detector,
            "_chamar_gpt_contextual",
            _mock_gpt(intencao="ambiguo", quer_voltar=True),
        )

        tratado = await emp._escape_semantico_ou_none(
            "quero voltar", "publico", "confirmando_terceiro",
            "conv-1", "558599990000", "PHONE_ID", "token", "lead-1", "Barra",
        )

        assert tratado is False
        assert estado["etapa"] == "confirmando_terceiro"
        _isola_enviar.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_telas_extraidas_exibem_rodape_voltar(self, monkeypatch, _isola_enviar):
        estado, fake_get, fake_set = _fluxo_mock("listou_categorias", {
            "perfil": "publico",
            "mapa_categorias": _nav_mapa_categorias(),
        })
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)

        await emp._processar_publico(
            "1", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        assert estado["etapa"] == "listou_vagas"
        assert estado["categoria_escolhida"]["categoria"] == "Administrativo"
        assert "voltar" in _isola_enviar.call_args.args[3].lower()
