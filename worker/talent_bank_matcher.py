import os
import json
import logging
import asyncio
import re
from openai import AsyncOpenAI
from supabase import create_client, Client

logger = logging.getLogger("talent_bank_matcher")

# ─── Mapeamento canônico: setor da vaga → categoria do Banco de Talentos ─────
#
# O campo `setor` da tabela `vagas` usa os textos longos definidos em SETORES_VAGA
# (ex: "Comércio e Vendas (vendedor, caixa, atendimento)"), enquanto o campo
# `area_interesse` do talent_bank pode conter tanto o texto longo (candidatos
# importados via import_curriculos.py) quanto a categoria curta (candidatos
# oriundos do bot WhatsApp ou formulários mais antigos).
#
# Este dicionário traduz o texto longo do setor para a categoria curta equivalente.
# Na filtragem, ambas as formas são aceitas — garantindo cobertura completa
# independente da origem do candidato.
MAPEAMENTO_SETOR_CATEGORIA: dict[str, str] = {
    "Comércio e Vendas (vendedor, caixa, atendimento)":
        "Comércio e Vendas",
    "Administrativo / Escritório (recepção, auxiliar administrativo)":
        "Administrativo",
    "Logística e Entregas (estoque, separação, entregador, motorista)":
        "Logística e Entregas",
    "Serviços Gerais (limpeza, portaria, zeladoria)":
        "Serviços Gerais",
    "Alimentação (cozinha, garçom, lanchonete)":
        "Alimentação",
    "Criativo / Digital (design, vídeo, redes sociais)":
        "Criativo / Digital",
    "Construção Civil (pedreiro, ajudante, eletricista, encanador)":
        "Construção Civil",
    "Tecnologia (suporte técnico, programação, dados)":
        "Tecnologia",
    "Beleza e Estética (barbeiro, manicure, cabeleireiro)":
        "Beleza e Estética",
    "Cuidados Pessoais (babá, cuidador de idosos)":
        "Cuidados Pessoais",
}

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

BATCH_SIZE = 20  # candidatos por chamada ao GPT


def _extrair_termos(texto: str) -> set[str]:
    """Extrai termos relevantes de um texto normalizando para minúsculas."""
    if not texto:
        return set()
    palavras = re.findall(r'\b[a-záàâãéèêíïóôõöúüç]{3,}\b', texto.lower())
    # Remove stopwords simples
    stopwords = {"que", "com", "para", "dos", "das", "não", "uma", "ser", "ter", "como", "mais", "seu", "sua"}
    return set(p for p in palavras if p not in stopwords)


def _pontuar_candidato(candidato: dict, termos_vaga: set[str]) -> int:
    """Pontua um candidato por correspondência semântica com os termos da vaga."""
    if not termos_vaga:
        return 0
    skills = candidato.get("skills_jsonb") or {}
    textos = []
    # Fontes de dados do candidato para cruzamento
    textos.extend(skills.get("resumo_experiencias") or [])
    textos.extend(skills.get("habilidades") or [])
    if skills.get("resumo"):
        textos.append(skills["resumo"])
    if skills.get("justificativa_ia"):
        textos.append(skills["justificativa_ia"])
    texto_completo = " ".join(str(t) for t in textos).lower()
    termos_candidato = _extrair_termos(texto_completo)
    return len(termos_vaga & termos_candidato)


async def _ranquear_batch(batch: list[dict], vaga: dict, max_tokens: int = 1500) -> list[dict]:
    """Envia um batch de candidatos ao GPT-4o e retorna lista com scores."""
    candidatos_texto = []
    for c in batch:
        skills = c.get("skills_jsonb") or {}
        entrada = {"id": c["id"], "nome": c["nome"]}
        if skills.get("escolaridade") or skills.get("habilidades") or skills.get("resumo_experiencias"):
            entrada["escolaridade"] = skills.get("escolaridade", "")
            entrada["experiencia_meses"] = skills.get("experiencia_meses", 0)
            entrada["habilidades"] = skills.get("habilidades", [])
            entrada["resumo_experiencias"] = skills.get("resumo_experiencias", [])
        if skills.get("resumo"):
            entrada["resumo_curriculo"] = skills["resumo"]
        if skills.get("justificativa_ia"):
            entrada["justificativa_area"] = skills["justificativa_ia"]
        candidatos_texto.append(entrada)

    # SQS-49: prompt diferenciado para selecao_evento — múltiplos cargos, regra de compatibilidade ampliada
    if vaga.get("tipo") == "selecao_evento":
        cargos_lista = vaga.get("cargos_lista") or []
        cargos_str = ", ".join(c.get("titulo", "") for c in cargos_lista) if cargos_lista else vaga.get("descricao", "")
        prompt = f"""Você é especialista em recrutamento e seleção. Analise a compatibilidade de cada candidato com o processo seletivo abaixo.

PROCESSO SELETIVO: {vaga.get('titulo', '')}
CARGOS DISPONÍVEIS: {cargos_str}

CANDIDATOS:
{json.dumps(candidatos_texto, ensure_ascii=False, indent=2)}

REGRAS OBRIGATÓRIAS:
1. O candidato é COMPATÍVEL se o perfil se encaixa em QUALQUER UM dos cargos listados — não exija que encaixe em todos.
   Exemplo: candidato com experiência em caixa → compatível para "Operador de Caixa" ou "Balconista".
2. Candidatos sem experiência formal mas com perfil jovem aprendiz → compatíveis para "Jovem Aprendiz".
3. Score de 0 a 100: 0 = incompatível com todos os cargos, 100 = perfeito para um ou mais cargos.
4. Retorne APENAS candidatos com score >= 30. Mencione na justificativa o cargo específico para o qual é compatível.
5. Ordene do maior para o menor score.

Retorne SOMENTE JSON válido, sem markdown:
{{
  "candidatos": [
    {{
      "id": "uuid",
      "score": 85,
      "justificativa": "Compatível para [cargo]: [razão] (máx 90 caracteres)"
    }}
  ]
}}"""
    else:
        prompt = f"""Você é especialista em recrutamento e seleção. Analise a compatibilidade de cada candidato com a vaga abaixo.

VAGA:
- Título: {vaga.get('titulo', '')}
- Descrição: {(vaga.get('descricao') or '')[:600]}
- Requisitos: {(vaga.get('requisitos') or '')[:600]}
- Escolaridade Mínima: {vaga.get('escolaridade_minima') or 'Não especificado'}
- Tipo de Contrato: {vaga.get('tipo_contrato', '')}

CANDIDATOS:
{json.dumps(candidatos_texto, ensure_ascii=False, indent=2)}

REGRAS OBRIGATÓRIAS:
1. Analise a FUNÇÃO ESPECÍFICA de cada experiência — não apenas a categoria ampla.
   Exemplo: motorista e estoquista são ambos "Logística", mas são funções completamente diferentes.
   Se a vaga pede estoque/separação e o candidato é motorista, o score deve ser <= 20.
2. Score de 0 a 100: 0 = totalmente incompatível, 100 = perfeito para a vaga.
3. Retorne APENAS candidatos com score >= 30. Candidatos sem aderência real devem ser excluídos.
4. A justificativa deve mencionar a experiência ESPECÍFICA que justifica (ou não) a compatibilidade.
5. Ordene do maior para o menor score.

Retorne SOMENTE JSON válido, sem markdown:
{{
  "candidatos": [
    {{
      "id": "uuid",
      "score": 85,
      "justificativa": "Frase curta com a razão específica (máx 90 caracteres)"
    }}
  ]
}}"""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "Você retorna apenas JSON válido sem nenhum texto adicional."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=max_tokens,
        )
        raw = response.choices[0].message.content.strip()
        logger.warning(f"[_ranquear_batch] GPT raw (200): {raw[:200]!r} finish={response.choices[0].finish_reason}")
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        resultado = json.loads(raw)
        parsed = resultado.get("candidatos", [])
        logger.warning(f"[_ranquear_batch] {len(parsed)} aprovados neste batch")
        return parsed
    except Exception as e:
        import traceback
        logger.error(f"[_ranquear_batch] ERRO: {e}\n{traceback.format_exc()}")
        return []


def _norm_fone(f: str) -> str:
    """Normaliza telefone para apenas dígitos, independente de formato."""
    return re.sub(r'\D', '', f or '')


async def triar_banco_talentos(vaga_id: str, quantidade: int = 5, setor_vaga: list[str] | None = None, excluir_ids: list[str] | None = None, telefones_inscritos: list[str] | None = None, filtros: dict | None = None) -> list[dict]:
    """Triagem com varredura completa da área + pré-filtragem semântica + batching.

    Fluxo:
    1. Busca dados da vaga e todos os candidatos disponíveis da área
    2. Aplica filtros demográficos diretamente no Supabase (economiza tokens GPT)
    3. Pré-filtra semanticamente por termos da vaga (sem chamada de IA)
    4. Varre candidatos com skills em batches de 20 pelo GPT-4o
    5. Consolida scores, pega top N
    6. Completa com OCR de candidatos sem skills se necessário
    """

    # 1. Buscar dados da vaga
    vaga_res = supabase.table("vagas").select(
        "titulo, descricao, requisitos, escolaridade_minima, tipo_contrato, setor, tipo, cargos_lista"
    ).eq("id", vaga_id).single().execute()
    vaga = vaga_res.data
    if not vaga:
        raise ValueError(f"Vaga {vaga_id} não encontrada.")

    logger.warning(f"[triar_banco_talentos] vaga tipo={vaga.get('tipo')!r} cargos_lista={bool(vaga.get('cargos_lista'))} qtd_cargos={len(vaga.get('cargos_lista') or [])}")

    setores = setor_vaga or vaga.get("setor") or []

    # SQS-49: para selecao_evento expande texto com todos os cargos — sem descrição/requisitos disponíveis
    if vaga.get("tipo") == "selecao_evento":
        cargos_lista = vaga.get("cargos_lista") or []
        titulos_cargos = " ".join(c.get("titulo", "") for c in cargos_lista)
        texto_vaga = f"{vaga.get('titulo', '')} {titulos_cargos}"
        # Enriquecer o dict vaga para o prompt do _ranquear_batch ter contexto dos cargos
        vaga = {**vaga, "descricao": f"Processo seletivo com os cargos: {titulos_cargos}", "requisitos": ""}
    else:
        texto_vaga = f"{vaga.get('titulo', '')} {vaga.get('descricao', '')} {vaga.get('requisitos', '')}"

    termos_vaga = _extrair_termos(texto_vaga)

    # S37B-06: Aplicar filtros demográficos diretamente na query do Supabase
    filtros = filtros or {}
    tb_query = supabase.table("talent_bank").select(
        "id, nome, data_nascimento, telefone, arquivo_cv_url, skills_jsonb, area_interesse, data_curriculo, primeiro_emprego"
    ).eq("status", "disponivel")

    if filtros.get("escolaridade"):
        tb_query = tb_query.eq("escolaridade_normalizada", filtros["escolaridade"])
    if filtros.get("genero"):
        tb_query = tb_query.eq("genero", filtros["genero"])
    if filtros.get("pcd") is not None:
        tb_query = tb_query.eq("pcd", bool(filtros["pcd"]))
    if filtros.get("primeiro_emprego") is not None:
        tb_query = tb_query.eq("primeiro_emprego", bool(filtros["primeiro_emprego"]))

    filtros_ativos = [k for k, v in filtros.items() if v is not None and v != ""]
    if filtros_ativos:
        logger.info(f"[triar_banco_talentos] Filtros demográficos aplicados: {filtros_ativos}")

    # 2. Buscar candidatos disponíveis com filtros demográficos já aplicados no banco
    tb_res = tb_query.order("data_curriculo", desc=True).execute()

    todos = tb_res.data or []

    # Excluir candidatos já mostrados ou já inscritos nesta vaga
    ids_excluir = set(excluir_ids or [])
    if ids_excluir:
        todos = [c for c in todos if c["id"] not in ids_excluir]
        logger.info(f"[triar_banco_talentos] Excluindo {len(ids_excluir)} candidatos por ID")

    # Excluir por telefone normalizado (resolve incompatibilidade de formatos)
    fones_excluir = set(_norm_fone(f) for f in (telefones_inscritos or []) if f)
    if fones_excluir:
        antes = len(todos)
        todos = [c for c in todos if _norm_fone(c.get("telefone") or "") not in fones_excluir]
        logger.info(f"[triar_banco_talentos] Excluindo {antes - len(todos)} candidatos por telefone")

    # Filtrar por área de interesse compatível com o setor da vaga.
    # Expande setores para incluir tanto o texto longo (vagas) quanto a categoria
    # curta (candidatos do bot/formulários legados) via MAPEAMENTO_SETOR_CATEGORIA.
    if setores:
        setores_expandidos: set[str] = set()
        for s in setores:
            setores_expandidos.add(s)  # forma longa original
            if s in MAPEAMENTO_SETOR_CATEGORIA:
                setores_expandidos.add(MAPEAMENTO_SETOR_CATEGORIA[s])  # forma curta
            else:
                # Fallback: adiciona versão sem parênteses para cobrir variações
                setores_expandidos.add(s.split("(")[0].strip())

        compatíveis = []
        sem_area = []
        for c in todos:
            areas = c.get("area_interesse") or []
            if not areas:
                sem_area.append(c)
            elif any(a in setores_expandidos for a in areas):
                compatíveis.append(c)
        pool = compatíveis + sem_area
        logger.info(
            f"[triar_banco_talentos] Setores expandidos: {setores_expandidos} | "
            f"compatíveis={len(compatíveis)} sem_area={len(sem_area)}"
        )
    else:
        pool = todos

    # Separar candidatos com e sem skills processados
    com_skills = [c for c in pool if c.get("skills_jsonb")]
    sem_skills = [c for c in pool if not c.get("skills_jsonb")]

    logger.info(
        f"[triar_banco_talentos] Vaga {vaga_id}: pool={len(pool)} "
        f"({len(com_skills)} com OCR, {len(sem_skills)} sem OCR) | "
        f"setores={setores} | termos_vaga={len(termos_vaga)}"
    )

    if not pool:
        return []

    # 3. Pré-filtragem semântica: ordenar candidatos com skills por relevância estimada
    if termos_vaga:
        com_skills.sort(key=lambda c: _pontuar_candidato(c, termos_vaga), reverse=True)

    # SQS-49: selecao_evento tem múltiplos cargos — varrer teto fixo para garantir resposta dentro do timeout do proxy (60s)
    # Cada batch de 20 leva ~4-6s → 6 batches = 120 candidatos → ~30-40s total (margem segura)
    is_selecao_evento = vaga.get("tipo") == "selecao_evento"
    if is_selecao_evento:
        MAX_VARRER = min(len(com_skills), 120)  # teto fixo: 6 batches × 20 = ~35s
    else:
        MAX_VARRER = min(len(com_skills), quantidade * 20)
    if len(com_skills) > MAX_VARRER:
        logger.warning(f"[triar_banco_talentos] Limitando varredura de {len(com_skills)} para {MAX_VARRER} candidatos")
        com_skills = com_skills[:MAX_VARRER]

    # max_tokens maior para selecao_evento: prompt mais inclusivo tende a aprovar mais candidatos por batch
    batch_max_tokens = 2500 if is_selecao_evento else 1500

    # 4. Varrer candidatos com skills em batches
    todos_scores: list[dict] = []  # {"id": ..., "score": ..., "justificativa": ...}
    candidatos_map = {c["id"]: c for c in com_skills}

    for i in range(0, len(com_skills), BATCH_SIZE):
        batch = com_skills[i:i + BATCH_SIZE]
        logger.info(f"[triar_banco_talentos] Ranqueando batch {i//BATCH_SIZE + 1} ({len(batch)} candidatos)...")
        resultados_batch = await _ranquear_batch(batch, vaga, max_tokens=batch_max_tokens)
        todos_scores.extend(resultados_batch)
        if i + BATCH_SIZE < len(com_skills):
            await asyncio.sleep(0.5)  # anti-rate-limit entre batches

    # 5. Consolidar e ordenar por score (melhor de cada candidato se aparecer em múltiplos batches)
    score_map: dict[str, dict] = {}
    for r in todos_scores:
        cid = r.get("id")
        if not cid:
            continue
        if cid not in score_map or r.get("score", 0) > score_map[cid].get("score", 0):
            score_map[cid] = r

    ranking = sorted(score_map.values(), key=lambda x: x.get("score", 0), reverse=True)
    top_matches = ranking[:quantidade]

    logger.info(
        f"[triar_banco_talentos] Vaga {vaga_id}: varridos {len(com_skills)} candidatos com OCR, "
        f"{len(score_map)} com score>=30, top {len(top_matches)} selecionados"
    )

    # 6. Se não atingiu a quantidade desejada, completar com candidatos sem skills (OCR sob demanda)
    slots_restantes = quantidade - len(top_matches)
    if slots_restantes > 0 and sem_skills:
        from cv_processor import process_cv_talent_bank_id

        # Priorizar semanticamente também os sem skills (pelo nome/área apenas — aproximação)
        candidatos_ocr = sem_skills[:slots_restantes * 3]  # pega mais para compensar falhas de OCR

        for c in candidatos_ocr:
            if len(top_matches) >= quantidade:
                break
            if c.get("arquivo_cv_url"):
                try:
                    skills = await process_cv_talent_bank_id(c["id"], c["arquivo_cv_url"])
                    if skills:
                        c["skills_jsonb"] = skills
                        candidatos_map[c["id"]] = c
                        # Ranquear individualmente (batch de 1 para aproveitar o contexto)
                        resultado_ocr = await _ranquear_batch([c], vaga)
                        if resultado_ocr and resultado_ocr[0].get("score", 0) >= 30:
                            score_map[c["id"]] = resultado_ocr[0]
                            top_matches = sorted(
                                [score_map[cid] for cid in score_map if cid in {**candidatos_map}],
                                key=lambda x: x.get("score", 0), reverse=True
                            )[:quantidade]
                    await asyncio.sleep(0.3)
                except Exception as ocr_err:
                    logger.warning(f"[triar_banco_talentos] OCR falhou para {c['id']}: {ocr_err}")

    # 7. Montar resultado final enriquecido
    # Atualizar mapa com candidatos de sem_skills que foram processados
    for c in sem_skills:
        if c.get("skills_jsonb"):
            candidatos_map[c["id"]] = c

    resultado_final = []
    for match in top_matches:
        cid = match.get("id")
        if cid not in candidatos_map:
            continue
        c = candidatos_map[cid]
        skills = c.get("skills_jsonb") or {}
        resultado_final.append({
            "id": cid,
            "nome": c["nome"],
            "telefone": c.get("telefone"),
            "data_nascimento": c.get("data_nascimento"),
            "arquivo_cv_url": c.get("arquivo_cv_url"),
            "match_score": match.get("score", 0),
            "justificativa": match.get("justificativa", ""),
            "skills_jsonb": skills,
            "primeiro_emprego": c.get("primeiro_emprego", False),
        })

    logger.info(
        f"[triar_banco_talentos] Vaga {vaga_id}: {len(resultado_final)} retornados "
        f"(varridos: {len(com_skills)} com OCR + {min(slots_restantes*3, len(sem_skills))} sem OCR)"
    )
    return resultado_final
