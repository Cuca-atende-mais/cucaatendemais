-- S-EMP-GES-03: retorno da empresa pelo link do pedido de feedback — "em análise" e "substituída" no
-- pedido. Idempotente e aditiva: só colunas novas e nullable.
-- (A versão aplicada em 14/10 criava também candidaturas.motivo_rejeicao; o motivo saiu do escopo no mesmo
-- dia e a coluna é removida em 20261014170000_emp_ges_03_sem_motivo_rejeicao.sql.)

-- 1. Situação do pedido além de enviado/respondido:
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

-- 2. Taxa de retorno por empresa (tela Feedback) lê por empresa_id — índice já existe (GES-02).
