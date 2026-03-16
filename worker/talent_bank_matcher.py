import os
import json
import logging
from openai import AsyncOpenAI
from supabase import create_client, Client

logger = logging.getLogger("talent_bank_matcher")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


async def triar_banco_talentos(vaga_id: str) -> list[dict]:
    """Compara todos os candidatos disponíveis no banco de talentos com os requisitos da vaga via GPT-4o."""

    # 1. Buscar dados da vaga
    vaga_res = supabase.table("vagas").select(
        "titulo, descricao, requisitos, escolaridade_minima, tipo_contrato"
    ).eq("id", vaga_id).single().execute()
    vaga = vaga_res.data
    if not vaga:
        raise ValueError(f"Vaga {vaga_id} não encontrada.")

    # 2. Buscar todos os candidatos disponíveis no banco de talentos
    tb_res = supabase.table("talent_bank").select(
        "id, nome, data_nascimento, telefone, arquivo_cv_url, skills_jsonb"
    ).eq("status", "disponivel").execute()
    candidatos = tb_res.data or []

    if not candidatos:
        return []

    # Filtrar candidatos sem skills (OCR nunca rodou)
    candidatos_com_skills = [c for c in candidatos if c.get("skills_jsonb")]
    candidatos_sem_skills = [c for c in candidatos if not c.get("skills_jsonb")]

    if not candidatos_com_skills:
        logger.info(f"[triar_banco_talentos] Nenhum candidato com skills_jsonb para vaga {vaga_id}")
        return []

    # 3. Montar prompt para GPT
    candidatos_texto = []
    for c in candidatos_com_skills:
        skills = c["skills_jsonb"]
        candidatos_texto.append({
            "id": c["id"],
            "nome": c["nome"],
            "escolaridade": skills.get("escolaridade", ""),
            "experiencia_meses": skills.get("experiencia_meses", 0),
            "habilidades": skills.get("habilidades", []),
            "resumo_experiencias": skills.get("resumo_experiencias", []),
        })

    prompt = f"""Você é especialista em recrutamento e seleção.

Analise a compatibilidade dos candidatos abaixo com a vaga e retorne um JSON com a lista ordenada por score.

VAGA:
- Título: {vaga.get('titulo', '')}
- Descrição: {vaga.get('descricao', '')[:500] if vaga.get('descricao') else ''}
- Requisitos: {vaga.get('requisitos', '')[:500] if vaga.get('requisitos') else ''}
- Escolaridade Mínima: {vaga.get('escolaridade_minima', 'Não especificado')}
- Tipo de Contrato: {vaga.get('tipo_contrato', '')}

CANDIDATOS:
{json.dumps(candidatos_texto, ensure_ascii=False, indent=2)}

Retorne SOMENTE JSON válido neste formato (sem markdown, sem texto extra):
{{
  "candidatos": [
    {{
      "id": "uuid-do-candidato",
      "score": 85,
      "justificativa": "Frase curta explicando a compatibilidade"
    }}
  ]
}}

Regras:
- Score de 0 a 100 representando compatibilidade com a vaga
- Inclua apenas candidatos com score >= 40
- Ordene do maior para o menor score
- Seja objetivo na justificativa (máximo 80 caracteres)
"""

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "Você retorna apenas JSON válido sem nenhum texto adicional."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
        max_tokens=1000,
    )

    raw = response.choices[0].message.content.strip()

    # Limpar possível markdown
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    resultado = json.loads(raw)
    matches = resultado.get("candidatos", [])

    # 4. Enriquecer resultado com dados completos do candidato
    candidatos_map = {c["id"]: c for c in candidatos_com_skills}
    resultado_final = []

    for match in matches:
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
        })

    logger.info(f"[triar_banco_talentos] Vaga {vaga_id}: {len(resultado_final)} candidatos compatíveis encontrados")
    return resultado_final
