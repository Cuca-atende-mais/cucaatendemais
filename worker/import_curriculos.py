"""
Sprint 38 — Importação em massa: CURRÍCULOS/ → talent_bank

Percorre a pasta CURRÍCULOS/, mapeia a subpasta ao area_interesse,
extrai o nome pelo nome do arquivo, faz upload para Supabase Storage
e insere no talent_bank. Zero custo — nenhuma API de IA chamada.

Uso:
    cd worker
    python import_curriculos.py

    # Dry-run (não faz nada, só lista o que faria):
    python import_curriculos.py --dry-run

    # Processar apenas uma subpasta específica:
    python import_curriculos.py --pasta "COMUNIDADE/ADMINISTRATIVO"
"""

import os
import re
import sys
import mimetypes
import argparse
import unicodedata
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Pasta raiz dos currículos (relativa ao script)
PASTA_RAIZ = Path(__file__).parent.parent / "CURRÍCULOS"

# Pastas a ignorar completamente
PASTAS_IGNORAR = {
    "FORMULARIO INATIVO",
    "CURRICULOS (JA NO BANCO DE DADOS)",
    "CUCA NAS ESCOLAS - EMPREGABILIDADE",
    " CUCA NAS ESCOLAS - EMPREGABILIDADE",
}

# Extensões de arquivo aceitas
EXTENSOES_ACEITAS = {".pdf", ".PDF", ".docx", ".DOCX", ".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"}

# Mapeamento: keywords no nome da pasta → area_interesse
MAPA_AREAS = [
    (
        ["ATENDIMENTO", "VENDAS", "VENDA", "CAIXA", "TELEMARKETING", "COMERCIO", "COMÉRCIO", "PROMOTOR"],
        "Comércio e Vendas (vendedor, caixa, atendimento)",
    ),
    (
        ["MOTORISTA", "LOGISTICA", "LOGÍSTICA", "ESTOQUE", "ENTREGA", "SEPARACAO", "SEPARAÇÃO"],
        "Logística e Entregas (estoque, separação, entregador, motorista)",
    ),
    (
        ["ADMINISTRATIVO", "RECEPCIONISTA", "ESCRITÓRIO", "ESCRITORIO", "SECRETARIA", "AUXILIAR ADMIN", "ASSISTENTE DE ADMIN", "AUXILIAR ADMNISTRATIVO", "AUXILIAR ADMINISTR"],
        "Administrativo / Escritório (recepção, auxiliar administrativo)",
    ),
    (
        ["SERVIÇOS GERAIS", "SERVICOS GERAIS", "LIMPEZA", "PORTEIRO", "ZELADOR", "VIGILANTE", "SEGURANÇA", "SEGURANCA"],
        "Serviços Gerais (limpeza, portaria, zeladoria)",
    ),
    (
        ["ELETRICISTA", "PEDREIRO", "CONSTRUÇÃO", "CONSTRUCAO", "ENCANADOR", "CIVIL", "MANUTENÇÃO", "MANUTENCAO", "PINTOR"],
        "Construção Civil (pedreiro, ajudante, eletricista, encanador)",
    ),
    (
        ["COZINHA", "COZINHEIRO", "GARÇOM", "GARCOM", "LANCHONETE", "ALIMENTAÇÃO", "ALIMENTACAO", "COPA", "PADARIA"],
        "Alimentação (cozinha, garçom, lanchonete)",
    ),
    (
        ["INFORMATICA", "INFORMÁTICA", "TECNOLOGIA", "TI ", " TI", "PROGRAMACAO", "PROGRAMAÇÃO", "SUPORTE", "DADOS", "DESENVOLV"],
        "Tecnologia (suporte técnico, programação, dados)",
    ),
    (
        ["MARKETING", "DESIGN", "DIGITAL", "CRIATIVO", "MÍDIA", "MIDIA", "VIDEO", "VÍDEO", "SOCIAL", "FOTOGRAFIA"],
        "Criativo / Digital (design, vídeo, redes sociais)",
    ),
    (
        ["BELEZA", "ESTETICA", "ESTÉTICA", "BARBEIRO", "MANICURE", "CABELEIREIRO", "MAQUIAGEM", "SPA"],
        "Beleza e Estética (barbeiro, manicure, cabeleireiro)",
    ),
    (
        ["CUIDADOR", "BABA", "BABÁ", "IDOSO", "CUIDADOS PESSOAIS", "ENFERMAGEM"],
        "Cuidados Pessoais (babá, cuidador de idosos)",
    ),
]


def mapear_area(nome_pasta: str) -> str | None:
    """Mapeia o nome da pasta para uma area_interesse. Retorna None se não encontrar."""
    nome_upper = nome_pasta.upper()
    for keywords, area in MAPA_AREAS:
        for kw in keywords:
            if kw in nome_upper:
                return area
    return None


def limpar_nome(filename: str) -> str:
    """Extrai o nome do candidato do nome do arquivo."""
    nome = Path(filename).stem

    # Remove prefixos comuns (ordem importa — mais específicos primeiro)
    prefixos = [
        r"^\[Currículo\]\s*",
        r"^\[Curriculo\]\s*",
        r"^Cópia de\s+",
        r"^Copia de\s+",
        r"^Curriculum Vitae\s*[-–]\s*",
        r"^Curriculum\s+",
        r"^Currículo\s*[-–_.]?\s*",
        r"^Curriculo\s*[-–_.]?\s*",
        r"^Currilo\s+",
        r"^Curriuclo\s+",
        r"^CV\s*[-_.]\s*",
        r"^CVLeticia",
        r"^curriculo\.atualizado\.",
        r"^curriculo\.",
        r"^Rai_curriculo\s*-\s*",
    ]
    for p in prefixos:
        nome = re.sub(p, "", nome, flags=re.IGNORECASE).strip()

    # Remove sufixos numéricos/datas: "(1)", "(1) (1)", "_20260113_205739", " 2025 a", " 2026"
    nome = re.sub(r"(\s*\(\d+\))+\s*$", "", nome).strip()
    nome = re.sub(r"_\d{8}_\d{6}.*$", "", nome).strip()
    nome = re.sub(r"\s+\d{4}\s*[a-z]?\s*$", "", nome).strip()

    # Remove sufixos descritivos após " - " se o que sobrar parecer nome (≥10 chars)
    candidato = re.sub(r"\s+-\s+[A-Za-zÀ-ú\s]{3,40}$", "", nome).strip()
    if len(candidato) >= 6:
        nome = candidato

    # Remove emojis e caracteres especiais mantendo letras, acentos, espaços, hífens
    nome = re.sub(r"[^\w\sÀ-úÀ-ÿ\-\.]", "", nome).strip()

    # Remove extensões que sobraram dentro do nome (ex: ".pdf", ".docx")
    nome = re.sub(r"\.(pdf|docx|doc|PDF)$", "", nome, flags=re.IGNORECASE).strip()

    # Normaliza underscores e múltiplos espaços
    nome = nome.replace("_", " ")
    nome = re.sub(r"\s+", " ", nome).strip()

    # Remove traços soltos no início
    nome = re.sub(r"^[-–\s]+", "", nome).strip()

    # Se ficou muito curto (lixo), usa o stem original sem extensão
    if len(nome) < 4:
        nome = Path(filename).stem.replace("_", " ").strip()

    # Capitaliza apenas se estiver todo em maiúsculas
    return nome.title() if nome.isupper() else nome


def sanitizar_path(texto: str) -> str:
    """Remove acentos e caracteres especiais para criar um path válido no Storage."""
    # Normaliza unicode (NFD) e remove diacríticos
    nfd = unicodedata.normalize("NFD", texto)
    sem_acento = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    # Mantém apenas letras, números, espaços, traços, underscores e pontos
    limpo = re.sub(r"[^\w\s.\-]", "_", sem_acento)
    # Colapsa múltiplos underscores/espaços
    limpo = re.sub(r"[\s_]+", "_", limpo).strip("_")
    return limpo


def ja_existe(nome: str, arquivo_url: str) -> bool:
    """Verifica se já existe no talent_bank pelo arquivo_cv_url."""
    res = supabase.table("talent_bank").select("id").eq("arquivo_cv_url", arquivo_url).limit(1).execute()
    return len(res.data or []) > 0


def subir_arquivo(caminho: Path, destino: str, dry_run: bool) -> str | None:
    """Faz upload para o Storage e retorna a URL pública."""
    if dry_run:
        return f"https://[storage]/{destino}"

    try:
        with open(caminho, "rb") as f:
            conteudo = f.read()

        mime, _ = mimetypes.guess_type(str(caminho))
        if not mime:
            mime = "application/octet-stream"

        supabase.storage.from_("curriculos").upload(
            destino,
            conteudo,
            {"content-type": mime, "upsert": "false"},
        )

        return supabase.storage.from_("curriculos").get_public_url(destino)
    except Exception as e:
        # Se já existe no storage (409), tenta pegar a URL mesmo assim
        if "409" in str(e) or "already exists" in str(e).lower() or "Duplicate" in str(e):
            return supabase.storage.from_("curriculos").get_public_url(destino)
        raise


def inserir_talent_bank(nome: str, url: str, area: str | None, dry_run: bool):
    """Insere ou atualiza no talent_bank."""
    if dry_run:
        return

    payload = {
        "nome": nome,
        "arquivo_cv_url": url,
        "area_interesse": [area] if area else None,
        "status": "disponivel",
        "skills_jsonb": None,
    }
    supabase.table("talent_bank").insert(payload).execute()


def processar(dry_run: bool = False, filtro_pasta: str | None = None):
    total = 0
    inseridos = 0
    ignorados = 0
    ja_existentes = 0
    erros = 0

    print(f"\n{'[DRY-RUN] ' if dry_run else ''}Iniciando importação de: {PASTA_RAIZ}\n")

    for arquivo in sorted(PASTA_RAIZ.rglob("*")):
        if not arquivo.is_file():
            continue

        # Ignorar extensões não aceitas
        if arquivo.suffix not in EXTENSOES_ACEITAS:
            ignorados += 1
            continue

        # Ignorar pastas bloqueadas
        partes = [p for p in arquivo.parts]
        if any(ig in partes for ig in PASTAS_IGNORAR):
            ignorados += 1
            continue

        # Filtro opcional de subpasta
        if filtro_pasta and filtro_pasta not in str(arquivo):
            continue

        total += 1

        # Pasta imediata do arquivo = classificação
        pasta_imediata = arquivo.parent.name

        # Mapear área de interesse
        area = mapear_area(pasta_imediata)

        # Nome do candidato
        nome = limpar_nome(arquivo.name)

        # Destino no storage — sanitizado para evitar erros com acentos
        pasta_safe = sanitizar_path(pasta_imediata)
        arquivo_safe = sanitizar_path(arquivo.stem) + arquivo.suffix.lower().replace(".PDF", ".pdf")
        destino = f"talent_bank/{pasta_safe}/{arquivo_safe}"

        print(f"  [{total:04d}] {nome[:40]:<40} | {pasta_imediata[:25]:<25} | {area or 'sem área'}")

        try:
            # Upload
            url = subir_arquivo(arquivo, destino, dry_run)
            if not url:
                erros += 1
                continue

            # Verificar duplicata
            if not dry_run and ja_existe(nome, url):
                ja_existentes += 1
                continue

            # Inserir no banco
            inserir_talent_bank(nome, url, area, dry_run)
            inseridos += 1

        except Exception as e:
            print(f"    ⚠️  ERRO: {e}")
            erros += 1

    print(f"""
{'='*60}
RELATÓRIO FINAL {'(DRY-RUN)' if dry_run else ''}
{'='*60}
  Arquivos encontrados : {total}
  Inseridos no banco   : {inseridos}
  Já existentes        : {ja_existentes}
  Ignorados            : {ignorados}
  Erros                : {erros}
{'='*60}
""")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Importa currículos para o talent_bank")
    parser.add_argument("--dry-run", action="store_true", help="Simula sem fazer alterações")
    parser.add_argument("--pasta", type=str, default=None, help="Filtrar por subpasta específica")
    args = parser.parse_args()

    processar(dry_run=args.dry_run, filtro_pasta=args.pasta)
