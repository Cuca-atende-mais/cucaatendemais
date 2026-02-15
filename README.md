# CUCA Atende+

> Sistema de Atendimento Inteligente via WhatsApp para a Rede CUCA de Fortaleza

## 📋 Sobre o Projeto

O **CUCA Atende+** é um sistema completo de atendimento automatizado via WhatsApp para os 5 Centros Urbanos de Cultura, Arte, Ciência e Esporte (CUCAs) de Fortaleza/CE. O sistema utiliza inteligência artificial para gerenciar comunicação com jovens, divulgar programações, intermediar vagas de emprego, coletar feedback e facilitar o acesso aos espaços públicos.

## 🏗️ Arquitetura

- **Portal Web**: Next.js 14+ (App Router) hospedado na Vercel
- **Worker de Processamento**: Python (FastAPI) + Celery na VPS Hostinger
- **Banco de Dados**: Supabase (PostgreSQL 15+ com pgvector)
- **Gateway WhatsApp**: UAZAPI (14 instâncias)
- **IA**: OpenAI (GPT-4o, Whisper, Embeddings)

## 🚀 Status do Projeto

🔨 **Em Desenvolvimento** - Sprint 1/17

## 📞 Canais de Atendimento

O sistema opera **14 números de WhatsApp** distribuídos em 5 categorias:

- **5 canais institucionais** (um por CUCA)
- **5 canais de empregabilidade** (vagas por unidade)
- **1 canal de empregabilidade geral** (todas as unidades)
- **1 canal de programação mensal** (disparo global)
- **1 canal de ouvidoria** (críticas e sugestões)
- **1 canal de informações gerais + acesso CUCA**

## 🎯 Funcionalidades Principais

### Programação e Eventos
- Divulgação de programação mensal (20k+ jovens)
- Eventos pontuais com segmentação por interesse
- Agente IA para dúvidas sobre atividades

### Empregabilidade
- Cadastro de empresas e vagas
- Coleta de currículos via WhatsApp
- OCR automático de CVs
- Matching IA entre candidatos e vagas
- Banco de talentos

### Acesso CUCA
- Solicitação de uso de espaços (teatro, quadra, auditório)
- Aprovação em 2 níveis (técnico + secretaria)
- Gestão de equipamentos

### Ouvidoria Jovem
- Críticas anônimas
- Sugestões identificadas
- Análise de sentimento por IA
- Eventos de escuta

## 🔐 Segurança e Privacidade

- LGPD compliant
- Opt-in/opt-out automático
- Anonimato em críticas
- RLS (Row Level Security) no banco
- Tokens armazenados no Supabase Vault

## 👥 Equipe

Desenvolvido para a **Secretaria Municipal da Juventude de Fortaleza**.

## 📄 Licença

Este é um projeto de software público para a Prefeitura Municipal de Fortaleza.

---

**Rede CUCA** - Cultura, Arte, Ciência e Esporte para a Juventude de Fortaleza
