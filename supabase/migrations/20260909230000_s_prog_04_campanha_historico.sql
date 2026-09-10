-- S-PROG-04: histórico de transições de status da programação mensal (item 3 da story).
-- Idempotente/retrocompatível: tabela nova, aditiva — não altera campanhas_mensais.
-- Aplicada diretamente em produção (svzkrkfzpiqcesloukgb) via MCP em 2026-09-09.

CREATE TABLE IF NOT EXISTS public.campanha_historico (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campanha_id uuid NOT NULL REFERENCES public.campanhas_mensais(id) ON DELETE CASCADE,
  de_status varchar(20),
  para_status varchar(20) NOT NULL,
  motivo text,
  usuario_id uuid REFERENCES public.colaboradores(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campanha_historico_campanha_id ON public.campanha_historico(campanha_id);

ALTER TABLE public.campanha_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Historico: leitura com permissao" ON public.campanha_historico;
CREATE POLICY "Historico: leitura com permissao" ON public.campanha_historico
  FOR SELECT USING (public.has_permission('programacao', 'read'));

DROP POLICY IF EXISTS "Historico: insercao com permissao" ON public.campanha_historico;
CREATE POLICY "Historico: insercao com permissao" ON public.campanha_historico
  FOR INSERT WITH CHECK (public.has_permission('programacao', 'update'));
