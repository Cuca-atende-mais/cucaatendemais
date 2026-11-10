-- S-EMP-GES-10 (AC13): correção dos talentos travados pela regra antiga.
-- ATENÇÃO: aplicar SÓ DEPOIS do redeploy do cuca-worker (triagem paginada) e do portal
-- (aprovar/convocar sem travar). Ver "Ordem de deploy" na story.
-- Idempotente: o backup só é criado uma vez; rodar de novo não muda nada, porque não sobra
-- ninguém em 'selecionado' ou 'arquivado'.

-- 1. Backup do status anterior, protegido (RLS ligada, sem policy, sem acesso de anon/authenticated).
DO $$
BEGIN
    IF to_regclass('public._backup_emp_ges10_talent_bank_status') IS NULL THEN
        CREATE TABLE public._backup_emp_ges10_talent_bank_status AS
            SELECT id, status, updated_at
            FROM public.talent_bank
            WHERE status IN ('selecionado', 'arquivado');
    END IF;
END $$;

ALTER TABLE public._backup_emp_ges10_talent_bank_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._backup_emp_ges10_talent_bank_status FROM PUBLIC, anon, authenticated;

-- 2. Quem tem candidatura "contratado" (vaga normal) fica contratado. Hoje: 0.
UPDATE public.talent_bank t
SET status = 'contratado', updated_at = now()
WHERE t.status IN ('selecionado', 'arquivado')
  AND EXISTS (
      SELECT 1
      FROM public.candidaturas c
      JOIN public.vagas v ON v.id = c.vaga_id
      WHERE c.status = 'contratado'
        AND v.tipo IS DISTINCT FROM 'selecao_evento'
        AND public.emp_chave_telefone(t.telefone) IS NOT NULL
        AND public.emp_chave_telefone(c.telefone) = public.emp_chave_telefone(t.telefone)
  );

-- 3. Os demais voltam a disponível. data_curriculo não muda.
UPDATE public.talent_bank
SET status = 'disponivel', updated_at = now()
WHERE status IN ('selecionado', 'arquivado');
