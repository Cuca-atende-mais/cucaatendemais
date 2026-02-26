import os
import json
import logging
from openai import AsyncOpenAI
from supabase import create_client, Client

logger = logging.getLogger("sentiment_processor")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

async def analyse_manifestation_sentiment(registro_id: str, texto: str):
    """Analisa o sentimento de uma manifestação da Ouvidoria e atualiza o banco."""
    logger.info(f"Analisando sentimento para registro {registro_id}")
    
    try:
        prompt_sys = """
        Você é Sofia, a IA da Ouvidoria da Rede CUCA.
        Sua tarefa é analisar uma manifestação (crítica ou sugestão) de um cidadão.
        
        Retorne um JSON rigoroso com:
        1. "sentimento": "positivo", "negativo" ou "neutro".
        2. "resumo_ia": Um resumo executivo de 1 frase (máximo 15 palavras).
        3. "temas": Lista de até 3 palavras-chave (ex: ["Infraestrutura", "Atendimento", "Esporte"]).
        """
        
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": prompt_sys},
                {"role": "user", "content": f"Manifestação: {texto}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.0
        )
        
        result = json.loads(response.choices[0].message.content)
        
        # Atualizar no banco
        supabase.table("ouvidoria_registros").update({
            "sentimento": result.get("sentimento"),
            "resumo_ia": result.get("resumo_ia"),
            "temas_identificados": result.get("temas")
        }).eq("id", registro_id).execute()
        
        logger.info(f"Análise concluída para {registro_id}: {result.get('sentimento')}")
        return result

    except Exception as e:
        logger.error(f"Erro ao analisar sentimento {registro_id}: {str(e)}")
        raise e
