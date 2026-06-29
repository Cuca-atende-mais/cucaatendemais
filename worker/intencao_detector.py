"""
S-EMP-01-01 — Detector de intenção para o canal Empregabilidade.
Classifica a primeira mensagem por palavras-chave; GPT-4o-mini como fallback para ambíguos.
"""
import json
import logging
import os
import re

logger = logging.getLogger("intencao_detector")

_CATEGORIAS_VALIDAS = {"candidato_vaga", "banco_talentos", "empresa", "ambiguo"}

_NOME_STOPWORDS = {
    "quero", "boa", "bom", "dia", "tarde", "noite", "oi", "olá", "ola",
    "tudo", "bem", "como", "voce", "você", "meu", "minha", "uma", "um",
}


class IntencaoDetector:
    KEYWORDS_EMPRESA = [
        "cnpj", "contratar", "processo seletivo", "selecao", "seleção",
        "quero contratar", "divulgar vaga", "abrir vaga", "criar vaga",
        "oferecer vaga", "disponibilizar vaga", "preciso de funcionário",
        "quero divulgar", "seleçao", "marcar selecao", "marcar seleção",
    ]
    KEYWORDS_BANCO = [
        "banco de talentos", "banco talentos",
        "cadastrar curriculo", "cadastrar currículo",
        "deixar curriculo", "deixar currículo",
        "curriculo sem vaga", "currículo sem vaga",
        "curriculo", "currículo",
    ]
    KEYWORDS_VAGA = [
        "me candidatar", "quero trabalhar", "procuro emprego", "quero emprego",
        "tem vaga", "ver vagas", "vagas abertas", "oportunidade de trabalho",
        "vaga aberta", "quero uma vaga", "busca de trabalho",
        "vaga", "vagas", "emprego", "candidatura", "candidato", "trabalho", "oportunidade",
    ]

    async def classificar(self, mensagem: str, midia_tipo: str, lead_nome: str | None) -> dict:
        """Classifica intenção da primeira mensagem. Retorna dict {intencao, nome}."""
        # Upload de arquivo é sinal dominante — independe do texto
        if midia_tipo in ("document", "image"):
            return {"intencao": "upload", "nome": lead_nome}

        texto = mensagem.lower().strip() if mensagem else ""

        # Empresa: CNPJ é inequívoco; demais keywords também forte
        for kw in self.KEYWORDS_EMPRESA:
            if kw in texto:
                logger.debug("[intencao_detector] keyword empresa: %r", kw)
                return {"intencao": "empresa", "nome": lead_nome}

        # Banco de talentos (antes de candidato_vaga pois é mais específico)
        for kw in self.KEYWORDS_BANCO:
            if kw in texto:
                logger.debug("[intencao_detector] keyword banco_talentos: %r", kw)
                return {"intencao": "banco_talentos", "nome": lead_nome}

        # Candidato / busca de vaga
        for kw in self.KEYWORDS_VAGA:
            if kw in texto:
                logger.debug("[intencao_detector] keyword candidato_vaga: %r", kw)
                return {"intencao": "candidato_vaga", "nome": lead_nome}

        # Nenhuma keyword — GPT para desambiguar
        try:
            resultado = await self._gpt_fallback(texto, lead_nome)
        except Exception as exc:
            logger.warning("[intencao_detector] _gpt_fallback lançou exceção: %s", exc)
            return {"intencao": "ambiguo", "nome": lead_nome}
        intencao = resultado.get("intencao", "ambiguo")
        if intencao not in _CATEGORIAS_VALIDAS:
            intencao = "ambiguo"
        return {"intencao": intencao, "nome": lead_nome}

    async def _gpt_fallback(self, texto: str, lead_nome: str | None) -> dict:
        try:
            from openai import AsyncOpenAI  # noqa: PLC0415
            client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{
                    "role": "user",
                    "content": (
                        "Classifique a mensagem em UMA categoria. Retorne SOMENTE JSON com chave 'intencao'.\n"
                        "Valores: candidato_vaga | banco_talentos | empresa | ambiguo\n\n"
                        f"Mensagem: {texto}"
                    ),
                }],
                response_format={"type": "json_object"},
                temperature=0.0,
                max_tokens=30,
            )
            result = json.loads(response.choices[0].message.content)
            intencao = result.get("intencao", "ambiguo")
            if intencao not in _CATEGORIAS_VALIDAS:
                intencao = "ambiguo"
            logger.info("[intencao_detector] GPT classificou: %r → %s", texto[:40], intencao)
            return {"intencao": intencao, "nome": lead_nome}
        except Exception as exc:
            logger.warning("[intencao_detector] GPT fallback erro: %s", exc)
            return {"intencao": "ambiguo", "nome": lead_nome}


def extrair_nome_heuristico(texto: str) -> str | None:
    """
    Tenta extrair o primeiro nome do texto quando leads.nome não está disponível.
    Heurística: primeira palavra ≥ 3 chars, capitalizada, fora das stopwords.
    """
    if not texto:
        return None
    for palavra in re.split(r"[\s,!?.]+", texto):
        limpa = re.sub(r"[^a-zA-ZÀ-ÿ]", "", palavra)
        if len(limpa) >= 3 and limpa[0].isupper() and limpa.lower() not in _NOME_STOPWORDS:
            return limpa
    return None
