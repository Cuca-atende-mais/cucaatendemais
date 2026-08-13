"""
S-EMP-01-01 — Detector de intenção para o canal Empregabilidade.
Classifica a primeira mensagem por palavras-chave; GPT-4o-mini como fallback para ambíguos.

S-WM-20 Task 3 — `avaliar_mensagem_contextual` substitui `IntencaoDetector.classificar`
como decisão primária em produção: GPT-4o-mini é consultado com o contexto completo
(perfil + etapa + última mensagem do bot), sem keywords antes. `classificar`/KEYWORDS_*
ficam mantidos como fallback/legado — remoção é uma fase "contract" (expand/contract),
deliberadamente adiada até a Task 5 validar em staging que o classificador novo cobre
de verdade os 6 cenários de regressão da S-EMP-01-01 e os 5 bugs do relatório. Remover
antes disso violaria o mesmo princípio já aplicado à migração UAZAPI→Meta (não desligar
o caminho antigo antes do novo estar validado com dados reais).
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


async def avaliar_mensagem_contextual(
    texto: str,
    midia_tipo: str = "",
    perfil: str | None = None,
    etapa: str | None = None,
    ultima_msg_bot: str | None = None,
    lead_nome: str | None = None,
) -> dict:
    """Classificador semântico contextual (S-WM-20 Task 3).

    Contrato novo: recebe a frase inteira + perfil já declarado + etapa atual
    + última mensagem do bot, e pede ao GPT-4o-mini um veredito único sobre
    intenção E sinais de escape (quer_sair, mudou_de_assunto,
    quer_atendente_humano) — diferente do
    `classificar()` acima (keyword-primeiro, sem contexto de conversa,
    só para a primeira mensagem). É a decisão PRIMÁRIA agora: keywords não são
    mais consultadas antes do LLM. Atalhos determinísticos (upload, dígito
    puro) continuam sem chamar o LLM, por serem inequívocos e por custo/latência
    (AC#12).

    Retorna sempre {"intencao", "quer_sair", "mudou_de_assunto",
    "quer_atendente_humano", "nome"} — nunca propaga exceção; qualquer falha
    (JSON malformado, API fora do ar, etc.) cai no default seguro (ambíguo,
    sem sinais de escape) para nunca travar o fluxo.
    """
    default = {
        "intencao": "ambiguo",
        "quer_sair": False,
        "mudou_de_assunto": False,
        "quer_atendente_humano": False,
        "nome": lead_nome,
    }

    if midia_tipo in ("document", "image"):
        return {**default, "intencao": "upload"}

    texto_limpo = (texto or "").strip()
    if not texto_limpo:
        return default

    # Atalho determinístico: dígito puro (menu 1-9) nunca precisa do LLM.
    if re.fullmatch(r"\d{1,2}", texto_limpo):
        return default

    try:
        data = await _chamar_gpt_contextual(texto_limpo, perfil, etapa, ultima_msg_bot)
        intencao = data.get("intencao", "ambiguo")
        if intencao not in _CATEGORIAS_VALIDAS:
            intencao = "ambiguo"
        return {
            "intencao": intencao,
            "quer_sair": bool(data.get("quer_sair", False)),
            "mudou_de_assunto": bool(data.get("mudou_de_assunto", False)),
            "quer_atendente_humano": bool(data.get("quer_atendente_humano", False)),
            "nome": lead_nome,
        }
    except Exception as exc:
        logger.warning("[avaliar_mensagem_contextual] erro, fallback seguro: %s", exc)
        return default


async def _chamar_gpt_contextual(
    texto: str, perfil: str | None, etapa: str | None, ultima_msg_bot: str | None,
) -> dict:
    """Chamada real ao GPT-4o-mini, isolada em função própria para permitir mock
    direto nos testes (mesmo padrão de `IntencaoDetector._gpt_fallback`)."""
    from openai import AsyncOpenAI  # noqa: PLC0415
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "user",
            "content": (
                "Você interpreta mensagens de WhatsApp do canal de Empregabilidade "
                "da rede CUCA. Considere o contexto da conversa e a frase do lead. "
                "Retorne SOMENTE JSON com as chaves:\n"
                "- 'intencao': um de candidato_vaga | banco_talentos | empresa | ambiguo\n"
                "- 'quer_sair': true se o lead claramente quer encerrar/parar a conversa "
                "(despedida, negativa de continuar, sem intenção de fazer outra coisa)\n"
                "- 'mudou_de_assunto': true se o lead está redirecionando para uma intenção "
                "diferente da etapa atual (ex.: nega o que foi perguntado e diz que quer outra "
                "coisa), mesmo sem querer encerrar a conversa\n"
                "- 'quer_atendente_humano': true se o lead pede falar com atendente humano, "
                "suporte, equipe, pessoa ou ajuda humana, mesmo com erro de digitação "
                "(ex.: atendendte, atendete, atendente humano)\n\n"
                f"Perfil já declarado: {perfil or 'nenhum'}\n"
                f"Etapa atual da conversa: {etapa or 'nenhuma'}\n"
                f"Última mensagem do bot: {ultima_msg_bot or 'nenhuma'}\n"
                f"Mensagem do lead: {texto}"
            ),
        }],
        response_format={"type": "json_object"},
        temperature=0.0,
        max_tokens=100,
    )
    return json.loads(response.choices[0].message.content)


# Mapeamento keyword→canonical para filtro de setor em vagas.
# A canonical é uma substring dos valores de SETORES_VAGA do portal,
# permitindo match parcial case-insensitive contra a coluna setor (text[]).
_SETOR_KEYWORDS: list[tuple[str, str]] = [
    # multi-word primeiro (prioridade)
    ("serviços gerais", "Serviços Gerais"),
    ("servicos gerais", "Serviços Gerais"),
    ("construção civil", "Construção Civil"),
    ("construcao civil", "Construção Civil"),
    ("cuidados pessoais", "Cuidados Pessoais"),
    ("auxiliar administrativo", "Administrativo"),
    ("suporte técnico", "Tecnologia"),
    ("suporte tecnico", "Tecnologia"),
    ("redes sociais", "Criativo"),
    ("banco de talentos", ""),  # guard: evita falso-positivo da keyword do fluxo
    # single-word
    ("limpeza", "Serviços Gerais"),
    ("portaria", "Serviços Gerais"),
    ("zeladoria", "Serviços Gerais"),
    ("construção", "Construção Civil"),
    ("construcao", "Construção Civil"),
    ("pedreiro", "Construção Civil"),
    ("eletricista", "Construção Civil"),
    ("encanador", "Construção Civil"),
    ("logística", "Logística"),
    ("logistica", "Logística"),
    ("entrega", "Logística"),
    ("estoque", "Logística"),
    ("motorista", "Logística"),
    ("motoboy", "Logística"),
    ("vendas", "Comércio"),
    ("venda", "Comércio"),
    ("comercio", "Comércio"),
    ("comércio", "Comércio"),
    ("comercial", "Comércio"),
    ("alimentação", "Alimentação"),
    ("alimentacao", "Alimentação"),
    ("cozinha", "Alimentação"),
    ("garçom", "Alimentação"),
    ("garcom", "Alimentação"),
    ("restaurante", "Alimentação"),
    ("lanchonete", "Alimentação"),
    ("tecnologia", "Tecnologia"),
    ("programação", "Tecnologia"),
    ("programacao", "Tecnologia"),
    ("design", "Criativo"),
    ("criativo", "Criativo"),
    ("beleza", "Beleza"),
    ("estética", "Beleza"),
    ("estetica", "Beleza"),
    ("barbeiro", "Beleza"),
    ("manicure", "Beleza"),
    ("cabeleireiro", "Beleza"),
    ("cuidador", "Cuidados"),
    ("babá", "Cuidados"),
    ("baba", "Cuidados"),
    ("idoso", "Cuidados"),
    ("administrativo", "Administrativo"),
    ("administrativa", "Administrativo"),
    ("escritório", "Administrativo"),
    ("escritorio", "Administrativo"),
    ("recepção", "Administrativo"),
    ("recepcao", "Administrativo"),
    ("produção", "Produção"),
    ("producao", "Produção"),
]


def extrair_setor_da_mensagem(texto: str) -> tuple[str | None, str | None]:
    """
    Extrai menção a setor profissional na mensagem.
    Retorna (keyword_do_usuario, canonical_para_filtro) ou (None, None).
    A canonical é comparada por substring contra os valores do array setor nas vagas.
    Ex: "quero vaga de vendas" → ("vendas", "Comércio")
    """
    if not texto:
        return None, None
    t = texto.lower()
    for keyword, canonical in _SETOR_KEYWORDS:
        if re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", t):
            if not canonical:  # guard para "banco de talentos"
                return None, None
            return keyword, canonical
    return None, None


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
