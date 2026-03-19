import os
import io
import json
import logging
import base64
import httpx
from openai import AsyncOpenAI
from supabase import create_client, Client

logger = logging.getLogger("cv_processor")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

async def download_file_bytes(url: str) -> bytes:
    """Faz download do arquivo via URL e retorna bytes brutos."""
    async with httpx.AsyncClient() as http_client:
        response = await http_client.get(url)
        response.raise_for_status()
        return response.content


async def download_file_as_base64(url: str) -> str:
    """Faz download do arquivo via URL e retorna base64."""
    content = await download_file_bytes(url)
    return base64.b64encode(content).decode("utf-8")


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extrai texto de um PDF usando pdfminer.six."""
    from pdfminer.high_level import extract_text_to_fp
    from pdfminer.layout import LAParams
    output = io.StringIO()
    extract_text_to_fp(io.BytesIO(pdf_bytes), output, laparams=LAParams())
    return output.getvalue().strip()

async def process_cv_ocr(candidatura_id: str, cv_url: str, vaga_id: str):
    """Lê o currículo com GPT-4o Vision / Document, e salva os dados OCR na candidatura."""
    logger.info(f"Iniciando OCR para candidatura {candidatura_id} ({cv_url})")
    
    try:
        is_pdf = cv_url.lower().endswith(".pdf")
        
        # 1.5 Buscar relacionamento
        cand_res = supabase.table("candidaturas").select("candidato_id").eq("id", candidatura_id).single().execute()
        candidato_id = cand_res.data["candidato_id"]
        
        # 2. Buscar requisitos da vaga para o "Matching"
        vaga_res = supabase.table("vagas").select("titulo, requisitos, escolaridade_minima").eq("id", vaga_id).single().execute()
        vaga = vaga_res.data
        
        prompt_sys = f"""
        Você é um assistente especialista em Recrutamento e Seleção da Rede CUCA (equipamento público de Fortaleza). 
        Sua missão é extrair dados de um currículo e compará-los com os requisitos de uma vaga de estágio ou primeiro emprego.
        
        DADOS DA VAGA:
        Título: {vaga.get('titulo', '')}
        Requisitos principais: {vaga.get('requisitos', '')}
        Escolaridade Mínima: {vaga.get('escolaridade_minima', 'Não especificado')}
        
        INSTRUÇÕES:
        Extraia as informações em formato JSON rigoroso. Compare o perfil do candidato com a vaga e forneça uma análise qualitativa.
        
        SCHEMA JSON ESPERADO:
        {{
            "escolaridade": "String",
            "experiencia_meses": Integer,
            "resumo_experiencias": ["String"],
            "habilidades": ["String"],
            "telefone": "String com apenas dígitos ou null",
            "match_score": Integer (0 a 100),
            "analise_aderencia": {{
                "pontos_fortes": ["Por que ele combina"],
                "pontos_atencao": ["O que falta ou diverge"],
                "veredito": "✅ ou ⚠️ ou ❌"
            }}
        }}

        Se o currículo contiver número de telefone ou celular, extraia apenas os dígitos sem formatação.
        Se houver mais de um número, priorize o celular. Retorne null se não encontrar nenhum número.
        """

        # Montar mensagem: PDF → extração de texto; imagem → vision (base64)
        if is_pdf:
            pdf_bytes = await download_file_bytes(cv_url)
            cv_text = extract_text_from_pdf(pdf_bytes)
            if not cv_text:
                cv_text = "(conteúdo do PDF não pôde ser extraído automaticamente)"
            messages = [
                {"role": "system", "content": prompt_sys},
                {"role": "user", "content": f"Extraia os dados deste currículo e retorne APENAS o JSON válido:\n\n{cv_text}"}
            ]
        else:
            file_b64 = await download_file_as_base64(cv_url)
            messages = [
                {"role": "system", "content": prompt_sys},
                {"role": "user", "content": [
                    {"type": "text", "text": "Extraia os dados deste currículo e retorne APENAS o JSON válido:"},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{file_b64}",
                            "detail": "high",
                        },
                    },
                ]}
            ]

        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            max_tokens=1000,
            temperature=0.0
        )
        
        raw_output = response.choices[0].message.content.strip()
        
        # Limpar crases de markdown se o GPT retornar
        if raw_output.startswith("```json"):
            raw_output = raw_output[7:-3]
        elif raw_output.startswith("```"):
            raw_output = raw_output[3:-3]
            
        json_data = json.loads(raw_output)
        
        # Extraindo dados da nova estrutura
        analise = json_data.get("analise_aderencia", {})
        veredito = analise.get("veredito", "⚠️")
        match_score = json_data.get("match_score", 0)
        pontos_fortes = " ".join(analise.get("pontos_fortes", []))
        
        # 3. Atualizar no banco (Tabela: candidatos - Habilidades Gerais), se candidato_id disponível
        if candidato_id:
            supabase.table("candidatos").update({
                "escolaridade": json_data.get("escolaridade", ""),
                "experiencias": json_data.get("resumo_experiencias", []),
                "habilidades": json_data.get("habilidades", []),
            }).eq("id", candidato_id).execute()

        # 4. Atualizar no banco (Tabela: candidaturas - Match com a Vaga específica)
        update_candidatura = {
            "matching_score": match_score,
            "matching_justificativa": f"{veredito} - {pontos_fortes}",
            "status": "selecionado" if veredito == "✅" else ("rejeitado" if veredito == "❌" else "pendente"),
            "dados_ocr_json": {**json_data, "telefone_ocr": json_data.get("telefone")},
        }
        supabase.table("candidaturas").update(update_candidatura).eq("id", candidatura_id).execute()

        # S29-01: Preencher telefone da candidatura com o extraído do OCR, apenas se o campo estiver vazio
        telefone_ocr = json_data.get("telefone")
        if telefone_ocr:
            cand_atual = supabase.table("candidaturas").select("telefone").eq("id", candidatura_id).single().execute()
            if not cand_atual.data.get("telefone"):
                supabase.table("candidaturas").update({"telefone": telefone_ocr}).eq("id", candidatura_id).execute()
                logger.info(f"[S29-01] Telefone {telefone_ocr} extraído do currículo e salvo na candidatura {candidatura_id}")
        
        logger.info(f"OCR finalizado para {candidatura_id}. Score: {match_score}. Veredito: {veredito}")

    except Exception as e:
        logger.error(f"Erro ao processar OCR da candidatura {candidatura_id}: {str(e)}")
        supabase.table("candidaturas").update({
            "matching_justificativa": f"Erro OCR: {str(e)[:50]}"
        }).eq("id", candidatura_id).execute()


async def process_cv_espontaneo(nome: str, telefone: str, cv_url: str):
    """S16-01: OCR de currículo sem vaga. Extrai skills e atualiza talent_bank por telefone."""
    logger.info(f"OCR espontâneo: {nome} ({telefone})")
    try:
        file_b64 = await download_file_as_base64(cv_url)

        prompt_sys = """
        Você é um especialista em análise de currículos da Rede CUCA.
        Extraia as informações do currículo e retorne APENAS um JSON válido com este schema:
        {
            "escolaridade": "String (ex: Ensino Médio, Superior Incompleto, etc.)",
            "experiencia_meses": Integer (total estimado),
            "experiencia_resumo": "String resumindo as experiências",
            "habilidades": ["lista", "de", "habilidades"],
            "areas_interesse": ["áreas", "de", "atuação"],
            "email": "String ou null"
        }
        """

        is_pdf = cv_url.lower().endswith(".pdf")
        media_type = "application/pdf" if is_pdf else "image/jpeg"

        messages = [
            {"role": "system", "content": prompt_sys},
            {"role": "user", "content": [
                {"type": "text", "text": "Extraia as informações deste currículo:"},
                {
                    "type": "image_url" if not is_pdf else "text",
                    **({"image_url": {"url": f"data:{media_type};base64,{file_b64}", "detail": "high"}}
                       if not is_pdf else {"text": f"[Currículo PDF em base64 - URL: {cv_url}]"}),
                },
            ]}
        ]

        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            max_tokens=800,
            temperature=0.0
        )

        raw_output = response.choices[0].message.content.strip()
        if raw_output.startswith("```json"):
            raw_output = raw_output[7:-3]
        elif raw_output.startswith("```"):
            raw_output = raw_output[3:-3]

        json_data = json.loads(raw_output)

        # Atualizar talent_bank pelo telefone
        supabase.table("talent_bank").update({
            "skills_jsonb": {
                **json_data,
                "origem": "candidatura_espontanea",
                "ocr_processado": True,
            }
        }).eq("telefone", telefone).execute()

        logger.info(f"OCR espontâneo finalizado para {nome}")

    except Exception as e:
        logger.error(f"Erro OCR espontâneo {nome}: {str(e)}")


async def process_cv_talent_bank_id(talent_id: str, cv_url: str) -> dict | None:
    """Processa OCR de um currículo do talent_bank por ID. Atualiza skills_jsonb e retorna os dados extraídos."""
    logger.info(f"[OCR talent_bank] Iniciando OCR para talent_id={talent_id}")
    try:
        is_pdf = cv_url.lower().endswith(".pdf")

        if is_pdf:
            pdf_bytes = await download_file_bytes(cv_url)
            texto_pdf = extract_text_from_pdf(pdf_bytes)
            if len(texto_pdf) > 200:
                prompt_content = [{"type": "text", "text": f"Extraia as informações deste currículo:\n\n{texto_pdf[:6000]}"}]
            else:
                file_b64 = base64.b64encode(pdf_bytes).decode("utf-8")
                prompt_content = [
                    {"type": "text", "text": "Extraia as informações deste currículo PDF:"},
                    {"type": "image_url", "image_url": {"url": f"data:application/pdf;base64,{file_b64}", "detail": "high"}},
                ]
        else:
            file_b64 = await download_file_as_base64(cv_url)
            prompt_content = [
                {"type": "text", "text": "Extraia as informações deste currículo:"},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{file_b64}", "detail": "high"}},
            ]

        prompt_sys = """Você é especialista em análise de currículos da Rede CUCA.
Extraia as informações e retorne APENAS um JSON válido:
{
    "escolaridade": "String",
    "experiencia_meses": Integer,
    "experiencia_resumo": "String resumindo experiências",
    "habilidades": ["lista", "de", "habilidades"],
    "resumo_experiencias": ["frase por experiência"],
    "email": "String ou null"
}"""

        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": prompt_sys},
                {"role": "user", "content": prompt_content},
            ],
            max_tokens=800,
            temperature=0.0,
        )

        raw = response.choices[0].message.content.strip()
        if raw.startswith("```json"):
            raw = raw[7:-3]
        elif raw.startswith("```"):
            raw = raw[3:-3]

        json_data = json.loads(raw)
        skills = {**json_data, "origem": "talent_bank_ocr_demanda", "ocr_processado": True}

        supabase.table("talent_bank").update({
            "skills_jsonb": skills,
            "updated_at": __import__("datetime").datetime.utcnow().isoformat(),
        }).eq("id", talent_id).execute()

        logger.info(f"[OCR talent_bank] Concluído para talent_id={talent_id}")
        return skills

    except Exception as e:
        logger.error(f"[OCR talent_bank] Erro talent_id={talent_id}: {e}")
        return None
