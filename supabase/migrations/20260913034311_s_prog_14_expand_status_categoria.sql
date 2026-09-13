-- S-PROG-14 (expand): status por categoria, categoria no histórico e migração do que já foi aprovado.
-- Aditivo: não grava em `campanhas_mensais` (o gatilho do RAG não dispara) e não altera o conteúdo
-- nem o `ativo` de nenhum documento de RAG. As transições, o "Aprovar RAG" e o desligamento do gatilho
-- entram na migration de liberação (`s_prog_14_15_liberacao`), depois do redeploy do portal.

-- 1. Status por categoria dentro da campanha
CREATE TABLE IF NOT EXISTS public.campanha_categoria_status (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campanha_id uuid NOT NULL REFERENCES public.campanhas_mensais(id) ON DELETE CASCADE,
    categoria varchar NOT NULL,
    status varchar NOT NULL DEFAULT 'rascunho'
        CHECK (status IN ('rascunho', 'aguardando_autorizacao', 'autorizada')),
    atualizado_por uuid REFERENCES public.colaboradores(id) ON DELETE SET NULL,
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campanha_id, categoria)
);

ALTER TABLE public.campanha_categoria_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campanha_categoria_status_leitura" ON public.campanha_categoria_status;
CREATE POLICY "campanha_categoria_status_leitura" ON public.campanha_categoria_status
    FOR SELECT TO authenticated
    USING (
        public.is_developer()
        OR public.pgm_pode_categoria(categoria, 'read')
        OR public.has_permission_exata('pgm_rag_aprovar', 'read')
        OR public.has_permission_exata('pgm_disparo_global', 'read')
    );
-- Sem política de escrita: só funções do servidor (chave de serviço / SECURITY DEFINER) gravam.

REVOKE ALL ON public.campanha_categoria_status FROM anon;

-- 2. Categoria no histórico (registros antigos ficam sem)
ALTER TABLE public.campanha_historico ADD COLUMN IF NOT EXISTS categoria varchar;

-- 3. A primeira atividade de uma categoria cria o status dela, em rascunho
CREATE OR REPLACE FUNCTION public.pgm_criar_status_categoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_nome text := CASE public.pgm_slug_categoria(NEW.categoria)
        WHEN 'esportes' THEN 'ESPORTES' WHEN 'cursos' THEN 'CURSOS'
        WHEN 'dia_a_dia' THEN 'DIA A DIA' WHEN 'especiais' THEN 'ESPECIAIS'
    END;
BEGIN
    IF NEW.campanha_id IS NOT NULL AND v_nome IS NOT NULL THEN
        INSERT INTO public.campanha_categoria_status (campanha_id, categoria, status)
        VALUES (NEW.campanha_id, v_nome, 'rascunho')
        ON CONFLICT (campanha_id, categoria) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pgm_criar_status_categoria() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_atividade_mensal_status_categoria ON public.atividades_mensais;
CREATE TRIGGER tr_atividade_mensal_status_categoria
    AFTER INSERT ON public.atividades_mensais
    FOR EACH ROW EXECUTE FUNCTION public.pgm_criar_status_categoria();

-- 4. O que foi aprovado no fluxo antigo continua aprovado no novo
--    aprovado → categorias autorizadas; pendente → aguardando autorização; demais → rascunho.
WITH categorias AS (
    SELECT DISTINCT
        am.campanha_id,
        CASE public.pgm_slug_categoria(am.categoria)
            WHEN 'esportes' THEN 'ESPORTES' WHEN 'cursos' THEN 'CURSOS'
            WHEN 'dia_a_dia' THEN 'DIA A DIA' WHEN 'especiais' THEN 'ESPECIAIS'
        END AS categoria,
        CASE cm.status
            WHEN 'aprovado' THEN 'autorizada'
            WHEN 'pendente' THEN 'aguardando_autorizacao'
            ELSE 'rascunho'
        END AS status
    FROM public.atividades_mensais am
    JOIN public.campanhas_mensais cm ON cm.id = am.campanha_id
    WHERE public.pgm_slug_categoria(am.categoria) IS NOT NULL
),
inseridas AS (
    INSERT INTO public.campanha_categoria_status (campanha_id, categoria, status)
    SELECT campanha_id, categoria, status FROM categorias
    ON CONFLICT (campanha_id, categoria) DO NOTHING
    RETURNING campanha_id, categoria, status
)
INSERT INTO public.campanha_historico (campanha_id, de_status, para_status, motivo, usuario_id, categoria)
SELECT campanha_id, NULL, status, 'Migração S-PROG-14: situação herdada do fluxo anterior', NULL, categoria
FROM inseridas
WHERE status <> 'rascunho';

-- 5. Mês e ano de volta nos documentos de RAG (o motor-agente lê para a diretiva de vigência).
--    Só `metadados`: o gatilho de indexação reage a titulo/conteudo, então nada é reindexado.
UPDATE public.documentos_rag d
SET metadados = d.metadados || jsonb_build_object('mes', c.mes, 'ano', c.ano, 'unidade_cuca', c.unidade_cuca)
FROM public.campanhas_mensais c
WHERE d.tipo = 'monthly_program'
  AND d.metadados->>'campanha_id' = c.id::text
  AND (d.metadados->>'mes' IS DISTINCT FROM c.mes::text OR d.metadados->>'ano' IS DISTINCT FROM c.ano::text);

-- 6. Situação das campanhas para a lista: categorias autorizadas e se está no RAG.
--    Só devolve campanhas que quem pede enxerga (mesma regra da política de leitura).
CREATE OR REPLACE FUNCTION public.pgm_situacao_campanhas(p_ids uuid[])
RETURNS TABLE(campanha_id uuid, total_categorias integer, autorizadas integer, aguardando integer, no_rag boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        c.id,
        (SELECT count(*)::int FROM public.campanha_categoria_status s
            WHERE s.campanha_id = c.id
              AND EXISTS (SELECT 1 FROM public.atividades_mensais a
                          WHERE a.campanha_id = c.id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria))),
        (SELECT count(*)::int FROM public.campanha_categoria_status s
            WHERE s.campanha_id = c.id AND s.status = 'autorizada'
              AND EXISTS (SELECT 1 FROM public.atividades_mensais a
                          WHERE a.campanha_id = c.id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria))),
        (SELECT count(*)::int FROM public.campanha_categoria_status s
            WHERE s.campanha_id = c.id AND s.status = 'aguardando_autorizacao'
              AND EXISTS (SELECT 1 FROM public.atividades_mensais a
                          WHERE a.campanha_id = c.id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria))),
        EXISTS (
            SELECT 1 FROM public.documentos_rag d
            WHERE d.tipo = 'monthly_program' AND d.ativo
              AND d.metadados->>'campanha_id' = c.id::text
              AND EXISTS (SELECT 1 FROM public.chunks_documentos ch WHERE ch.documento_id = d.id)
        )
    FROM public.campanhas_mensais c
    WHERE c.id = ANY(p_ids)
      AND (
          public.is_developer()
          OR (
              (c.unidade_cuca IS NULL OR c.unidade_cuca::text = public.get_my_unit() OR public.get_my_unit() IS NULL)
              AND public.pgm_pode_ler_campanhas()
          )
      );
$$;

REVOKE ALL ON FUNCTION public.pgm_situacao_campanhas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pgm_situacao_campanhas(uuid[]) TO authenticated, service_role;
