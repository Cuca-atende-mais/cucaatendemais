# PLANO DE DESENVOLVIMENTO — Sistema CUCA (Guia Mestre)
> **Versão**: 6.0 | **Atualizado**: 08/03/2026
> **STATUS ATUAL**: Sprints 1–14 Concluídos | **Próximo: Sprint 15 — Atendimento Institucional + Correções Programação**
> **REGRAS GERAIS**: Este arquivo é a **ÚNICA** fonte de verdade para planejamento. Não existem arquivos de tarefa (.tasks) ou planos externos.
> **Lido e consolidado de**: DOCUMENTACAO_FUNCIONAL.md (1441 linhas) · SCHEMA_BANCO_DADOS.md (926 linhas) · GUIA_PROMPTS_AGENTES.md · PRODUTO_ESCOPO_ENTREGAS.md · personas_rede_cuca.md · brainstorm_cuca.md · DECISOES_RESOLVIDAS.md · IMPLEMENTATION_PLAN.md

---

> ## 🔴 REGRA DE OURO — ACESSO A NOVAS FUNCIONALIDADES
>
> **Todo módulo/funcionalidade novo** aparece primeiro APENAS para os dois Developers. Após testes e aprovação, eles liberam via RBAC. O fluxo é sempre:
>
> ```
> Dev implementa → Só os 2 veem e testam
>     ↓
> Aprovado → Devs marcam na Matriz (Perfis) para o Super Admin Cuca
>     ↓
> Super Admin Cuca decide quem mais acessa (novos perfis/usuários)
> ```
>
> **Acesso dos 2 Developers (`valmir@cucateste.com` / `dev.cucaatendemais@gmail.com`):**
> - Bypass total por email em `user-provider.tsx` → `hasPermission()` retorna `true` para tudo
> - Identificados via `DEVELOPER_EMAILS` — não pelo role
>
> **Acesso de outros usuários (Super Admin, Gestor, etc.):**
> - Dependem 100% da matriz `sys_permissions` no banco (can_read, can_create, can_update, can_delete)
> - **Nenhum bypass automático por role** — Super Admin sem marcação explícita não acessa módulos novos
>
> **Módulos permanentemente restritos (email-only, nunca via RBAC):**
> - `developer` — Console de desenvolvedor
> - `programacao_rag_global` — Base de conhecimento global
>
> **Módulos liberáveis via RBAC (marcação na Matriz de Perfis):**
> - `divulgacao` — Chip de Divulgação + painel Gestor Geral
> - Qualquer módulo futuro que os devs decidirem liberar

---

## SUMÁRIO

1. [Stack Técnica](#1-stack)
2. [Arquitetura Geral](#2-arquitetura)
3. [Estrutura de 13 Canais WhatsApp — REVISÃO JAN/2026](#3-canais)
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
14. [Sprint 9 — Canal Divulgação + RAG Global](#sprint9)

---

## 1. STACK TÉCNICA {#1-stack}

| Camada | Tecnologia | Obs |
|--------|-----------|-----|
| **Portal** | Next.js 15 (App Router) + shadcn/ui + Tailwind v4 | Hostinger VPS (Easypanel) |
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
| **Deploy** | Hostinger VPS — Easypanel (portal + worker) | Cloudflare DNS |
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
                               Portal Next.js (Hostinger VPS — Easypanel)
                               ├── Dashboard (por nível de acesso)
                               ├── Chat espelhado (Realtime)
                               ├── Módulos: Leads, Programação, Empregabilidade, Acesso CUCA, Ouvidoria
                               ├── Import planilha CSV/Excel (Programação Mensal)
                               ├── Formulários públicos: candidatura, Acesso CUCA, empresa
                               └── Developer Console (exclusivo role 'super_admin')
```

---

## 3. ESTRUTURA DE 13 CANAIS WHATSAPP — REVISÃO MAR/2026 {#3-canais}

> **ATUALIZAÇÃO v5.15 (05/03/2026)**: Após reunião com a Rede CUCA, a arquitetura de canais foi revisada. O organograma oficial passa a ter **13 chips** ao invés de 14. A separação entre "canal pontual" e "canal institucional" foi eliminada: os **Institucionais** absorvem a função de atendimento da programação. Um novo chip **Divulgação** assume os disparos globais. A numeração foi reorganizada.

| # | Canal | Agente/Persona | Gerencia | Comunicação | Chip |
|---|-------|---------------|----------|-------------|------|
| 01 | Institucional — Barra | Maria (Barra) | Admin CUCA Barra | **Ativo + Passivo**: disparo pontual da unidade + RAG programação/unidade | Institucional |
| 02 | Institucional — Mondubim | Maria (Mondubim) | Admin CUCA Mondubim | Ativo + Passivo | Institucional |
| 03 | Institucional — Jangurussu | Maria (Jangurussu) | Admin CUCA Jangurussu | Ativo + Passivo | Institucional |
| 04 | Institucional — José Walter | Maria (J. Walter) | Admin CUCA J. Walter | Ativo + Passivo | Institucional |
| 05 | Institucional — Pici | Maria (Pici) | Admin CUCA Pici | Ativo + Passivo | Institucional |
| 06 | Empregabilidade — Barra | Júlia (Barra) | Admin CUCA Barra | Passivo: vagas, orientação, CV | Empregabilidade |
| 07 | Empregabilidade — Mondubim | Júlia (Mondubim) | Admin CUCA Mondubim | Passivo | Empregabilidade |
| 08 | Empregabilidade — Jangurussu | Júlia (Jangurussu) | Admin CUCA Jangurussu | Passivo | Empregabilidade |
| 09 | Empregabilidade — José Walter | Júlia (J. Walter) | Admin CUCA J. Walter | Passivo | Empregabilidade |
| 10 | Empregabilidade — Pici | Júlia (Pici) | Admin CUCA Pici | Passivo | Empregabilidade |
| 11 | Acesso CUCA | Ana (global) | Super Admin / Gestor Divulgação | Passivo: agendamento de espaços | Acesso |
| 12 | Ouvidoria Jovem | Sofia (global) | Super Admin | Passivo + Ativo: pesquisas/escuta | Ouvidoria |
| **13** | **Divulgação CUCA** | **Maria Geral** | **Gestor Divulgação** | **Ativo**: aviso mensal + pontual estratégico para toda a rede | **Divulgação** |

### Por que Divulgação ao invés de 5 Institucionais disparando?

| Cenário | Antes (5 chips disparando) | Depois (1 chip Divulgação) |
|---|---|---|
| Ban do chip de 1 unidade | Perde serviço + disparo daquela unidade | Os 5 Institucionais ficam intactos (apenas serviço) |
| Volume mensal por chip | ~4k msgs/chip | ~20k msgs/chip Divulgação |
| Risco de ban | Distribuído nos 5 | Concentrado no Divulgação (workaround: trocar chip mantém instância) |
| Crítico para preservar | Institucional (relacionamento) | Divulgação (disparo) pode ser recuperado sem afetar atendimento |

**Decisão**: O chip Divulgação envia **1 mensagem curta e direta** (não o programa completo), reduzindo o risco. Os Institucionais focam no atendimento RAG.

### Regras da Persona Divulgação (Maria Geral)

```
Mensagem chega no chip Divulgação:
  │
  ├── Lead responde ao aviso / "obrigado" / saudação?
  │       → Template padrão: link portal + números de cada CUCA
  │
  ├── Lead pergunta sobre programação específica de uma unidade?
  │       → Identifica unidade + redireciona: "Fale com o CUCA [X]: wa.me/..."
  │
  └── Lead pergunta algo geral sobre a Rede (endereço, horário, missão)?
          → Responde via RAG Global (base de conhecimento geral da Rede)
```

Template de aviso mensal (exemplo):
> *"🎉 A programação de Março chegou! Acesse o Portal: cucaatendemais.com.br*
> *Para saber o que rola no seu CUCA, fale direto:*
> *📍 Barra: [wa.me/+558...]*
> *📍 Mondubim: [wa.me/+558...]*
> *📍 Jangurussu: [wa.me/+558...]*
> *📍 José Walter: [wa.me/+558...]*
> *📍 Pici: [wa.me/+558...]"*

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
| S8-06 | **Warm-up por instância**: `warmup_started_at TIMESTAMPTZ` adicionado em `instancias_uazapi`. `_atualizar_status_banco` detecta troca de telefone no evento `connection` e reseta warmup automaticamente. `_calcular_limite_warmup` em `campanhas_engine.py` calcula limite diário por instância: 50 (S1) → 150 (S2) → 500 (S3) → 1500 (S4) → global (S5+). Cada instância tem seu próprio contador independente. | [x] |

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

#### Sprint 13 — Ouvidoria Fase 2 + Divulgação + Qualificação de Leads ✅ CONCLUÍDO
> **Implementado em**: 06-07/03/2026 | **Commit**: `5387b8b`

| Ticket | Entregável | Status |
|--------|-----------|--------|
| S13-01 | Tab "Conversas Sofia" na aba `/ouvidoria` com ChatSidebar + ChatWindow (Realtime) | [x] |
| S13-02 | Menu boas-vindas Sofia: coluna `menu_boas_vindas` em `prompts_agentes`; motor-agente v6 envia na 1ª mensagem sem chamar GPT | [x] |
| S13-03 | Botão "Assumir Atendimento" no ChatWindow — pausa IA, muda status para `awaiting_human` | [x] |
| S13-04 | Restrição de identidade: Super Admin vê nome/telefone de leads; outros veem aviso de sigilo | [x] |
| S13-05 | Máscara telefone internacional: `mascaraTelefone` / `limparTelefone` em `utils.ts`, aplicada em Leads + Vagas | [x] |
| S13-06 | Flag `expansiva BOOLEAN` em `eventos_pontuais`; toggle no modal de programação; roteamento worker (expansiva → Divulgação, não-expansiva → Institucional da unidade) | [x] |
| S13-07 | Migration `categorias_interesse` (pai + subcategoria, hierárquica) + `lead_interesses` (junction UNIQUE) com RLS | [x] |
| S13-08 | Seed: 7 categorias pai + 29 subcategorias em `categorias_interesse` | [x] |
| S13-09 | UI lead_interesses: checkboxes hierárquicos na Sheet de lead — toggle em tempo real (INSERT/DELETE) | [x] |
| S13-10 | Público-alvo por categorias no modal de Programação Pontual: checkboxes + counter de alcance estimado | [x] |
| S13-11 | Público-alvo por categorias nos Eventos de Ouvidoria: checkboxes + `categorias_alvo JSONB` na tabela | [x] |
| S13-12 | Worker `campanhas_engine.py`: filtro `categorias_alvo` via JOIN em `lead_interesses` ao buscar leads | [x] |
| S13-13 | RAG Global para Divulgação: instância Divulgação busca `rag_chunks` sem filtro de unidade (global) | [x] |

#### Sprint 14 — Programação Ajustes + Configuração de Instâncias ✅ CONCLUÍDO
> **Implementado em**: 08/03/2026 | **Commit**: `c740727` / `c6b0661`

| Ticket | Entregável | Status |
|--------|-----------|--------|
| S14-01 | Validação de conflito de datas ao criar evento pontual: query de sobreposição na mesma unidade, `confirm()` se houver conflito | [x] |
| S14-02 | Filtros de unidade e busca aplicados server-side (`.eq()` + `.ilike()`) na `fetchData` de `/programacao` | [x] |
| S14-03 | Select "Canal de Disparo" no modal de criação pontual: carrega instâncias ativas filtradas por unidade; `instancia_id` salvo no evento; worker usa `_query_instancia_by_id_sync` quando definido | [x] |
| S14-04 | Grid de instâncias agrupado por `canal_tipo` em `/developer/instancias` (seções Institucional, Empregabilidade, Acesso, Ouvidoria, Reserva, Divulgação) | [x] |
| S14-05 | Feedback de progresso por etapas ao criar instância: mensagens de status em tempo real dentro do modal | [x] |

---

### FASE 5 — BACKLOG PENDENTE (pós-reunião 06/03/2026)

> Itens identificados no backlog oficial (`backlog-portal-cucaatendemais.html`) que **não foram implementados** nos sprints anteriores ou foram implementados de forma divergente da especificação.

---

#### Sprint 15 — Atendimento Institucional + Correções de Programação ⏳ PENDENTE

| Ticket | Entregável | Módulo | Status |
|--------|-----------|--------|--------|
| S15-01 | **Atendimento — Filtro Institucional**: filtrar `/atendimento` para exibir APENAS conversas de instâncias com `canal_tipo = 'Institucional'`. Instâncias de Empregabilidade, Ouvidoria, Acesso e Divulgação NÃO aparecem nesta aba | Portal | [ ] |
| S15-02 | **Programação — Validar RAG por Institucional**: confirmar que ao criar/aprovar evento pontual ou importar programação mensal, o indexador RAG gera chunks com `cuca_unit_id` correto associado ao número Institucional da unidade | Worker + Banco | [ ] |
| S15-03 | **Programação — Bug Mensal**: investigar e corrigir erros na exibição ou importação da programação mensal. Validar dados existentes no banco — conferir campos nulos, datas inválidas, total_atividades inconsistente | Portal + Banco | [ ] |
| S15-04 | **Programação — Bug Datas Pontuais**: identificar registros com `data_inicio > data_fim` ou campos nulos nos eventos pontuais existentes; criar migration de correção e validação de consistência no banco | Banco + Portal | [ ] |

---

#### Sprint 16 — Empregabilidade Fase 2 ⏳ PENDENTE

> **Prazo do backlog**: 13/03/2026

| Ticket | Entregável | Módulo | Status |
|--------|-----------|--------|--------|
| S16-01 | **Candidatura Espontânea — Banco de Talentos**: migration para permitir `vaga_id NULL` em `candidaturas`; página pública `/candidatos/espontanea` com formulário (nome, data nasc, telefone, upload CV PDF); OCR automático via GPT-4o Vision; inserção direta em `talent_bank` com `status = 'disponivel'` | Portal + Banco + Worker | [ ] |
| S16-02 | **Cadastro Manual pelo Colaborador**: botão "Cadastrar no Banco de Talentos" no portal de empregabilidade; formulário interno (nome, nascimento, telefone, upload CV opcional); colaborador pode adicionar candidato presencial sem vaga específica | Portal | [ ] |
| S16-03 | **Mensagem de Encerramento após Inscrição**: agente Júlia envia automaticamente após o lead enviar CV: *"Seu currículo foi registrado! Caso seja aprovado, você receberá confirmação por aqui. De toda forma, seu CV fica no nosso Banco de Talentos para vagas futuras."* | Worker + Edge Function | [ ] |
| S16-04 | **Follow-up com a Empresa**: interface no portal da vaga para registrar feedback da empresa (aprovado / reprovado / em análise) por candidato; histórico de contatos com a empresa parceira | Portal | [ ] |
| S16-05 | **Follow-up com o Candidato Aprovado**: quando gestor marca candidato como `selecionado`, disparo automático via WhatsApp notificando aprovação. NÃO notificar rejeitados neste fluxo | Worker + Portal | [ ] |
| S16-06 | **Visualização Cross-CUCA de Vagas**: colaboradores de empregabilidade de qualquer CUCA têm acesso **read-only** às vagas abertas de todos os equipamentos. Aba "Rede Completa" na página de vagas | Portal | [ ] |
| S16-07 | **Buscador Multi-CUCA por Perfil de CV**: agente Júlia (canal geral ou unidade) analisa CV do lead → busca vagas compatíveis em todos os 5 CUCAs → informa se há vagas, quais são, onde estão e passa o número de contato para inscrição | Worker + Edge Function | [ ] |
| S16-08 | **Inscrição de Terceiros**: agente reconhece quando alguém está inscrevendo outra pessoa ("meu filho", "minha filha", etc.) → solicita dados do candidato indicado → habilita upload do CV do terceiro → cria candidatura normalmente | Worker + Edge Function | [ ] |

---

#### Sprint 17 — Divulgação Prévia + Diagnóstico de Configurações ⏳ PENDENTE

| Ticket | Entregável | Módulo | Status |
|--------|-----------|--------|--------|
| S17-01 | **Prévia de Disparo — Programação Pontual**: antes de disparar evento pontual, exibir: prévia da mensagem com `{{nome}}` preenchido, contagem de leads que receberão, seleção de público-alvo; confirmação explícita antes de iniciar o disparo | Portal | [ ] |
| S17-02 | **Diagnóstico de Lentidão de Instâncias**: investigar causa raiz — testar se é (a) revalidação de cache do Next.js (`router.refresh` vs `router.push`), (b) capacidade da VPS, ou (c) polling excessivo. Documentar resultado | Portal + Infra | [ ] |
| S17-03 | **Correção de Lentidão**: aplicar correção baseada no diagnóstico de S17-02. Se frontend: otimizar state management e invalidação de cache. Se infra: documentar necessidade de upgrade de plano | Portal ou Infra | [ ] |

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
    - **Aviso "Desconectado" Limpo (Sem Overlay Blocks)**: O antigo overlay absoluto vermelho foi removido por prejudicar a usabilidade e a visualização. Foi substituído por uma faixa de alerta limpa no rodapé. Os botões "Limpar Sessão / Trocar Chip" ficam sempre visíveis no CardFooter normal, e o Lápis continua livre no cabeçalho.
    - Botão de **Editar Instância (Lápis ✏️)**: Exibido abertamente no cabeçalho de todas as instâncias para gestores/admins com permissão. Acesso liberado independente da instância estar online, reserva ou desconectada.
    - ⚠️ **Exclusão Definitiva (`DELETE /instance`)**: O botão de exclusão só é renderizado para perfis Developers restritos no frontend (via check de e-mail limitados). A requisição passa por uma rota blindada no Next.js `/api/instancias/excluir/route.ts` que valida o e-mail no backend com o Supabase antes de engatilhar a chamada no motor Python para limpar os servidores da Met/UAZAPI completamente.
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

---

## 🆕 Sprint 9 — Canal Divulgação + RAG Global {#sprint9}

> **Versão**: 5.15 | **Data de planejamento**: 05/03/2026
> **Motivação**: Reunião Rede CUCA estabeleceu nova arquitetura de 13 chips com um canal Divulgação global para disparos mensais, protegendo os 5 canais Institucionais para atendimento puro.

### 9.1 Visão Geral e Decisões Arquiteturais

| Decisão | Escolha | Justificativa |
|---|---|---|
| Import de planilha | **Mantém per-unidade** (sem mudança de formato) | A planilha "PROGRAMAÇÃO 2026 - REDE CUCA BARRA.xlsx" já existe por unidade. Forçar 1 planilha global exigiria reformatação de todos os documentos da comissão. |
| Disparo mensal global | **Botão "Disparo Global" no painel do Gestor** | Após todas unidades terem sua programação importada para o mês, o Gestor Divulgação aciona o blast global pelo Divulgação. |
| Mensagem do Divulgação | **Curta + lista de links de cada CUCA** | Não envia programação completa — apenas aviso + wa.me por unidade. Reduz risco de detecção de spam pela Meta. |
| RAG Global | **Novo modal em Configurações** (módulo `programacao_rag_global`) | Base de conhecimento geral da Rede CUCA: endereços, missão, contatos dos gerentes. Separado do RAG de programação. |
| Novo papel | **NÃO criado pelo código** | Valmir cria o papel pelo RBAC após as interfaces estarem disponíveis. O código apenas expõe os módulos necessários. |

### 9.2 Novo CanalTipo: Divulgação

**O que muda no código:**

| Arquivo | Mudança |
|---|---|
| `cuca-portal/src/app/(dashboard)/configuracoes/whatsapp/page.tsx` | Adicionar `"Divulgação"` ao tipo `CanalTipo` e às constantes de cor/ícone/descrição |
| `cuca-portal/src/app/(dashboard)/developer/instancias/page.tsx` | Idem — lista de tipos |
| `cuca-portal/src/components/instancias/canal-whatsapp-tab.tsx` | Idem |
| `worker/campanhas_engine.py` | Buscar instância `Divulgação` ao invés de `Institucional` para disparo mensal global |
| Banco | Verificar se há CHECK constraint em `canal_tipo` e adicionar `'Divulgação'` |

**Cor visual**: Amarelo-âmbar (`#F9C74F`) — já existe no organograma.

### 9.3 Fluxo Completo: Do Upload ao Disparo (DEFINITIVO)

> ⚠️ **BUG CRÍTICO IDENTIFICADO**: O código atual de importação (`import-planilha-modal.tsx`, linha 343) salva a campanha diretamente com `status: "aprovado"`, o que faz o motor disparar automaticamente 30 segundos após o upload. **Isso é errado e precisa ser corrigido antes de qualquer teste com leads reais.** O ticket S9-00 corrige isso.

```
╔══════════════════════════════════════════════════════════════╗
║  ETAPA 1 — UPLOAD (cada unidade, sem mudança no processo)    ║
╠══════════════════════════════════════════════════════════════╣
║  Gerente / Aux Admin faz upload da planilha da sua unidade   ║
║    → CORREÇÃO: status salvo como "pendente" (não "aprovado") ║
║    → RAG da unidade é indexado automaticamente               ║
║    → Cards da programação aparecem na tela para revisão      ║
╠══════════════════════════════════════════════════════════════╣
║  ETAPA 2 — APROVAÇÃO POR UNIDADE (Gerente da unidade)        ║
╠══════════════════════════════════════════════════════════════╣
║  Gerente revisa os cards da programação do seu CUCA          ║
║    → Clica em "Aprovar Programação"                          ║
║    → status vira "aprovado"                                  ║
║    → NENHUM DISPARO ACONTECE AQUI                            ║
╠══════════════════════════════════════════════════════════════╣
║  ETAPA 3 — PAINEL DO GESTOR GERAL (novo perfil)              ║
╠══════════════════════════════════════════════════════════════╣
║  Gestor Geral acessa o painel de Divulgação e vê:            ║
║                                                              ║
║  Programação de Março/2026                                   ║
║  ✅ CUCA Barra       → Aprovada (74 atividades)              ║
║  ✅ CUCA Mondubim    → Aprovada (86 atividades)              ║
║  ⏳ CUCA Jangurussu  → Carregada, aguardando aprovação       ║
║  ✅ CUCA José Walter → Aprovada (61 atividades)              ║
║  ❌ CUCA Pici        → Ainda não enviou a planilha           ║
║                                                              ║
║  Se alguma faltar: Gestor contata a unidade pelo canal       ║
║  interno pedindo a liberação.                                ║
║                                                              ║
║  Quando decidir que está pronto:                             ║
║    → Clica em "Disparar Aviso Global — Março/2026"           ║
║    → Confirmação de segurança (modal de confirmação)         ║
║    → Motor usa instância Divulgação                          ║
║    → Envia mensagem curta para TODOS os leads opt_in         ║
║       (sem filtro de unidade — base completa da Rede)        ║
║    → Template: aviso + link portal + wa.me de cada CUCA      ║
║    → Estratégia anti-ban ativa (distribuição por sessão,     ║
║       spintax, warmup por instância)                         ║
╚══════════════════════════════════════════════════════════════╝
```

**Regra fundamental**: O motor de disparo (`campanhas_engine.py`) **NUNCA** processa `campanhas_mensais` automaticamente. O disparo mensal global via Divulgação só acontece quando o Gestor Geral clica no botão. O motor passa a ler uma nova tabela `disparos_divulgacao` criada por esse botão.

### 9.4 Painel do Gestor Geral de Divulgação (módulo `divulgacao`)

**Localização**: `/divulgacao` no menu lateral — visível apenas para quem tiver o módulo `divulgacao` habilitado.

**O que o painel mostra e permite:**

| Área do painel | O que faz | Permissão |
|---|---|---|
| **Visão de Status por Unidade** | Tabela com: unidade / status (sem planilha / pendente / aprovada) / qtd atividades / responsável / data upload | `can_read` |
| **Botão "Disparar Aviso Global"** | Só fica ativo quando pelo menos 1 unidade está aprovada. Abre modal de confirmação antes de disparar. | `can_create` |
| **Histórico de Disparos** | Lista de todos os envios anteriores: data, mês de referência, total enviado, status (em andamento / concluído / pausado) | `can_read` |
| **Métricas do Último Disparo** | Entregas, respostas recebidas, STOP recebidos, taxa de engajamento | `can_read` |
| **Conversas do Canal** | Visualização das conversas de atendimento no chip Divulgação | `can_read` |
| **Gerenciar Chip Divulgação** | Conectar, trocar chip (banco + UAZAPI), ver QR Code — igual ao que existe em Config WhatsApp | `can_update` |

### 9.5 RAG Global (módulo `programacao_rag_global`)

**O que é**: Base de conhecimento geral da Rede CUCA — separada do RAG de programação por unidade. Responde perguntas como "onde fica o CUCA da Barra?", "quem é o gerente do Jangurussu?", "o que é o programa CUCA?".

**Localização**: Configurações → aba "Base de Conhecimento — Rede Geral" (módulo `programacao_rag_global`)

**Formato de entrada**: Upload de PDF, TXT, DOCX + campo de texto livre. Indexado com `source_type = 'rede_cuca_global'` e `cuca_unit_id = NULL` em `rag_chunks`.

**Comportamento do Worker**: Persona Divulgação busca primeiro em `rede_cuca_global`. Os Institucionais buscam no RAG da sua unidade e fazem fallback para `rede_cuca_global` se não encontrar.

### 9.6 Anti-Ban — Estratégia Completa e Revisada (pesquisa Mar/2026)

**O que já existe e continuará:**

| Estratégia | Detalhes |
|---|---|
| Delays aleatórios | 5s a 45s entre mensagens, configurável no banco |
| Simulação "digitando…" | `presence: composing` antes de cada envio |
| Bloqueio noturno | Envios apenas das 08h às 22h |
| Pause por erro técnico | Pausa automática se taxa de falha HTTP > 8% |
| Warmup por instância | 50→150→500→1500→global, controlado pelo `warmup_started_at` de cada chip |
| Personalização | `{{nome}}` em todas as mensagens |
| Logout seguro | `POST /instance/disconnect` antes de trocar chip |
| WhatsApp Business | Uso obrigatório de contas comerciais |

**O que será adicionado no Sprint 9:**

| Estratégia nova | O que é | Como funciona |
|---|---|---|
| **Spintax — variação de texto** | Evita que todas as mensagens sejam idênticas (principal trigger de ban) | Motor sorteia aleatoriamente entre variantes: `{Olá\|Oi\|Hey\|Bom dia}, {{nome}}!`. Template de Divulgação terá 3-5 variantes de abertura e fechamento. |
| **Distribuição por sessão (limite/hora)** | Evita enviar 500 mensagens em 10 minutos | Além do limite diário, o motor divide em sessões de até 80 mensagens/hora com pausa de 10min entre sessões. |
| **STOP automático** | Evita que usuários precisem bloquear o número para sair | Se qualquer lead responder "STOP", "Parar", "Sair", "Não quero", "Cancelar" → `opt_in = false` instantaneamente. Bot confirma: "Pronto! Você foi removido da lista." |
| **Alerta de saúde do número** | Detecta rejeição social, não só erro técnico | A cada 50 mensagens: se >5% STOP/bloqueios detectados na sessão → motor pausa + alerta no painel do Gestor. Histórico salvo em `disparos_divulgacao.metricas_json`. |
| **Filtro de contatos frios (60 dias)** | Leads sem nenhuma interação há mais de 60 dias têm taxa de bloqueio muito maior | Motor filtra `leads WHERE opt_in=true AND last_interaction_at > NOW() - 60 days`. Leads frios ficam em lista separada para campanha de reengajamento futura. |
| **Primeira mensagem sem link externo** | WhatsApp bloqueia URLs externas em primeiros contatos | Para leads que nunca interagiram com o chip Divulgação: mensagem só com wa.me (link nativo). Links do portal só em segunda interação. |
| **Log de qualidade por disparo** | Histórico de saúde para decisões futuras | Cada disparo salva: total enviado, respostas recebidas em 24h, STOP recebidos, taxa de engajamento. Esses dados ficam visíveis no painel. |

### 9.7 Novos Módulos RBAC em sys_permissions

| Módulo (chave) | Label na UI | Quem pode ter |
|---|---|---|
| `divulgacao` | Divulgação CUCA | Apenas o perfil Gestor Geral que Valmir criar via RBAC |
| `programacao_rag_global` | Base Conhecimento Global | Idem — controlado pelo Gestor Geral |

> ⚠️ Esses módulos **não aparecem** na tela de criação de perfil para Gerentes — filtrados via `isDeveloper` na UI de perfis.

### 9.8 Disparo Pontual via Divulgação (fase 2 — planejado)

Eventos de grande escala da Rede (ex: "Semana do Jovem") poderão ser disparados com a mesma lógica: Gestor cria o evento, escreve a mensagem, confirma e dispara via chip Divulgação para toda a base.

> ⚠️ Pontuais de **unidade específica** sempre usam o canal Institucional daquela unidade.

### 9.9 Checklist de Execução Sprint 9 — DEFINITIVO

| Ticket | Tarefa | Impacto | Status |
|---|---|---|---|
| **S9-00** | **BUG FIX**: Alterar `import-planilha-modal.tsx` para salvar `status: "pendente"` no upload (não "aprovado"). Adicionar botão "Aprovar Programação" na tela de programação mensal do Gerente. | CRÍTICO — impede disparo acidental | [x] |
| S9-01 | Adicionar `'Divulgação'` ao `CanalTipo` em todos os arquivos (portal + tipos TS + worker). Cor amarelo-âmbar, ícone `Megaphone`. | Portal + Worker | [x] |
| S9-02 | Verificar CHECK constraint em `instancias_uazapi.canal_tipo` e adicionar `'Divulgação'` via migration. | Banco | [x] |
| S9-03 | Criar página `/divulgacao` com painel: tabela de status por unidade, botão disparar (com modal de confirmação), histórico, métricas. | Portal | [x] |
| S9-04 | Criar tabela `disparos_divulgacao` (id, mes, ano, status, total_leads, metricas_json, criado_por, created_at) e API route `POST /api/divulgacao/disparar`. | Banco + Portal API | [x] |
| S9-05 | `campanhas_engine.py` — novo loop para `disparos_divulgacao WHERE status='pendente'` → busca instância Divulgação → envia para TODOS leads `opt_in=true AND last_interaction_at > 60d` → sem filtro de unidade. | Worker | [x] |
| S9-06 | Implementar Spintax no motor: templates com variantes `{A\|B\|C}` sortidas por lead. Variantes de abertura, corpo e fechamento para a mensagem de Divulgação. | Worker | [x] |
| S9-07 | Implementar distribuição por sessão: máx 80 mensagens/hora, pausa 10min entre sessões dentro do disparo diário. | Worker | [x] |
| S9-08 | Implementar STOP automático: detectar palavras-chave no handler de mensagens → `opt_in = false` + confirmação para o lead. | Worker | [x] |
| S9-09 | Implementar alerta de saúde: a cada 50 msgs, checar % de STOP → se >5% pausa sessão + grava alerta em `disparos_divulgacao.metricas_json`. | Worker | [x] |
| S9-10 | Implementar filtro de leads frios: no loop de disparo, excluir leads sem interação nos últimos 60 dias. | Worker | [x] |
| S9-11 | Aba "Gerenciar Chip Divulgação" no painel: conectar, trocar chip, QR Code — reusar componente existente de Configurações WhatsApp. | Portal | [x] |
| S9-12 | Página `/configuracoes/rag-global` — Base de Conhecimento Rede Geral: CRUD de docs globais (`unidade_cuca = NULL`), indexação via Edge Function com `source_type = 'rede_cuca_global'`. Acessível via permissão `programacao_rag_global`. Item adicionado ao menu Configurações. | Portal | [x] |
| S9-13 | Worker `main.py` linhas 392-395: detecta `canal_tipo == "Divulgação"` → define `agente_tipo = "maria_divulgacao"` e `unidade_cuca = None` (sem filtro). Sinaliza para Edge Function `motor-agente` usar RAG `rede_cuca_global`. | Worker | [x] |
| S9-14 | Módulos `divulgacao` e `programacao_rag_global` já presentes no grupo "Divulgação & RAG Global" em `configuracoes/perfis/page.tsx`. | Portal | [x] |
| S9-15 | Card "Conversas Recentes — Canal Divulgação" adicionado ao painel `/divulgacao`: filtra `conversas WHERE instancia_uazapi = instanciaDisp`, mostra lead, telefone, status e timestamp. Realtime pode ser adicionado em sprint futura. | Portal | [x] |
| S9-16 | Commit, push e deploy Worker (cuca-worker no Easypanel). Smoke test com número de teste. | DevOps | [x] |

### 9.10 O que NÃO muda no Sprint 9

- ✅ Formato da planilha Excel — sem alteração
- ✅ Fluxo de upload per-unidade — sem alteração no processo do Gerente (só o status inicial muda para "pendente")
- ✅ RAG de programação por unidade — sem alteração
- ✅ Canais Institucional e Empregabilidade — comportamento igual
- ✅ Papel do Gerente, Super Admin, Developer — sem alteração de permissões existentes
- ✅ Pontual por unidade — Agora também compartilha a instância Global de "Divulgação" e tem o problema de Load infinito de "data_evento" ajustado.

---

## Sprint 10 — Leads: Perfil de Atividades + Performance para 10k+ Registros *(REPLANEADO 07/03/2026)*

**Objetivo:** Corrigir estrutura de leads após análise das fichas reais da Prefeitura de Fortaleza. Remover campos desnecessários, criar sistema de perfil automático por atividades/equipamentos, implementar paginação server-side e preparar integração futura com API da Prefeitura.

**Contexto:** As fichas reais mostram que cada jovem tem um histórico de cursos/atividades em diferentes CUCAs (equipamentos). Campos como JUV, turma, freq%, nota, situação NÃO são necessários no sistema. O que importa para disparos: quais equipamentos ele frequenta mais (top 2) e quais atividades pratica mais (top 2). Com 10k+ leads esperados, a página precisa de paginação. Tudo fica na página `/leads` sem modais externos — drawer lateral inline. O perfil de atividades alimenta Programação Pontual e Ouvidoria para filtragem precisa de público-alvo.

> ⚠️ Sprint 10 original foi replaneado. Estrutura criada (lead_percurso_formativo + 5 colunas extras) foi revertida por ser desnecessária.

### 10.1 Banco — Reversão e Nova Estrutura

| Ticket | Tarefa | Status |
|---|---|---|
| S10-R01 | Migration REVERTER: DROP colunas desnecessárias de `leads`: `nome_social`, `numero_juventude`, `data_cadastro_juv`, `contato_alternativo`, `uf_origem` | [ ] |
| S10-R02 | Migration REVERTER: DROP TABLE `lead_percurso_formativo` | [ ] |
| S10-01 | Migration: ADD em `leads` → `equipamentos_principais TEXT[] DEFAULT '{}'` e `atividades_principais TEXT[] DEFAULT '{}'` | [ ] |
| S10-02 | Migration: CREATE TABLE `lead_atividades` (`id UUID PK`, `lead_id UUID FK ON DELETE CASCADE`, `equipamento TEXT NOT NULL`, `atividade TEXT NOT NULL`, `contagem INT DEFAULT 1`, `created_at TIMESTAMPTZ`, `UNIQUE(lead_id, equipamento, atividade)`) — UPSERT incrementa contagem | [ ] |
| S10-03 | Migration: função SQL `recalcular_perfil_lead(p_lead_id UUID)` → atualiza `equipamentos_principais` (top 2 por SUM contagem) e `atividades_principais` (top 2 por SUM contagem) em `leads` | [ ] |
| S10-04 | Migration: trigger `trg_lead_atividades_perfil` AFTER INSERT/UPDATE/DELETE em `lead_atividades` → chama `recalcular_perfil_lead` automaticamente | [ ] |
| S10-05 | RLS para `lead_atividades`: SELECT/INSERT/UPDATE/DELETE com `has_permission('leads', ...)` | [ ] |

### 10.2 Tipos TypeScript

| Ticket | Tarefa | Status |
|---|---|---|
| S10-06 | Atualizar tipo `Lead` em `src/lib/types/database.ts`: remover 5 campos revertidos, adicionar `equipamentos_principais: string[]` e `atividades_principais: string[]`, manter `data_nascimento DATE` | [ ] |
| S10-07 | Substituir `LeadPercursoFormativo` por `LeadAtividade` (`id, lead_id, equipamento, atividade, contagem, created_at`) | [ ] |

### 10.3 UI — Página `/leads` com Paginação e Drawer Inline

| Ticket | Tarefa | Status |
|---|---|---|
| S10-08 | Substituir `.limit(100)` por paginação server-side: 50 leads/página, busca e filtros via Supabase (ilike + eq), contador total via `.count()`, controles Anterior/Próxima | [ ] |
| S10-09 | Drawer lateral inline (Sheet do shadcn/ui): ao clicar `...` → "Ver Lead" abre Sheet pela direita sem sair da página | [ ] |
| S10-10 | Conteúdo do Sheet: **Dados** (nome, telefone, data_nascimento, email, unidade_cuca editáveis + Salvar) + **Perfil** (badges read-only: equipamentos_principais + atividades_principais) + **Atividades** (tabela: Equipamento \| Atividade \| Contagem \| [Excluir] + botão "+ Adicionar" com select CUCA + input atividade + contagem → UPSERT) | [ ] |
| S10-11 | Modal "Novo Lead" simplificado: apenas nome, telefone, data_nascimento, email, unidade_cuca | [ ] |
| S10-12 | Coluna "Perfil" na tabela de leads: badges de `atividades_principais` (máx 2, coloridos) e `equipamentos_principais` (máx 2, outline) | [ ] |

### 10.4 API de Importação (preparação para API da Prefeitura de Fortaleza)

| Ticket | Tarefa | Status |
|---|---|---|
| S10-13 | API route `POST /api/leads/importar-atividades`: recebe array de `{telefone, nome, data_nascimento, equipamento, atividade, contagem}`, faz UPSERT em `leads` (on_conflict: telefone) e UPSERT em `lead_atividades` (on_conflict: lead_id+equipamento+atividade → soma contagem). Retorna `{processados, erros}` | [ ] |
| S10-14 | Suporte a batch com `offset`: retomar importação após timeout sem duplicar dados — idempotente por design | [ ] |

### 10.5 Checklist Sprint 10

| Ticket | Tarefa | Impacto | Status |
|---|---|---|---|
| S10-R01 | DROP colunas desnecessárias em leads | Banco | [ ] |
| S10-R02 | DROP lead_percurso_formativo | Banco | [ ] |
| S10-01 | ADD equipamentos/atividades_principais em leads | Banco | [ ] |
| S10-02 | CREATE lead_atividades | Banco | [ ] |
| S10-03 | Função recalcular_perfil_lead | Banco | [ ] |
| S10-04 | Trigger automático | Banco | [ ] |
| S10-05 | RLS lead_atividades | Banco | [ ] |
| S10-06 | Tipo Lead atualizado | Portal | [ ] |
| S10-07 | Tipo LeadAtividade criado | Portal | [ ] |
| S10-08 | Paginação server-side 50/pág | Portal | [ ] |
| S10-09 | Sheet drawer inline | Portal | [ ] |
| S10-10 | Conteúdo Sheet (dados + perfil + atividades) | Portal | [ ] |
| S10-11 | Novo Lead simplificado | Portal | [ ] |
| S10-12 | Badges perfil na tabela | Portal | [ ] |
| S10-13 | API importar-atividades | Portal API | [ ] |
| S10-14 | Suporte offset/batch | Portal API | [ ] |

---

## Sprint 11 — Atendimento Aprimorado + RAG Global no Portal

**Objetivo:** Separar conversas de atendimento institucional das demais e facilitar upload de RAG Global diretamente da página de Atendimento

**Contexto:** A página `/atendimento` exibe TODAS as conversas sem filtro. Gestores precisam ver apenas os canais institucionais. O upload de RAG Global hoje só é feito em `/configuracoes/rag-global` — precisa ser acessível no atendimento. Reunião de Gestores (06/03/2026).

### 11.1 Filtro de Conversas Institucionais

| Ticket | Tarefa | Status |
|---|---|---|
| S11-01 | Em `src/app/(dashboard)/atendimento/page.tsx`: passar prop `filterAgenteTipo` para `ChatSidebar` excluindo tipos `maria_divulgacao` e agentes de ouvidoria, mostrando apenas atendimento institucional | [ ] |
| S11-02 | Testar que conversas de divulgação e ouvidoria NÃO aparecem no atendimento | [ ] |

### 11.2 Modal RAG Global no Atendimento

| Ticket | Tarefa | Status |
|---|---|---|
| S11-03 | Adicionar botão "Base de Conhecimento Global" na toolbar da página de atendimento | [ ] |
| S11-04 | Reutilizar componente existente de RAG Global (`/configuracoes/rag-global`) como modal/drawer acessível direto do atendimento | [ ] |

### 11.3 Handover Humano (UI Base)

| Ticket | Tarefa | Status |
|---|---|---|
| S11-05 | Adicionar botão "Assumir Atendimento" no `ChatWindow` (UI apenas — backend implementado em sprint futura) | [ ] |

### 11.4 Checklist Sprint 11

| Ticket | Tarefa | Impacto | Status |
|---|---|---|---|
| S11-01 | Filtro filterAgenteTipo no atendimento | Portal | [ ] |
| S11-02 | Teste filtro | QA | [ ] |
| S11-03 | Botão RAG Global toolbar | Portal | [ ] |
| S11-04 | Modal RAG reutilizado | Portal | [ ] |
| S11-05 | Botão handover (UI) | Portal | [ ] |

---

## Sprint 12 — Empregabilidade Fase 2

**Objetivo:** Implementar fluxos pós-candidatura: envio de CV por email para empresa, follow-ups, banco de talentos com UI completa e visualização read-only de vagas de outros CUCAs

**Contexto:** Tabelas `vagas`, `candidaturas`, `banco_talentos` existem no banco mas a UI carece de fluxos pós-inscrição. Gestores solicitaram: envio automático de CV à empresa, mensagem de fechamento, follow-up bilateral e pesquisa multi-CUCA. Reunião de Gestores (06/03/2026).

### 12.1 Banco de Dados

| Ticket | Tarefa | Status |
|---|---|---|
| S12-01 | Migration: adicionar `email_contato_empresa VARCHAR(255)` à tabela `vagas` | [ ] |
| S12-02 | Migration: criar tabela `empregabilidade_followup` (`id UUID PK`, `candidatura_id UUID FK candidaturas.id`, `tipo VARCHAR(20)` [empresa/candidato], `mensagem TEXT`, `enviado_em TIMESTAMPTZ`, `status VARCHAR(20)`, `created_at TIMESTAMPTZ`) | [ ] |
| S12-03 | RLS policies para `empregabilidade_followup` | [ ] |

### 12.2 Edge Function — Envio de CV por Email

| Ticket | Tarefa | Status |
|---|---|---|
| S12-04 | Edge Function `send-cv-email`: recebe `candidatura_id`, busca CV do lead, formata email com dados da vaga e candidato, envia para `email_contato_empresa` | [ ] |
| S12-05 | Trigger ou chamada manual no momento da candidatura: chamar `send-cv-email` | [ ] |

### 12.3 UI — Fluxos Empregabilidade

| Ticket | Tarefa | Status |
|---|---|---|
| S12-06 | Mensagem de fechamento automática após inscrição: modal de confirmação exibe texto personalizado para o candidato | [ ] |
| S12-07 | Painel de follow-up no módulo de candidaturas: timeline de contatos com empresa e candidato | [ ] |
| S12-08 | UI banco de talentos: busca por skill, unidade, disponibilidade; ações de contato | [ ] |
| S12-09 | Visualização read-only de vagas de outros CUCAs: filtro "Todas as unidades" sem permissão de edição | [ ] |
| S12-10 | Inscrição por terceiros: colaborador pode registrar candidato manualmente informando telefone/nome | [ ] |

### 12.4 Checklist Sprint 12

| Ticket | Tarefa | Impacto | Status |
|---|---|---|---|
| S12-01 | Migration email_contato_empresa em vagas | Banco | [ ] |
| S12-02 | Migration tabela empregabilidade_followup | Banco | [ ] |
| S12-03 | RLS followup | Banco | [ ] |
| S12-04 | Edge Function send-cv-email | Worker/Supabase | [ ] |
| S12-05 | Trigger envio CV | Backend | [ ] |
| S12-06 | Mensagem fechamento após inscrição | Portal | [ ] |
| S12-07 | Painel follow-up timeline | Portal | [ ] |
| S12-08 | UI banco de talentos completa | Portal | [ ] |
| S12-09 | Read-only vagas outros CUCAs | Portal | [ ] |
| S12-10 | Inscrição por terceiros | Portal | [ ] |

---

## Sprint 13 — Ouvidoria Fase 2 + Divulgação Ajustes

**Objetivo:** Adicionar rastreamento de conversas e handover na Ouvidoria; corrigir máscara de telefone e roteamento pontual na Divulgação

**Contexto:** A Ouvidoria atual só registra ocorrências mas não exibe o histórico de conversa WhatsApp associado. Gestores precisam ver e assumir conversas. Na Divulgação, inputs não formatam DDI +55 e eventos pontuais de grande escala precisam usar o chip Divulgação. Reunião de Gestores (06/03/2026).

### 13.1 Ouvidoria — Painel de Conversas

| Ticket | Tarefa | Status |
|---|---|---|
| S13-01 | Adicionar aba/seção "Conversas" em `src/app/(dashboard)/ouvidoria/page.tsx`: reutilizar `ChatSidebar` com `filterAgenteTipo` = tipos de agente ouvidoria | [ ] |
| S13-02 | Template de menu de boas-vindas Ouvidoria: mensagem inicial com botões rápidos (1-Ideia / 2-Crítica / 3-Denúncia) configurável no banco (`prompts_agentes`) | [ ] |
| S13-03 | Handover humano integrado na tab Ouvidoria: botão "Assumir Atendimento" no painel de conversa da ouvidoria | [ ] |
| S13-04 | Opção de anonimato: flag no registro de ouvidoria para ocultar identidade do reportante na visualização dos Gestores | [ ] |

### 13.2 Divulgação — Ajustes

| Ticket | Tarefa | Status |
|---|---|---|
| S13-05 | Máscara de telefone internacionalizada (+55): todos os inputs de telefone em divulgação e leads formatam com DDI `+55 (XX) XXXXX-XXXX` | [ ] |
| S13-06 | Roteamento de programação pontual via chip Divulgação: eventos pontuais de alcance geral (ex: Semana do Jovem) podem ser despachados via instância Divulgação em vez do canal institucional da unidade | [ ] |

### 13.3 Filtros de Qualificação e Classificação de Leads no Disparo

**Contexto:** Para reduzir risco de ban e aumentar relevância, o disparo de Programação Pontual (e criação de eventos de Ouvidoria) deve filtrar leads por unidade CUCA e por interesses declarados. Ex: evento de vôlei no CUCA Barra → dispara apenas para leads do CUCA Barra com interesse em Esporte > Vôlei.

**Estrutura de interesses (dois níveis):**
- Esporte → Vôlei, Basquete, Futebol, Natação, Lutas, Skate, etc.
- Cultura → Teatro, Música, Dança, Artes Visuais, Fotografia, Cinema, etc.
- Outros → Empreendedorismo, Tecnologia, Meio Ambiente, etc.

| Ticket | Tarefa | Status |
|---|---|---|
| S13-07 | Migration: criar tabela `categorias_interesse` (`id UUID PK`, `nome TEXT`, `parent_id UUID FK categorias_interesse.id nullable`, `ativo BOOL`) — árvore de dois níveis (categoria pai + subcategoria) | [ ] |
| S13-08 | Migration: criar tabela `lead_interesses` (`id UUID PK`, `lead_id UUID FK leads.id`, `categoria_id UUID FK categorias_interesse.id`, `created_at TIMESTAMPTZ`) — vínculo lead ↔ interesses | [ ] |
| S13-09 | Seed: popular `categorias_interesse` com categorias e subcategorias padrão da Rede CUCA | [ ] |
| S13-10 | UI em leads: aba/seção "Interesses" no modal do lead — seleção hierárquica (categoria → subcategorias) com checkboxes | [ ] |
| S13-11 | UI em Programação Pontual — criação/edição de evento: campo "Público-alvo" com filtros: `unidade_cuca` (já existe) + `categorias_interesse` (multi-seleção das subcategorias relevantes ao evento) | [ ] |
| S13-12 | Migration: adicionar coluna `categorias_alvo JSONB` em `eventos_pontuais` para armazenar array de `categoria_id` do público-alvo do evento | [ ] |
| S13-13 | Worker `campanhas_engine.py`: ao buscar leads para disparo pontual, aplicar JOIN com `lead_interesses` filtrando pelos `categorias_alvo` do evento. Se `categorias_alvo` for vazio/null, dispara para todos (comportamento atual) | [ ] |
| S13-14 | UI em Ouvidoria — criação de evento: mesmos filtros de público-alvo (`unidade_cuca` + `categorias_interesse`) para segmentar para quem o evento será comunicado | [ ] |
| S13-15 | RLS policies para `categorias_interesse` (leitura pública) e `lead_interesses` (escrita com permissão de leads) | [ ] |

### 13.4 Checklist Sprint 13

| Ticket | Tarefa | Impacto | Status |
|---|---|---|---|
| S13-01 | Painel conversas ouvidoria (ChatSidebar filtrado) | Portal | [ ] |
| S13-02 | Template menu boas-vindas ouvidoria | Worker + Banco | [ ] |
| S13-03 | Handover ouvidoria | Portal | [ ] |
| S13-04 | Flag anonimato | Banco + Portal | [ ] |
| S13-05 | Máscara +55 nos inputs | Portal | [ ] |
| S13-06 | Pontual via chip Divulgação | Worker + Portal | [ ] |
| S13-07 | Migration tabela categorias_interesse | Banco | [ ] |
| S13-08 | Migration tabela lead_interesses | Banco | [ ] |
| S13-09 | Seed categorias padrão CUCA | Banco | [ ] |
| S13-10 | UI interesses no modal do lead | Portal | [ ] |
| S13-11 | UI público-alvo em Programação Pontual | Portal | [ ] |
| S13-12 | Migration categorias_alvo em eventos_pontuais | Banco | [ ] |
| S13-13 | Worker: filtro de leads por interesse no disparo pontual | Worker | [ ] |
| S13-14 | UI público-alvo em Ouvidoria — criação de evento | Portal | [ ] |
| S13-15 | RLS categorias_interesse e lead_interesses | Banco | [ ] |

---

## Sprint 14 — Programação Ajustes + Configurações

**Objetivo:** Corrigir bug de conflito de datas, adicionar filtros por unidade em eventos pontuais, vincular base de conhecimento por instância e organizar instâncias por função no painel

**Contexto:** Gestores reportaram sobreposição de datas em programação pontual. Colaboradores de unidades específicas veem eventos de todas as unidades. A vinculação de KB por número institucional ainda não existe. Reunião de Gestores (06/03/2026).

### 14.1 Programação — Validações e Filtros

| Ticket | Tarefa | Status |
|---|---|---|
| S14-01 | Validação de conflito de datas: ao criar/editar evento pontual, checar sobreposição de `data_inicio`/`data_fim` para a mesma unidade e instância. Exibir erro claro na UI. | [ ] |
| S14-02 | Filtro por unidade do colaborador: eventos pontuais exibem apenas os da `unidade_cuca` do colaborador logado (exceto Super Admin que vê todos) | [ ] |
| S14-03 | Vinculação KB por instância: adicionar campo `instancia_id FK instancias_uazapi.id` (nullable) em `eventos_mensais` e `eventos_pontuais`. Quando preenchido, o Worker usa o RAG específico dessa instância. | [ ] |

### 14.2 Configurações — Organização de Instâncias

| Ticket | Tarefa | Status |
|---|---|---|
| S14-04 | Organizador de instâncias por função no painel de configurações: agrupar/filtrar instâncias por `canal_tipo` (Institucional / Divulgação / Ouvidoria / Empregabilidade) | [ ] |
| S14-05 | Diagnóstico de lentidão na criação de instâncias UAZAPI: verificar logs do Worker e UAZAPI, identificar gargalo (timeout? polling?), implementar feedback de progresso na UI | [ ] |

### 14.3 Checklist Sprint 14

| Ticket | Tarefa | Impacto | Status |
|---|---|---|---|
| S14-01 | Validação conflito datas pontual | Portal + Banco | [ ] |
| S14-02 | Filtro unidade eventos pontuais | Portal | [ ] |
| S14-03 | FK instancia_id em eventos + KB por instância | Banco + Worker | [ ] |
| S14-04 | Organizador instâncias por função | Portal | [ ] |
| S14-05 | Diagnóstico lentidão UAZAPI | Worker + Portal | [ ] |

---

## Pendências Supabase (Dados)

> Executar via Supabase MCP antes de iniciar Sprint 10

| Item | Ação | Status |
|---|---|---|
| Prompt `maria_divulgacao` | INSERT em `prompts_agentes` com prompt da agente Maria | [ ] |
| Agentes duplicados | DELETE duplicatas `Ana`/`ana`, `Sofia`/`sofia` em tabela de agentes | [ ] |
| `instancias_uazapi` vazia | INSERT das instâncias reais após criação via UAZAPI | [ ] |
| `rede_cuca_global` sem docs | INSERT de documentos base no RAG Global para agente Maria funcionar | [ ] |

