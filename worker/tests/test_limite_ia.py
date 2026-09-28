"""ACHADO-016: limite de respostas de IA por conversa."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import limite_ia
import meta_adapter_inbound

AVISO = limite_ia.PADRAO["ia_limite_mensagem"]


def _sb(por_hora=0, por_dia=0, ultima=None, config=None, erro=False):
    """Supabase falso: contagens de ai_usage_logs (1ª consulta = hora, 2ª = dia), última mensagem."""
    sb = MagicMock()
    contagens = iter([por_hora, por_dia])

    def table(nome):
        if erro:
            raise RuntimeError("banco fora")
        t = MagicMock()
        if nome == "system_config":
            t.select.return_value.in_.return_value.execute.return_value = SimpleNamespace(data=config or [])
        elif nome == "ai_usage_logs":
            q = t.select.return_value.eq.return_value.eq.return_value.gte.return_value.limit.return_value
            q.execute.side_effect = lambda: SimpleNamespace(count=next(contagens))
        elif nome == "mensagens":
            q = t.select.return_value.eq.return_value.order.return_value.limit.return_value
            q.execute.return_value = SimpleNamespace(data=[ultima] if ultima else [])
        return t
    sb.table.side_effect = table
    return sb


def _limpar_cache():
    limite_ia._cache.update(valor=None, expira=0.0)


def test_dentro_do_limite_atende_normalmente():
    _limpar_cache()
    assert limite_ia.mensagem_se_excedeu(_sb(por_hora=19, por_dia=39), "c1") is None


def test_passou_do_limite_por_hora_manda_aviso():
    _limpar_cache()
    assert limite_ia.mensagem_se_excedeu(_sb(por_hora=20), "c1") == AVISO


def test_passou_do_limite_por_dia_manda_aviso():
    _limpar_cache()
    assert limite_ia.mensagem_se_excedeu(_sb(por_hora=3, por_dia=40), "c1") == AVISO


def test_nao_repete_o_aviso():
    _limpar_cache()
    ultima = {"remetente": "agente", "conteudo": AVISO}
    assert limite_ia.mensagem_se_excedeu(_sb(por_hora=25, ultima=ultima), "c1") == ""


def test_limites_e_texto_vem_da_configuracao():
    _limpar_cache()
    cfg = [{"chave": "ia_limite_por_hora", "valor": "5"}, {"chave": "ia_limite_mensagem", "valor": "Calma aí!"}]
    assert limite_ia.mensagem_se_excedeu(_sb(por_hora=5, config=cfg), "c1") == "Calma aí!"


def test_erro_na_checagem_atende_normalmente():
    _limpar_cache()
    assert limite_ia.mensagem_se_excedeu(_sb(erro=True), "c1") is None


def _dispatch(monkeypatch, retorno_limite):
    monkeypatch.setattr(limite_ia, "mensagem_se_excedeu", lambda sb, cid: retorno_limite)
    chamar = AsyncMock(return_value=["resposta"])
    enviar = AsyncMock(return_value=True)
    monkeypatch.setattr(meta_adapter_inbound, "_chamar_motor_agente", chamar)
    import meta_adapter_outbound
    monkeypatch.setattr(meta_adapter_outbound, "_meta_enviar", enviar)
    monkeypatch.setattr(meta_adapter_outbound, "_meta_marcar_lida_e_digitando", AsyncMock())
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = SimpleNamespace(data={"status": "ativa"})
    asyncio.run(meta_adapter_inbound._executar_dispatch(
        agente_tipo="Institucional", contrato_v2={"mensagem": "oi"}, conversa_id="c1", lead_id="l1",
        telefone="5585999990000", phone_number_id="pn", wamid="w", push_name="", midia_tipo="text",
        unidade_cuca=None, mensagem="oi", supabase=sb))
    return chamar, enviar


def test_dispatch_acima_do_limite_nao_chama_a_ia(monkeypatch):
    chamar, enviar = _dispatch(monkeypatch, AVISO)
    chamar.assert_not_called()
    assert enviar.call_args[0][2] == AVISO


def test_dispatch_aviso_ja_dado_fica_em_silencio(monkeypatch):
    chamar, enviar = _dispatch(monkeypatch, "")
    chamar.assert_not_called()
    enviar.assert_not_called()


def test_dispatch_dentro_do_limite_segue_para_a_ia(monkeypatch):
    chamar, _ = _dispatch(monkeypatch, None)
    chamar.assert_called_once()
