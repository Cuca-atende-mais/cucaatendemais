-- S-EMP-GES-03: retorno da empresa pelo link do pedido de feedback — motivo da rejeição na tela interna,
-- "em análise" e "substituída" no pedido. Idempotente e aditiva: só colunas novas e nullable.

-- 1. Motivo da rejeição (opcional, só pela tela interna). Lista fixa ou "Outro: <texto curto>".
ALTER TABLE public.candidaturas ADD COLUMN IF NOT EXISTS motivo_rejeicao text;

-- 2. Situação do pedido além de enviado/respondido:
--    em_analise  = a empresa abriu o link e sinalizou "Ainda em análise" (nenhum candidato muda);
--    substituida = a equipe reenviou; o pedido novo está em substituida_por.
--    Em qualquer das duas, e com respondido_em preenchido, o link deixa de valer (uso único).
ALTER TABLE public.feedback_solicitacoes ADD COLUMN IF NOT EXISTS situacao text;
ALTER TABLE public.feedback_solicitacoes ADD COLUMN IF NOT EXISTS situacao_em timestamptz;
ALTER TABLE public.feedback_solicitacoes ADD COLUMN IF NOT EXISTS substituida_por uuid
    REFERENCES public.feedback_solicitacoes(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_solicitacoes_situacao_check') THEN
        ALTER TABLE public.feedback_solicitacoes
            ADD CONSTRAINT feedback_solicitacoes_situacao_check CHECK (situacao IS NULL OR situacao IN ('em_analise', 'substituida'));
    END IF;
END $$;

-- 3. Taxa de retorno por empresa (tela Feedback) lê por empresa_id — índice já existe (GES-02).
