import os
import logging
from supabase import create_client, Client
from openai import OpenAI
import json

logger = logging.getLogger("worker-category-extractor")

# Instancia Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Instancia OpenAI
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY)

def process_categories_for_campanha(campanha_id: str):
    """
    Motor de Normalização e Extração (Sanitizador).
    Lê as atividades de uma campanha, extrai títulos únicos, e classifica 
    em Eixo/Modalidade usando LLM. Então faz upsert em categorias_interesse.
    """
    logger.info(f"Iniciando extração de categorias para campanha {campanha_id}")
    try:
        # 1. Buscar as atividades
        res = supabase.table("atividades_mensais").select("titulo, categoria").eq("campanha_id", campanha_id).execute()
        if not res.data:
            logger.warning(f"Nenhuma atividade encontrada para a campanha {campanha_id}")
            return
            
        # 2. Extrair títulos únicos
        titulos_unicos = set()
        for act in res.data:
            t = act.get("titulo")
            if t:
                titulos_unicos.add(t)
                
        titulos_lista = list(titulos_unicos)
        logger.info(f"Encontrados {len(titulos_lista)} títulos únicos para classificar.")
        
        if not titulos_lista:
            return
            
        # 3. Pegar os Eixos existentes do banco para mapearmos corretamente
        eixos_res = supabase.table("categorias_interesse").select("id, nome").is_("pai_id", "null").execute()
        eixos_map = {e["nome"].lower(): e["id"] for e in eixos_res.data}
        
        # Eixos válidos: 'esportes', 'cultura', 'cursos (formação e qualificação)'
        
        # 4. Usar OpenAI para classificar em lote (batching se for muito grande)
        batch_size = 50
        for i in range(0, len(titulos_lista), batch_size):
            batch = titulos_lista[i:i+batch_size]
            prompt = f"""
Você é um classificador de atividades da Rede CUCA.
Sua tarefa é mapear os seguintes títulos de atividades brutas para uma taxonomia minimalista de 2 níveis: EIXO e MODALIDADE.

Os Eixos permitidos são EXATAMENTE estes 3:
1. "Esportes"
2. "Cultura"
3. "Cursos (Formação e Qualificação)"

Regras para Modalidade:
- Deve ser genérica e minimalista. Exemplo: "Vôlei Seleção" -> "Vôlei". "Inglês Básico" -> "Idiomas".
- Agrupe variações. 
- Retorne um JSON estrito contendo uma lista de objetos, um para cada título de entrada.

Entrada (Títulos):
{json.dumps(batch, ensure_ascii=False)}

Formato de Saída JSON esperado:
[
  {{"titulo_original": "Futsal Sub-15", "eixo": "Esportes", "modalidade": "Futsal"}},
  ...
]
"""
            
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "Você é um classificador de dados em JSON."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            
            # O type=json_object força retorno de um objeto {"atividades": [...]} se induzido.
            # Como pedimos uma lista no prompt, para garantir com json_object, devemos ajustar a saída.
            # Vamos parsear a resposta:
            content = response.choices[0].message.content
            
            try:
                # Pode ter retornado um objeto com uma chave que tem a lista
                parsed = json.loads(content)
                items = []
                if isinstance(parsed, list):
                    items = parsed
                elif isinstance(parsed, dict) and "atividades" in parsed:
                    items = parsed["atividades"]
                else:
                    # tenta achar a primeira lista
                    for v in parsed.values():
                        if isinstance(v, list):
                            items = v
                            break
                            
                for item in items:
                    titulo_orig = item.get("titulo_original")
                    eixo = item.get("eixo")
                    modalidade = item.get("modalidade")
                    
                    if not eixo or not modalidade: continue
                    
                    eixo_id = None
                    eixo_str = eixo.lower()
                    
                    if "esporte" in eixo_str: eixo_id = eixos_map.get("esportes")
                    elif "cultura" in eixo_str: eixo_id = eixos_map.get("cultura")
                    elif "curso" in eixo_str: eixo_id = eixos_map.get("cursos (formação e qualificação)")
                    
                    if eixo_id:
                        # Faz Upsert da Modalidade no banco
                        # Busca se já existe essa modalidade para esse pai
                        mod_res = supabase.table("categorias_interesse").select("id").eq("pai_id", eixo_id).ilike("nome", modalidade).execute()
                        if not mod_res.data:
                            # Insere nova modalidade
                            logger.info(f"Nova modalidade detectada: {modalidade} (Eixo: {eixo})")
                            supabase.table("categorias_interesse").insert({
                                "nome": modalidade.title(),
                                "pai_id": eixo_id,
                                "ativo": True
                            }).execute()
                        else:
                            # Atualiza ativo=True se estivesse false
                            supabase.table("categorias_interesse").update({"ativo": True}).eq("id", mod_res.data[0]["id"]).execute()
                            
            except Exception as e_json:
                logger.error(f"Erro ao parsear JSON da LLM: {str(e_json)} | Content: {content}")
                
        logger.info(f"Extração de categorias concluída para a campanha {campanha_id}")
    except Exception as e:
        logger.error(f"Erro geral no motor de categorias: {str(e)}")
