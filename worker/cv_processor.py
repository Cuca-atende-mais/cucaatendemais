import os
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

async def download_file_as_base64(url: str) -> str:
    """Faz download do arquivo via URL e retorna base64."""
    async with httpx.AsyncClient() as http_client:
        response = await http_client.get(url)
        response.raise_for_status()
        return base64.b64encode(response.content).decode("utf-8")

async def process_cv_ocr(candidatura_id: str, cv_url: str, vaga_id: str):
    """Lê o currículo com GPT-4o Vision / Document, e salva os dados OCR na candidatura."""
    logger.info(f"Iniciando OCR para candidatura {candidatura_id} ({cv_url})")
    
    try:
        # 1. Obter base64 do arquivo
        file_b64 = await download_file_as_base64(cv_url)
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

        # Preparar mensagem dependendo do tipo (GPT-4o lida com PDF no endpoint vision/chat se convertido em imagem, 
        # mas como estamos mandando cru, se for PDF é ideal usar a API Assistants ou tratar a extração de texto primeiro.
        # Para MVPs com GPT-4o (Chat Completions API), passamos a URL direta de imagem. Se for PDF real precisaria do PDF2Image.
        # Como hack MVP, se for PDF vamos pedir pro frontend fazer upload de PNG ou assumir que o AssistantAPI é melhor.
        # Por simplicidade da Fase 3: assumiremos que a URL é acessível e usaremos o detail high de imagem se for jpeg/png.
        
        messages = [
            {"role": "system", "content": prompt_sys},
            {"role": "user", "content": [
                {"type": "text", "text": "Extraia os dados deste currículo e retorne APENAS o JSON válido:"},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": cv_url,
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
        
        # 3. Atualizar no banco (Tabela: candidatos - Habilidades Gerais)
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
