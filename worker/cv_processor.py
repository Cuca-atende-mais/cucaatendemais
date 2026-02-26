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
        
        # 2. Buscar requisitos da vaga para o "Matching" (score_aderencia/requisitos_atendidos)
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
            "match_score": Integer (0 a 100),
            "analise_aderencia": {{
                "pontos_fortes": ["Por que ele combina"],
                "pontos_atencao": ["O que falta ou diverge"],
                "veredito": "✅ ou ⚠️ ou ❌"
            }}
        }}
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
        
        # 3. Atualizar no banco
        supabase.table("candidaturas").update({
            "dados_ocr_json": json_data,
            "requisitos_atendidos": veredito,
            "match_score": match_score, # Novo campo sugerido na Fase 2
            "status": "selecionado" if veredito == "✅" else "pendente"
        }).eq("id", candidatura_id).execute()
        
        logger.info(f"OCR finalizado para {candidatura_id}. Avaliação: {avaliacao}")

    except Exception as e:
        logger.error(f"Erro ao processar OCR da candidatura {candidatura_id}: {str(e)}")
        # Atualizar status para erro de processamento
        supabase.table("candidaturas").update({
            "requisitos_atendidos": "Erro OCR"
        }).eq("id", candidatura_id).execute()
