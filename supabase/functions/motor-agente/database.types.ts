export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ae_conversas: {
        Row: {
          ae_instancia_id: string
          created_at: string
          estado: string | null
          id: string
          lead_id: string | null
          metadata: Json | null
          nao_lidas: number
          push_name: string | null
          status: string | null
          ultima_entrada_em: string | null
          ultima_mensagem_em: string | null
          updated_at: string
          wa_contact: string
        }
        Insert: {
          ae_instancia_id: string
          created_at?: string
          estado?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          nao_lidas?: number
          push_name?: string | null
          status?: string | null
          ultima_entrada_em?: string | null
          ultima_mensagem_em?: string | null
          updated_at?: string
          wa_contact: string
        }
        Update: {
          ae_instancia_id?: string
          created_at?: string
          estado?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          nao_lidas?: number
          push_name?: string | null
          status?: string | null
          ultima_entrada_em?: string | null
          ultima_mensagem_em?: string | null
          updated_at?: string
          wa_contact?: string
        }
        Relationships: [
          {
            foreignKeyName: "ae_conversas_ae_instancia_id_fkey"
            columns: ["ae_instancia_id"]
            isOneToOne: false
            referencedRelation: "ae_instancias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ae_conversas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      ae_instancias: {
        Row: {
          ativa: boolean
          created_at: string
          display_name: string | null
          forward_secret: string | null
          id: string
          instancia_nome: string | null
          messaging_limit_tier: string | null
          pending_reason: string | null
          phone_number: string | null
          phone_number_id: string | null
          quality_rating: string | null
          slug: string | null
          status: string | null
          updated_at: string
          waba_id: string | null
          workspace_id: string
        }
        Insert: {
          ativa?: boolean
          created_at?: string
          display_name?: string | null
          forward_secret?: string | null
          id?: string
          instancia_nome?: string | null
          messaging_limit_tier?: string | null
          pending_reason?: string | null
          phone_number?: string | null
          phone_number_id?: string | null
          quality_rating?: string | null
          slug?: string | null
          status?: string | null
          updated_at?: string
          waba_id?: string | null
          workspace_id: string
        }
        Update: {
          ativa?: boolean
          created_at?: string
          display_name?: string | null
          forward_secret?: string | null
          id?: string
          instancia_nome?: string | null
          messaging_limit_tier?: string | null
          pending_reason?: string | null
          phone_number?: string | null
          phone_number_id?: string | null
          quality_rating?: string | null
          slug?: string | null
          status?: string | null
          updated_at?: string
          waba_id?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      ae_mensagens: {
        Row: {
          ae_conversa_id: string
          conteudo: string | null
          created_at: string
          id: string
          metadata: Json | null
          midia_url: string | null
          remetente: string
          status: string | null
          tipo: string
          wa_message_id: string | null
        }
        Insert: {
          ae_conversa_id: string
          conteudo?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          midia_url?: string | null
          remetente: string
          status?: string | null
          tipo?: string
          wa_message_id?: string | null
        }
        Update: {
          ae_conversa_id?: string
          conteudo?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          midia_url?: string | null
          remetente?: string
          status?: string | null
          tipo?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ae_mensagens_ae_conversa_id_fkey"
            columns: ["ae_conversa_id"]
            isOneToOne: false
            referencedRelation: "ae_conversas"
            referencedColumns: ["id"]
          },
        ]
      }
      ae_presencas: {
        Row: {
          created_at: string
          data_encontro: string
          id: string
          lead_id: string | null
          nome: string | null
          presente: boolean
          telefone: string
          unidade_cuca: string | null
        }
        Insert: {
          created_at?: string
          data_encontro: string
          id?: string
          lead_id?: string | null
          nome?: string | null
          presente?: boolean
          telefone: string
          unidade_cuca?: string | null
        }
        Update: {
          created_at?: string
          data_encontro?: string
          id?: string
          lead_id?: string | null
          nome?: string | null
          presente?: boolean
          telefone?: string
          unidade_cuca?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ae_presencas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      ae_webhook_capturas: {
        Row: {
          corpo: string | null
          headers: Json | null
          id: string
          metodo: string | null
          received_at: string
          url: string | null
        }
        Insert: {
          corpo?: string | null
          headers?: Json | null
          id?: string
          metodo?: string | null
          received_at?: string
          url?: string | null
        }
        Update: {
          corpo?: string | null
          headers?: Json | null
          id?: string
          metodo?: string | null
          received_at?: string
          url?: string | null
        }
        Relationships: []
      }
      ai_usage_logs: {
        Row: {
          agente_tipo: string | null
          conversa_id: string | null
          created_at: string | null
          custo_estimado_usd: number | null
          feature: string
          id: string
          instancia_uazapi: string | null
          modelo: string
          tokens_completion: number
          tokens_prompt: number
          tokens_total: number | null
        }
        Insert: {
          agente_tipo?: string | null
          conversa_id?: string | null
          created_at?: string | null
          custo_estimado_usd?: number | null
          feature?: string
          id?: string
          instancia_uazapi?: string | null
          modelo?: string
          tokens_completion?: number
          tokens_prompt?: number
          tokens_total?: number | null
        }
        Update: {
          agente_tipo?: string | null
          conversa_id?: string | null
          created_at?: string | null
          custo_estimado_usd?: number | null
          feature?: string
          id?: string
          instancia_uazapi?: string | null
          modelo?: string
          tokens_completion?: number
          tokens_prompt?: number
          tokens_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_logs_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
        ]
      }
      atividades_mensais: {
        Row: {
          campanha_id: string | null
          categoria: string | null
          created_at: string | null
          data_atividade: string
          descricao: string | null
          hora_fim: string | null
          hora_inicio: string | null
          id: string
          local: string | null
          metadata: Json | null
          titulo: string
          unidade_cuca: string
        }
        Insert: {
          campanha_id?: string | null
          categoria?: string | null
          created_at?: string | null
          data_atividade: string
          descricao?: string | null
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          local?: string | null
          metadata?: Json | null
          titulo: string
          unidade_cuca: string
        }
        Update: {
          campanha_id?: string | null
          categoria?: string | null
          created_at?: string | null
          data_atividade?: string
          descricao?: string | null
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          local?: string | null
          metadata?: Json | null
          titulo?: string
          unidade_cuca?: string
        }
        Relationships: [
          {
            foreignKeyName: "atividades_mensais_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_mensais"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          acao: string
          created_at: string | null
          dados_antigos: Json | null
          dados_novos: Json | null
          id: string
          registro_id: string | null
          tabela: string
          usuario_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string | null
          dados_antigos?: Json | null
          dados_novos?: Json | null
          id?: string
          registro_id?: string | null
          tabela: string
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string | null
          dados_antigos?: Json | null
          dados_novos?: Json | null
          id?: string
          registro_id?: string | null
          tabela?: string
          usuario_id?: string | null
        }
        Relationships: []
      }
      auditoria: {
        Row: {
          acao: string
          colaborador_id: string | null
          created_at: string | null
          detalhes: Json | null
          id: string
          ip_address: unknown
          recurso: string
          recurso_id: string | null
          user_agent: string | null
        }
        Insert: {
          acao: string
          colaborador_id?: string | null
          created_at?: string | null
          detalhes?: Json | null
          id?: string
          ip_address?: unknown
          recurso: string
          recurso_id?: string | null
          user_agent?: string | null
        }
        Update: {
          acao?: string
          colaborador_id?: string | null
          created_at?: string | null
          detalhes?: Json | null
          id?: string
          ip_address?: unknown
          recurso?: string
          recurso_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auditoria_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      banco_talentos: {
        Row: {
          area_interesse: string[] | null
          arquivo_cv_url: string | null
          candidatura_original_id: string | null
          created_at: string | null
          data_nascimento: string
          id: string
          nome: string
          skills_jsonb: Json | null
          status: string | null
          telefone: string
        }
        Insert: {
          area_interesse?: string[] | null
          arquivo_cv_url?: string | null
          candidatura_original_id?: string | null
          created_at?: string | null
          data_nascimento: string
          id?: string
          nome: string
          skills_jsonb?: Json | null
          status?: string | null
          telefone: string
        }
        Update: {
          area_interesse?: string[] | null
          arquivo_cv_url?: string | null
          candidatura_original_id?: string | null
          created_at?: string | null
          data_nascimento?: string
          id?: string
          nome?: string
          skills_jsonb?: Json | null
          status?: string | null
          telefone?: string
        }
        Relationships: [
          {
            foreignKeyName: "banco_talentos_candidatura_original_id_fkey"
            columns: ["candidatura_original_id"]
            isOneToOne: false
            referencedRelation: "candidaturas"
            referencedColumns: ["id"]
          },
        ]
      }
      campanhas_mensais: {
        Row: {
          ano: number
          arquivo_excel_url: string | null
          created_at: string | null
          created_by: string | null
          descricao: string | null
          disparo_id: string | null
          id: string
          instancia_id: string | null
          mes: number
          status: string | null
          titulo: string
          total_atividades: number | null
          unidade_cuca: string | null
          updated_at: string | null
        }
        Insert: {
          ano: number
          arquivo_excel_url?: string | null
          created_at?: string | null
          created_by?: string | null
          descricao?: string | null
          disparo_id?: string | null
          id?: string
          instancia_id?: string | null
          mes: number
          status?: string | null
          titulo: string
          total_atividades?: number | null
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Update: {
          ano?: number
          arquivo_excel_url?: string | null
          created_at?: string | null
          created_by?: string | null
          descricao?: string | null
          disparo_id?: string | null
          id?: string
          instancia_id?: string | null
          mes?: number
          status?: string | null
          titulo?: string
          total_atividades?: number | null
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanhas_mensais_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_mensais_disparo_id_fkey"
            columns: ["disparo_id"]
            isOneToOne: false
            referencedRelation: "disparos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_mensais_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "instancias_uazapi"
            referencedColumns: ["id"]
          },
        ]
      }
      candidatos: {
        Row: {
          areas_interesse: string[] | null
          ativo: boolean | null
          cpf: string | null
          created_at: string | null
          cv_embedding: string | null
          cv_texto: string | null
          cv_url: string | null
          data_nascimento: string | null
          disponibilidade: string | null
          email: string | null
          endereco: string | null
          escolaridade: string | null
          experiencias: string | null
          habilidades: string[] | null
          id: string
          lead_id: string | null
          nome: string
          pretensao_salarial: string | null
          telefone: string
          updated_at: string | null
        }
        Insert: {
          areas_interesse?: string[] | null
          ativo?: boolean | null
          cpf?: string | null
          created_at?: string | null
          cv_embedding?: string | null
          cv_texto?: string | null
          cv_url?: string | null
          data_nascimento?: string | null
          disponibilidade?: string | null
          email?: string | null
          endereco?: string | null
          escolaridade?: string | null
          experiencias?: string | null
          habilidades?: string[] | null
          id?: string
          lead_id?: string | null
          nome: string
          pretensao_salarial?: string | null
          telefone: string
          updated_at?: string | null
        }
        Update: {
          areas_interesse?: string[] | null
          ativo?: boolean | null
          cpf?: string | null
          created_at?: string | null
          cv_embedding?: string | null
          cv_texto?: string | null
          cv_url?: string | null
          data_nascimento?: string | null
          disponibilidade?: string | null
          email?: string | null
          endereco?: string | null
          escolaridade?: string | null
          experiencias?: string | null
          habilidades?: string[] | null
          id?: string
          lead_id?: string | null
          nome?: string
          pretensao_salarial?: string | null
          telefone?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidatos_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      candidaturas: {
        Row: {
          area_interesse: string[] | null
          arquivo_cv_url: string | null
          bairro: string | null
          candidato_id: string | null
          cargo_escolhido: string | null
          confirmacao_presenca: string | null
          created_at: string | null
          dados_ocr_json: Json | null
          data_entrevista: string | null
          data_nascimento: string | null
          email_enviado_em: string | null
          email_enviado_para: string | null
          escolaridade_normalizada: string | null
          experiencia_meses: number | null
          genero: string | null
          hora_entrevista: string | null
          id: string
          local_entrevista: string | null
          match_score: number | null
          matching_justificativa: string | null
          matching_score: number | null
          nome: string | null
          observacoes: string | null
          pcd: boolean | null
          pcd_candidato: boolean | null
          pcd_tipo: string | null
          pcd_tipo_candidato: string | null
          primeiro_emprego: boolean | null
          requisitos_atendidos: string | null
          status: string | null
          telefone: string | null
          unidade_atendimento_id: string | null
          unidade_cuca: string | null
          updated_at: string | null
          vaga_id: string | null
        }
        Insert: {
          area_interesse?: string[] | null
          arquivo_cv_url?: string | null
          bairro?: string | null
          candidato_id?: string | null
          cargo_escolhido?: string | null
          confirmacao_presenca?: string | null
          created_at?: string | null
          dados_ocr_json?: Json | null
          data_entrevista?: string | null
          data_nascimento?: string | null
          email_enviado_em?: string | null
          email_enviado_para?: string | null
          escolaridade_normalizada?: string | null
          experiencia_meses?: number | null
          genero?: string | null
          hora_entrevista?: string | null
          id?: string
          local_entrevista?: string | null
          match_score?: number | null
          matching_justificativa?: string | null
          matching_score?: number | null
          nome?: string | null
          observacoes?: string | null
          pcd?: boolean | null
          pcd_candidato?: boolean | null
          pcd_tipo?: string | null
          pcd_tipo_candidato?: string | null
          primeiro_emprego?: boolean | null
          requisitos_atendidos?: string | null
          status?: string | null
          telefone?: string | null
          unidade_atendimento_id?: string | null
          unidade_cuca?: string | null
          updated_at?: string | null
          vaga_id?: string | null
        }
        Update: {
          area_interesse?: string[] | null
          arquivo_cv_url?: string | null
          bairro?: string | null
          candidato_id?: string | null
          cargo_escolhido?: string | null
          confirmacao_presenca?: string | null
          created_at?: string | null
          dados_ocr_json?: Json | null
          data_entrevista?: string | null
          data_nascimento?: string | null
          email_enviado_em?: string | null
          email_enviado_para?: string | null
          escolaridade_normalizada?: string | null
          experiencia_meses?: number | null
          genero?: string | null
          hora_entrevista?: string | null
          id?: string
          local_entrevista?: string | null
          match_score?: number | null
          matching_justificativa?: string | null
          matching_score?: number | null
          nome?: string | null
          observacoes?: string | null
          pcd?: boolean | null
          pcd_candidato?: boolean | null
          pcd_tipo?: string | null
          pcd_tipo_candidato?: string | null
          primeiro_emprego?: boolean | null
          requisitos_atendidos?: string | null
          status?: string | null
          telefone?: string | null
          unidade_atendimento_id?: string | null
          unidade_cuca?: string | null
          updated_at?: string | null
          vaga_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidaturas_candidato_id_fkey"
            columns: ["candidato_id"]
            isOneToOne: false
            referencedRelation: "candidatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidaturas_vaga_id_fkey"
            columns: ["vaga_id"]
            isOneToOne: false
            referencedRelation: "vagas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidaturas_vaga_id_fkey"
            columns: ["vaga_id"]
            isOneToOne: false
            referencedRelation: "vagas_abertas_todas_cucas"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_feedback: {
        Row: {
          ativo: boolean
          cor: string | null
          created_at: string | null
          descricao: string | null
          id: string
          nome: string
        }
        Insert: {
          ativo?: boolean
          cor?: string | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome: string
        }
        Update: {
          ativo?: boolean
          cor?: string | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      categorias_interesse: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          icone: string | null
          id: string
          nome: string
          ordem: number | null
          pai_id: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          icone?: string | null
          id?: string
          nome: string
          ordem?: number | null
          pai_id?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          icone?: string | null
          id?: string
          nome?: string
          ordem?: number | null
          pai_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categorias_interesse_pai_id_fkey"
            columns: ["pai_id"]
            isOneToOne: false
            referencedRelation: "categorias_interesse"
            referencedColumns: ["id"]
          },
        ]
      }
      chunks_documentos: {
        Row: {
          chunk_index: number
          conteudo: string
          created_at: string | null
          documento_id: string | null
          embedding: string | null
          id: string
          metadados: Json | null
        }
        Insert: {
          chunk_index: number
          conteudo: string
          created_at?: string | null
          documento_id?: string | null
          embedding?: string | null
          id?: string
          metadados?: Json | null
        }
        Update: {
          chunk_index?: number
          conteudo?: string
          created_at?: string | null
          documento_id?: string | null
          embedding?: string | null
          id?: string
          metadados?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chunks_documentos_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_rag"
            referencedColumns: ["id"]
          },
        ]
      }
      colaboradores: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          email: string
          funcao_id: string | null
          id: string
          nome_completo: string
          role_id: string | null
          setup_token: string | null
          setup_token_expires_at: string | null
          telefone: string | null
          unidade_cuca: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          email: string
          funcao_id?: string | null
          id?: string
          nome_completo: string
          role_id?: string | null
          setup_token?: string | null
          setup_token_expires_at?: string | null
          telefone?: string | null
          unidade_cuca?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          email?: string
          funcao_id?: string | null
          id?: string
          nome_completo?: string
          role_id?: string | null
          setup_token?: string | null
          setup_token_expires_at?: string | null
          telefone?: string | null
          unidade_cuca?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "colaboradores_funcao_id_fkey"
            columns: ["funcao_id"]
            isOneToOne: false
            referencedRelation: "funcoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "colaboradores_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "sys_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      coletas_mensais: {
        Row: {
          ano: number
          created_at: string | null
          erro: string | null
          executado_em: string | null
          id: string
          mes: number
          status: string | null
          total_registros: number | null
        }
        Insert: {
          ano: number
          created_at?: string | null
          erro?: string | null
          executado_em?: string | null
          id?: string
          mes: number
          status?: string | null
          total_registros?: number | null
        }
        Update: {
          ano?: number
          created_at?: string | null
          erro?: string | null
          executado_em?: string | null
          id?: string
          mes?: number
          status?: string | null
          total_registros?: number | null
        }
        Relationships: []
      }
      configuracoes: {
        Row: {
          chave: string
          created_at: string | null
          descricao: string | null
          id: string
          updated_at: string | null
          updated_by: string | null
          valor: Json
        }
        Insert: {
          chave: string
          created_at?: string | null
          descricao?: string | null
          id?: string
          updated_at?: string | null
          updated_by?: string | null
          valor: Json
        }
        Update: {
          chave?: string
          created_at?: string | null
          descricao?: string | null
          id?: string
          updated_at?: string | null
          updated_by?: string | null
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "configuracoes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      conversas: {
        Row: {
          agente_tipo: string
          canal_ativo: string
          created_at: string | null
          estado: string | null
          id: string
          lead_id: string | null
          metadata: Json | null
          nao_lidas: number
          origem_id: string
          status: string | null
          ultima_mensagem_em: string | null
          updated_at: string | null
        }
        Insert: {
          agente_tipo: string
          canal_ativo?: string
          created_at?: string | null
          estado?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          nao_lidas?: number
          origem_id: string
          status?: string | null
          ultima_mensagem_em?: string | null
          updated_at?: string | null
        }
        Update: {
          agente_tipo?: string
          canal_ativo?: string
          created_at?: string | null
          estado?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          nao_lidas?: number
          origem_id?: string
          status?: string | null
          ultima_mensagem_em?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      curriculos: {
        Row: {
          created_at: string
          dados: Json
          deleted_at: string | null
          id: string
          talent_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dados?: Json
          deleted_at?: string | null
          id?: string
          talent_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dados?: Json
          deleted_at?: string | null
          id?: string
          talent_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curriculos_talent_id_fkey"
            columns: ["talent_id"]
            isOneToOne: false
            referencedRelation: "talent_bank"
            referencedColumns: ["id"]
          },
        ]
      }
      disparos: {
        Row: {
          agendado_para: string | null
          campanha_mensal_id: string | null
          concluido_em: string | null
          created_at: string | null
          created_by: string | null
          evento_id: string | null
          id: string
          iniciado_em: string | null
          instancia_uazapi: string
          mensagem_template: string
          midia_url: string | null
          segmentacao_id: string | null
          status: string | null
          tipo: string
          total_destinatarios: number | null
          total_enviados: number | null
          total_erros: number | null
        }
        Insert: {
          agendado_para?: string | null
          campanha_mensal_id?: string | null
          concluido_em?: string | null
          created_at?: string | null
          created_by?: string | null
          evento_id?: string | null
          id?: string
          iniciado_em?: string | null
          instancia_uazapi: string
          mensagem_template: string
          midia_url?: string | null
          segmentacao_id?: string | null
          status?: string | null
          tipo: string
          total_destinatarios?: number | null
          total_enviados?: number | null
          total_erros?: number | null
        }
        Update: {
          agendado_para?: string | null
          campanha_mensal_id?: string | null
          concluido_em?: string | null
          created_at?: string | null
          created_by?: string | null
          evento_id?: string | null
          id?: string
          iniciado_em?: string | null
          instancia_uazapi?: string
          mensagem_template?: string
          midia_url?: string | null
          segmentacao_id?: string | null
          status?: string | null
          tipo?: string
          total_destinatarios?: number | null
          total_enviados?: number | null
          total_erros?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "disparos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disparos_segmentacao_id_fkey"
            columns: ["segmentacao_id"]
            isOneToOne: false
            referencedRelation: "segmentacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      disparos_divulgacao: {
        Row: {
          ano: number
          created_at: string | null
          criado_por: string | null
          id: string
          instancia_uazapi: string | null
          mensagem_template: string
          mes: number
          metricas_json: Json | null
          status: string
          titulo: string | null
          total_enviados: number | null
          total_erros: number | null
          total_leads: number | null
          total_stop: number | null
          updated_at: string | null
        }
        Insert: {
          ano: number
          created_at?: string | null
          criado_por?: string | null
          id?: string
          instancia_uazapi?: string | null
          mensagem_template: string
          mes: number
          metricas_json?: Json | null
          status?: string
          titulo?: string | null
          total_enviados?: number | null
          total_erros?: number | null
          total_leads?: number | null
          total_stop?: number | null
          updated_at?: string | null
        }
        Update: {
          ano?: number
          created_at?: string | null
          criado_por?: string | null
          id?: string
          instancia_uazapi?: string | null
          mensagem_template?: string
          mes?: number
          metricas_json?: Json | null
          status?: string
          titulo?: string | null
          total_enviados?: number | null
          total_erros?: number | null
          total_leads?: number | null
          total_stop?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      documentos_rag: {
        Row: {
          ativo: boolean | null
          conteudo: string
          created_at: string | null
          created_by: string | null
          id: string
          metadados: Json | null
          tipo: string
          titulo: string
          unidade_cuca: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          conteudo: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          metadados?: Json | null
          tipo: string
          titulo: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          conteudo?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          metadados?: Json | null
          tipo?: string
          titulo?: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_rag_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      empregabilidade_followup: {
        Row: {
          candidatura_id: string
          created_at: string
          enviado_por: string | null
          id: string
          mensagem: string
          status: string
          tipo: string
        }
        Insert: {
          candidatura_id: string
          created_at?: string
          enviado_por?: string | null
          id?: string
          mensagem: string
          status?: string
          tipo: string
        }
        Update: {
          candidatura_id?: string
          created_at?: string
          enviado_por?: string | null
          id?: string
          mensagem?: string
          status?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "empregabilidade_followup_candidatura_id_fkey"
            columns: ["candidatura_id"]
            isOneToOne: false
            referencedRelation: "candidaturas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          ativa: boolean | null
          cnpj: string | null
          contato_responsavel: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          endereco: string | null
          id: string
          nome: string
          nome_fantasia: string | null
          porte: string | null
          setor: string | null
          telefone: string | null
          updated_at: string | null
        }
        Insert: {
          ativa?: boolean | null
          cnpj?: string | null
          contato_responsavel?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          nome: string
          nome_fantasia?: string | null
          porte?: string | null
          setor?: string | null
          telefone?: string | null
          updated_at?: string | null
        }
        Update: {
          ativa?: boolean | null
          cnpj?: string | null
          contato_responsavel?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          nome?: string
          nome_fantasia?: string | null
          porte?: string | null
          setor?: string | null
          telefone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empresas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamentos_cuca: {
        Row: {
          created_at: string | null
          descricao: string | null
          espaco_id: string
          id: string
          nome: string
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          espaco_id: string
          id?: string
          nome: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          espaco_id?: string
          id?: string
          nome?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipamentos_cuca_espaco_id_fkey"
            columns: ["espaco_id"]
            isOneToOne: false
            referencedRelation: "espacos_cuca"
            referencedColumns: ["id"]
          },
        ]
      }
      equipamentos_disponiveis: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          descricao: string | null
          id: string
          nome: string
          quantidade: number | null
          unidade_cuca: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome: string
          quantidade?: number | null
          unidade_cuca: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          quantidade?: number | null
          unidade_cuca?: string
        }
        Relationships: []
      }
      espacos_cuca: {
        Row: {
          capacidade: number | null
          created_at: string | null
          descricao: string | null
          id: string
          nome: string
          status: string
          unidade_cuca: string
          updated_at: string | null
        }
        Insert: {
          capacidade?: number | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome: string
          status?: string
          unidade_cuca: string
          updated_at?: string | null
        }
        Update: {
          capacidade?: number | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          status?: string
          unidade_cuca?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      espacos_disponiveis: {
        Row: {
          ativo: boolean | null
          capacidade: number | null
          created_at: string | null
          descricao: string | null
          id: string
          nome: string
          unidade_cuca: string
        }
        Insert: {
          ativo?: boolean | null
          capacidade?: number | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome: string
          unidade_cuca: string
        }
        Update: {
          ativo?: boolean | null
          capacidade?: number | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          unidade_cuca?: string
        }
        Relationships: []
      }
      eventos_escuta: {
        Row: {
          created_at: string | null
          created_by: string | null
          data_evento: string
          descricao: string | null
          hora_fim: string | null
          hora_inicio: string | null
          id: string
          local: string | null
          titulo: string
          total_feedbacks: number | null
          total_participantes: number | null
          unidade_cuca: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          data_evento: string
          descricao?: string | null
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          local?: string | null
          titulo: string
          total_feedbacks?: number | null
          total_participantes?: number | null
          unidade_cuca: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          data_evento?: string
          descricao?: string | null
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          local?: string | null
          titulo?: string
          total_feedbacks?: number | null
          total_participantes?: number | null
          unidade_cuca?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eventos_escuta_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos_pontuais: {
        Row: {
          capacidade: number | null
          categorias_alvo: Json | null
          created_at: string | null
          created_by: string | null
          data_evento: string
          data_fim: string | null
          data_inicio: string | null
          descricao: string | null
          disparo_id: string | null
          expansiva: boolean | null
          flyer_url: string | null
          hora_fim: string | null
          hora_inicio: string | null
          id: string
          instancia_id: string | null
          local: string | null
          segmentacao_id: string | null
          status: string | null
          titulo: string
          unidade_cuca: string | null
          updated_at: string | null
        }
        Insert: {
          capacidade?: number | null
          categorias_alvo?: Json | null
          created_at?: string | null
          created_by?: string | null
          data_evento: string
          data_fim?: string | null
          data_inicio?: string | null
          descricao?: string | null
          disparo_id?: string | null
          expansiva?: boolean | null
          flyer_url?: string | null
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          instancia_id?: string | null
          local?: string | null
          segmentacao_id?: string | null
          status?: string | null
          titulo: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Update: {
          capacidade?: number | null
          categorias_alvo?: Json | null
          created_at?: string | null
          created_by?: string | null
          data_evento?: string
          data_fim?: string | null
          data_inicio?: string | null
          descricao?: string | null
          disparo_id?: string | null
          expansiva?: boolean | null
          flyer_url?: string | null
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          instancia_id?: string | null
          local?: string | null
          segmentacao_id?: string | null
          status?: string | null
          titulo?: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eventos_pontuais_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_pontuais_disparo_id_fkey"
            columns: ["disparo_id"]
            isOneToOne: false
            referencedRelation: "disparos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_pontuais_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "instancias_uazapi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_pontuais_segmentacao_id_fkey"
            columns: ["segmentacao_id"]
            isOneToOne: false
            referencedRelation: "segmentacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      feedbacks: {
        Row: {
          anonimo: boolean | null
          categoria: string | null
          created_at: string | null
          id: string
          lead_id: string | null
          mensagem: string
          respondido_em: string | null
          respondido_por: string | null
          resposta: string | null
          sentimento: string | null
          sentimento_score: number | null
          status: string | null
          tipo: string
          unidade_cuca: string | null
        }
        Insert: {
          anonimo?: boolean | null
          categoria?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string | null
          mensagem: string
          respondido_em?: string | null
          respondido_por?: string | null
          resposta?: string | null
          sentimento?: string | null
          sentimento_score?: number | null
          status?: string | null
          tipo: string
          unidade_cuca?: string | null
        }
        Update: {
          anonimo?: boolean | null
          categoria?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string | null
          mensagem?: string
          respondido_em?: string | null
          respondido_por?: string | null
          resposta?: string | null
          sentimento?: string | null
          sentimento_score?: number | null
          status?: string | null
          tipo?: string
          unidade_cuca?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedbacks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedbacks_respondido_por_fkey"
            columns: ["respondido_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      funcoes: {
        Row: {
          created_at: string | null
          descricao: string | null
          id: string
          nivel_acesso: number
          nome: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          id?: string
          nivel_acesso: number
          nome: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          id?: string
          nivel_acesso?: number
          nome?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      funcoes_permissoes: {
        Row: {
          created_at: string | null
          funcao_id: string
          permissao_id: string
        }
        Insert: {
          created_at?: string | null
          funcao_id: string
          permissao_id: string
        }
        Update: {
          created_at?: string | null
          funcao_id?: string
          permissao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funcoes_permissoes_funcao_id_fkey"
            columns: ["funcao_id"]
            isOneToOne: false
            referencedRelation: "funcoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funcoes_permissoes_permissao_id_fkey"
            columns: ["permissao_id"]
            isOneToOne: false
            referencedRelation: "permissoes"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_opt_in: {
        Row: {
          canal: string | null
          created_at: string | null
          id: string
          lead_id: string
          motivo: string
          operador_id: string | null
          opt_in: boolean
        }
        Insert: {
          canal?: string | null
          created_at?: string | null
          id?: string
          lead_id: string
          motivo?: string
          operador_id?: string | null
          opt_in: boolean
        }
        Update: {
          canal?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string
          motivo?: string
          operador_id?: string | null
          opt_in?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "historico_opt_in_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      human_handover_contacts: {
        Row: {
          ativo: boolean | null
          created_at: string
          id: string
          modulo: string
          nome_responsavel: string | null
          telefone_destino: string
          unidade_cuca: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string
          id?: string
          modulo: string
          nome_responsavel?: string | null
          telefone_destino: string
          unidade_cuca?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string
          id?: string
          modulo?: string
          nome_responsavel?: string | null
          telefone_destino?: string
          unidade_cuca?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inscricoes_eventos: {
        Row: {
          confirmado: boolean | null
          created_at: string | null
          email: string | null
          evento_id: string | null
          id: string
          lead_id: string | null
          nome: string
          presente: boolean | null
          telefone: string
        }
        Insert: {
          confirmado?: boolean | null
          created_at?: string | null
          email?: string | null
          evento_id?: string | null
          id?: string
          lead_id?: string | null
          nome: string
          presente?: boolean | null
          telefone: string
        }
        Update: {
          confirmado?: boolean | null
          created_at?: string | null
          email?: string | null
          evento_id?: string | null
          id?: string
          lead_id?: string | null
          nome?: string
          presente?: boolean | null
          telefone?: string
        }
        Relationships: [
          {
            foreignKeyName: "inscricoes_eventos_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "eventos_pontuais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inscricoes_eventos_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      instancias_uazapi: {
        Row: {
          agente_tipo: string
          ativa: boolean | null
          ban_detectado_em: string | null
          ban_motivo: string | null
          canal_tipo: string | null
          created_at: string | null
          id: string
          nome: string
          observacoes: string | null
          reserva: boolean | null
          telefone: string | null
          token: string
          unidade_cuca: string | null
          updated_at: string | null
          warmup_started_at: string | null
          webhook_url: string | null
        }
        Insert: {
          agente_tipo: string
          ativa?: boolean | null
          ban_detectado_em?: string | null
          ban_motivo?: string | null
          canal_tipo?: string | null
          created_at?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          reserva?: boolean | null
          telefone?: string | null
          token: string
          unidade_cuca?: string | null
          updated_at?: string | null
          warmup_started_at?: string | null
          webhook_url?: string | null
        }
        Update: {
          agente_tipo?: string
          ativa?: boolean | null
          ban_detectado_em?: string | null
          ban_motivo?: string | null
          canal_tipo?: string | null
          created_at?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          reserva?: boolean | null
          telefone?: string | null
          token?: string
          unidade_cuca?: string | null
          updated_at?: string | null
          warmup_started_at?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      lead_atividades: {
        Row: {
          atividade: string
          contagem: number
          created_at: string | null
          equipamento: string
          id: string
          lead_id: string
        }
        Insert: {
          atividade: string
          contagem?: number
          created_at?: string | null
          equipamento: string
          id?: string
          lead_id: string
        }
        Update: {
          atividade?: string
          contagem?: number
          created_at?: string | null
          equipamento?: string
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_atividades_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_interesses: {
        Row: {
          categoria_id: string
          created_at: string | null
          id: string
          lead_id: string
        }
        Insert: {
          categoria_id: string
          created_at?: string | null
          id?: string
          lead_id: string
        }
        Update: {
          categoria_id?: string
          created_at?: string | null
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_interesses_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_interesse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_interesses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          atividades_principais: string[] | null
          bloqueado: boolean | null
          created_at: string | null
          data_nascimento: string | null
          email: string | null
          equipamentos_principais: string[] | null
          excluido: boolean
          id: string
          motivo_bloqueio: string | null
          nome: string | null
          opt_in: boolean | null
          origem: string | null
          tags: string[] | null
          telefone: string
          unidade_cuca: string | null
          updated_at: string | null
        }
        Insert: {
          atividades_principais?: string[] | null
          bloqueado?: boolean | null
          created_at?: string | null
          data_nascimento?: string | null
          email?: string | null
          equipamentos_principais?: string[] | null
          excluido?: boolean
          id?: string
          motivo_bloqueio?: string | null
          nome?: string | null
          opt_in?: boolean | null
          origem?: string | null
          tags?: string[] | null
          telefone: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Update: {
          atividades_principais?: string[] | null
          bloqueado?: boolean | null
          created_at?: string | null
          data_nascimento?: string | null
          email?: string | null
          equipamentos_principais?: string[] | null
          excluido?: boolean
          id?: string
          motivo_bloqueio?: string | null
          nome?: string | null
          opt_in?: boolean | null
          origem?: string | null
          tags?: string[] | null
          telefone?: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      logs_disparo: {
        Row: {
          created_at: string | null
          disparo_id: string | null
          enviado_em: string | null
          erro: string | null
          id: string
          lead_id: string | null
          status: string
          telefone: string
        }
        Insert: {
          created_at?: string | null
          disparo_id?: string | null
          enviado_em?: string | null
          erro?: string | null
          id?: string
          lead_id?: string | null
          status: string
          telefone: string
        }
        Update: {
          created_at?: string | null
          disparo_id?: string | null
          enviado_em?: string | null
          erro?: string | null
          id?: string
          lead_id?: string | null
          status?: string
          telefone?: string
        }
        Relationships: [
          {
            foreignKeyName: "logs_disparo_disparo_id_fkey"
            columns: ["disparo_id"]
            isOneToOne: false
            referencedRelation: "disparos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_disparo_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      logs_webhook: {
        Row: {
          created_at: string | null
          erro: string | null
          id: string
          instancia_uazapi: string
          payload: Json
          processado: boolean | null
          tipo_evento: string
        }
        Insert: {
          created_at?: string | null
          erro?: string | null
          id?: string
          instancia_uazapi: string
          payload: Json
          processado?: boolean | null
          tipo_evento: string
        }
        Update: {
          created_at?: string | null
          erro?: string | null
          id?: string
          instancia_uazapi?: string
          payload?: Json
          processado?: boolean | null
          tipo_evento?: string
        }
        Relationships: []
      }
      mensagens: {
        Row: {
          conteudo: string | null
          conversa_id: string | null
          created_at: string | null
          id: string
          lead_id: string | null
          midia_url: string | null
          remetente: string
          sentimento: string | null
          sentimento_score: number | null
          tipo: string
          transcricao: string | null
          wamid: string | null
        }
        Insert: {
          conteudo?: string | null
          conversa_id?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string | null
          midia_url?: string | null
          remetente: string
          sentimento?: string | null
          sentimento_score?: number | null
          tipo: string
          transcricao?: string | null
          wamid?: string | null
        }
        Update: {
          conteudo?: string | null
          conversa_id?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string | null
          midia_url?: string | null
          remetente?: string
          sentimento?: string | null
          sentimento_score?: number | null
          tipo?: string
          transcricao?: string | null
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_phone_numbers: {
        Row: {
          agente_tipo: string
          ativo: boolean
          canal_tipo: string
          created_at: string
          display_name: string | null
          phone_number_id: string
          unidade_cuca: string | null
          updated_at: string
          waba_id: string
        }
        Insert: {
          agente_tipo: string
          ativo?: boolean
          canal_tipo: string
          created_at?: string
          display_name?: string | null
          phone_number_id: string
          unidade_cuca?: string | null
          updated_at?: string
          waba_id: string
        }
        Update: {
          agente_tipo?: string
          ativo?: boolean
          canal_tipo?: string
          created_at?: string
          display_name?: string | null
          phone_number_id?: string
          unidade_cuca?: string | null
          updated_at?: string
          waba_id?: string
        }
        Relationships: []
      }
      meta_templates: {
        Row: {
          ativo: boolean | null
          automacoes: string[] | null
          categoria: string | null
          corpo_texto: string | null
          corpo_texto_aprovado: string | null
          created_at: string | null
          id: string
          nome: string
          observacoes: string | null
          parameter_format: string
          phone_number_ids: string[] | null
          status: string | null
          updated_at: string | null
          variaveis: Json | null
          waba_ids: string[] | null
        }
        Insert: {
          ativo?: boolean | null
          automacoes?: string[] | null
          categoria?: string | null
          corpo_texto?: string | null
          corpo_texto_aprovado?: string | null
          created_at?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          parameter_format?: string
          phone_number_ids?: string[] | null
          status?: string | null
          updated_at?: string | null
          variaveis?: Json | null
          waba_ids?: string[] | null
        }
        Update: {
          ativo?: boolean | null
          automacoes?: string[] | null
          categoria?: string | null
          corpo_texto?: string | null
          corpo_texto_aprovado?: string | null
          created_at?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          parameter_format?: string
          phone_number_ids?: string[] | null
          status?: string | null
          updated_at?: string | null
          variaveis?: Json | null
          waba_ids?: string[] | null
        }
        Relationships: []
      }
      metricas_openai: {
        Row: {
          agente_tipo: string
          created_at: string | null
          custo_estimado: number | null
          id: string
          latencia_ms: number | null
          modelo: string
          tokens_completion: number
          tokens_prompt: number
          tokens_total: number
        }
        Insert: {
          agente_tipo: string
          created_at?: string | null
          custo_estimado?: number | null
          id?: string
          latencia_ms?: number | null
          modelo: string
          tokens_completion: number
          tokens_prompt: number
          tokens_total: number
        }
        Update: {
          agente_tipo?: string
          created_at?: string | null
          custo_estimado?: number | null
          id?: string
          latencia_ms?: number | null
          modelo?: string
          tokens_completion?: number
          tokens_prompt?: number
          tokens_total?: number
        }
        Relationships: []
      }
      ouvidoria_eventos: {
        Row: {
          categorias_alvo: Json | null
          created_at: string | null
          data_fim: string | null
          data_inicio: string | null
          descricao: string | null
          disparo_id: string | null
          id: string
          segmentacao_tags: string[] | null
          status: string | null
          titulo: string
          unidade_cuca: string | null
          updated_at: string | null
        }
        Insert: {
          categorias_alvo?: Json | null
          created_at?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          descricao?: string | null
          disparo_id?: string | null
          id?: string
          segmentacao_tags?: string[] | null
          status?: string | null
          titulo: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Update: {
          categorias_alvo?: Json | null
          created_at?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          descricao?: string | null
          disparo_id?: string | null
          id?: string
          segmentacao_tags?: string[] | null
          status?: string | null
          titulo?: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ouvidoria_registros: {
        Row: {
          anonimo: boolean
          created_at: string | null
          evento_id: string | null
          id: string
          lead_id: string | null
          nome_solicitante: string | null
          protocolo: string | null
          resumo_ia: string | null
          sentimento: string | null
          telefone_solicitante: string | null
          temas_identificados: string[] | null
          texto_manifestacao: string
          tipo: string
          unidade_cuca: string | null
          updated_at: string | null
        }
        Insert: {
          anonimo?: boolean
          created_at?: string | null
          evento_id?: string | null
          id?: string
          lead_id?: string | null
          nome_solicitante?: string | null
          protocolo?: string | null
          resumo_ia?: string | null
          sentimento?: string | null
          telefone_solicitante?: string | null
          temas_identificados?: string[] | null
          texto_manifestacao: string
          tipo: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Update: {
          anonimo?: boolean
          created_at?: string | null
          evento_id?: string | null
          id?: string
          lead_id?: string | null
          nome_solicitante?: string | null
          protocolo?: string | null
          resumo_ia?: string | null
          sentimento?: string | null
          telefone_solicitante?: string | null
          temas_identificados?: string[] | null
          texto_manifestacao?: string
          tipo?: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ouvidoria_registros_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "ouvidoria_eventos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ouvidoria_registros_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      participacoes_escuta: {
        Row: {
          created_at: string | null
          evento_id: string | null
          feedback_id: string | null
          id: string
          lead_id: string | null
          nome: string | null
          presente: boolean | null
          telefone: string | null
        }
        Insert: {
          created_at?: string | null
          evento_id?: string | null
          feedback_id?: string | null
          id?: string
          lead_id?: string | null
          nome?: string | null
          presente?: boolean | null
          telefone?: string | null
        }
        Update: {
          created_at?: string | null
          evento_id?: string | null
          feedback_id?: string | null
          id?: string
          lead_id?: string | null
          nome?: string | null
          presente?: boolean | null
          telefone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participacoes_escuta_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "eventos_escuta"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participacoes_escuta_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedbacks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participacoes_escuta_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      permissoes: {
        Row: {
          acao: string
          created_at: string | null
          descricao: string | null
          id: string
          recurso: string
        }
        Insert: {
          acao: string
          created_at?: string | null
          descricao?: string | null
          id?: string
          recurso: string
        }
        Update: {
          acao?: string
          created_at?: string | null
          descricao?: string | null
          id?: string
          recurso?: string
        }
        Relationships: []
      }
      prompts_agentes: {
        Row: {
          agente_tipo: string
          ativo: boolean | null
          created_at: string | null
          created_by: string | null
          id: string
          max_tokens: number | null
          menu_boas_vindas: string | null
          nome: string
          prompt_contexto: string | null
          prompt_sistema: string
          temperatura: number | null
          updated_at: string | null
          versao: number | null
        }
        Insert: {
          agente_tipo: string
          ativo?: boolean | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          max_tokens?: number | null
          menu_boas_vindas?: string | null
          nome: string
          prompt_contexto?: string | null
          prompt_sistema: string
          temperatura?: number | null
          updated_at?: string | null
          versao?: number | null
        }
        Update: {
          agente_tipo?: string
          ativo?: boolean | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          max_tokens?: number | null
          menu_boas_vindas?: string | null
          nome?: string
          prompt_contexto?: string | null
          prompt_sistema?: string
          temperatura?: number | null
          updated_at?: string | null
          versao?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "prompts_agentes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      registros_sige: {
        Row: {
          atividade: string | null
          coleta_id: string | null
          created_at: string | null
          dados_brutos: Json | null
          data_atividade: string | null
          email: string | null
          id: string
          nome: string
          telefone: string | null
          unidade_cuca: string | null
        }
        Insert: {
          atividade?: string | null
          coleta_id?: string | null
          created_at?: string | null
          dados_brutos?: Json | null
          data_atividade?: string | null
          email?: string | null
          id?: string
          nome: string
          telefone?: string | null
          unidade_cuca?: string | null
        }
        Update: {
          atividade?: string | null
          coleta_id?: string | null
          created_at?: string | null
          dados_brutos?: Json | null
          data_atividade?: string | null
          email?: string | null
          id?: string
          nome?: string
          telefone?: string | null
          unidade_cuca?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registros_sige_coleta_id_fkey"
            columns: ["coleta_id"]
            isOneToOne: false
            referencedRelation: "coletas_mensais"
            referencedColumns: ["id"]
          },
        ]
      }
      segmentacoes: {
        Row: {
          created_at: string | null
          created_by: string | null
          descricao: string | null
          filtros: Json
          id: string
          nome: string
          total_leads: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          descricao?: string | null
          filtros: Json
          id?: string
          nome: string
          total_leads?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          descricao?: string | null
          filtros?: Json
          id?: string
          nome?: string
          total_leads?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "segmentacoes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitacoes_acesso: {
        Row: {
          aprovacao_1_em: string | null
          aprovacao_1_observacoes: string | null
          aprovacao_1_por: string | null
          aprovacao_2_em: string | null
          aprovacao_2_observacoes: string | null
          aprovacao_2_por: string | null
          aprovado_em: string | null
          aprovado_n1_em: string | null
          aprovado_n1_por: string | null
          aprovado_n2_em: string | null
          aprovado_n2_por: string | null
          cancelar_em: string | null
          cpf_solicitante: string | null
          created_at: string | null
          data_evento: string
          descricao_evento: string
          email: string | null
          equipamentos_solicitados: string[] | null
          espaco_id: string | null
          espacos_solicitados: string[]
          hora_fim: string
          hora_inicio: string
          horario_fim: string | null
          horario_inicio: string | null
          id: string
          lead_id: string | null
          motivo_rejeicao: string | null
          natureza_evento: string | null
          nome_solicitante: string
          numero_participantes: number | null
          observacao_n1: string | null
          observacao_n2: string | null
          observacoes: string | null
          protocolo: string | null
          remote_jid: string | null
          status: string | null
          telefone: string
          tipo_evento: string
          unidade_cuca: string | null
          updated_at: string | null
        }
        Insert: {
          aprovacao_1_em?: string | null
          aprovacao_1_observacoes?: string | null
          aprovacao_1_por?: string | null
          aprovacao_2_em?: string | null
          aprovacao_2_observacoes?: string | null
          aprovacao_2_por?: string | null
          aprovado_em?: string | null
          aprovado_n1_em?: string | null
          aprovado_n1_por?: string | null
          aprovado_n2_em?: string | null
          aprovado_n2_por?: string | null
          cancelar_em?: string | null
          cpf_solicitante?: string | null
          created_at?: string | null
          data_evento: string
          descricao_evento: string
          email?: string | null
          equipamentos_solicitados?: string[] | null
          espaco_id?: string | null
          espacos_solicitados: string[]
          hora_fim: string
          hora_inicio: string
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: string
          lead_id?: string | null
          motivo_rejeicao?: string | null
          natureza_evento?: string | null
          nome_solicitante: string
          numero_participantes?: number | null
          observacao_n1?: string | null
          observacao_n2?: string | null
          observacoes?: string | null
          protocolo?: string | null
          remote_jid?: string | null
          status?: string | null
          telefone: string
          tipo_evento: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Update: {
          aprovacao_1_em?: string | null
          aprovacao_1_observacoes?: string | null
          aprovacao_1_por?: string | null
          aprovacao_2_em?: string | null
          aprovacao_2_observacoes?: string | null
          aprovacao_2_por?: string | null
          aprovado_em?: string | null
          aprovado_n1_em?: string | null
          aprovado_n1_por?: string | null
          aprovado_n2_em?: string | null
          aprovado_n2_por?: string | null
          cancelar_em?: string | null
          cpf_solicitante?: string | null
          created_at?: string | null
          data_evento?: string
          descricao_evento?: string
          email?: string | null
          equipamentos_solicitados?: string[] | null
          espaco_id?: string | null
          espacos_solicitados?: string[]
          hora_fim?: string
          hora_inicio?: string
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: string
          lead_id?: string | null
          motivo_rejeicao?: string | null
          natureza_evento?: string | null
          nome_solicitante?: string
          numero_participantes?: number | null
          observacao_n1?: string | null
          observacao_n2?: string | null
          observacoes?: string | null
          protocolo?: string | null
          remote_jid?: string | null
          status?: string | null
          telefone?: string
          tipo_evento?: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "solicitacoes_acesso_aprovacao_1_por_fkey"
            columns: ["aprovacao_1_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_acesso_aprovacao_2_por_fkey"
            columns: ["aprovacao_2_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_acesso_espaco_id_fkey"
            columns: ["espaco_id"]
            isOneToOne: false
            referencedRelation: "espacos_cuca"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_acesso_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      sys_permissions: {
        Row: {
          can_create: boolean | null
          can_delete: boolean | null
          can_read: boolean | null
          can_update: boolean | null
          created_at: string | null
          id: string
          module: string
          role_id: string
          updated_at: string | null
        }
        Insert: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_read?: boolean | null
          can_update?: boolean | null
          created_at?: string | null
          id?: string
          module: string
          role_id: string
          updated_at?: string | null
        }
        Update: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_read?: boolean | null
          can_update?: boolean | null
          created_at?: string | null
          id?: string
          module?: string
          role_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sys_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "sys_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      sys_roles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          unidade_cuca: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      system_config: {
        Row: {
          chave: string
          descricao: string | null
          updated_at: string | null
          valor: string
        }
        Insert: {
          chave: string
          descricao?: string | null
          updated_at?: string | null
          valor: string
        }
        Update: {
          chave?: string
          descricao?: string | null
          updated_at?: string | null
          valor?: string
        }
        Relationships: []
      }
      talent_bank: {
        Row: {
          area_interesse: string[] | null
          arquivo_cv_url: string | null
          bairro: string | null
          candidatura_origem_id: string | null
          created_at: string
          curriculo_estruturado: Json | null
          data_curriculo: string | null
          data_nascimento: string | null
          escolaridade_normalizada: string | null
          experiencia_meses: number | null
          genero: string | null
          id: string
          nome: string
          pcd: boolean | null
          pcd_candidato: boolean | null
          pcd_tipo: string | null
          pcd_tipo_candidato: string | null
          primeiro_emprego: boolean | null
          skills_jsonb: Json | null
          status: string | null
          telefone: string | null
          updated_at: string
          vaga_origem_id: string | null
        }
        Insert: {
          area_interesse?: string[] | null
          arquivo_cv_url?: string | null
          bairro?: string | null
          candidatura_origem_id?: string | null
          created_at?: string
          curriculo_estruturado?: Json | null
          data_curriculo?: string | null
          data_nascimento?: string | null
          escolaridade_normalizada?: string | null
          experiencia_meses?: number | null
          genero?: string | null
          id?: string
          nome: string
          pcd?: boolean | null
          pcd_candidato?: boolean | null
          pcd_tipo?: string | null
          pcd_tipo_candidato?: string | null
          primeiro_emprego?: boolean | null
          skills_jsonb?: Json | null
          status?: string | null
          telefone?: string | null
          updated_at?: string
          vaga_origem_id?: string | null
        }
        Update: {
          area_interesse?: string[] | null
          arquivo_cv_url?: string | null
          bairro?: string | null
          candidatura_origem_id?: string | null
          created_at?: string
          curriculo_estruturado?: Json | null
          data_curriculo?: string | null
          data_nascimento?: string | null
          escolaridade_normalizada?: string | null
          experiencia_meses?: number | null
          genero?: string | null
          id?: string
          nome?: string
          pcd?: boolean | null
          pcd_candidato?: boolean | null
          pcd_tipo?: string | null
          pcd_tipo_candidato?: string | null
          primeiro_emprego?: boolean | null
          skills_jsonb?: Json | null
          status?: string | null
          telefone?: string | null
          updated_at?: string
          vaga_origem_id?: string | null
        }
        Relationships: []
      }
      transbordo_humano: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          id: string
          modulo: string
          responsavel: string
          telefone: string
          unidade_cuca: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          modulo: string
          responsavel: string
          telefone: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          modulo?: string
          responsavel?: string
          telefone?: string
          unidade_cuca?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      unidades_cuca: {
        Row: {
          ativo: boolean
          bairro: string | null
          created_at: string | null
          email: string | null
          endereco: string | null
          id: string
          latitude: number | null
          longitude: number | null
          nome: string
          responsavel: string | null
          slug: string
          telefone: string | null
          territorio: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean
          bairro?: string | null
          created_at?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          nome: string
          responsavel?: string | null
          slug: string
          telefone?: string | null
          territorio?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean
          bairro?: string | null
          created_at?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          nome?: string
          responsavel?: string | null
          slug?: string
          telefone?: string | null
          territorio?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      vagas: {
        Row: {
          beneficios: string | null
          carga_horaria: string | null
          cargos_lista: Json | null
          created_at: string | null
          created_by: string | null
          data_abertura: string | null
          data_fechamento: string | null
          datas_selecao: Json | null
          descricao: string
          disparo_id: string | null
          email_contato_empresa: string | null
          email_responsavel: string | null
          empresa_id: string | null
          endereco_entrevista: string | null
          escolaridade_minima: string | null
          expansiva: boolean | null
          faixa_etaria: string | null
          historico_alteracoes: Json | null
          id: string
          limite_curriculos: number | null
          local: string | null
          local_entrevista: string | null
          numero_vaga: number | null
          pcd_homologado: boolean | null
          pcd_tipo: string | null
          pcd_vaga: boolean | null
          requisitos: string | null
          salario: string | null
          setor: string[] | null
          status: string | null
          telefone_responsavel: string | null
          tipo: string
          tipo_contrato: string | null
          tipo_local_entrevista: string | null
          tipo_selecao: string | null
          titulo: string
          total_vagas: number | null
          unidade_cuca: string | null
          unidade_destino: string | null
          updated_at: string | null
        }
        Insert: {
          beneficios?: string | null
          carga_horaria?: string | null
          cargos_lista?: Json | null
          created_at?: string | null
          created_by?: string | null
          data_abertura?: string | null
          data_fechamento?: string | null
          datas_selecao?: Json | null
          descricao: string
          disparo_id?: string | null
          email_contato_empresa?: string | null
          email_responsavel?: string | null
          empresa_id?: string | null
          endereco_entrevista?: string | null
          escolaridade_minima?: string | null
          expansiva?: boolean | null
          faixa_etaria?: string | null
          historico_alteracoes?: Json | null
          id?: string
          limite_curriculos?: number | null
          local?: string | null
          local_entrevista?: string | null
          numero_vaga?: number | null
          pcd_homologado?: boolean | null
          pcd_tipo?: string | null
          pcd_vaga?: boolean | null
          requisitos?: string | null
          salario?: string | null
          setor?: string[] | null
          status?: string | null
          telefone_responsavel?: string | null
          tipo?: string
          tipo_contrato?: string | null
          tipo_local_entrevista?: string | null
          tipo_selecao?: string | null
          titulo: string
          total_vagas?: number | null
          unidade_cuca?: string | null
          unidade_destino?: string | null
          updated_at?: string | null
        }
        Update: {
          beneficios?: string | null
          carga_horaria?: string | null
          cargos_lista?: Json | null
          created_at?: string | null
          created_by?: string | null
          data_abertura?: string | null
          data_fechamento?: string | null
          datas_selecao?: Json | null
          descricao?: string
          disparo_id?: string | null
          email_contato_empresa?: string | null
          email_responsavel?: string | null
          empresa_id?: string | null
          endereco_entrevista?: string | null
          escolaridade_minima?: string | null
          expansiva?: boolean | null
          faixa_etaria?: string | null
          historico_alteracoes?: Json | null
          id?: string
          limite_curriculos?: number | null
          local?: string | null
          local_entrevista?: string | null
          numero_vaga?: number | null
          pcd_homologado?: boolean | null
          pcd_tipo?: string | null
          pcd_vaga?: boolean | null
          requisitos?: string | null
          salario?: string | null
          setor?: string[] | null
          status?: string | null
          telefone_responsavel?: string | null
          tipo?: string
          tipo_contrato?: string | null
          tipo_local_entrevista?: string | null
          tipo_selecao?: string | null
          titulo?: string
          total_vagas?: number | null
          unidade_cuca?: string | null
          unidade_destino?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vagas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vagas_disparo_id_fkey"
            columns: ["disparo_id"]
            isOneToOne: false
            referencedRelation: "disparos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vagas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vagas_feedback_tokens: {
        Row: {
          created_at: string | null
          cuca_unit_id: string | null
          expires_at: string
          id: string
          token: string
          used: boolean | null
          vaga_id: string | null
        }
        Insert: {
          created_at?: string | null
          cuca_unit_id?: string | null
          expires_at: string
          id?: string
          token: string
          used?: boolean | null
          vaga_id?: string | null
        }
        Update: {
          created_at?: string | null
          cuca_unit_id?: string | null
          expires_at?: string
          id?: string
          token?: string
          used?: boolean | null
          vaga_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vagas_feedback_tokens_vaga_id_fkey"
            columns: ["vaga_id"]
            isOneToOne: false
            referencedRelation: "vagas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vagas_feedback_tokens_vaga_id_fkey"
            columns: ["vaga_id"]
            isOneToOne: false
            referencedRelation: "vagas_abertas_todas_cucas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      vagas_abertas_todas_cucas: {
        Row: {
          data_fechamento: string | null
          id: string | null
          requisitos: string | null
          resumo: string | null
          salario: string | null
          tipo_contrato: string | null
          titulo: string | null
          total_vagas: number | null
          unidade_cuca: string | null
        }
        Insert: {
          data_fechamento?: string | null
          id?: string | null
          requisitos?: string | null
          resumo?: never
          salario?: string | null
          tipo_contrato?: string | null
          titulo?: string | null
          total_vagas?: number | null
          unidade_cuca?: string | null
        }
        Update: {
          data_fechamento?: string | null
          id?: string | null
          requisitos?: string | null
          resumo?: never
          salario?: string | null
          tipo_contrato?: string | null
          titulo?: string | null
          total_vagas?: number | null
          unidade_cuca?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      buscar_chunks_similares: {
        Args: {
          p_limite?: number
          p_tipos?: string[]
          p_unidade_cuca?: string
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          conteudo: string
          documento_id: string
          fonte_tipo: string
          metadados: Json
          similaridade: number
        }[]
      }
      buscar_vagas_multi_cuca: {
        Args: { p_busca: string }
        Returns: {
          carga_horaria: string
          data_fechamento: string
          descricao: string
          id: string
          requisitos: string
          salario: string
          tipo_contrato: string
          titulo: string
          total_vagas: number
          unidade_cuca: string
        }[]
      }
      calcular_total_leads_segmentacao: {
        Args: { p_filtros: Json }
        Returns: number
      }
      claim_disparo_divulgacao: {
        Args: never
        Returns: {
          ano: number
          created_at: string | null
          criado_por: string | null
          id: string
          instancia_uazapi: string | null
          mensagem_template: string
          mes: number
          metricas_json: Json | null
          status: string
          titulo: string | null
          total_enviados: number | null
          total_erros: number | null
          total_leads: number | null
          total_stop: number | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "disparos_divulgacao"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_evento_pontual: {
        Args: never
        Returns: {
          capacidade: number | null
          categorias_alvo: Json | null
          created_at: string | null
          created_by: string | null
          data_evento: string
          data_fim: string | null
          data_inicio: string | null
          descricao: string | null
          disparo_id: string | null
          expansiva: boolean | null
          flyer_url: string | null
          hora_fim: string | null
          hora_inicio: string | null
          id: string
          instancia_id: string | null
          local: string | null
          segmentacao_id: string | null
          status: string | null
          titulo: string
          unidade_cuca: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "eventos_pontuais"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_ouvidoria_evento: {
        Args: never
        Returns: {
          categorias_alvo: Json | null
          created_at: string | null
          data_fim: string | null
          data_inicio: string | null
          descricao: string | null
          disparo_id: string | null
          id: string
          segmentacao_tags: string[] | null
          status: string | null
          titulo: string
          unidade_cuca: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ouvidoria_eventos"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      criar_candidato_curriculo: {
        Args: {
          p_area?: string
          p_data_nascimento?: string
          p_nome: string
          p_telefone: string
        }
        Returns: string
      }
      desativar_eventos_pontuais_passados: { Args: never; Returns: number }
      gerar_protocolo_acesso: { Args: never; Returns: string }
      get_anon_key: { Args: never; Returns: string }
      get_my_unit: { Args: never; Returns: string }
      get_openai_key: { Args: never; Returns: string }
      get_resend_key: { Args: never; Returns: string }
      get_user_role: { Args: never; Returns: string }
      has_permission: {
        Args: { p_acao: string; p_recurso: string }
        Returns: boolean
      }
      increment_nao_lidas: { Args: { conv_id: string }; Returns: undefined }
      is_developer: { Args: never; Returns: boolean }
      next_numero_vaga:
        | { Args: never; Returns: number }
        | { Args: { p_empresa_id: string }; Returns: number }
      pode_gerenciar_funcao: {
        Args: { p_funcao_id: string; p_unidade: string }
        Returns: boolean
      }
      recalcular_perfil_lead: {
        Args: { p_lead_id: string }
        Returns: undefined
      }
      registrar_opt_in: {
        Args: { p_lead_id: string; p_operador_id?: string }
        Returns: undefined
      }
      registrar_opt_out: {
        Args: { p_motivo?: string; p_telefone: string }
        Returns: undefined
      }
      reset_automation_memory: { Args: never; Returns: Json }
      salvar_curriculo_estruturado: {
        Args: { p_curriculo_id?: string; p_dados?: Json; p_talent_id: string }
        Returns: string
      }
      update_vault_secret: {
        Args: { p_name: string; p_value: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
