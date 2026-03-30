# Plano de Desenvolvimento: Triagem Inteligente do Banco de Talentos

## Objetivo
Criar uma ferramenta exclusiva para desenvolvedores no painel administrativo capaz de receber múltiplos currículos manuais (arquivos PDF/Docx), extrair o texto em tempo real, utilizar a LLM (OpenAI) para classificá-los exatamente entre 10 macro categorias (ignorando objetivos genéricos e focando em competências/histórico) e inseri-los finalizados na tabela `talent_bank`.

## Etapa 1: Preparação do Ambiente
- **Ação:** Limpar (Truncar) a tabela `talent_bank` atual.
- **Motivo:** O banco atual foi poluído com classificações incorretas geradas por scripts via nome de pasta. A tabela deve estar zerada (0 currículos) para iniciar os testes com a ferramenta final.

## Etapa 2: Motor de Extração e IA (Backend)
- **Arquivo:** `cuca-portal/src/app/api/developer/batch-triage/route.ts`
- **Funcionalidades:**
    - Autenticação rigorosa: Apenas emails listados em `DEVELOPER_EMAILS`.
    - Bufferização do arquivo: Fazer o parse de PDF via pacote Node (`pdf-parse`) sem precisar salvar fisicamente o arquivo temporário.
    - Chamada OpenAI (`gpt-4o-mini`) usando **Structured Outputs** (JSON).
    - Inserção (Insert) automática no Supabase na tabela `talent_bank` com todos os metadados devolvidos pela IA.
- **Categorias Permitidas no Prompt:**
    1. Serviços Gerais
    2. Construção Civil
    3. Logística e Entregas
    4. Comércio e Vendas
    5. Alimentação
    6. Tecnologia
    7. Criativo / Digital
    8. Beleza e Estética
    9. Cuidados Pessoais
    10. Administrativo / Escritório

## Etapa 3: "Laboratório" de Processamento (Frontend)
- **Arquivo:** `cuca-portal/src/app/(dashboard)/developer/triage/page.tsx`
- **Funcionalidades:**
    - Zona de Drag and Drop (soltar de 1 a N arquivos).
    - Lista/tabela pendente preenchendo conforme o usuário escolhe os arquivos.
    - Botão "Processar Currículos".
    - Indicador de status (Processando arquivo X de Y, Concluído, etc).

## Etapa 4: Validação do Sistema Final
- Submeter 5 currículos originais da pasta `KFC - ELAINE` pela interface.
- Verificar no Supabase ou diretamente na página "Candidatos" / "Banco de Talentos" se a IA inseriu nas macro-áreas certas ignorando a falta da seção "Objetivos".
