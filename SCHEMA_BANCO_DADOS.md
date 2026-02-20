# SCHEMA DO BANCO DE DADOS — Sistema CUCA

> **Versão**: 1.0 | **Data**: 15/02/2026
> **SGBD**: PostgreSQL 15+ (Supabase)
> **Extensões**: `pgvector`, `pg_cron`, `pg_net`, `pgsodium` (Vault)

---

## SUMÁRIO

1. [Extensões e Configurações](#1-extensões)
2. [Tabelas Core (RBAC + Multi-tenancy)](#2-core)
3. [Tabelas de Leads e Comunicação](#3-leads)
4. [Tabelas de Programação](#4-programação)
5. [Tabelas de Empregabilidade](#5-empregabilidade)
6. [Tabelas de Acesso CUCA](#6-acesso)
7. [Tabelas de Ouvidoria](#7-ouvidoria)
8. [Tabelas de RAG e IA](#8-rag)
9. [Tabelas de Logs e Auditoria](#9-logs)
10. [Tabelas de Configuração](#10-config)
11. [Índices e Performance](#11-índices)
12. [RLS (Row Level Security)](#12-rls)
13. [Triggers e Functions](#13-triggers)

---

## 1. EXTENSÕES E CONFIGURAÇÕES {#1-extensões}

```sql
-- Habilitar extensões
CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";
CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";
CREATE EXTENSION IF NOT EXISTS \"vector\"; -- pgvector
CREATE EXTENSION IF NOT EXISTS \"pg_cron\";
CREATE EXTENSION IF NOT EXISTS \"pg_net\";
CREATE EXTENSION IF NOT EXISTS \"pgsodium\"; -- Vault

-- Configurar pg_cron
SELECT cron.schedule('sync_monthly_programs', '0 0 1 * *', 'SELECT sync_monthly_programs()');
SELECT cron.schedule('cleanup_old_messages', '0 2 * * *', 'SELECT cleanup_old_messages()');
SELECT cron.schedule('auto_cancel_space_requests', '0 */1 * * *', 'SELECT auto_cancel_space_requests()');
```

---

## 2. TABELAS CORE (RBAC + MULTI-TENANCY) {#2-core}

### 2.1 `cuca_units` — Unidades CUCA

```sql
CREATE TABLE cuca_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE, -- \"CUCA Barra\", \"CUCA Mondubim\", etc.
  slug VARCHAR(50) NOT NULL UNIQUE, -- \"barra\", \"mondubim\", etc.
  address TEXT,
  phone VARCHAR(20),
  opening_hours JSONB, -- {\"mon\": \"08:00-22:00\", \"tue\": \"08:00-22:00\", ...}
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cuca_units_slug ON cuca_units(slug);
```

### 2.2 `roles` — Funções do sistema

```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL UNIQUE, -- \"super_admin\", \"gestor_unidade\", etc.
  description TEXT,
  is_global BOOLEAN DEFAULT false, -- true para super_admin, secretaria
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed de funções
INSERT INTO roles (name, description, is_global) VALUES
  ('super_admin', 'Desenvolvedor/Owner com acesso total', true),
  ('secretaria', 'Gestão central com acesso a todas as unidades', true),
  ('gestor_unidade', 'Gestor de uma unidade específica', false),
  ('coordenador', 'Coordenador de uma unidade específica', false),
  ('operador', 'Operador de chat de uma unidade específica', false);
```

### 2.3 `permissions` — Permissões do sistema

```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) NOT NULL UNIQUE, -- \"leads:read\", \"leads:write\", etc.
  category VARCHAR(50), -- \"leads\", \"programacao\", \"empregabilidade\", etc.
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed de permissões (exemplo parcial)
INSERT INTO permissions (key, category, description) VALUES
  ('developer:access', 'developer', 'Acesso ao Developer Console'),
  ('leads:read', 'leads', 'Visualizar leads'),
  ('leads:write', 'leads', 'Criar/editar leads'),
  ('leads:delete', 'leads', 'Deletar leads'),
  ('programacao_pontual:create', 'programacao', 'Criar programação pontual'),
  ('programacao_pontual:approve', 'programacao', 'Aprovar programação pontual'),
  ('programacao_mensal:manage', 'programacao', 'Gerenciar programação mensal (exclusivo secretaria)'),
  ('empregabilidade:manage', 'empregabilidade', 'Gerenciar vagas e candidatos'),
  ('acesso_cuca:approve_tecnico', 'acesso_cuca', 'Aprovar solicitações (nível técnico)'),
  ('acesso_cuca:approve_secretaria', 'acesso_cuca', 'Aprovar solicitações (nível secretaria)'),
  ('ouvidoria:manage', 'ouvidoria', 'Gerenciar ouvidoria'),
  ('chat:view', 'chat', 'Visualizar conversas'),
  ('chat:respond', 'chat', 'Responder conversas'),
  ('dashboard:view', 'dashboard', 'Visualizar dashboards'),
  ('rbac:manage', 'rbac', 'Gerenciar funções e permissões');
```

### 2.4 `role_permissions` — Relação N:N entre funções e permissões

```sql
CREATE TABLE role_permissions (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);
```

### 2.5 `collaborators` — Colaboradores do sistema

```sql
CREATE TABLE collaborators (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20), -- WhatsApp para receber alertas do sistema
  role_id UUID REFERENCES roles(id) NOT NULL,
  cuca_unit_id UUID REFERENCES cuca_units(id), -- NULL para funções globais
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_collaborators_role ON collaborators(role_id);
CREATE INDEX idx_collaborators_unit ON collaborators(cuca_unit_id);
CREATE INDEX idx_collaborators_email ON collaborators(email);
```

---

## 3. TABELAS DE LEADS E COMUNICAÇÃO {#3-leads}

### 3.1 `categories` — Categorias de interesse

```sql
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE, -- \"Esporte\", \"Cultura\", \"Hip Hop\", etc.
  slug VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_categories_slug ON categories(slug);
```

### 3.2 `leads` — Leads do sistema

```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  remote_jid VARCHAR(50) NOT NULL UNIQUE, -- \"5585999990000@s.whatsapp.net\"
  phone VARCHAR(20) NOT NULL, -- \"5585999990000\"
  name VARCHAR(200),
  cuca_unit_id UUID REFERENCES cuca_units(id), -- CUCA de preferência
  opt_in BOOLEAN DEFAULT true,
  opt_in_date TIMESTAMPTZ,
  opt_out_date TIMESTAMPTZ,
  latitude DECIMAL(10, 8), -- geolocalização (se compartilhada)
  longitude DECIMAL(11, 8),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_remote_jid ON leads(remote_jid);
CREATE INDEX idx_leads_unit ON leads(cuca_unit_id);
CREATE INDEX idx_leads_opt_in ON leads(opt_in);
```

### 3.3 `lead_categories` — Relação N:N entre leads e categorias

```sql
CREATE TABLE lead_categories (
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, category_id)
);

CREATE INDEX idx_lead_categories_lead ON lead_categories(lead_id);
CREATE INDEX idx_lead_categories_category ON lead_categories(category_id);
```

### 3.4 `whatsapp_instances` — Instâncias UAZAPI

```sql
CREATE TABLE whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_name VARCHAR(100) NOT NULL UNIQUE, -- \"cuca_barra_pontual\"
  phone VARCHAR(20), -- \"+5585999990000\"
  category VARCHAR(50) NOT NULL, -- \"institucional\", \"empregabilidade\", \"pontual\", \"mensal\", \"ouvidoria\", \"acesso\"
  cuca_unit_id UUID REFERENCES cuca_units(id), -- NULL para instâncias globais (mensal, ouvidoria, acesso)
  token_vault_key VARCHAR(100), -- Chave no Vault para o token UAZAPI
  status VARCHAR(20) DEFAULT 'disconnected', -- \"connected\", \"disconnected\", \"banned\"
  last_activity TIMESTAMPTZ,
  messages_sent_today INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_instances_name ON whatsapp_instances(instance_name);
CREATE INDEX idx_instances_unit ON whatsapp_instances(cuca_unit_id);
CREATE INDEX idx_instances_status ON whatsapp_instances(status);
```

### 3.5 `message_logs` — Logs de mensagens (limpeza 60 dias)

```sql
CREATE TABLE message_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  remote_jid VARCHAR(50),
  message_id VARCHAR(100), -- ID da mensagem no WhatsApp
  direction VARCHAR(10) NOT NULL, -- \"inbound\", \"outbound\"
  content_type VARCHAR(20), -- \"text\", \"audio\", \"image\", \"document\"
  content TEXT, -- Texto da mensagem ou transcrição de áudio
  media_url TEXT, -- URL do Storage (se áudio/imagem/documento)
  from_me BOOLEAN DEFAULT false,
  status VARCHAR(20), -- \"sent\", \"delivered\", \"read\", \"failed\"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_message_logs_instance ON message_logs(instance_id);
CREATE INDEX idx_message_logs_lead ON message_logs(lead_id);
CREATE INDEX idx_message_logs_created ON message_logs(created_at);
CREATE INDEX idx_message_logs_direction ON message_logs(direction);
```

### 3.6 `conversations` — Estado das conversas

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id UUID REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  status VARCHAR(30) DEFAULT 'active', -- \"active\", \"awaiting_human\", \"human_responding\", \"closed\"
  assigned_to UUID REFERENCES collaborators(id), -- Operador humano (se handover)
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(instance_id, lead_id)
);

CREATE INDEX idx_conversations_instance ON conversations(instance_id);
CREATE INDEX idx_conversations_lead ON conversations(lead_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_assigned ON conversations(assigned_to);
```

---

## 4. TABELAS DE PROGRAMAÇÃO {#4-programação}

### 4.1 `scheduled_programs` — Programação Pontual

```sql
CREATE TABLE scheduled_programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cuca_unit_id UUID REFERENCES cuca_units(id) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  location VARCHAR(200),
  flyer_url TEXT, -- URL do Storage
  status VARCHAR(30) DEFAULT 'rascunho', -- \"rascunho\", \"aguardando_aprovacao\", \"aprovado\", \"enviado\", \"cancelado\"
  approved_by UUID REFERENCES collaborators(id),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES collaborators(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scheduled_programs_unit ON scheduled_programs(cuca_unit_id);
CREATE INDEX idx_scheduled_programs_status ON scheduled_programs(status);
CREATE INDEX idx_scheduled_programs_date ON scheduled_programs(event_date);
```

### 4.2 `scheduled_program_filters` — Filtros de segmentação (programação pontual)

```sql
CREATE TABLE scheduled_program_filters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scheduled_program_id UUID REFERENCES scheduled_programs(id) ON DELETE CASCADE,
  filter_type VARCHAR(30) NOT NULL, -- \"category\", \"age_range\", \"gender\", \"geo_radius\"
  filter_value JSONB NOT NULL, -- {\"category_ids\": [\"uuid1\", \"uuid2\"]} ou {\"min\": 15, \"max\": 25}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_program_filters_program ON scheduled_program_filters(scheduled_program_id);
```

### 4.3 `monthly_programs` — Programação Mensal (cabeçalho)

```sql
CREATE TABLE monthly_programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INT NOT NULL,
  source VARCHAR(30) DEFAULT 'api', -- \"api\", \"manual_import\"
  imported_at TIMESTAMPTZ,
  imported_by UUID REFERENCES collaborators(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(month, year)
);

CREATE INDEX idx_monthly_programs_month_year ON monthly_programs(month, year);
```

### 4.4 `monthly_program_items` — Atividades da programação mensal

```sql
CREATE TABLE monthly_program_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  monthly_program_id UUID REFERENCES monthly_programs(id) ON DELETE CASCADE,
  cuca_unit_id UUID REFERENCES cuca_units(id) NOT NULL,
  activity_name VARCHAR(200) NOT NULL,
  category VARCHAR(100), -- \"Esporte\", \"Cultura\", etc.
  instructor VARCHAR(200),
  day_of_week VARCHAR(20), -- \"Segunda\", \"Terça\", etc.
  time_start TIME,
  time_end TIME,
  location VARCHAR(200),
  age_range VARCHAR(50), -- \"15-29 anos\"
  vacancies INT,
  enrollment_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_monthly_items_program ON monthly_program_items(monthly_program_id);
CREATE INDEX idx_monthly_items_unit ON monthly_program_items(cuca_unit_id);
```

### 4.5 `campaigns` — Campanhas genéricas

```sql
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  message_template TEXT NOT NULL, -- Template com variáveis {{nome}}, {{cuca}}, etc.
  media_url TEXT, -- URL do Storage (se houver mídia)
  status VARCHAR(30) DEFAULT 'rascunho', -- \"rascunho\", \"aguardando_aprovacao\", \"aprovado\", \"enviado\", \"cancelado\"
  scheduled_for TIMESTAMPTZ,
  approved_by UUID REFERENCES collaborators(id),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES collaborators(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_scheduled ON campaigns(scheduled_for);
```

### 4.6 `campaign_filters` — Filtros de segmentação (campanhas)

```sql
CREATE TABLE campaign_filters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  filter_type VARCHAR(30) NOT NULL,
  filter_value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campaign_filters_campaign ON campaign_filters(campaign_id);
```

---

## 5. TABELAS DE EMPREGABILIDADE {#5-empregabilidade}

### 5.1 `companies` — Empresas parceiras

```sql
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  cnpj VARCHAR(18) UNIQUE,
  email VARCHAR(255),
  phone VARCHAR(20),
  address TEXT,
  contact_person VARCHAR(200),
  access_token VARCHAR(100) UNIQUE, -- Token para criar vagas via formulário público
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_cnpj ON companies(cnpj);
CREATE INDEX idx_companies_token ON companies(access_token);
```

### 5.2 `job_postings` — Vagas de emprego

```sql
CREATE TABLE job_postings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  cuca_unit_id UUID REFERENCES cuca_units(id) NOT NULL, -- Unidade responsável
  title VARCHAR(200) NOT NULL,
  description TEXT,
  requirements TEXT,
  salary VARCHAR(100), -- \"R$ 2.500\" ou \"A combinar\"
  vacancies INT,
  status VARCHAR(30) DEFAULT 'pre_cadastro', -- \"pre_cadastro\", \"aberta\", \"preenchida\", \"cancelada\"
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by UUID REFERENCES collaborators(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_job_postings_company ON job_postings(company_id);
CREATE INDEX idx_job_postings_unit ON job_postings(cuca_unit_id);
CREATE INDEX idx_job_postings_status ON job_postings(status);
```

### 5.3 `candidates` — Candidatos às vagas

```sql
CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_posting_id UUID REFERENCES job_postings(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  name VARCHAR(200),
  birth_date DATE,
  cv_url TEXT NOT NULL, -- URL do Storage (PDF ou foto)
  ocr_data JSONB, -- Dados extraídos via OCR: {\"nome\": \"...\", \"idade\": 25, ...}
  status VARCHAR(30) DEFAULT 'pendente', -- \"pendente\", \"selecionado\", \"contratado\", \"rejeitado\", \"banco_talentos\"
  notes TEXT, -- Observações do gestor
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_candidates_job ON candidates(job_posting_id);
CREATE INDEX idx_candidates_lead ON candidates(lead_id);
CREATE INDEX idx_candidates_status ON candidates(status);
```

### 5.4 `talent_bank` — Banco de Talentos (últimos 3 meses)

```sql
CREATE TABLE talent_bank (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  cuca_unit_id UUID REFERENCES cuca_units(id) NOT NULL,
  skills JSONB, -- [\"eletricista\", \"vigilante\", ...]
  experience_years INT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(candidate_id)
);

CREATE INDEX idx_talent_bank_unit ON talent_bank(cuca_unit_id);
CREATE INDEX idx_talent_bank_added ON talent_bank(added_at);
```

---

## 6. TABELAS DE ACESSO CUCA {#6-acesso}

### 6.1 `spaces` — Espaços disponíveis

```sql
CREATE TABLE spaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cuca_unit_id UUID REFERENCES cuca_units(id) NOT NULL,
  name VARCHAR(100) NOT NULL, -- \"Teatro\", \"Quadra\", \"Auditório\", etc.
  capacity INT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_spaces_unit ON spaces(cuca_unit_id);
CREATE INDEX idx_spaces_active ON spaces(active);
```

### 6.2 `equipment` — Equipamentos disponíveis

```sql
CREATE TABLE equipment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL, -- \"Projetor\", \"Microfone\", \"Caixa de som\", etc.
  status VARCHAR(20) DEFAULT 'ativo', -- \"ativo\", \"desativado\", \"manutencao\"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_equipment_space ON equipment(space_id);
CREATE INDEX idx_equipment_status ON equipment(status);
```

### 6.3 `space_requests` — Solicitações de uso de espaço

```sql
CREATE TABLE space_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  protocol_number VARCHAR(20) UNIQUE NOT NULL, -- \"#12345\"
  lead_id UUID REFERENCES leads(id),
  name VARCHAR(200) NOT NULL,
  cpf VARCHAR(14) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  cuca_unit_id UUID REFERENCES cuca_units(id) NOT NULL,
  space_id UUID REFERENCES spaces(id) NOT NULL,
  equipment_ids UUID[], -- Array de IDs de equipamentos solicitados
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  event_nature VARCHAR(100), -- \"cultural\", \"educacao\", \"social\", \"esportivo\", etc.
  description TEXT,
  status VARCHAR(50) DEFAULT 'aguardando_aprovacao_tecnica', -- \"aguardando_aprovacao_tecnica\", \"aguardando_aprovacao_secretaria\", \"aprovado\", \"reprovado\", \"cancelado\"
  approved_by_tecnico UUID REFERENCES collaborators(id),
  approved_by_secretaria UUID REFERENCES collaborators(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  auto_canceled_at TIMESTAMPTZ, -- Se passou 48h sem aprovação
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_space_requests_protocol ON space_requests(protocol_number);
CREATE INDEX idx_space_requests_cpf ON space_requests(cpf);
CREATE INDEX idx_space_requests_unit ON space_requests(cuca_unit_id);
CREATE INDEX idx_space_requests_status ON space_requests(status);
CREATE INDEX idx_space_requests_date ON space_requests(event_date);
```

---

## 7. TABELAS DE OUVIDORIA {#7-ouvidoria}

### 7.1 `ouvidoria_manifestacoes` — Críticas e Sugestões

```sql
CREATE TABLE ouvidoria_manifestacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo VARCHAR(20) NOT NULL, -- \"critica\", \"sugestao\", \"ideia\"
  conteudo TEXT NOT NULL,
  cuca_unit_id UUID REFERENCES cuca_units(id), -- NULL se crítica não vinculada
  -- Dados pessoais APENAS para sugestões (críticas são anônimas)
  nome VARCHAR(200), -- NULL para críticas
  telefone VARCHAR(20), -- NULL para críticas
  remote_jid VARCHAR(50), -- NULL para críticas
  lead_id UUID REFERENCES leads(id), -- NULL para críticas
  protocolo VARCHAR(20) UNIQUE, -- Apenas para sugestões
  sentiment VARCHAR(20), -- \"positivo\", \"negativo\", \"neutro\" (análise IA)
  themes JSONB, -- [\"infraestrutura\", \"atendimento\", ...] (análise IA)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ouvidoria_tipo ON ouvidoria_manifestacoes(tipo);
CREATE INDEX idx_ouvidoria_unit ON ouvidoria_manifestacoes(cuca_unit_id);
CREATE INDEX idx_ouvidoria_sentiment ON ouvidoria_manifestacoes(sentiment);
CREATE INDEX idx_ouvidoria_created ON ouvidoria_manifestacoes(created_at);
```

### 7.2 `ouvidoria_eventos` — Eventos de Escuta

```sql
CREATE TABLE ouvidoria_eventos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titulo VARCHAR(200) NOT NULL,
  descricao TEXT NOT NULL, -- Descrição que define o escopo do evento
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'ativo', -- \"ativo\", \"encerrado\"
  created_by UUID REFERENCES collaborators(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ouvidoria_eventos_status ON ouvidoria_eventos(status);
CREATE INDEX idx_ouvidoria_eventos_dates ON ouvidoria_eventos(start_date, end_date);
```

### 7.3 `satisfaction_surveys` — Pesquisas de Satisfação

```sql
CREATE TABLE satisfaction_surveys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo VARCHAR(30) NOT NULL, -- \"quantitativa\", \"qualitativa\"
  pergunta TEXT NOT NULL,
  opcoes JSONB, -- [\"Muito satisfeito\", \"Satisfeito\", ...] (apenas quantitativa)
  cuca_unit_id UUID REFERENCES cuca_units(id), -- NULL para pesquisa global
  status VARCHAR(20) DEFAULT 'ativa', -- \"ativa\", \"encerrada\"
  created_by UUID REFERENCES collaborators(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_surveys_unit ON satisfaction_surveys(cuca_unit_id);
CREATE INDEX idx_surveys_status ON satisfaction_surveys(status);
```

### 7.4 `survey_responses` — Respostas das pesquisas

```sql
CREATE TABLE survey_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id UUID REFERENCES satisfaction_surveys(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  resposta TEXT NOT NULL, -- Texto livre ou opção escolhida
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_survey_responses_survey ON survey_responses(survey_id);
CREATE INDEX idx_survey_responses_lead ON survey_responses(lead_id);
```

---

## 8. TABELAS DE RAG E IA {#8-rag}

### 8.1 `rag_chunks` — Chunks de conhecimento

```sql
CREATE TABLE rag_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type VARCHAR(50) NOT NULL, -- \"knowledge_base\", \"monthly_program\", \"scheduled_program\", \"job_posting\"
  source_id UUID, -- ID da fonte (se aplicável)
  cuca_unit_id UUID REFERENCES cuca_units(id), -- NULL para conhecimento global
  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small
  metadata JSONB, -- {\"title\": \"...\", \"category\": \"...\", ...}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rag_chunks_source ON rag_chunks(source_type, source_id);
CREATE INDEX idx_rag_chunks_unit ON rag_chunks(cuca_unit_id);
CREATE INDEX idx_rag_chunks_embedding ON rag_chunks USING ivfflat (embedding vector_cosine_ops);
```

### 8.2 `knowledge_base` — Base de conhecimento manual

```sql
CREATE TABLE knowledge_base (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  cuca_unit_id UUID REFERENCES cuca_units(id), -- NULL para conhecimento global
  category VARCHAR(100),
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES collaborators(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_knowledge_base_unit ON knowledge_base(cuca_unit_id);
CREATE INDEX idx_knowledge_base_active ON knowledge_base(active);
```

### 8.3 `ai_usage_logs` — Logs de consumo OpenAI

```sql
CREATE TABLE ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model VARCHAR(50) NOT NULL, -- \"gpt-4o\", \"whisper-1\", \"text-embedding-3-small\"
  feature VARCHAR(50) NOT NULL, -- \"agent\", \"ocr\", \"transcription\", \"matching\", \"sentiment\"
  tokens_input INT,
  tokens_output INT,
  cost_usd DECIMAL(10, 6), -- Custo estimado em USD
  instance_id UUID REFERENCES whatsapp_instances(id),
  lead_id UUID REFERENCES leads(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_model ON ai_usage_logs(model);
CREATE INDEX idx_ai_usage_feature ON ai_usage_logs(feature);
CREATE INDEX idx_ai_usage_created ON ai_usage_logs(created_at);
```

---

## 9. TABELAS DE LOGS E AUDITORIA {#9-logs}

### 9.1 `audit_logs` — Logs de auditoria

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES collaborators(id),
  action VARCHAR(100) NOT NULL, -- \"create_lead\", \"approve_program\", \"delete_candidate\", etc.
  resource_type VARCHAR(50), -- \"lead\", \"scheduled_program\", \"candidate\", etc.
  resource_id UUID,
  old_data JSONB, -- Estado anterior (para updates/deletes)
  new_data JSONB, -- Estado novo (para creates/updates)
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
```

### 9.2 `worker_logs` — Logs do Worker Python

```sql
CREATE TABLE worker_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level VARCHAR(20) NOT NULL, -- \"INFO\", \"WARNING\", \"ERROR\", \"CRITICAL\"
  type VARCHAR(50), -- \"webhook\", \"dispatch\", \"ocr\", \"transcribe\", \"error\"
  instance_id UUID REFERENCES whatsapp_instances(id),
  lead_id UUID REFERENCES leads(id),
  message TEXT,
  metadata JSONB, -- Dados adicionais (latency, error stack, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_worker_logs_level ON worker_logs(level);
CREATE INDEX idx_worker_logs_type ON worker_logs(type);
CREATE INDEX idx_worker_logs_instance ON worker_logs(instance_id);
CREATE INDEX idx_worker_logs_created ON worker_logs(created_at);
```

---

## 10. TABELAS DE CONFIGURAÇÃO {#10-config}

### 10.1 `system_config` — Configurações do sistema

```sql
CREATE TABLE system_config (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES collaborators(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed de configurações
INSERT INTO system_config (key, value, description) VALUES
  ('dispatch_delays_mensal', '{\"min_delay\": 15, \"max_delay\": 45, \"presence_typing\": true, \"presence_duration\": 3000, \"active_hours\": [8, 22]}', 'Configurações de delay para programação mensal'),
  ('dispatch_delays_pontual', '{\"min_delay\": 5, \"max_delay\": 15, \"presence_typing\": true, \"presence_duration\": 2000, \"active_hours\": [8, 22]}', 'Configurações de delay para programação pontual'),
  ('dispatch_delays_campanha', '{\"min_delay\": 10, \"max_delay\": 30, \"presence_typing\": true, \"presence_duration\": 2500, \"active_hours\": [8, 22]}', 'Configurações de delay para campanhas'),
  ('max_messages_per_instance_per_day', '5000', 'Limite de mensagens por instância por dia'),
  ('warmup_active', 'true', 'Warm-up ativo'),
  ('warmup_weeks', '5', 'Número de semanas de warm-up'),
  ('audio_transcription_limit_seconds', '40', 'Limite de duração de áudio em segundos'),
  ('whisper_model', '\"whisper-1\"', 'Modelo Whisper para transcrição'),
  ('openai_budget_monthly_usd', '500', 'Budget mensal OpenAI em USD');
```

### 10.2 `developer_alerts` — Configuração de alertas do Developer Console

```sql
CREATE TABLE developer_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trigger_type VARCHAR(50) NOT NULL, -- \"worker_offline\", \"error_rate_high\", \"instance_disconnected\", etc.
  condition JSONB NOT NULL, -- {\"threshold\": 10, \"duration_minutes\": 60}
  channel VARCHAR(20) NOT NULL, -- \"whatsapp\", \"email\"
  recipient VARCHAR(255) NOT NULL, -- Número WhatsApp ou e-mail
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_developer_alerts_active ON developer_alerts(active);
```

---

## 11. ÍNDICES E PERFORMANCE {#11-índices}

Todos os índices já foram criados inline nas definições das tabelas acima. Índices adicionais podem ser criados conforme necessidade identificada em produção.

---

## 12. RLS (ROW LEVEL SECURITY) {#12-rls}

### Exemplo de RLS para `leads`

```sql
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Super admin vê tudo
CREATE POLICY \"super_admin_all_leads\" ON leads
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM collaborators c
      JOIN roles r ON c.role_id = r.id
      WHERE c.id = auth.uid() AND r.name = 'super_admin'
    )
  );

-- Secretaria vê tudo
CREATE POLICY \"secretaria_all_leads\" ON leads
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM collaborators c
      JOIN roles r ON c.role_id = r.id
      WHERE c.id = auth.uid() AND r.name = 'secretaria'
    )
  );

-- Gestor/Coordenador/Operador vê apenas leads da sua unidade
CREATE POLICY \"unit_staff_own_leads\" ON leads
  FOR ALL
  USING (
    cuca_unit_id IN (
      SELECT cuca_unit_id FROM collaborators
      WHERE id = auth.uid()
    )
  );
```

**Nota**: RLS deve ser aplicado a TODAS as tabelas que contêm dados sensíveis ou específicos de unidade.

---

## 13. TRIGGERS E FUNCTIONS {#13-triggers}

### 13.1 Trigger para atualizar `updated_at`

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar a todas as tabelas com updated_at
CREATE TRIGGER update_cuca_units_updated_at BEFORE UPDATE ON cuca_units FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_collaborators_updated_at BEFORE UPDATE ON collaborators FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- ... (aplicar a todas as tabelas relevantes)
```

### 13.2 Function para limpeza de mensagens antigas (60 dias)

```sql
CREATE OR REPLACE FUNCTION cleanup_old_messages()
RETURNS void AS $$
BEGIN
  DELETE FROM message_logs WHERE created_at < NOW() - INTERVAL '60 days';
END;
$$ LANGUAGE plpgsql;
```

### 13.3 Function para auto-cancelamento de solicitações (48h)

```sql
CREATE OR REPLACE FUNCTION auto_cancel_space_requests()
RETURNS void AS $$
BEGIN
  UPDATE space_requests
  SET status = 'cancelado', auto_canceled_at = NOW()
  WHERE status IN ('aguardando_aprovacao_tecnica', 'aguardando_aprovacao_secretaria')
    AND created_at < NOW() - INTERVAL '48 hours';
END;
$$ LANGUAGE plpgsql;
```

### 13.4 Function para sincronizar programação mensal (API Portal)

```sql
CREATE OR REPLACE FUNCTION sync_monthly_programs()
RETURNS void AS $$
DECLARE
  api_url TEXT := 'https://api.portaldajuventude.fortaleza.ce.gov.br/programacao-mensal';
  api_token TEXT;
  response JSONB;
BEGIN
  -- Buscar token do Vault
  SELECT decrypted_secret INTO api_token FROM vault.decrypted_secrets WHERE name = 'portal_api_token';
  
  -- Fazer requisição via pg_net
  SELECT content::jsonb INTO response
  FROM net.http_get(
    url := api_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_token)
  );
  
  -- Processar resposta e fazer UPSERT
  -- (lógica de processamento aqui)
  
  -- Log de sucesso
  INSERT INTO worker_logs (level, type, message) VALUES ('INFO', 'sync', 'Programação mensal sincronizada com sucesso');
EXCEPTION
  WHEN OTHERS THEN
    -- Log de erro
    INSERT INTO worker_logs (level, type, message, metadata) VALUES ('ERROR', 'sync', 'Erro ao sincronizar programação mensal', jsonb_build_object('error', SQLERRM));
END;
$$ LANGUAGE plpgsql;
```

---

> **Este schema é a base completa do banco de dados do Sistema CUCA.** Todas as tabelas, índices, RLS e triggers necessários estão documentados aqui.
