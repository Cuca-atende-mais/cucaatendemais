-- SQS-40: Gestão Transacional de Convocações e Transbordo

-- 1.1 Atualização da tabela vagas
ALTER TABLE public.vagas 
ADD COLUMN IF NOT EXISTS tipo_local_entrevista VARCHAR(50),
ADD COLUMN IF NOT EXISTS endereco_entrevista TEXT;

-- 1.2 Atualização da tabela candidaturas
ALTER TABLE public.candidaturas 
ADD COLUMN IF NOT EXISTS data_entrevista DATE,
ADD COLUMN IF NOT EXISTS hora_entrevista TIME,
ADD COLUMN IF NOT EXISTS local_entrevista TEXT;

-- 1.3 Atualização da constraint de status em candidaturas
ALTER TABLE public.candidaturas 
DROP CONSTRAINT IF EXISTS check_candidaturas_status;

ALTER TABLE public.candidaturas 
ADD CONSTRAINT check_candidaturas_status 
CHECK (status IN (
  'pendente', 
  'selecionado', 
  'contratado', 
  'rejeitado', 
  'banco_talentos', 
  'aprovado_empresa', 
  'convite_enviado', 
  'entrevista_confirmada', 
  'entrevista_recusada', 
  'duvida',
  'enviada' -- Valor default encontrado em algumas instâncias
));

-- 1.4 Nova tabela para controle de tokens de feedback
CREATE TABLE IF NOT EXISTS public.vagas_feedback_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vaga_id UUID REFERENCES public.vagas(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS para a nova tabela
ALTER TABLE public.vagas_feedback_tokens ENABLE ROW LEVEL SECURITY;

-- Usuários não autenticados podem ver o token para validar o link público
CREATE POLICY "Acesso público para verificação de token"
ON public.vagas_feedback_tokens FOR SELECT
TO anon
USING (true);

-- No entanto, apenas autenticados podem gerenciar
CREATE POLICY "Gerenciamento total para colaboradores"
ON public.vagas_feedback_tokens FOR ALL
TO authenticated
USING (true);
