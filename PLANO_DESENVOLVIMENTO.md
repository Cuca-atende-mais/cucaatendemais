# PLANO DE DESENVOLVIMENTO — Sistema CUCA (Guia Mestre)
> **Versão**: 5.14 | **Atualizado**: 04/03/2026
> **STATUS ATUAL**: Sprint 4 Concluído (100%) | **Sprint 5: Conexão Real ✅ 100% — Integração UAZAPI v2 corrigida**
> **REGRAS GERAIS**: Este arquivo é a **ÚNICA** fonte de verdade para planejamento. Não existem arquivos de tarefa (.tasks) ou planos externos.
> **Lido e consolidado de**: DOCUMENTACAO_FUNCIONAL.md (1441 linhas) · SCHEMA_BANCO_DADOS.md (926 linhas) · GUIA_PROMPTS_AGENTES.md · PRODUTO_ESCOPO_ENTREGAS.md · personas_rede_cuca.md · brainstorm_cuca.md · DECISOES_RESOLVIDAS.md · IMPLEMENTATION_PLAN.md

---

## SUMÁRIO

1. [Stack Técnica](#1-stack)
2. [Arquitetura Geral](#2-arquitetura)
3. [Estrutura de 14 Canais WhatsApp (CORRIGIDA)](#3-canais)
4. [Agentes IA, Personas e RAG](#4-agentes)
5. [RBAC — 4 Níveis de Acesso](#5-rbac)
6. [Schema do Banco de Dados (26 tabelas)](#6-schema)
7. [Mapa de Dependências](#7-dependencias)
8. [Roadmap: 5 Fases, 17 Sprints](#8-roadmap)
9. [Status por Sprint com Tickets](#9-sprints)
10. [Developer Console — Detalhamento](#10-devconsole)
11. [Mapa de Reflexos (Ação → Impacto)](#11-reflexos)
12. [Integrações Externas](#12-integracoes)
13. [Riscos e Mitigações](#13-riscos)

---

## 1. STACK TÉCNICA {#1-stack}

| Camada | Tecnologia | Obs |
|--------|-----------|-----|
| **Portal** | Next.js 15 (App Router) + shadcn/ui + Tailwind v4 | Vercel deploy |
| **Banco** | Supabase (PostgreSQL 15+) + pgvector + pg_cron + pg_net | RLS nativo |
| **Auth** | Supabase Auth (email/senha + JWT) | Integrado ao RLS |
| **Storage** | Supabase Storage | CVs, flyers, mídias |
| **Secrets** | Supabase Vault (pgsodium) | Tokens UAZAPI, OpenAI Key |
| **Worker** | Python (FastAPI) + Celery + Redis (VPS Hostinger) | **Credenciais Recebidas ✅** |
| **WhatsApp** | UAZAPI v2 (14 instâncias) | REST + webhooks |
| **LLM** | OpenAI GPT-4o | Agentes, OCR de CV, sentimento |
| **Embeddings** | OpenAI `text-embedding-3-small` (vector 1536) | RAG — custo-benefício |
| **Transcrição** | OpenAI Whisper (`whisper-1`) | Áudio → texto (limite 40s) |
| **Gráficos** | Recharts | Dashboards |
| **Monitoramento** | Sentry | Rastreamento de erros (Frontend/Backend) |
| **Deploy** | Vercel (portal) + Hostinger VPS (worker) | Cloudflare DNS |
| **Cron** | pg_cron + pg_net | Sync mensal, limpeza 60d, auto-cancel 48h |
| **Realtime** | Supabase Realtime | Chat espelhado em tempo real |

---

## 2. ARQUITETURA GERAL {#2-arquitetura}

```
WhatsApp (14 instâncias)  ←→  UAZAPI v2 (webhooks: messages / messages_update / connection)
                                         ↕
                               Worker Python FastAPI (VPS Hostinger)
                               ├── Webhook Handler → 200 OK imediato (OBRIGATÓRIO antes de processar)
                               ├── Identificação de canal e persona ativa
                               ├── OCR CV (GPT-4o Vision)
                               ├── Whisper (áudio ≤40s → texto)
                               ├── Motor de Agentes (3 camadas: persona + técnica + RAG)
                               ├── Motor Anti-Ban (presence: composing, delay aleatório, horário 8h-22h)
                               └── Celery Queues (Redis)
                                         ↕
                               Supabase (PostgreSQL 15 + pgvector)
                               ├── 26 tabelas (ver seção 6)
                               ├── rag_chunks (source_type + cuca_unit_id + vector 1536d)
                               ├── ai_usage_logs (custo por modelo/feature)
                               ├── system_config (delays, limites, configurações)
                               ├── Vault (OpenAI Key, tokens UAZAPI)
                               ├── Realtime (conversations, message_logs)
                               └── pg_cron (3 jobs: sync mensal, limpeza 60d, auto-cancel 48h)
                                         ↕
                               Portal Next.js (Vercel)
                               ├── Dashboard (por nível de acesso)
                               ├── Chat espelhado (Realtime)
                               ├── Módulos: Leads, Programação, Empregabilidade, Acesso CUCA, Ouvidoria
                               ├── Import planilha CSV/Excel (Programação Mensal)
                               ├── Formulários públicos: candidatura, Acesso CUCA, empresa
                               └── Developer Console (exclusivo role 'super_admin')
```

---

## 3. ESTRUTURA DE 14 CANAIS WHATSAPP ⚠️ NUMERAÇÃO CORRIGIDA {#3-canais}

> **CORREÇÃO CRÍTICA**: Não existe "canal institucional" como entidade separada. Canais #1-5 são de **Empregabilidade** (por unidade). A informação geral é respondida por Maria nos canais **Pontuais** (#7-11) e no canal **Geral** (#14).

| # | Canal | Agente/Persona | Gerenciado por | Tipo de Comunicação |
|---|-------|---------------|----------------|---------------------|
| 1 | Empregabilidade — CUCA Barra | Júlia (Barra) | Admin CUCA Barra | Passiva: vagas da Barra, orientação, CV |
| 2 | Empregabilidade — CUCA Mondubim | Júlia (Mondubim) | Admin CUCA Mondubim | Passiva: vagas do Mondubim |
| 3 | Empregabilidade — CUCA Jangurussu | Júlia (Jangurussu) | Admin CUCA Jangurussu | Passiva: vagas do Jangurussu |
| 4 | Empregabilidade — CUCA José Walter | Júlia (J. Walter) | Admin CUCA J. Walter | Passiva: vagas de José Walter |
| 5 | Empregabilidade — CUCA Pici | Júlia (Pici) | Admin CUCA Pici | Passiva: vagas do Pici |
| 6 | **Empregabilidade Geral** | Júlia Geral | Super Admin/Dev | Passiva: vagas de **TODOS** os CUCAs, direciona ao canal certo |
| 7 | Programação Pontual — CUCA Barra | Maria (Barra) | Admin CUCA Barra | **Ativa**: disparo de eventos + Passiva: dúvidas via RAG |
| 8 | Programação Pontual — CUCA Mondubim | Maria (Mondubim) | Admin CUCA Mondubim | Ativa + Passiva |
| 9 | Programação Pontual — CUCA Jangurussu | Maria (Jangurussu) | Admin CUCA Jangurussu | Ativa + Passiva |
| 10 | Programação Pontual — CUCA José Walter | Maria (J. Walter) | Admin CUCA J. Walter | Ativa + Passiva |
| 11 | Programação Pontual — CUCA Pici | Maria (Pici) | Admin CUCA Pici | Ativa + Passiva |
| 12 | **Programação Mensal** | Maria (global) | Super Admin (exclusivo) | **Ativa**: Aviso de nova programação + Link Portal Juventude |
| 13 | **Ouvidoria Jovem** | Sofia | Super Admin (exclusivo) | Passiva: críticas anônimas, sugestões + Ativa: pesquisas/eventos |
| 14 | **Info Gerais + Acesso CUCA** | Maria + Ana (routing) | Super Admin/Dev | Passiva: info qualquer CUCA + agendamento espaços |

### Lógica do Canal de Empregabilidade Geral (#6)

- Canal **passivo** — divulgado em redes sociais (Instagram, etc.), não por disparo
- Lead chega por conta própria perguntando sobre vagas
- Júlia Geral lista vagas abertas de **todas as unidades** (vagas com `status = 'aberta'`)
- Responde: *"Esta vaga está no CUCA [X]. Fale com eles pelo número [link WhatsApp empregabilidade daquela unidade]"*
- **NÃO coleta CV** — apenas direciona ao canal territorial correto

### Lógica dos Canais Pontuais (#7-11)

- Cada CUCA tem seu canal pontual gerenciado pelo próprio Admin
- **Comunicação Ativa**: disparo de programações pontuais (após aprovação)
- **Comunicação Passiva**: pós-disparo, lead responde → Maria usa RAG do evento para responder dúvidas
- Maria também responde dúvidas gerais sobre aquela unidade (RAG de `knowledge_base` da unidade)

### Lógica do Canal #14 — Routing Automático por Intenção

```
Lead envia mensagem para #14
    │
    ├── Intenção: dúvida geral / programação / cursos / horários / info dos CUCAs
    │       └── Ativa persona MARIA
    │               RAG: knowledge_base (global) + monthly_program + scheduled_program
    │
    └── Intenção: usar espaço / agendar / reservar / equipamento
            └── Ativa persona ANA
                    Ação: envia link público do formulário de solicitação
                    RAG: spaces + equipment ativos (query direta no DB, não pgvector)
```

### Estratégia Anti-Ban (todos os canais de disparo)

| Regra | Implementação Técnica | Detalhe Crucial |
|-------|-----------------------|-----------------|
| Simulação de presença | `"presence": "composing"` | Simula "digitando..." por 2-3s antes de cada disparo |
| Delay dinâmico | 5s a 45s (conforme canal) | Nunca usar delays fixos; o Worker deve gerar atraso aleatório |
| Horário comercial | Bloqueio 22:01 às 07:59 | Evita detecção de comportamento robótico noturno |
| Distribuição de carga | Segmentação por 3 instâncias | 20k leads → ~6.6k por número p/ reduzir estresse individual |
| Personalização IA | Variáveis `{{nome}}` + RAG | Mensagens únicas por lead evitam o hash de spam da Meta |
| Warm-up gradual | Escalonamento em 5 semanas | 50 (S1) → 150 (S2) → 500 (S3) → 1.5k (S4) → 6k+ (S5) msgs/dia |
| Webhook Health Check | Monitoramento `messages.update` | Ponto crítico: **Pausar envio** se taxa de erro (failed) > 8% |
| Logout Seguro | `POST /instance/disconnect` (token da instância) | Sempre desconectar antes de TROCAR chip — **NÃO excluir a instância** |
| Tipo de Conta | WhatsApp Business | Uso obrigatório de contas comerciais para maior tolerância |

### Gestão Descentralizada e Recuperação de Ban (Self-Service)

Para evitar deslocamentos físicos e chamadas constantes, o sistema adota a **Autonomia de Unidade**:

1.  **Portal da Unidade**: Administradores locais (`admin_cuca_[unidade]`) terão acesso a uma página de "Configurações de Conexão".
2.  **Visibilidade Filtrada**: O Admin do CUCA Pici vê apenas as instâncias #5 (Empregabilidade Pici) e #11 (Pontual Pici).
3.  **Independência de Número**: A automação (agentes e lógica) está vinculada ao **Token da Instância**, não ao chip físico.
4.  **Recuperação Zero-Support**:
    - Se o número for banido, o Admin da unidade abre seu portal.
    - Clica em **"Alterar Aparelho/Recuperar Ban"** (executa `logout` da instância atual).
    - Escaneia o novo QR Code com um chip reserva diretamente da unidade.
    - O sistema volta a operar imediatamente com o novo número, mantendo todo o histórico de conversas e prompts.

---

> [!IMPORTANT]
> ## ⚠️ DECISÃO ARQUITETURAL — TROCA DE NÚMERO / RECUPERAÇÃO DE BAN (04/03/2026)
>
> **Cenário**: número banido pelo Meta, ou Admin decide trocar o chip de uma instância.
>
> ### ✅ AÇÃO CORRETA: Logout + Reconectar ("Trocar Chip")
> 1. Portal exibe botão **"Trocar Chip"** → chama `POST /api/instancias/{nome}/logout`
> 2. Worker executa `POST /instance/disconnect` na UAZAPI (chip atual desvinculado)
> 3. Worker mantém a instância no banco com o MESMO token — apenas `ativa = false`
> 4. Portal abre modal de QR Code → usuário escaneia com novo chip
> 5. Worker atualiza `ativa = true` e `telefone` quando webhook `connection` chega
>
> **Por que é a correta:**
> - Token da instância permanece → histórico de conversas íntegro (`instancia_id` não muda)
> - Configuração de webhook, agentes e transbordo humano preservados
> - Único custo: warm-up reinicia para o novo número
>
> ### ❌ AÇÃO INCORRETA: Excluir + Recriar
> - Novo token → novo webhook URL → reconfigurar tudo
> - Conversas antigas ficam sem referência (`instancia_id` deletado → dados órfãos)
> - Warm-up reinicia do zero de forma mais severa (número completamente novo para a Meta)
> - **Excluir instância = apenas para encerramento definitivo de canal** (unidade desativada)
>
> ### 🔁 Warm-up na troca de chip
> - O Worker deve detectar mudança de telefone via evento `connection` e registrar data de início do warm-up por instância
> - **Ticket pendente (S8-06)**: Warm-up por instância (`instancias_uazapi.warmup_started_at`), não global
> - Até S8-06 ser implementado: Super Admin deve monitorar o disparo manualmente nos primeiros 5 dias após troca

## 4. AGENTES IA, PERSONAS E RAG {#4-agentes}

### As 3 Camadas do Prompt (obrigatório para todos os agentes)

```
CAMADA 1 — PERSONA (quem sou)
  → personas_rede_cuca.md: nome, idade, tom de voz, frases características, competências
  → "Você é a [Nome], [X] anos. [perfil]. Seu tom é [tom]. Use frases como: [exemplos]."

CAMADA 2 — TÉCNICA (o que faço)
  → Regras de negócio, rotas, ações proibidas, limites, fluxos
  → Baseada nas seções funcionais da DOCUMENTACAO_FUNCIONAL.md

CAMADA 3 — RAG DINÂMICO (o que sei agora)
  → Chunks injetados via busca semântica no pgvector (à cada mensagem)
  → Filtros: source_type + cuca_unit_id (quando aplicável)
```

> **Importante**: A persona (Camada 1) define a PERSONALIDADE. A camada técnica (Camada 2) define o COMPORTAMENTO e as REGRAS. Ela é quem "chama" a persona. A persona sozinha não sabe quais rotas seguir.

### Tabela de Agentes com RAG por Canal

| Canal | Persona | RAG — source_type | RAG — filtro cuca_unit_id |
|-------|---------|-------------------|---------------------------|
| #1-5 (Empregabilidade unidade) | Júlia | `job_posting` | Apenas a unidade do canal |
| #6 (Empregabilidade Geral) | Júlia | `job_posting` | **Sem filtro** (todos os CUCAs) |
| #7-11 (Pontual por unidade) | Maria | `scheduled_program` + `knowledge_base` | Apenas a unidade do canal |
| #12 (Mensal) | Maria | `monthly_program` | Sem filtro (global) |
| #13 (Ouvidoria) | Sofia | `ouvidoria_evento` (se ativo) | Conforme evento |
| #14 (Geral — dúvidas) | Maria | `knowledge_base` + `monthly_program` | Sem filtro (global) |
| #14 (Acesso CUCA — agendamento) | Ana | Query direta: `spaces` + `equipment` (status='ativo') | CUCA da solicitação |

### Personas (resumo de personas_rede_cuca.md)

| Persona | Idade | Tom | Frases características |
|---------|-------|-----|----------------------|
| **Maria** | 28 | Acolhedor, claro, didático | "Deixa eu te explicar direitinho..." / "Só para garantir que ficou claro..." |
| **Ana** | 32 | Profissional, objetivo, cordial | "Vou precisar de alguns detalhes..." / "Quanto ao prazo, o processo leva..." |
| **Sofia** | 35 | Acolhedor, respeitoso, validador | "Agradeço por compartilhar isso..." / "Vou registrar sua manifestação com cuidado..." |
| **Júlia** | 30 | Encorajador, prático, respeitoso | "Vamos ver qual vaga se encaixa melhor..." / "Essa experiência pode ser um diferencial..." |
| **Expert** | — | Técnico, analítico, vigilante | "Detectada anomalia na API..." / "Saúde do sistema em 98.5%..." |

### Agente de Observabilidade (Especialista Técnico)
Novo agente focado na saúde do ecossistema, medindo as duas fontes de verdade:

1. **Fonte Interna**: `ai_usage_logs`, `worker_logs`, `audit_logs` e métricas do Supabase.
2. **Fonte Externa**: Sentry (erros de frontend e exceções de backend).

**Objetivo**: Realizar a correlação entre falhas de código (Sentry) e comportamento da IA/Worker, gerando relatórios de estabilidade e sugerindo otimizações de tokens ou correção de bugs de fluxo.

### Regras Técnicas Críticas por Agente (Camada 2)

**Júlia (Empregabilidade #1-5)**:
- Lista APENAS vagas com `status = 'aberta'` da unidade
- Confirma e certifica com o lead antes de enviar link: *"Você deseja se candidatar à vaga de [título]? Confirme para prosseguir."*
- **NUNCA opina** se o candidato tem aptidão ou não — apenas lista vagas disponíveis
- Se lead quer se candidatar a mais de uma: trata cada candidatura separadamente
- Envia link público de candidatura (data nasc + upload CV)
- Orienta carreira 24h quando não há candidatura em andamento

**Júlia Geral (Empregabilidade #6)**:
- Lista vagas de TODOS os CUCAs
- Direciona ao WhatsApp da unidade correspondente (nunca coleta CV)

**Maria (Pontual #7-11)**:
- Responde dúvidas gerais da unidade + detalhes de eventos pontuais ativos (RAG)
- Pós-disparo: contexto do evento carregado via RAG (`scheduled_program`)
- Na primeira interação: avisa limite de áudio — *"Você pode enviar áudios de até 40 segundos."*

**Maria (Mensal #12)** e **Maria (Geral #14)**:
- **Consultora de Programação**: Responde dúvidas detalhadas sobre cursos e horários baseada no RAG do Excel importado.
- **Chamada para Ação (CTA)**: Sempre enfatiza: *"Se quiser saber mais detalhes sobre qualquer atividade da programação, pode me perguntar por aqui mesmo! Estarei pronta para te ajudar."*
- **Redirecionamento**: Sempre reforça que a matrícula é feita exclusivamente pelo link do Portal da Juventude (enviado no aviso inicial).
- Fornece links WhatsApp das unidades quando necessário.
- Se detectar intenção de agendamento: transfere para Ana (no #14).

**Ana (Acesso CUCA — #14)**:
- Envia link do formulário público de solicitação
- Após aprovação: informa protocolo e cron de 48h
- **NUNCA** compartilha: informações de contato de servidores, motivos de reprovação, detalhes internos
- Se lead insiste após reprovação: *"Os detalhes só podem ser compartilhados presencialmente. Por favor, dirija-se à unidade [CUCA]."* (repete com variações)

**Sofia (Ouvidoria #13)**:
- Pergunta SEMPRE: *"Você quer fazer uma crítica ou uma sugestão?"*
- Ativa **buffer de 15 segundos** antes de processar (lead pode enviar em mensagens fragmentadas)
- **Crítica** → anônima: não coleta nome/telefone. Avisa: *"Não estamos coletando seus dados pessoais, apenas a mensagem."*
- **Sugestão** → identificada: coleta nome + CUCA que frequenta
- **Loop de continuidade**: após cada mensagem, pergunta se quer enviar mais. Encerra quando lead diz "não", "obrigado", "valeu", "era isso", etc.
- Em **evento ativo**: responde EXCLUSIVAMENTE dentro do escopo da Descrição do Evento. Fora do escopo: *"Neste momento estamos coletando seu feedback sobre [tema]. Para dúvidas gerais, entre em contato pelo número de informações gerais."*

### Transcrição de Áudio (todos os agentes)

- Limite: **40 segundos**
- Fluxo: Webhook `messages.upsert` → verificar `audioMessage.seconds`
- **Regra crítica**: responder 200 OK ao webhook **IMEDIATAMENTE**, antes de qualquer processamento
- Se `seconds > 40`: NÃO baixar mídia. Responder com delay+presence: *"Seu áudio ultrapassou o limite de 40 segundos. Por favor, envie um áudio mais curto ou descreva por texto."*
- Se `seconds ≤ 40`: `GET /instance/downloadMedia` → buffer → Whisper → texto → LLM

---

## 5. RBAC — 4 NÍVEIS DE ACESSO {#5-rbac}

### Nível 1 — Developer/Owner (`role = 'super_admin'` no schema atual)

- Único com acesso ao **Developer Console** (`/developer`)
- Gerencia prompts dos agentes (editar, versionar, testar)
- Acessa `ai_usage_logs`: custo por modelo, feature, projeção mensal
- Logs em tempo real do Worker (WebSocket, últimas 1000 linhas, filtros)
- Métricas do Worker: health, uptime, fila Celery, latência, CPU/memória
- Controle de instâncias UAZAPI (criar, editar, deletar, reconectar, QR Code)
- Configura gatilhos de alerta (WhatsApp + e-mail para erros críticos)
- Ajusta `system_config` (delays, limites, warm-up, modelos) sem restart
- Cria usuários Super Admin

### Nível 2 — Super Admin CUCA (`role = 'secretaria'` no schema)

- Acesso global — todos os territórios
- **Exclusivo**: criar e ver eventos de Ouvidoria, análise de sentimento
- **Exclusivo**: Programação Mensal (import planilha + confirmação + disparo)
- Visualiza relatórios consolidados de todos os CUCAs
- Cria usuários Admin CUCA
- **Não acessa** Developer Console

### Nível 3 — Admin por CUCA (`role = 'gestor_unidade'` ou `'coordenador'`)

- Visão restrita ao seu `cuca_unit_id`
- Cria sub-usuários (colaboradores) com permissões granulares via checklist
- **Programação Pontual**: criar, aprovar, disparar para a unidade. Pode ativar **filtro global** para evento unificar todos os CUCAs
- **Empregabilidade**: criar/editar vagas, ver candidatos, aprovar agendamento nível 1
- **Vagas Expansivas**: flag que faz a vaga aparecer no canal geral #6 (divulgação via redes)
- Não vê Ouvidoria, Developer Console, dados de outros CUCAs

### Nível 4 — Colaborador/Operador (`role = 'operador'`)

- Criado pelo Admin CUCA com permissões específicas via checklist

**Checklist de permissões por módulo** (Admin seleciona ao criar a função):

| Módulo | Ações no checklist |
|--------|--------------------|
| Programação Pontual | Criar / Editar / Deletar / Aprovar / Visualizar |
| Programação Mensal | Sincronizar / Visualizar |
| Instâncias WhatsApp | Criar / Editar / Deletar / Conectar / Visualizar |
| Mensagens | Enviar / Visualizar / Envio em Massa |
| Vagas | Criar / Editar / Deletar / Visualizar / Gerenciar Candidatos |
| Empresas | Criar / Editar / Deletar / Visualizar |
| Leads | Criar / Editar / Deletar / Visualizar / Importar / Exportar |
| Banco de Talentos | Visualizar / Fazer Match / Atribuir a Vaga |
| Colaboradores | Criar / Editar / Deletar / Visualizar |
| Funções | Criar / Editar / Deletar / Visualizar |
| Categorias | Criar / Editar / Deletar / Visualizar |
| Unidades CUCA | Editar / Visualizar |
| Base de Conhecimento | Criar / Editar / Deletar / Visualizar |
| Campanhas | Criar / Editar / Deletar / Aprovar / Visualizar |
| Agendamento de Espaços | Visualizar / Aprovar Nível 1 / Aprovar Nível 2 |
| Ouvidoria | Visualizar / Responder / Categorizar / Exportar |
| Dashboard/Métricas | Visualizar Própria Unidade / Visualizar Global |
| Pesquisas | Criar / Enviar / Visualizar Resultados |

### Controle de Mensagens (Isolamento por Instância)

| Perfil | O que vê no chat espelhado |
|--------|---------------------------|
| Operador de Empregabilidade (CUCA X) | Apenas conversas da instância empregabilidade do CUCA X |
| Operador de Pontual (CUCA X) | Apenas conversas da instância pontual do CUCA X |
| Gestor do CUCA X | Todas as conversas de todas as instâncias do CUCA X |
| Admin/Gestão Central | Todas as conversas de todos os CUCAs + canais globais |

---

## 6. SCHEMA DO BANCO DE DADOS (26 TABELAS) {#6-schema}

### Core (RBAC + Multi-tenancy)
- `cuca_units` — 5 unidades (name, slug, address, opening_hours JSONB, lat/lng)
- `roles` — funções (super_admin, secretaria, gestor_unidade, coordenador, operador)
- `permissions` — permissões granulares (key: `leads:read`, `ouvidoria:manage`, `developer:access`, etc.)
- `role_permissions` — N:N entre roles e permissions
- `collaborators` — vinculado a `auth.users` + role_id + cuca_unit_id (NULL para globais)

### Leads e Comunicação
- `categories` — categorias de interesse (Esporte, Cultura, Hip Hop, Tecnologia...)
- `leads` — remote_jid, phone, name, cuca_unit_id, opt_in, opt_in_date, opt_out_date, lat/lng
- `lead_categories` — N:N leads × categories
- `whatsapp_instances` — 14 instâncias (instance_name, phone, category, cuca_unit_id, token_vault_key, status, messages_sent_today)
- `message_logs` — toda mensagem (instance_id, lead_id, direction, content_type, content, media_url, from_me, status) — **limpeza automática 60 dias**
- `conversations` — estado da conversa (status: active/awaiting_human/human_responding/closed, assigned_to)

### Programação
- `scheduled_programs` — pontual (title, description, event_date, flyer_url, status: rascunho→aguardando_aprovacao→aprovado→enviado→cancelado, approved_by)
- `scheduled_program_filters` — filtros N:N (category, age_range, gender, geo_radius como JSONB)
- `monthly_programs` — cabeçalho mensal (month, year, source: api/manual_import)
- `monthly_program_items` — atividades (activity_name, category, instructor, day_of_week, time_start, location, age_range, vacancies, enrollment_link)
- `campaigns` — campanhas genéricas (message_template com variáveis {{nome}}, media_url, status, scheduled_for)
- `campaign_filters` — filtros das campanhas

### Empregabilidade
- `companies` — CNPJ, access_token (para formulário público sem recadastro)
- `job_postings` — vagas (title, description, requirements, salary, vacancies, status: pre_cadastro→aberta→preenchida→cancelada, cuca_unit_id)
- `candidates` — (job_posting_id, lead_id, cv_url, ocr_data JSONB, status: pendente→selecionado→contratado/rejeitado→banco_talentos)
- `talent_bank` — (candidate_id, skills JSONB, experience_years) — últimos 3 meses

### Acesso CUCA
- `spaces` — espaços (name, capacity, active, cuca_unit_id)
- `equipment` — equipamentos (space_id, name, status: ativo/desativado/manutencao)
- `space_requests` — solicitações (protocol_number, cpf, space_id, equipment_ids UUID[], status: aguardando_aprovacao_tecnica→aguardando_aprovacao_secretaria→aprovado/reprovado/cancelado, auto_canceled_at)

### Ouvidoria
- `ouvidoria_manifestacoes` — (tipo: critica/sugestao/ideia, conteudo, cuca_unit_id, nome/telefone/remote_jid/lead_id **APENAS para sugestões**, protocolo, sentiment, themes JSONB)
- `ouvidoria_eventos` — eventos de escuta (titulo, descricao, start_date, end_date, status: ativo/encerrado)
- `satisfaction_surveys` — pesquisas (tipo: quantitativa/qualitativa, pergunta, opcoes JSONB)
- `survey_responses` — respostas (survey_id, lead_id, resposta)

### RAG e IA
- `rag_chunks` — chunks vetorizados (source_type: knowledge_base/monthly_program/scheduled_program/job_posting, source_id, cuca_unit_id, content, embedding vector(1536), metadata JSONB)
- `knowledge_base` — base manual (title, content, cuca_unit_id [NULL=global], category)
- `ai_usage_logs` — consumo OpenAI (model, feature: agent/ocr/transcription/matching/sentiment, tokens_input, tokens_output, cost_usd)

### Logs, Auditoria e Config
- `audit_logs` — (action, resource_type, resource_id, old_data JSONB, new_data JSONB, ip_address)
- `worker_logs` — (level: INFO/WARNING/ERROR/CRITICAL, type: webhook/dispatch/ocr/transcribe/error, metadata JSONB)
- `system_config` — chave/valor JSONB (delays, limites, warm-up, modelo Whisper, budget OpenAI)
- `developer_alerts` — gatilhos de alerta (trigger_type, condition JSONB, channel: whatsapp/email, recipient)

### pg_cron Jobs (3 agendados)

```sql
-- Sync Mensal (dia 1 de cada mês às 00:00)
SELECT cron.schedule('sync_monthly_programs', '0 0 1 * *', 'SELECT sync_monthly_programs()');

-- Limpeza de mensagens antigas (60 dias — todo dia às 02:00)
SELECT cron.schedule('cleanup_old_messages', '0 2 * * *', 'SELECT cleanup_old_messages()');

-- Auto-cancelamento de solicitações sem resposta (48h — a cada hora)
SELECT cron.schedule('auto_cancel_space_requests', '0 */1 * * *', 'SELECT auto_cancel_space_requests()');
```

### RLS — Row Level Security

Toda tabela com dados sensíveis tem RLS:
- `super_admin` → acessa tudo (todas as tabelas, sem filtro de unidade)
- `secretaria` → acessa tudo (igual super_admin, mas sem Developer Console)
- `gestor_unidade` / `coordenador` / `operador` → acessa apenas registros onde `cuca_unit_id = colaborators.cuca_unit_id` do usuário logado
- RLS é a barreira real de segurança — o frontend não pode confiar apenas em si mesmo

### Triggers e Automações SQL (Detalhamento Técnico)

| Trigger | Tabela | Ação | Objetivo |
|---------|--------|------|----------|
| `tr_evento_index` | `eventos_pontuais` | AFTER INSERT/UPDATE | Indexa no RAG apenas se `status = 'aprovado'`. |
| `tr_vaga_index` | `vagas` | AFTER INSERT/UPDATE | Indexa no RAG apenas se `status = 'aberta'`. |
| `tr_campanha_mensal_index` | `campanhas_mensais` | AFTER INSERT/UPDATE | Indexa no RAG se `status = 'aprovado'`. |
| `tr_alerta_handover` | `conversas` | AFTER UPDATE | Dispara alerta WP ao operador se `status = 'awaiting_human'`. |
| `tr_alerta_acesso_cuca` | `solicitacoes_acesso` | AFTER INSERT/UPDATE | Dispara alerta N1 (Coordenador) ou N2 (Secretaria). |
| `trigger_alerta_evento_pontual` | `eventos_pontuais` | AFTER INSERT/UPDATE | Notifica Super Admin sobre nova solicitação de aprovação. |

> [!NOTE]
> Todas as automações utilizam a extensão `pg_net` para invocar a Edge Function `alertas-institucionais`, que atua como HUB de roteamento.

---

## 6.5 DECISÕES ARQUITETURAIS CRÍTICAS — O QUE NÃO EXISTE NO PORTAL {#65-decisoes}

### RAG é invisível e automático

Não existe módulo "Base de Conhecimento" no portal como item de menu ou página acessível ao usuário final. O RAG é alimentado **silenciosamente** pelo Worker sempre que o usuário faz o seu trabalho normal:

| Usuário faz... | Worker faz automaticamente (invisível) |
|----------------|----------------------------------------|
| Salva/edita uma Programação Pontual | `indexar_conteudo('scheduled_program', id)` → chunking → embeddings → `rag_chunks` |
| Importa Programação Mensal | `indexar_conteudo('monthly_program', id)` → embeddings → `rag_chunks`. **Nota**: Processo exclusivo para consulta via IA, sem gestão de matrículas interna. |
| Cria/edita uma Vaga de Emprego | `indexar_conteudo('job_posting', id)` → embeddings → `rag_chunks` |
| Cria um Evento de Ouvidoria | Sofia recebe a descrição do evento diretamente no contexto do prompt |

O usuário **nunca vê, nunca toca, nunca configura** embeddings, `source_type`, `chunk_size`, ou qualquer detalhe técnico do RAG.

### Prompts dos agentes são código, não configuração de usuário

Os prompts completos das 4 personas (Maria, Ana, Sofia, Júlia) com as 3 camadas são **escritos pela IA e versionados como migration SQL**. Nenhum usuário final configura prompts. O fluxo é:

```
IA escreve prompt → migration SQL → banco (tabela system_config ou agent_prompts)
                                          ↓
                         Worker consulta prompt ao receber mensagem
                         (invisível ao usuário)
```

O Owner/Developer pode **visualizar** os prompts ativos no Developer Console — mas sem edição de produção diretamente pela UI (mudanças passam por nova migration).

### O que NÃO deve aparecer na sidebar do portal para usuário final

| Item removido | Motivo |
|---------------|--------|
| `/base-conhecimento` | Não existe como módulo de usuário — RAG é automático |
| `/agente-maria` | Configuração técnica — exclusiva do Developer Console |
| Qualquer referência a "embeddings", "RAG", "prompt", "token" | Jargão técnico invisível para gestores |

### Onde essas informações vivem (apenas para Developer/Owner)

| O quê | Onde fica |
|-------|-----------|
| Logs de execução dos agentes | Developer Console → Logs em Tempo Real |
| Consumo de tokens por agente | Developer Console → Consumo OpenAI |
| Prompts ativos (visualização) | Developer Console → Agentes (read-only) |
| Configuração de parâmetros RAG (top_k, threshold) | `system_config` no banco — editável só pelo Developer Console |

---

## 7. MAPA DE DEPENDÊNCIAS {#7-dependencias}

```
NÍVEL 0 — Fundação (sem dependências)
├── Supabase: schema + RLS + Auth + Vault + pgvector + pg_cron
├── RBAC: roles, permissions, collaborators, seeds
└── UAZAPI: 14 instâncias configuradas, webhook 200 OK

NÍVEL 1 — Depende do Nível 0
├── Leads: CRUD, importação CSV, opt-in/opt-out LGPD
├── Categorias CRUD
├── Unidades CUCA CRUD
├── Worker Python: scaffold FastAPI, rota /webhook → 200 OK imediato
└── Base de Conhecimento + RAG (rag_chunks + knowledge_base + embeddings)

NÍVEL 2 — Depende do Nível 1
├── Agentes IA: 3 camadas de prompt, busca semântica pgvector
├── Chat espelhado em tempo real (Supabase Realtime)
├── Handover humano: notificação WhatsApp + resumo IA
└── Transcrição áudio: validação de 40s + Whisper

NÍVEL 3 — Depende do Nível 2
├── Programação Pontual (CRUD + aprovação + disparo + filtro global + RAG auto)
├── Programação Mensal (**RAG-Only**: import planilha + embeddings + disparo de aviso com link externo)
├── Campanhas genéricas (workflow idêntico ao pontual)
└── Espaços/Equipamentos CRUD (pré-requisito para Acesso CUCA)

NÍVEL 4 — Depende do Nível 3
├── Empregabilidade (vagas, link público, OCR, candidatos, banco talentos)
├── Canal Geral #6 (vagas expansivas de todos os CUCAs)
├── Acesso CUCA (formulário, protocolo, 2 aprovações, cron 48h, Ana)
└── Ouvidoria (Sofia, crítica/sugestão, eventos de escuta, pesquisas)

NÍVEL 5 — Depende de tudo
├── Dashboards consolidados e métricas por território/global
├── Análise de sentimento automática (IA) por evento
├── Banco de Talentos + Matching IA (últimos 3 meses)
└── Developer Console (ai_usage_logs, worker health, prompt control)
```

---

## 8. ROADMAP: 5 FASES, 17 SPRINTS {#8-roadmap}

> Cada sprint = **2 semanas**. Total: **~8,5 meses de desenvolvimento**

| Fase | Sprints | Objetivo |
|------|---------|----------|
| **Fase 0** | 1-2 | Fundação: Supabase, RBAC, UAZAPI, Worker scaffold, Portal shell |
| **Fase 1** | 3-5 | Comunicação base: Leads, RAG, Maria, Chat espelhado |
| **Fase 2** | 6-8 | Programações, Disparos, Campanhas |
| **Fase 3** | 9-11 | Empregabilidade completa (Júlia, OCR, canal geral) |
| **Fase 4** | 12-14 | Acesso CUCA (Ana) + Ouvidoria (Sofia) |
| **Fase 5** | 15-17 | Developer Console, Dashboards, Testes, Go-live |

---

## 9. STATUS POR SPRINT COM TICKETS {#9-sprints}

### FASE 0 — FUNDAÇÃO

#### Sprint 1 — Supabase + RBAC Base ✅ CONCLUÍDO
| Ticket | Entregável | Status |
|--------|-----------|--------|
| S1-01 | Schema base: cuca_units, roles, permissions, role_permissions, collaborators | [x] |
| S1-02 | Auth: login email/senha, middleware de sessão | [x] |
| S1-03 | RLS: policies por cuca_unit_id e role | [x] |
| S1-04 | Extensões: pgvector, pg_cron, pg_net, pgsodium | [x] |
| S1-05 | Seeds: 5 unidades CUCA, roles padrão, permissions | [x] |

#### Sprint 2 — Estrutura & Portal ✅
> **Foco**: Shell do Portal e Fluxo de Autenticação Centralizado.

- [x] **S2-01: Setup Next.js 14 + Shadcn UI** ✅
- [x] **S2-02: Auth Supabase (Edge Middleware)** ✅
- [x] **S2-03: Layout Shell (App Router)** ✅
- [x] **S2-04: Sidebar Dinâmica (Role Based Access)** ✅
- [x] **S2-05: RBAC: Funções & Permissões** (Seeded) ✅
- [x] **S2-06: CRUD: Colaboradores & Equipe** ✅
- [x] **S2-07: UAZAPI: Conexão Webhook (200 OK)** ✅
- [x] **S2-08: Worker Python: FastAPI Scaffold** ✅
- [x] **S2-09: CORREÇÃO**: Remover `/base-conhecimento` e `/agente-maria` da sidebar geral do portal ✅
- [x] **S2-10: Criar Developer Console Hub** em `/developer` e `/developer/agentes` ✅

---

### FASE 1 — COMUNICAÇÃO BASE

#### Sprint 3 — Leads + Categories ✅ CONCLUÍDO
| Ticket | Entregável | Status |
|--------|-----------|--------|
| S3-01 | Leads CRUD: cadastro, busca, filtros por unidade | [x] |
| S3-02 | Importação CSV de leads | [x] |
| S3-03 | Opt-in/Opt-out: detecção automática "SAIR"/"PARAR" + historico_opt_in | [x] |
| S3-04 | Categorias CRUD (Cultura, Esporte, Tecnologia, Arte, etc.) | [x] |
| S3-05 | Unidades CUCA CRUD com dados dos 5 equipamentos | [x] |

#### Sprint 4 — RAG + Motor de Agentes MVP ✅ CONCLUÍDO (Técnico)

| Ticket | Entregável | Status |
|--------|-----------|--------|
| S4-01 | Tabelas: rag_chunks, ai_usage_logs, conversations, message_logs | [x] |
| S4-02 | Índice HNSW no embedding vector(1536) | [x] |
| S4-03 | Function SQL `buscar_chunks_similares` corrigida com filtros unit/tipo | [x] |
| S4-04 | **Seeds SQL**: Prompts 3 camadas para Maria, Júlia, Ana, Sofia | [x] |
| S4-05 | Edge Function `processar-documento`: chunking (800 chars) + embeddings | [x] |
| S4-06 | Trigger RAG automático: `documentos_rag` → via `pg_net` para Edge Function | [x] |
| S4-07 | Trigger Automação Vagas: `vagas` → gera `documentos_rag` reativo | [x] |
| S4-08 | Trigger Automação Eventos: `eventos_pontuais` → gera `documentos_rag` reativo | [x] |
| S4-09 | Edge Function `motor-agente`: Identificação + RAG + GPT-4o + Métricas | [x] |
| S4-10 | **Segurança**: Chave OpenAI no Supabase Vault + helpers SQL `get_openai_key` | [x] |
| S4-11 | **IA Auditiva**: Integração OpenAI Whisper no motor (áudio < 40s) | [x] |
| S4-12 | Página `/developer/agentes`: Visualização técnica dos prompts em 3 camadas | [x] |
| S4-13 | Teste E2E (Simulado): Pergunta RAG Barra → Resposta Maria Persona ✅ | [x] |

#### Sprint 5 — Chat Espelhado + Webhooks UAZAPI ✅
> **STATUS**: 100% CONCLUÍDO
| Ticket | Entregável | Status |
|--------|-----------|--------|
| S5-01 | **Webhook Master**: Worker FastAPI recebe, valida e salva em `mensagens` | [x] |
| S5-02 | **Routing Automático**: Worker consulta `instancias_uazapi` → envia para Edge Function `motor-agente` | [x] |
| S5-03 | **UI Chat Espelhado**: Página `/atendimento` com Supabase Realtime (viva) | [x] |
| S5-04 | **Controle Manual**: Botão IA ON/OFF por conversa (trava no Worker se status != 'ativa') | [x] |
| S5-05 | **Handover**: Detecção "humano" → Notificação Admin + status `awaiting_human` | [x] |
| S5-06 | **Resposta Manual**: Operador envia no portal → Worker dispara via UAZAPI | [x] |
| S5-07 | **Sincronização**: Marcar como lida no celular quando lida no portal | [x] |
| S5-08 | **Mídia Contextual**: Júlia envia flyer da vaga / Maria envia flyer do evento | [x] |
| S5-09 | **Scaffold do Worker**: Estrutura FastAPI + requirements + Dockerfile para Hostinger | [x] |
| S5-10 | **UI Gestão Instâncias (Global)**: CRUD Completo em `/developer/instancias` (Criação, Edição, Desativação e Vínculo de Transbordo Humano) para Super Admin (Acesso e Ouvidoria) | [x] |
| S5-11 | **UI Gestão Instâncias (Local)**: CRUD Completo em `/configuracoes/whatsapp` (Criação, Edição, Desativação e Vínculo de Transbordo Humano) para Admins de Unidade (Institucional e Empregabilidade) | [x] |
| S5-12 | **Filtros RBAC**: Garantir que Admin local gerencie apenas instâncias da sua Unidade (Máximo 2 ativas: Institucional e Empregabilidade) | [x] |
| S5-13 | **Estrutura de 20 Canais**: Banco migrado com `canal_tipo`, `reserva`, `observacoes` em `instancias_uazapi`, e nova tabela `transbordo_humano` com RLS por unidade. Isolamento de Ouvidoria/Acesso para Super Admin via RLS. | [x] |
| S5-14 | **Isolamento Ouvidoria**: Módulo de Chat de Ouvidoria restrito apenas a Super Admin/Roles Específicas, totalmente oculto do gerente da unidade (`/ouvidoria/mensagens`) | [x] |
| S5-15 | **Worker UAZAPI Manager** (`worker/uazapi_manager.py`): Fluxo real de 3 passos — ✅ **Corrigido para UAZAPI v2**: `POST /instance/init` (admintoken) → `POST /webhook` (token da instância, eventos: messages/messages_update/connection) → `POST /instance/connect` (gera QR). Status via `GET /instance/status`. Endpoints do router: `/api/instancias/criar`, `/{nome}/status`, `/{nome}/qrcode`, `/{nome}/logout`, `/{nome}/excluir`. Handler `connection` atualiza banco automaticamente com detecção dupla (string + booleano). **Nota histórica**: Plano original usava endpoints v1 (`/instance/create`, `/webhook/set`, header `apikey`) que retornavam 401. Corrigido após análise do OpenAPI spec oficial uazapiGO v2.0 e teste com curl manual. | [x] |
| S5-16 | **Hook `use-uazapi.ts`** no Portal: Criação real via Worker, QR Code base64, polling a cada 3s, refresh de QR expirado, logout seguro. Modal de QR com 4 estados visuais (loading/qr_ready/connected/error) em ambas as páginas de gestão. | [x] |
| S5-17 | **Paineis por Módulo** (`CanalWhatsappTab`): Componente reutilizável com CRUD de instâncias e transbordo inserido como aba "Canal WhatsApp" em Ouvidoria (`/ouvidoria`) e Acesso CUCA (`/acesso-cuca`). Visível somente para Super Admin via `hasPermission("super_admin")`. | [x] |

---

### FASE 2 — PROGRAMAÇÃO UNIFICADA E RAG

> [!IMPORTANT]
> **Conclusão de Reunião**: As programações Mensal e Eventual/Pontual serão fundidas. A fonte da verdade para a IA será a base unificada de cada unidade.

#### Sprint 6 — Gestão de Programação & Ingestão ✅
> **Tabelas Alvo**: `eventos_pontuais` (Pontual) e `campanhas_mensais` (Mensal - Bypass).

- [x] **S6-01: Página de Programação Unificada**: Centralizada em `/programacao` com abas Pontual/Mensal. ✅
- [x] **S6-02: Modal Unificado**: Toggle [Mensal/Pontual] para criação rápida. ✅
- [x] **S6-03: Lógica de Status**: Mensal (`aprovado`) com bypass; Pontual (`aguardando_aprovacao`). ✅
- [x] **S6-04: Alertas de Aprovação**: Super Admin notificado via WhatsApp sobre novos eventos pontuais. ✅
- [x] **S6-05: Módulo de Flyers**: Integração com Supabase Storage (bucket `programacao`) para artes gráficas. ✅
- [x] **S6-06: Importação XLSX**: Parser client-side (SheetJS) para carga massiva de planilhas de 800+ atividades. ✅

#### Sprint 7 — Sistema Integrado de Alertas & Inteligência ✅
> **Foco**: Notificações institucionais e RAG qualificado.

- [x] **S7-01: RAG Qualificado**: Indexação automática restrita a itens validados (aprovados/abertos). ✅
- [x] **S7-02: Fluxo Handover**: Alerta WP ao operador da unidade quando a IA pede intervenção humana. ✅
- [x] **S7-03/04: Acesso ao Cuca N1/N2**: Alertas multinível para Coordenadores (Técnico) e Secretaria (Final). ✅
- [x] **S7-05: Motor de Segmentação**: Lógica SQL para contagem e filtro de leads por Eixo e Unidade. ✅

---

---

## 13. MATRIZ DE ALERTAS INSTITUCIONAIS (UAZAPI)

O sistema "entenderá" para quem enviar cada alerta baseando-se na função e vínculo do colaborador:

| Evento de Gatilho | Destinatário Principal | Regra de Seleção |
|-------------------|-------------------------|-------------------|
| **Nova Programação Pontual** | Super Admin | `role = 'super_admin'` |
| **Programação Mensal** | *Nenhum (Bypass)* | Automático (Pré-aprovado) |
| **Handover / Humano** | Atendente / Operador | `role = 'operador'` + `cuca_unit_id` da conversa |
| **Acesso Cuca (Nível 1)** | Coordenador Unidade | `role = 'coordenador'` + `cuca_unit_id` da unidade solicitada |
| **Acesso Cuca (Nível 2)** | Secretaria / Aprovador | `role = 'secretaria'` |

> [!TIP]
> Os números são extraídos do campo `collaborators.phone`. Se houver mais de um colaborador na mesma unidade/regra, todos recebem o alerta para garantir a velocidade de resposta.

#### Sprint 8 — Campanhas + Motor Anti-Ban completo ⏳
| Ticket | Entregável | Status |
|--------|-----------|--------|
| S8-01 | Módulo Campanhas: CRUD (título, template com {{nome}}, mídia, público, agendamento) | [x] |
| S8-02 | Fluxo aprovação de campanhas (idêntico ao pontual) | [x] |
| S8-03 | system_config: delays configuráveis via Developer Console | [x] |
| S8-04 | Warm-up: tabela de progressão (50→150→500→1k→4k msgs/dia por 5 semanas) | [x] |
| S8-05 | Monitoramento: se taxa de erro > limite → parar disparo + alertar | [x] |
| S8-06 | **[PENDENTE]** Warm-up por instância: adicionar `warmup_started_at DATE` em `instancias_uazapi`. Worker detecta mudança de telefone no evento `connection` e reseta o contador de warm-up para aquela instância específica. Impede que troca de chip em uma instância banida resete o warm-up global das demais. | [ ] |

---

### FASE 3 — EMPREGABILIDADE

#### Sprints 9-11 — Empregabilidade Completa ⏳
| Ticket | Entregável | Status |
|--------|-----------|--------|
| S9-01 | Formulário público de cadastro de empresa (CNPJ lookup + access_token) | [x] |
| S9-02 | CRUD vagas: título, descrição, requisitos, benefícios, salário, nº vagas, faixa etária | [x] |
| S9-03 | Campo: local entrevista (na empresa / no CUCA) + tipo seleção | [x] |
| S9-04 | Status lifecycle vaga: pre_cadastro → aberta → preenchida → cancelada | [x] |
| S9-05 | Flag `expansiva`: vaga aparece no canal geral #6 (Júlia Geral no RAG) | [x] |
| S9-06 | Indexação RAG automática ao criar vaga (source_type='job_posting', filtro cuca_unit_id) | [x] |
| S9-07 | Link público unificado da unidade: data nasc. + upload CV + modal de escolha de vaga local | ⏳ |
| S9-08 | Worker: OCR via GPT-4o Vision → JSON (nome, idade, endereço, tel, escolaridade, experiência) | [x] |
| S9-09 | Aviso automático: preenche requisitos básicos? ✅/⚠️/❌ (informativo para gestor) | [x] |
| S9-10 | Datatable de candidatos: nome, idade, tel, escolaridade, experiência, status, ícone 📄 CV | [x] |
| S9-11 | Edição manual de dados OCR incorretos pelo gestor | [x] |
| S9-12 | Status lifecycle candidato: pendente → selecionado → contratado / rejeitado → banco_talentos | [x] |
| S9-13 | Rejeitado → automático para talent_bank com skills JSONB | [x] |
| S9-14 | Contratado → se vagas=0, vaga muda para "Preenchida" | [x] |
| S10-01 | Agente Júlia por unidade (#1-5): consulta RAG job_posting da unidade | [x] |
| S10-02 | Júlia: confirma candidatura antes de enviar link | [x] |
| S10-03 | Júlia Geral (#6): consulta RAG job_posting sem filtro de unidade | [x] |
| S10-04 | Júlia Geral: direciona ao WhatsApp da unidade (não coleta CV) | [x] |
| S10-05 | Orientação profissional 24h: dicas entrevista, currículo (sem candidatura ativa) | [x] |
| S10-06 | Agente RAG: Divulgação cruzada de vagas de outras unidades (com link wa.me) e incentivo no encerramento | ⏳ |
| S11-01 | Banco de Talentos: matching IA ao criar nova vaga (habilidades × requisitos, últimos 3 meses) | [x] |
| S11-02 | Aba "Banco de Talentos" dentro da vaga: candidatos sugeridos por score | [x] |
| S11-03 | Gestor pode adicionar talento como candidato com 1 clique | [x] |
| S11-04 | UI: Interface de mensagens `/empregabilidade/mensagens` isolada do atendimento geral (RH independente) | [x] |
| S11-05 | CRUD de Transbordo Humano: Tabela e Tela para configurar núm. de WhatsApp de responsáveis por módulo | [x] |
| S11-06 | Worker Handover: IA detecta pedido de humano, busca número no banco, envia resumo e link pro gestor | [x] |
| S11-07 | 🚨 **DEPLOY VPS HOSTINGER**: Subir o Worker FastAPI na VPS e autenticar instâncias UAZAPI para Go-Live operacional | ⏳ |

---

### FASE 4 — ACESSO CUCA + OUVIDORIA

#### Sprint 12 — Acesso CUCA (Ana) ⏳
| Ticket | Entregável | Status |
|--------|-----------|--------|
| S12-01 | CRUD de Espaços e Equipamentos (status: ativo/desativado/manutencao) | [x] |
| S12-02 | Formulário público: CUCA → espaço → equipamentos (checkboxes dinâmicos — só ativos) | [x] |
| S12-03 | Campos: nome, CPF, telefone, data, horário, natureza do evento | [x] |
| S12-04 | Geração automática de protocolo (#XXXXX) + status initial | [x] |
| S12-05 | Agente Ana: identifica intenção de agendamento → envia link formulário | [x] |
| S12-06 | Após submissão: Ana envia protocolo via WhatsApp ao solicitante | [x] |
| S12-07 | Aprovação Nível 1 (técnico): notificação WhatsApp + interface portal | [x] |
| S12-08 | Aprovação Nível 2 (secretaria): notificação + aprovação final | [x] |
| S12-09 | Aprovado: Ana informa + ativa cron de 48h auto-cancelamento | [x] |
| S12-10 | Reprovado: Ana responde sem compartilhar motivos/contatos | [x] |
| S12-11 | Insistência pós-reprovação: Ana repete redirecionamento à unidade (variações de texto) | [x] |
| S12-12 | Ana identifica solicitação por protocolo ou CPF em contato posterior | [x] |

#### Sprint 13 — Ouvidoria (Sofia) [x]
| Ticket | Entregável | Status |
|--------|-----------|--------|
| S13-01 | Criação de Eventos de Escuta (Super Admin): título, descrição, datas, filtro CUCA | [x] |
| S13-02 | Sofia: sempre pergunta "crítica ou sugestão?" na primeira mensagem | [x] |
| S13-03 | Buffer 15s entre mensagens (lead pode fragmentar o texto) | [x] |
| S13-04 | Fluxo crítica: anônima (sem remote_jid, sem nome), pergunta CUCA (opcional) | [x] |
| S13-05 | Aviso de anonimato: *"Não estamos coletando seus dados pessoais."* | [x] |
| S13-06 | Fluxo sugestão: coleta nome + CUCA + gera protocolo | [x] |
| S13-07 | Loop de continuidade após cada mensagem ("Deseja enviar mais alguma?") | [x] |
| S13-08 | Enceramento gracioso: "não"/"obrigado"/"valeu"/"era isso" → agradece e finaliza | [x] |
| S13-09 | Em evento ativo: Sofia responde EXCLUSIVAMENTE dentro do escopo da descrição do evento | [x] |
| S13-10 | Portal: páginas "Críticas" (anônimas) e "Sugestões" (identificadas) separadas | [x] |
| S13-11 | Análise de sentimento: botão por evento → GPT-4o classifica positivo/negativo/neutro | [x] |
| S13-12 | Temas recorrentes + resumo executivo + gráficos (pizza, linha, barras) | [x] |
| S13-13 | Pesquisas de satisfação: quantitativa (botões WhatsApp) + qualitativa (texto/áudio) | [x] |

#### Sprint 14 — Pesquisas, LGPD e Governança [x]
| Ticket | Entregável | Status |
|--------|-----------|--------|
| S14-01 | Opt-in na primeira interação: *"Para continuar, preciso que aceite receber mensagens. [Sim] [Não]"* | [x] |
| S14-02 | Se "Não": lead cadastrado mas nunca recebe disparos ativos | [x] |
| S14-03 | Anonimização de dados: funcionalidade de "direito ao esquecimento" | [x] |
| S14-04 | Audit logs automáticos em toda ação do portal (action, resource, user_id, old_data, new_data) | [x] |
| S14-05 | pg_cron limpeza 60 dias em message_logs (02:00 AM) | [x] |

---

### FASE 5 — DEVELOPER CONSOLE + DASHBOARDS + GO-LIVE

#### Sprints 15-17 [x]
| Ticket | Entregável | Status |
|--------|-----------|--------|
| S15-01 | Rota `/developer` (exclusivo role super_admin no banco) | [x] |
| S15-02 | Dashboard consumo OpenAI: tokens/dia, custo/modelo, breakdown por feature, projeção mensal | [x] |
| S15-03 | Alertas de budget: 🟡 80% e 🔴 100% em ai_usage_logs | [x] |
| S15-04 | Logs Worker em tempo real: WebSocket, últimas 1000 linhas, filtros (tipo, instância, lead, período) | [x] |
| S15-05 | Download logs: últimos 7 dias em .txt/.json | [x] |
| S15-06 | Métricas Worker: status, uptime, fila Celery (pendentes/executando/falhas), latência, CPU/memória | [x] |
| S15-07 | Controle instâncias: tabela 14 instâncias, status 🟢/🔴/⚠️, criar, editar, deletar, QR Code | [x] |
| S15-08 | Gatilhos de alerta: worker offline, erro alto, instância desconectada, budget alto, fila travada | [x] |
| S15-09 | system_config UI: editar delays, limites, warm-up, modelo Whisper, budget — sem restart | [x] |
| S15-10 | **Sentry Integration**: Configuração no Portal (Vercel) e no Worker (FastAPI) para captura de erros | [x] |
| S15-11 | **Agente de Observabilidade**: Seed SQL do prompt especialista e integração com APIs de logs | [x] |
| S15-12 | **Dashboard Observabilidade**: Visão consolidada IA (Saúde System) + Erros Sentry | [x] |
| S15-13 | Audit log do Developer Console (toda ação registrada) | [x] |
| S16-01 | Dashboards por CUCA: atendimentos, horários de pico, % IA vs humano, tempo médio resposta | [x] |
| S16-02 | Dashboards globais (Super Admin): consolidado + comparativo entre unidades | [x] |
| S16-03 | Dashboard Empregabilidade: vagas, candidaturas, taxa de contratação, tempo médio | [x] |
| S16-04 | Dashboard Acesso CUCA: espaços demandados, taxa aprovação, no-shows | [x] |
| S16-05 | Dashboard Ouvidoria: sentimento geral, temas, taxa resposta da gestão | [x] |
| S17-01 | Testes E2E (Playwright): todas as rotas e fluxos principais | [x] |
| S17-02 | Load testing: disparo 20k mensagens simultâneas | [x] |
| S17-03 | Documentação: guia do gestor + guia do admin + guia de API interna | [x] |
| S17-04 | Setup Multi-Ambiente: Configurar Redirect URLs no Supabase (Localhost + Produção) | ⏳ |
| S17-05 | Handover técnico: treinamento e entrega de acessos VPS/Hostinger | ⏳ |

---

## 10. DEVELOPER CONSOLE — DETALHAMENTO {#10-devconsole}

### Rota e Controle de Acesso

- Rota: `/developer` — oculta do menu geral
- Permissão: `developer:access` (apenas `role = 'super_admin'`)
- RLS: verificação no banco, não apenas no frontend

### Módulos do Console

**16.3.1 — Consumo OpenAI** (`ai_usage_logs`):
- Tokens input/output por dia (gráfico linha)
- Custo estimado por modelo: GPT-4o, whisper-1, text-embedding-3-small (pizza)
- Breakdown por feature: agent, ocr, transcription, matching, sentiment (tabela com % do total)
- Projeção mensal (baseada nos últimos 7 dias) + card de alerta se > 80% do budget

**16.3.2 — Logs em Tempo Real** (WebSocket):
- Últimas 1000 linhas em tempo real
- Filtros: tipo (webhook/dispatch/ocr/transcribe/error) + instância + lead + período
- Busca textual por message_id, instance_id, conteúdo
- Exemplo de linha: `[2026-02-15 18:45:32] [INFO] [webhook] Instance: cuca_barra_pontual | Lead: 55859... | Response: 200 OK | Latency: 1.2s`

**16.3.3 — Métricas do Worker** (endpoint `/health` do FastAPI):
- Status online/offline | Uptime | Fila Celery (pendentes/executando/falhas) | Latência avg | Taxa erro 24h | CPU/Memória
- Alertas visuais: 🟡 se > limites, 🔴 se crítico

**16.3.4 — Controle de Instâncias UAZAPI (Atualizado para Organograma Oficial)**:
- **Organograma**: 20 canais totais (12 ativos e 8 reservas).
  - **Ativos (12)**: 5 Institucionais, 5 Empregabilidade, 1 Acesso, 1 Ouvidoria.
- **Fluxo de Criação (CRUD real)**: Gerentes criam as suas 2 (Institucional e Empregabilidade). Super Admin cria Acesso e Ouvidoria.
- Botões de **Editar/Excluir/Criar**, em vez de apenas ler.
- **Transbordo Humano**: Interface para o Gerente/Admin amarrar "Números Pessoais/Operacionais" de transbordo da equipe, isolando essa configuração do fluxo global.

**16.3.4 — Controle de Instâncias UAZAPI**:
- **Fluxo de Criação Seguro (UAZAPI v2)**:
    1. `POST /instance/init` com header `admintoken` — cria instância vazia, retorna `token` da instância
    2. `POST /webhook` com header `token` — configura eventos: `messages`, `messages_update`, `connection`
    3. `POST /instance/connect` com header `token` — gera QR Code
    4. `GET /instance/status` com header `token` — verifica status e obtém QR atualizado
- **Gestão de Crise (Troca de Número / Ban)**:
    - Botão "Trocar Chip": chama `POST /instance/disconnect` (header `token`) para limpar sessão → reescanear QR com novo chip
    - ⚠️ **Nunca excluir a instância** para troca de número — isso quebra o histórico de conversas
    - `DELETE /instance` (header `token`): apenas para encerramento definitivo de canal
- **Vínculo Persistente**: Leads vinculados continuam ativos pois as conversas referenciam `instancia_id` que permanece o mesmo após troca de chip.

**16.3.5 — Gatilhos de Aviso** (`developer_alerts`):
| Gatilho | Condição | Canal |
|---------|----------|-------|
| Worker offline | > 5 min | WhatsApp + E-mail |
| Taxa de erro alta | > 10% em 1h | WhatsApp |
| Instância desconectada | Qualquer instância | WhatsApp |
| Budget OpenAI | > 80% do mensal | E-mail |
| Fila Celery travada | > 1000 pendentes | WhatsApp |

**16.3.6 — Configurações** (`system_config`):
- Delays de disparo por tipo (mensal/pontual/campanha): min, max, presence, horário ativo
- Máximo de mensagens/instância/dia
- Warm-up: ativo/inativo + semanas
- Limite áudio: 40 segundos (editável)
- Budget mensal OpenAI em USD
- DSN do Sentry
- Worker **recarrega configurações automaticamente** sem restart

**16.3.7 — Agente Expert de Observabilidade**:
- IA que "lê" os logs e o Sentry para dar o diagnóstico final.
- Mede o "Índice de Confiança" do sistema.
- Disponível no Developer Console para responder perguntas técnicas sobre erros.

---

## 11. MAPA DE REFLEXOS CRÍTICOS {#11-reflexos}

| Ação | Reflexo Imediato | Reflexo RAG | Reflexo em Dados |
|------|-----------------|-------------|-----------------|
| Criar lead | Lead disponível para disparos | — | +1 na base por território |
| Lead envia "SAIR" | opt_in = false imediato | Removido de todos os disparos | Taxa opt-out |
| Importar programação mensal | Dados → rag_chunks (source_type='monthly_program') | Maria tira dúvidas baseada na planilha | Consulta IA liberada |
| Aprovar programação mensal | Disparo de aviso em massa com link externo | RAG atualizado | Aviso enviado |
| Criar vaga | rag_chunks (source_type='job_posting', cuca_unit_id da unidade) + canal #6 se expansiva | Júlia passa a responder | Indicadores empregabilidade |
| Lead envia CV via link público | OCR automático (GPT-4o Vision) → ocr_data JSONB | — | +1 candidatura |
| Rejeitar candidato | Movido para talent_bank com skills | — | Banco talentos |
| Contratar candidato | Se vagas=0, vaga → "Preenchida" | — | Taxa contratação |
| Lead solicita agendamento (#14) | Ana identifica intenção → envia link formulário | — | — |
| Submeter formulário Acesso CUCA | Protocolo gerado, status "aguardando_aprovacao_tecnica" | — | Espaços demandados |
| Aprovação nível 2 | Ana notifica solicitante + cron 48h ativado | — | Tempo médio aprovação |
| Solicitante não aparece em 48h | status = "cancelado", auto_canceled_at = NOW() | — | Taxa no-show |
| Insistência pós-reprovação | Ana redireciona à unidade (nunca motivos/contatos) | — | — |
| Lead critica (ouvidoria) | Registro anônimo (sem remote_jid, nome, tel) | — | Sentimento + temas |
| Lead sugere (ouvidoria) | Registro identificado + protocolo | — | Temas recorrentes |
| Criar evento de escuta | Sofia responde APENAS com base na descrição do evento | RAG='ouvidoria_evento' ativo | Aguarda respostas |
| Clicar "Análise Sentimento" | GPT-4o classifica mensagens do evento | — | Gráficos positivo/negativo/neutro |
| Gestor cadastra base conhecimento | Chunking → embeddings → rag_chunks (source_type='knowledge_base') | Agentes respondem sobre o tema | — |
| Áudio > 40s | NÃO baixar mídia. Responder com aviso. Log rejected. | — | Metadados de rejeição |
| Lead pede humano | IA para + conversa="awaiting_human" + notificação WhatsApp (resumo IA) | — | % handover |
| Operador intervém | IA para imediatamente + fromMe sincronizado portal ↔ celular | — | % intervenções |
| Número banido | Evento `connection` → alerta + `POST /instance/disconnect` (Worker) → Admin escaneia QR com chip reserva | — | Histórico banimentos |

---

## 12. INTEGRAÇÕES EXTERNAS {#12-integracoes}

| Sistema | Tipo | A partir de | Status |
|---------|------|-------------|--------|
| **UAZAPI** | REST + Webhooks (14 instâncias) | Sprint 2 | 🔴 Crítica |
| **OpenAI** (GPT-4o, Embeddings, Whisper) | REST | Sprint 4 | 🔴 Crítica |
| **Supabase Vault** (OPENAI_API_KEY) | Supabase | Sprint 4 | ⚠️ **PENDENTE** |
| **Portal da Juventude** (API REST GET) | pg_cron + pg_net | Sprint 7 | 🟡 Média — fallback planilha |
| **WhatsApp Business** | Via UAZAPI | Sprint 2 | 🔴 Crítica |

---

## 13. RISCOS E MITIGAÇÕES {#13-riscos}

| Risco | Prob. | Impacto | Mitigação |
|-------|:-----:|:-------:|-----------|
| Ban de números WhatsApp | Alta | Alto | Warm-up 5 semanas, delay 5-45s, presence, Business, conteúdo personalizado |
| Custos OpenAI imprevistos | Média | Alto | ai_usage_logs + budget alerts (80%/100%) no Developer Console |
| OPENAI_API_KEY faltando | Alta | Crítico | **Bloqueador atual** — adicionar no Vault antes de continuar |
| API Portal da Juventude indisponível | Média | Médio | Fallback: import manual CSV/Excel já planejado (S7-01) |
| Volume 20k leads simultâneos | Alta | Médio | Celery queue + disparo gradual + distribuição entre instâncias |
| LGPD — críticas na ouvidoria | Baixa | Crítico | remote_jid=NULL em críticas, RLS, Vault, sem coleta de dados pessoais |
| RBAC apenas no frontend | Média | Crítico | RLS no banco é a barreira real — configurar em TODAS as tabelas |
| Numeração dos 14 canais confusa | Alta | Alto | **CORRIGIDA neste documento**: #1-5 Empregabilidade, #6 Geral, #7-11 Pontual, #12 Mensal, #13 Ouvidoria, #14 Info+Acesso |
| Worker não retorna 200 OK imediato | Alta | Alto | UAZAPI faz retry infinito — 200 OK deve ser a PRIMEIRA coisa que o worker faz |

---

---

## 14. HISTÓRICO DE ENTREGAS E EVIDÊNCIAS 📜

### Sprint 5 — Conexão Real (85%)
> **Data**: 20/02/2026

#### [S5-03] UI Chat Espelhado
- **Página `/atendimento`**: Implementada com Supabase Realtime para monitoramento ao vivo.
- **Visual Premium**: Layout glassmorphism com balões de chat customizados e avatares dinâmicos.

#### [S5-04] Controle Manual da IA
- **Lógica de Trava**: Worker FastAPI agora verifica `status` da conversa antes de disparar a IA.
- **Botão IA ON/OFF**: Alternância direta no cabeçalho do chat com feedback visual (cores de alerta para modo manual).

#### [S5-06] Resposta Manual Integrada
- **Worker FastAPI**: Criado endpoint `/send-message` que atua como proxy seguro para a UAZAPI, preservando tokens e instâncias.
- **Componente `ChatWindow`**: Adicionado campo de input com validação de estado (bloqueado quando IA está ativa).
- **Interface**: Design premium com suporte a `Enter` para envio e notificações de sucesso via `react-hot-toast`.

#### [S5-07] Sincronização de Leitura (Sincronizado)
- **Status "Read"**: Implementada chamada automática ao endpoint `/read-message` sempre que o chat é aberto ou uma nova mensagem chega em tempo real.
- **UAZAPI Sync**: A mensagem é marcada como lida no aparelho celular do operador, eliminando notificações pendentes duplicadas.

#### [S5-05] Handover Automático (Detecção de Intenção)
- **Prompt Engineering**: Regra crítica injetada nos prompts de sistema de todos os agentes.
- **Tag Interceptora**: Tag `[[HANDOVER]]` é gerada pela IA e interceptada pela Edge Function `motor-agente`.
- **Transição de Estado**: Mudança automática de `ativa` para `awaiting_human` no banco de dados.
- **UI de Alerta**: O portal exibe badge "URGENTE" e banner de alerta âmbar para intervenção imediata.

---

### Sprint 7 — Inteligência e Alertas Institucionais ✅
> **Data**: 21/02/2026

#### [S7-02] HUB de Alertas: Handover
- **Edge Function `alertas-institucionais`**: Centraliza o disparo de alertas WP para operadores.
- **Trigger SQL**: Sempre que o status muda para `awaiting_human`, o operador da unidade recebe um alerta imediato no WhatsApp com link para o portal.

#### [S7-03/04] Fluxo de Aprovação Acesso CUCA (N1 e N2)
- **Roteamento Técnico**: Alertas disparados para Coordenadores (N1) e Secretaria (N2) conforme o status da solicitação.
- **Unidade Local**: Sistema identifica a unidade do agendamento e notifica o coordenador específico via Banco de Dados -> Edge Function.

#### [S7-05] Motor de Segmentação por Eixos e Unidades
- **Lógica SQL Real**: Substituído placeholder por função `calcular_total_leads_segmentacao` que filtra por `unidade_cuca` e `categorias` (Eixos).
- **Segurança**: Respeita rigorosamente o opt-in de mensagens institucionais.

---

### Sprint 2 — Estrutura & Segurança (Saneamento de Saltos) ✅
> **Data**: 21/02/2026

#### [S2-04/05] RBAC e Sidebar Dinâmica
- **Pillar de Segurança**: Implementado `UserProvider` que carrega o perfil do colaborador e suas permissões do banco.
- **Filtragem de UI**: A barra lateral só exibe módulos onde o usuário possui `permissoes.acao = 'read'`.
- **Seed Base**: Super Admin (full), Gestores (operacional) e Colaboradores (vendas/atendimento) configurados com rigor.

#### [S2-06] Gestão de Equipe (CRUD)
- **Página `/configuracoes/colaboradores`**: Interface completa para o Super Admin gerenciar a equipe, funções e unidades ativas.
- **Integração Realtime**: Mudanças de permissão refletem instantaneamente na shell do portal para o usuário afetado.

---

### Sprint 8 — Motor de Disparo em Massa Integrado ✅
> **Data**: 22/02/2026

#### [S8-01] Unificação: Programação Pontual como Gatilho
- **Lógica de Automação**: O módulo de "Campanhas" foi absorvido pela **Programação Pontual**.
- **Fluxo de Aprovação**: Ao salvar um evento pontual, ele entra em `aguardando_aprovacao`. 
- **Gatilho Automático**: Assim que o Gerente da Unidade clica em "Aprovar", o status muda para `aprovado`. O Worker detecta essa mudança e inicia o disparo em massa para os leads do segmento filtrado.
- **Diferenciação**:
  - **Programação Mensal**: Alimenta o RAG (Base de Conhecimento) para respostas reativas.
  - **Programação Pontual**: Dispara avisos proativos via WhatsApp para os leads selecionados.

#### [S8-02] Motor Background Anti-Ban (Worker Python)
- **Loops Inteligentes (`campanhas_engine.py`)**: O script agora monitora as tabelas de `eventos_pontuais`.
- **Randomização (Warm-up)**: Aguarda tempo `random.uniform()` entre Delay Min e Delay Max a cada lead processado da fila.
- **Monitoramento de Taxa de Erro**: Bloqueio instantâneo se a taxa de erro subir, protegendo o chip contra banimentos.

---

---

#### Galeria de Evidências
````carousel
![Interface de Atendimento com Chat Ativo](/home/valmir/.gemini/antigravity/brain/f58aa5eb-3807-42ad-a784-38890f4da86f/valmir_rocha_chat_view_1771596439715.png)
<!-- slide -->
![Modo Manual / Intervenção Ativa](/home/valmir/.gemini/antigravity/brain/f58aa5eb-3807-42ad-a784-38890f4da86f/modo_manual_state_1771596994898.png)
````


---

## 14. AJUSTES PÓS-DEPLOY (HOSTINGER VPS) {#14-ajustes}

Status das correções emergenciais pós-deploy na VPS:

- [x] **A-01: Leads** - Corrigir erro ao criar Novo Lead (CRUD)
- [x] **A-02: Atendimento** - Ajustar visualização de mensagens (Real vs Mock) + `WORKER_URL`
- [x] **A-03: UI** - Remover menções aos agentes (Júlia Global RAG)
- [x] **A-04: Programação** - Adicionar campos `data_inicio` e `data_fim`
- [x] **A-05: Rotas** - Corrigir erros 404 (Empresas, Configurações, Acesso, Ouvidoria)
- [x] **A-06: CORS/Worker** - Resolver falha de conexão na porta 8000 da VPS

---

## 15. GUIA TÉCNICO: CRIAÇÃO DO SERVIÇO `cuca-worker` NO EASYPANEL {#15-worker-setup}

> **O código já está no repositório. Basta seguir os passos abaixo no painel.**

---

### O que é o Worker?
Um servidor Python (FastAPI + Gunicorn) que roda em paralelo ao Portal (Next.js). Ele é responsável por:
- **Disparos automáticos** (Pontual, Mensal, Ouvidoria) — varre o banco a cada 30s buscando status `aprovado`.
- **Webhooks** — recebe as mensagens do WhatsApp via UAZAPI e salva no banco.
- **Processamento de arquivos** — currículos PDF no Banco de Talentos.

O arquivo de entrada é `worker/main.py`. O Dockerfile já está pronto em `worker/Dockerfile`.

---

### Criando o Serviço no Easypanel

**1 — Criar o App**
- No painel do seu projeto no Easypanel, clique em **+ Create Service** → **App**.
- **Service Name**: `cuca-worker`

**2 — Configurar o Source (Git)**
- **Provider**: GitHub
- **Repository**: `Cuca-atende-mais/cucaatendemais`
- **Branch**: `main`
- **Path**: `./worker`
  > ⚠️ Este campo é crítico. Sem ele, o Easypanel vai tentar buildar o repositório inteiro em vez da pasta `worker`.

**3 — Adicionar as Variáveis de Ambiente**

Na aba **Environment**, adicione exatamente estas chaves (sem aspas nos valores):

| Variável | Valor / Onde pegar |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role (secret) |
| `UAZAPI_BASE_URL` | Somente a URL base: `https://cucaatendemais.uazapi.com` |
| `UAZAPI_MASTER_TOKEN` | UAZAPI Dashboard → Admin Token (começa com `zc7bpv...`). **Necessário para criar instâncias via `POST /instance/init`**. |
| `WEBHOOK_INTERNAL_TOKEN` | Crie qualquer senha forte (ex: `cuca-worker-secret-2026`). Deve ser **igual** ao `NEXT_PUBLIC_INTERNAL_TOKEN` do `.env.local` do Portal. |
| `OPENAI_API_KEY` | Dashboard da OpenAI |
| `DEBUG` | `False` |
| `SENTRY_DSN_WORKER` | Sentry → Project Settings → Client Keys → DSN |

> 📌 **Sobre o token da UAZAPI**: O token de cada número de WhatsApp (`zc7bpvjHyy...`) **não** vai aqui. Ele fica cadastrado no banco de dados, na tabela `instancias_uazapi` (coluna `token`), por instância. O Worker busca esse token do banco automaticamente ao enviar mensagens.

**4 — Configurar Portas e Domínios**
- Na aba **Domains**, adicione `api.cucaatendemais.com.br` com a porta `8000` e botão HTTPS ligado.
- Na aba **Ports** (Advanced), certifique-se de que a `Published Port` esteja VAZIA (não precisamos expor a porta diretamente pois o Traefik fará o roteamento pelo domínio).

**5 — Fazer o Deploy**
- Clique em **Deploy**.
- O Easypanel vai ler o `Dockerfile` dentro de `./worker`, que contém o comando correto para uso assíncrono (1 worker com timeout de 120s e verificação de integridade).
- Aguarde o log mostrar: `Application startup complete.`

---

### Como atualizar o Worker após mudanças no código?

O Easypanel **não** faz redeploy automático via Git push na Hostinger. Sempre que eu (IA) fizer um `git push` com mudanças no Worker:

1. Você abre o Easypanel.
2. Clica no serviço `cuca-worker`.
3. Clica em **Deploy** (botão azul). O processo dura ~1 minuto.

---

> **Versão 6.4 — 23/02/2026**
> Remoção definitiva de Campanhas do frontend e backend. Guia de criação do `cuca-worker` no Easypanel reestruturado com instruções precisas baseadas no código real do projeto.

---

### 🚀 DIRETRIZES DE GO-LIVE E MULTI-AMBIENTE (S17)

Para que o desenvolvimento local (`localhost`) funcione em paralelo com a produção real na Hostinger, as seguintes configurações MANUAIS são obrigatórias no Dashboard do Supabase:

#### 1. URLs de Redirecionamento (Auth)
Acesse: **Authentication > Settings > URIs**.
Adicione os seguintes itens:
- `http://localhost:3000/**` (Manutenção local porta padrão)
- `http://localhost:3001/**` (Manutenção local porta alternativa)
- `https://cucaatendemais.com.br/**` (Produção real)

> [!IMPORTANT]
> Sem estas URLs, o login via Supabase Auth falhará ao rodar o projeto localmente.

#### 2. Variáveis de Ambiente (.env)
O sistema detecta automaticamente o ambiente. Para manutenção local, utilize o arquivo `.env.local` apontando para o mesmo banco de dados, mas mantenha o `NEXT_PUBLIC_WORKER_URL` apontando para o Worker de produção (`api.cucaatendemais.com.br`) se não quiser rodar o Worker Python localmente.

---

### 📋 CHECKLIST FINAL DE ENTREGA
- [x] **Privacidade (LGPD)**: Botão de anonimização e fluxo de Opt-in testados e operacionais.
- [x] **Developer Console**: Monitoramento de custo OpenAI e Logs do Worker em tempo real ativos.
- [x] **Consolidado Gerencial**: Dashboard principal exibindo métricas reais de todas as unidades CUCA.
- [x] **Validação Local**: Abrir o sistema em `localhost:3000` e confirmar login bem-sucedido.
- [x] **Estabilidade de Build**: Correções de imports e rotas aplicadas para garantir deploy na Hostinger.

---

## 11. GUIA DE OPERAÇÃO E MANUTENÇÃO (S17) {#11-guia-operacao}

### 11.1 Gestão de Leads e LGPD
- **Anonimização**: Use o botão "Anonimizar Dados" na tela de Leads para pedidos de exclusão (Direito ao Esquecimento). A operação é irreversível.
- **Opt-in**: Respeite o fluxo automático. Se o lead não responder "SIM", o motor de IA não será ativado para este contato.

### 11.2 Monitoramento de Custos (OpenAI)
- Acesse `/developer/consumo` para ver o budget mensal.

---

## 🧠 Brainstorm: Visualização e Disparo da Programação Mensal

### Context
A importação de planilhas de Programação Mensal agora cria uma campanha "pai" e salva dezenas de linhas filhas na tabela `atividades_mensais`. Precisamos de uma interface read-only no painel `/programacao` para o usuário conferir se os dados do mês subiram corretos e, em seguida, botões de ação para aprovar o lote e realizar o envio em massa para os leads, contendo o link do Portal da Juventude (que consta em `system_config` como `portal_url_producao`).

---

### Option A: Modal Lateral (Sheet) expansível com Datatable 
Ao clicar em "Ver Atividades" na linha da Campanha Mensal, abre-se uma gaveta lateral (Sheet do shadcn/ui) contendo uma Datatable simples (com Paginação) listando: Título, Data, Horário e Local de cada atividade importada. No rodapé do Sheet, ficam os botões: "Aprovar Mês" e "Disparar Aviso".

✅ **Pros:**
- Mantém o usuário na mesma tela sem perder o contexto.
- Visual moderno e muito utilizado no restante do portal (ex: edição rápida).
- Componentes já existem no projeto (Fácil montagem).

❌ **Cons:**
- Sheets laterais têm espaço horizontal reduzido, apertando as colunas da datatable se houver textos de descrição longos.

📊 **Effort:** Low

---

### Option B: Expansão de Linha (Accordion/Sub-table)
A própria tabela principal de Campanhas Mensais ganha a habilidade de "expandir" a linha (Chevron Down). Ao expandir, revela-se uma mini-tabela embutida mostrando as atividades exclusivas daquele mês. Os botões de Aprovação e Disparo ficam ao lado do Chevron na linha principal.

✅ **Pros:**
- Visualização extremamente fluida e contígua.
- Permite comparar rapidamente atividades de dois meses diferentes se ambos expandidos.

❌ **Cons:**
- Datatables aninhadas no React podem ser chatas de lidar com responsividade.
- Fica visualmente poluído se o mês tiver 50+ atividades sendo listadas na mesma página principal.

📊 **Effort:** Medium

---

### Option C: Nova Página Dedicada (`/programacao/mensal/[id]`)
Clicar na campanha leva a uma rota totalmente nova. Nessa tela inteira, exibe-se a Datatable rica com filtros por dia útil, busca e todos os detalhes. No topo da tela (Header), o card de Status, o contador e a "Call to Action" de: 1. Aprovar Mês (Alimenta RAG) -> 2. Disparar Mensagem de Convite.

✅ **Pros:**
- Espaço infinito para visualizar as colunas do Excel original com conforto.
- URL própria (pode compartilhar o link da auditoria do mês com outro gestor).
- Única forma de ver relatórios de "quantos disparos daquele mês falharam" no futuro.

❌ **Cons:**
- Adiciona mais caminhos de roteamento ao sistema.
- Tira a agilidade de um "clique rápido e aprovo", exigindo navegar entre telas.

📊 **Effort:** Medium

---

### 💡 Recommendation sobre Visualização

**Option A (Modal Lateral / Sheet)** because é a solução mais alinhada com aplicações modernas em painéis Next.js. O usuário sobe o Excel, clica no olho (view) na mesma tela, corre o olho pela tabela paginada rápida no painel lateral só pra bater se as datas não estão malucas, e clica em "Disparar Aviso". É eficiente e não quebra a imersão.

---

### 💬 Fluxo de Disparo do Link do Portal
Para o disparo aos leads (WhatsApp), o fluxo técnico recomendado seria:

1. **Ação no Front-end**: Ao clicar em "Disparar", o React chama um endpoint (`/api/disparos/mensal`).
2. **Mensagem Template Sugerida (pode vir de `mensagens_padrao` ou escrita hardcoded):**
   *"Olá {lead_nome}! A programação do mês de {mes} do CUCA {unidade} já está no ar. Temos {total_atividades} atividades preparadas. Acesse nosso portal e confira tudo: {portal_url_producao}/programacao "*
3. **Engenharia**:
   - O backend recupera de `system_config` o valor real de `portal_url_producao` (ex: `https://cucaatendemais.com.br`).
   - Gera as mensagens de disparos na tabela `disparos` apontando para todos os jovens daquela `unidade_cuca` com `opt_in = true`.
   - O cron job de `pg_cron` (ou seu uazapi_worker) consome a fila gradativamente.
- O aviso amarelo 🟡 aparece com 80% do budget gasto. O vermelho 🔴 com 100%.
- Se o budget estourar, ajuste o valor na tela de `Configurações do Sistema`.

### 11.3 Troubleshooting (Worker)
- Se as mensagens pararem de chegar no portal:
  1. Verifique `/developer/worker` se o status está **Online**.
  2. Verifique `/developer/logs` para erros de "Unauthorized" (Token UAZAPI expirado).
  3. No Easypanel (Hostinger), faça o Redeploy do serviço `cuca-worker`.

### 11.4 Manutenção Local (localhost)
- Para rodar o sistema localmente sem afetar o login de produção:
  - Adicione `http://localhost:3000/**` nas **Redirect URLs** do Supabase.
  - No `.env.local`, mantenha as chaves do Supabase idênticas às de produção.
---

## 12. 🧠 BRAINSTORM: HIERARQUIA E AUTONOMIA (S18) {#12-hierarquia}

### Contexto
O sistema cresceu e precisa de uma cadeia de comando clara para descentralizar a gestão de usuários sem perder a segurança.

### Níveis de Autonomia Propostos:
1. **Developer (Valmir/Dev)**: Criam **Super Admin Cuca**. Acesso global.
2. **Super Admin Cuca**: Criam **Gestores/Gerentes** de cada Unidade/Território. Acesso global.
3. **Gestores de Unidade**: Criam sua **Equipe (N1/N2/Atendente)**. Acesso restrito à unidade.

---

### Opção A: Modais Especializados com Trava de Unidade (RECOMENDADO)
Criar fluxos de cadastro distintos no Dashboard para cada nível.
- **Prós**: UX fluida, redução de erro humano (unidade automática), segurança reforçada.
- **Contras**: Requer criação de 3 modais diferentes.
- **Esforço**: Médio.

### Opção B: Formulário Único com Lógica de Nível (RBAC)
Um único modal que habilita/desabilita campos conforme o `nivel_acesso` do usuário logado.
- **Prós**: Menos manutenção de UI.
- **Contras**: interface poluída com condicionais, risco de bypass se a lógica falhar.
- **Esforço**: Baixo.

---

### Solução Escolhida: Option A + RLS
Implementaremos modais específicos para cada nível hierárquico, garantindo que:
- O Gestor não precise (nem consiga) escolher a unidade — ela será herdada do seu próprio perfil.
- O Super Admin escolha a unidade ao criar o Gestor.

---

## 13. ESPECIFICAÇÕES TÉCNICAS: GESTÃO DE USUÁRIOS (S18) {#13-especificacoes-usuarios}

### 13.1 Modais de Criação
- **[NEW] Modal Super Admin**: Exclusivo para Developers. Campos: Nome, Email. `funcao_id` = Super Admin, `unidade_cuca` = NULL.
- **[NEW] Modal Gestor**: Exclusivo para Super Admins e Developers. Campos: Nome, Email, Unidade. `funcao_id` = Gestor.
- **[NEW] Modal Equipe**: Exclusivo para Gestores. Campos: Nome, Email, Nível (Atendente, N1, N2). `unidade_cuca` herdada automaticamente.

### 13.2 Bloqueios de Segurança (RLS)
- Função `pode_gerenciar_colaborador(target_user_id)` no Postgres para validar se o criador tem nível superior ao criado.

---

## 14. 🧠 BRAINSTORM: VISIBILIDADE GLOBAL DO DEVELOPER/OWNER (S18) {#14-visibilidade-developer}

### Contexto
Atualmente, os usuários com a função `developer` (`valmir@cucateste.com` e `dev.cucaatendemais@gmail.com`) estão visualizando **apenas** o módulo "Developer Console" no menu lateral, perdendo o acesso aos módulos de negócio (Dashboard, Leads, Atendimento, etc.).
O objetivo é garantir que esses usuários tenham um bypass global no frontend (Sidebar) e no backend (RLS), garantindo a visão administrativa de ambos os mundos (Técnico e Negócio).

---

### Opção A: Modificar a validação no `AppSidebar` (Frontend Bypass Global)
Alterar a lógica de filtragem de itens do menu para que, se a flag `isDeveloper` for verdadeira, retorne o array inteiro do menu sem passar pelas checagens individuais de permissão.
- **Prós**: Resolve o bug instantaneamente, garante que qualquer nova tela criada automaticamente apareça para os devs, sem precisar registrar permissões no banco.
- **Contras**: É apenas uma checagem visual. Se o backend (RLS) não estiver alinhado, as telas poderão carregar sem dados.
- **Esforço**: Baixo.

### Opção B: Vincular Mock de Permissões no Banco (`funcoes_permissoes`)
Rodar um script SQL preenchendo todas as permissões do sistema (`leads`, `atendimento`, etc.) para o `funcao_id` associado ao `developer`.
- **Prós**: Utiliza a estrutura base do Supabase já existente no `user-provider.tsx` sem mudar a lógica de React.
- **Contras**: Pouco manutenível. Sempre que for criado um novo módulo, será preciso lembrar de dar permissão ao Developer explicitamente via banco.
- **Esforço**: Médio.

### Opção C: Bypass Duplo (Sidebar + Backend) [RECOMENDADO]
Combinar a Opção A no Frontend com as lógicas RLS no Backend. Adicionar um bypass irrestrito (`if (isDeveloper) return true`) no arquivo `app-sidebar.tsx`, e nas lógicas SQL garantir que as funções como `get_my_unit()` tratem desenvolvedores de forma global (o que já foi parcialmente implementado).
- **Prós**: Solução definitiva à prova de falhas. Desenvolvedores viram "Deuses" no sistema. O acesso fica irrestrito independenente do que `hasPermission` diga no JS.
- **Contras**: Nenhum.
- **Esforço**: Baixo/Médio (Ajuste rápido no `app-sidebar.tsx`).

---

## 💡 Recomendação de Execução

**Opção C** porque garante a segurança a longo prazo. Um software como o Atende+ crescerá de módulos rapidamente, e atrelar a visualização do Developer à tabela de permissões causará problemas frequentes ("tela nova desaparecendo para o dev"). A implementação consiste em 1 linha de retorno garantido no `app-sidebar.tsx`.

### Passos da Execução Sugerida
1. Modificar `/src/components/layout/app-sidebar.tsx` adicionando `if (isDeveloper) return true` como primeira regra no filtro.
2. Garantir que no `UserProvider` a função `hasPermission` também faça short-circuit de segurança imediato.
3. Testar a interface global como Valmir.

---

## 15. 🧠 ARQUITETURA DEFINIDA: RAG DE MÊS ÚNICO E DATA TABLE RICA {#15-evolucao-programacao}

### Acordo Estratégico com Cliente (Wipe and Replace)
Para simplificar a gestão e garantir zero "alucinação temporal" na Inteligência Artificial, o sistema adotará a filosofia de **Mês Único Vigente** por Unidade. Em vez de manter um espelho histórico de meses anteriores no banco vetorial, a cada novo Import aprovado, a memória do sistema é deletada e reescrita, garantindo que o RAG só tenha ciência do cenário atual ou imediatamente futuro.

Aqui está o plano de implementação atualizado:

---

### 1. Interface: Importação Dinâmica e Data Table Robusta
- **Modal de Upload com Seletor de Mês**: Ao clicar em "Importar XLSX", um modal pedirá ao gestor para informar **Qual é o mês referência** da planilha que ele está subindo (Ex: Março).
- **Substituição (CRUD Base)**: O usuário possuirá um botão na interface "Atualizar Programação". Sempre que subir um Excel novo para a mesma Unidade, o Backend executará um `DELETE CASCADE` na campanha mensal anterior daquela unidade e em todas as `atividades_mensais` relativas a ela. 
- **O Fim da Gaveta (Sheet)**: As atividades não serão mais lidas numa aba lateral pequena. Serão migradas para uma **Data Table Premium** (react-table) em tela cheia (Modal gigante ou página própria) contendo filtros por dia, exibindo todas as colunas originadas do Excel.

### 2. O Parser Inteligente e Validação Visual de Abas
As planilhas do Excel possuem diversas abas (ex: `ESPORTES - JANEIRO`, `ESPORTES - FEVEREIRO`, `ESPORTES - MARÇO`). O sistema terá um visual de checklist para validar a escrita das abas no momento do upload.
- **Checklist Visual de Etapas**: Após selecionar o mês (ex: MARÇO) e iniciar o upload, a interface exibirá o status de leitura de cada aba processada. Exemplo para o Lead:
  - ✅ `CURSOS - MARÇO` - concluído (importado)
  - ✅ `ESPORTES - MARÇO` - concluído (importado)
  - ✅ `DIA A DIA - MARÇO` - concluído (importado)
  - ⚠️ `ESPECIAL - MARÇO` - não carregado - *"Atenção: aba não encontrada ou com erro de digitação (ex: sem cedilha). Reveja a escrita da aba e informe corretamente, e então tente novamente em 'Atualizar Programação'."*
- O parser irá iterar ativamente por `wb.SheetNames`. Se achar uma aba correspondente com o mês que o gestor escolheu (ou forçar um fuzzy match tolerante ou categorias fixadas base), ele importa. As abas mal digitadas (ex: "MARCO") farão disparar o alerta visual para correção humana.
- **Extração de Categoria**: O prefixo do nome da aba (A palavra antes de " - ") será recortado via Regex e gravado numa nova coluna obrigatória `categoria` (ex: "ESPORTE", "CURSO", "DIA A DIA").

### 3. Sincronização e Resposta Intocável no RAG
- **Solução Definitiva Pela Raiz**: Com a deleção sumária da campanha de "Fevereiro" para o carregamento da de "Março", o trigger do banco apagará os chunks vetoriais antigos do Pinecone/Supabase Vector automaticamente.
- Quando o Lead enviar a mensagem no WhatsApp perguntando "O que tem de teatro?", a IA lerá *apenas* a programação do mês engatilhado e ativo no sistema. Não é necessário mais programar filtros cruzados de timestamp na consulta vetorial.
- **Aviso Disparado**: A mensagem de aprovação carregará o mês atual validado para disparar na UAZAPI.

### 🚀 Resumo do Esforço e Próximos Passos
1. Modificar Banco: Adicionar coluna `categoria` em `atividades_mensais`.
2. Frontend: Criar o `<Dialog>` robusto de Importação com Seletor de Mês.
3. Frontend: Refatorar o código `handleImportXLSX` para rodar o loop em todas as `wb.SheetNames`, aplicando a regex de `Categoria - Mês` validando apenas o mês inputado.
4. Backend: Atualizar lógica para que a inserção apague (`DELETE`) a Campanha anterior da mesma `unidade_cuca` limpando a tabela filha e consequentemente os Embeddings RAG.
5. Frontend: Trocar a visualização na Sidebar por uma Tabela Complexa que usa o campo novo `categoria` p/ filtrar as atividades do mês.

---

## 16. 🧠 ARQUITETURA DE DADOS: O "SUPER-PROMPT" NA DESCRIÇÃO (RAG ENRIQUECIDO) {#16-super-prompt-descricao}

### O Problema da Informação Desestruturada
O cliente (Rede CUCA) possui planilhas que espelham exatamente a visão física ("Revistinha impressa" pela gráfica), ou seja, dividem os dados em diversas colunas vitais para a tomada de decisão do jovem: Período, Horário, Educador, Carga Horária, Faixa Etária, Vagas, Dias da semana, etc.
Anteriormente, a tabela do banco (`atividades_mensais`) possuía apenas um campo `descricao` simples que ignorava todo o resto das colunas, deixando o RAG "cego" sobre restrições de idade, cronograma e vagas.

### A Solução Parte 1: Inclusão Concatenada (O "Super-Prompt" do RAG)
Para evitar a necessidade de criar dezenas de colunas fragmentadas (e muitas vezes nulas, já que Esportes tem colunas diferentes de Cursos) na tabela de banco de dados, iremos adotar o padrão de **String Formatada Rico para RAG** (Super-Prompt).

No momento de leitura da planilha (`import-planilha-modal.tsx`), o parser irá capturar cada coluna disponível, rotulá-la em texto amigável e concatenar isso dentro do próprio campo `descricao`.
Desta forma, quando o processo Backend (Trigger/Edge Function) transformar o registro num Vetor (Embedding), toda a riqueza contextual subirá acoplada, e o LLM baterá o olho num texto humano de fácil compreensão.

### O Desafio das Datas Erradas (Solução)
Os primeiros testes traziam datas genéricas ("01/03/2026") inseridas via fallback no código, o que estava distante da realidade das planilhas.
A solução é abortar o `fallbackDate` cru e **extrair ativamente as colunas de Período** ("06/03/2026 a 27/03/2026"), embutindo-as na modelagem da data da atividade de forma fidedigna. Para Esportes que não possuem "Período", usaremos os Dias da Semana (ex: "Terças e Quintas"), garantindo fidelidade de agenda ao Jovem.

### A Solução Parte 2: A Prova Visual (UI de Transparência do RAG)
O problema levantado: *"Como o cliente terá a certeza e até eu mesmo como developer de que essas informações estão inseridas e dentro do RAG?"*

Para garantir que a visualização não seja um amontoado técnico de dados confusos, a solução visual será desenhada pensando na experiência do usuário (UX) com foco em **Clareza e Auditoria**.

**Como será na interface:**
1. Na Data Table de atividades (rota `[id]`), ao lado de cada linha, haverá um botão discreto e elegante com o ícone de um robô ou um cérebro (ex: `LucideBrain` ou `LucideBot`). O *tooltip* (balãozinho ao passar o mouse) dirá: *"Ver o que a IA sabe sobre isso"*.
2. **O Modal de "Visão da IA":** Ao clicar, um popup (Dialog) limpo e moderno se abrirá. 
3. **Layout do Modal:**
   - **Cabeçalho:** Título da atividade em destaque com um selo dizendo "Sincronizado com a IA ✅".
   - **Corpo (Para o Gestor/Usuário Comum):** Um card visual amigável exibindo as informações mastigadas em tópicos (Ex: 👨‍🏫 Educador: Renato; 👥 Vagas: 10; ⏰ Horário: 14h às 17h). Isso prova para o humano que o sistema capturou tudo.
   - **Corpo (Para o Desenvolvedor/Auditoria):** Logo abaixo, uma seção recolhível (Accordion) chamada *"Ver formato bruto enviado ao RAG (Modo Técnico)"*. Ao abrir, o usuário verá exatamente a grande *string concatenada* (o Super-Prompt) que está salva no banco de dados e que servirá para a busca vetorial.
   - **Conclusão:** Dessa forma, o usuário leigo recebe a paz de espírito visual de que os dados foram todos lidos, e nós (desenvolvedores) ganhamos uma ferramenta de auditoria instantânea (troubleshooting) sem precisar abrir o Supabase.

### Matriz de Mapeamento por Categoria (Parseamento Flexível):

#### 📚 CURSOS
- O script montará a `descricao` em blocos Textuais:
  - **Ementa:** [Coluna F]
  - **Requisitos:** [Coluna G]
  - **Datas, Períodos e Dias:** [Coluna H]
  - **Horário:** [Coluna I]
  - **Carga Horária:** [Coluna D]h / **Vagas:** [Coluna E] / **Educador:** [Coluna J]

#### ⚽ ESPORTES
- Como é um mapa menor, a montagem será objetiva:
  - **Turma:** [Coluna D] / **Professor:** [Coluna C]
  - **Público:** [Coluna E] / **Gênero:** [Coluna F]
  - **Vagas:** [Coluna G]
  - **Dias da Semana:** [Coluna H]
  - **Horário:** [Coluna I]

#### 🎮 DIA A DIA (E Esportes Especiais)
- Seguirá a mesma regra base de montagem amigável de sentenças usando os nomes das colunas como chaves semânticas baseadas na Planilha Real.

---

## 17. 🌐 VISÃO DE FUTURO: API-FIRST E INTEGRAÇÃO PORTAL DA JUVENTUDE (SEJU) {#17-api-seju}

O fluxo atual depende de arquivamento físico e planilhas instáveis geradas por humanos, visando suprir a Gráfica da Revista impressa. O modelo ideal (Target Architecture) abrange eliminar o Excel do centro tecnológico.

### Fases do Roadmap Estratégico de Interoperabilidade:

#### Plano A (Nossa API como Source of Truth)
- Como premissa, as Diretorias de Rede Cuca abandonarão a planilha e passarão a preencher a programação através de um cadastro direto no **Cuca Portal (Nosso Sistema)**, em uma tela robusta dotada de filtros e validações.
- **Construção do Endpoint:** Iremos instanciar uma API REST Pública (`GET /api/v1/programacoes/ativas`).
- **Consumo:** A equipe de TI da Prefeitura (Portal da Juventude - SEJU) passará a consumir o nosso JSON servido diretamente, injetando as rotinas no Portal deles para que o site continue sendo o centro oficial de **Matrículas**.
- **Benefício:** Reduz a zero a quebra de contrato de planilhas. O RAG ficará atualizado em Tempo Real e não em "bateladas" mensais.

#### Plano B (Consumindo a API da Prefeitura)
- Se a negociação fluir pelo lado reverso, a Prefeitura desenvolverá os Endpoints do Portal da Juventude que publicam a Revista Digitalizada.
- **Nosso Papel:** Criaríamos um Worker (Cron Job) que escutaria a API da SEJU (`GET /api/seju/revistas/cuca/atual`) a cada 12 horas.
- Todo o processamento vetorial (Embeddings), que hoje construímos usando arquivos do Excel, se alimentaria diretamente das chaves JSON dessa API, transformando seus arrays nativos no mesmo "Super-Prompt Literário" pro RAG engolir automaticamente e servir no Whatsapp aos Jovens.

---

## 18. 🔐 ARQUITETURA DE AUTENTICAÇÃO E CONTROLE DE ACESSO (RBAC) {#18-auth-rbac}

Para mitigar os históricos de conflitos com e-mails mágicos da plataforma Supabase e ao mesmo tempo fornecer extremo controle granular sobre quem vê o que no sistema (Hierarquia Cuca), a arquitetura adotada abandona o fluxo nativo automatizado (Invite) em prol da solução "SaaS Auth Flow Customizado".

### 18.1 Criação de Colaboradores e Tenant (Isolamento)
- **Inserção Acoplada:** A tabela de colaboradores será vinculada obrigatoriamente à tabela `auth.users` do Supabase via Foreign Key (`user_id`). 
- **Estratégia Anti-Conflito (Silenciosa):** O Back-End (via SDK Admin do Supabase) criará o usuário com a propriedade `email_confirm: true` para **silenciar todos os e-mails vitrines nativos do Supabase.** Nossa base registrará um Token temporário na nossa própria tabela de Colaboradores.
- **Isolamento de Tenant:** Os colaboradores e seus respectivos dados continuarão isolados pela coluna `unidade_cuca` na tabela pública, garantindo a visualização separada por Polos através do nosso Row Level Security (RLS), mesmo que pertençam globalmente à tabela de Auth.

### 18.2 Fluxo do E-mail Personalizado e Setup de Senha
- **E-Mail via Resend API:** Com a verificação de Domínio Próprio ou com e-mails fixados se usando Free Tier, o sistema dispara um E-mail React lindamente diagramado com a logo da Instituição, informando sobre a criação de conta.
- O e-mail contém um link `/setup-senha?token=XYZ` da nossa própria aplicação.
- Na tela enxuta e com identidade visual do CUCA, o colaborador digita a senha escolhida intransferível (apenas ele saberá). Ao enviar, o Back-End destrói o token de segurança, atualiza a senha de fato no Supabase (`admin.updateUserById`), realiza automaticamente o primeiro login e injeta o colaborador na home do Painel. Zero confusões de telas de validação mortas.

### 18.3 Gestão Dinâmica de Perfis (O "RBAC Enterprise")
A regra engessada de "Perfis fixados no código" foi substituída por um gerenciador dinâmico de Perfis de Acesso.

- **UI do "Nível Deus":**
  1. O **Developer** detém o Master Key: enxerga Módulos de Log, Developer Console puro, System Settings e tem perpassos imunes (`Bypass`) à validação do Middleware.
  2. O **Super Admin Cuca:** Pode tudo o que o negócio precisa, **cria** todos os demais colaboradores e cria os Gerentes, mas não vê as ferramentas técnicas (Developer Console), resguardando o código de incidentes.
- **Painel de Cargos (Rules):** O Super Admin contará com uma tela em `Configurações > Perfis` para "Fabricar" novos perfis desenhando a permissão granular baseada em Matriz CRUD (Visualizar Menu, Criar, Editar, Deletar).
  - Ex: Ele mesmo criará o perfil de "Atendente", desmarcando as caixas de criação de planilhas.
- **A Barreira (Middleware Edge):** Ao logar, nosso sistema lerá os direitos desse JSON atrelado à Conta do Cuca. Qualquer rota acessada irá ser cortada na raiz no Next.js caso seu perfil não a conte. Na ponta UI, os botões sumirão ou aparecerão bloqueados. O RLS do banco será o seguro de vida caso hackers forcem a UI localmente.

---

## 📋 Checklist de Execução: Fase 9 - Auth Customizada e RBAC Dinâmico

- [x] Criar tabelas `sys_roles` e `sys_permissions` no Supabase e atrelá-las a `colaboradores`.
- [x] Adicionar colunas `setup_token` (UUID) e `setup_token_expires_at` em `colaboradores`.
- [x] Criar API `/api/colaboradores/create` no Backend para Auth Admin silencioso (`email_confirm: true`).
- [x] Integrar envio de e-mail via Resend API (usando seu Token `re_E2VC...`) na criação do colaborador.
- [x] Criar tela pública `/setup-senha` para definição de senha com identidade visual do CUCA (React Email Template e Modal enxuto redirecionando para `/login`).
- [x] Desenvolver API `/api/colaboradores/setup-password` para que o frontend atualize a senha via Supabase Admin usando o token gerado.
- [x] Desenvolver UI em `/configuracoes/perfis` (Gestão Dinâmica) para criar Cargos Múltiplos com checkboxes CRUD (Read, Create, Update, Delete) vinculados as tabelas.
- [x] Modificar Middleware/SideBar no FrontEnd para ocultar itens de menu e botões que o usuário logado não possui permissão RBAC.
- [x] **Refinamento de UX/UI**: Segmentar as permissões em Grupos Categóricos (CRM, Ouvidoria, Admin).
- [x] **Ferramentas de Massa**: Incluir botões para "Marcar Linha (Todos os poderes daquele módulo)" e "Marcar Coluna (Todo visualização, todo delete, etc)".
- [x] **CRUD Completo de Cargos**: Permitir não só Criar e Deletar, mas também Editar o Nome e Descrição da Função Administrativa.

---

## 📋 Checklist de Execução: Fase 10 - Ajustes Finos de Hierarquia, Auditoria e Multi-Tenant por Unidade

- [x] **Soft-Delete e Auditoria (Colaboradores)**:
  - Adicionar Switch de `Ativo`/`Inativo` na tela de edição de equipe.
  - Ocultar/bloquear login na rota via Supabase Admin (ban_duration) para evitar exclusão de dados vinculados e manter histórico de auditoria.
- [x] **UX Inicial de Programação**:
  - Ajustar o menu `Programação` para exibir e carregar por padrão a tela "Mensal" em vez da agenda "Pontual".
- [x] **Visibilidade Multitenant Rigorosa (Master/Super vs Gerentes/Unidades)**:
  - Ocultar o módulo `Developer Console` de **todos**, exceto `valmir@cucateste.com` e `dev.cucaatendemais@gmail.com`.
  - Super Admin Cuca tem visão geral, porém Gerentes de Unidade só enxergam a si mesmos e os funcionários de **sua** unidade, e não veem os dados do Super Admin e dos Masters nos relatórios de equipe.
  - Nas telas de Programação e Acesso CUCA, o campo/filtro de Unidade deve vir cravado na unidade do funcionário logado, escondendo a opção "Todas" para quem não for Super Admin ou Master.
- [x] **Indicadores Visuais de Multitenant**:
  - Inserir um *Badge* ou letreiro claro nas telas indicando "Você está vendo/editando dados da Unidade X" para não haver confusão visual durante a Programação.

---

## 📋 Checklist de Execução: Fase 10.1 - Nivelamento Rigoroso de Configurações e Equipamentos

- [x] **Acesso CUCA (Espaços e Equipamentos)**:
  - Filtrar a aba de `Espaços & Equipamentos` para exibir somente os cadastrados na unidade do usuário (exceto Super Admin/Master).
- [x] **Restrição de Lista de Perfis**:
  - Na tela de criação/edição de perfis, não exibir perfis de outras unidades ou que o usuário não tenha poder para ver (esconder perfis Master/Super dependendo de quem logou).
- [x] **Granularidade do Menu `Configurações`**:
  - Separar e expandir os módulos na matriz de acesso (RBAC) para contemplar submenus: `WhatsApp`, `Colaboradores`, `Perfis`, `Unidades` e `Categorias`.
- [x] **Proteção de Modulos Críticos de Configuração**:
  - Os módulos de `Unidades` e `Categorias` não poderão ser cedidos, visualizados ou configurados por ninguém além dos Masters (`isDeveloper`). Somente o Master os visualizará como opção na criação de perfil.
- [x] **Botão de Ativar/Desativar Colaborador**:
  - Deixar o controle de ativação/desativação habilitado somente para Owner, Super Admin e Gerente (outros perfis que porventura puderem editar colabs não poderão mudar o status).

---

## 📋 Checklist de Execução: Fase 10.2 - Granularidade Extrema do RBAC e Bloqueio de UI por Permissão

- [x] **Módulo Leads**:
  - Desmembrar e criar chaves explícitas para: `Visualizar Leads`, `Novo Lead` (CRUD), `Registrar Output` (CRUD), `Bloquear Lead` (CRUD) e `Anonimizar Dados` (CRUD).
- [x] **Módulo Atendimento**:
  - Garantir chave única para Atendimento, e revisar os botões na UI para respeitarem `cria`, `edita`, `deleta`.
- [x] **Módulo Programação**:
  - Separar explicitamente na matriz: `Programação Mensal` e `Programação Pontual`.
- [x] **Módulo Empregabilidade**:
  - Separar explicitamente na matriz: `Módulo Banco de Vagas`, `Vagas` (CRUD).
- [x] **Módulo Acesso CUCA**:
  - Separar explicitamente na matriz: `Solicitações` (com editar/aprovar e deletar/recusar) e `Espaços e Equipamentos`.
- [x] **Módulo Ouvidoria**:
  - Analisar e garantir o bloqueio real dos botões de ação na View.
- [x] **Revisão e Implementação da Engine de Controle de Interface**:
  - Varrer todas as tabelas, modais e actions (`Novo`, `Editar`, `Deletar`) nas telas citadas acima. Se o cargo só tem flag de `read` (Visualizar), os botões de ação devem ser **desativados ou ocultados**. Somente quem possui flags `create`, `update`, `delete` verá e poderá interagir com essas funcionalidades na interface.
