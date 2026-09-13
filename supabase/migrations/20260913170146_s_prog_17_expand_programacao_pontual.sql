-- S-PROG-17 (expand) — programação pontual: motivo de devolução, opções `pgp_*` e RAG só após autorizado.
-- Compatível com o portal antigo (que ainda grava direto na tabela): nada aqui restringe gravação.
-- Idempotente.

-- 1. Motivo da última devolução (gravado ao devolver, limpo ao autorizar).
ALTER TABLE public.eventos_pontuais ADD COLUMN IF NOT EXISTS motivo_devolucao text;

-- 2. Espelha `programacao_pontual` nas opções `pgp_*`. Ninguém perde acesso quando as checagens trocarem.
-- Só preenche perfis que ainda NÃO têm nenhuma linha `pgp_*`: pode ser rodada de novo sem desfazer
-- escolhas feitas na tela de Perfis. A tela antiga (antes do redeploy) apaga e regrava só os módulos que
-- conhece; um perfil salvo nela perde as linhas `pgp_*` e volta a ser elegível. Rodar de novo antes do
-- contrato (`supabase/pendentes/s_prog_17_contract_eventos_pontuais.sql`).
--
-- Equivalência (mesma de `ORIGEM_ESPELHAMENTO_PONTUAL` em cuca-portal/src/lib/rbac/catalogo-programacao-pontual.ts):
--   can_read   -> pgp_ver
--   can_create -> pgp_criar
--   can_update -> pgp_editar, pgp_autorizar, pgp_devolver, pgp_disparar, pgp_cancelar
--   ninguém    -> pgp_excluir (hoje só as contas Developer excluem)
-- Opção de ação única guarda o "liberado" em can_read.
WITH mapa(module, origem) AS (
  VALUES
    ('pgp_ver', 'read'),
    ('pgp_criar', 'create'),
    ('pgp_editar', 'update'),
    ('pgp_autorizar', 'update'),
    ('pgp_devolver', 'update'),
    ('pgp_disparar', 'update'),
    ('pgp_cancelar', 'update'),
    ('pgp_excluir', 'nenhum')
),
elegiveis AS (
  SELECT sp.role_id, sp.can_read, sp.can_create, sp.can_update
  FROM public.sys_permissions sp
  WHERE sp.module = 'programacao_pontual'
    AND NOT EXISTS (
      SELECT 1 FROM public.sys_permissions x WHERE x.role_id = sp.role_id AND x.module LIKE 'pgp\_%'
    )
)
INSERT INTO public.sys_permissions (role_id, module, can_read, can_create, can_update, can_delete)
SELECT e.role_id, m.module,
  CASE m.origem
    WHEN 'read' THEN COALESCE(e.can_read, FALSE)
    WHEN 'create' THEN COALESCE(e.can_create, FALSE)
    WHEN 'update' THEN COALESCE(e.can_update, FALSE)
    ELSE FALSE
  END,
  FALSE, FALSE, FALSE
FROM elegiveis e
CROSS JOIN mapa m
ON CONFLICT (role_id, module) DO NOTHING;

-- 3. RAG: o evento só fica no ar a partir de `autorizado`. `em_andamento`, `pausada` e
-- `pausada_limite_diario` (gravados pelo worker durante/depois do envio) continuam no ar — antes o evento
-- saía do RAG enquanto era disparado. Fora do ar: `aguardando_aprovacao` (inclui devolvido) e `cancelado`.
-- Resto da função igual à versão em produção (conteúdo e metadados do documento sem mudança).
CREATE OR REPLACE FUNCTION public.trigger_indexar_evento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_doc_id uuid;
  v_conteudo TEXT;
BEGIN
  SELECT id INTO v_doc_id FROM public.documentos_rag
  WHERE metadados->>'evento_id' = NEW.id::text LIMIT 1;

  IF NEW.status IN ('autorizado', 'aprovado', 'em_andamento', 'pausada', 'pausada_limite_diario', 'concluida') THEN

    v_conteudo :=
      'EVENTO: ' || NEW.titulo || E'\n' ||
      'DESCRIÇÃO: ' || COALESCE(NEW.descricao, '') || E'\n' ||
      'DATA: ' || COALESCE(NEW.data_inicio::text, NEW.data_evento::text) ||
        CASE
          WHEN NEW.data_fim IS NOT NULL AND NEW.data_fim::text != COALESCE(NEW.data_inicio::text, NEW.data_evento::text)
          THEN ' até ' || NEW.data_fim::text
          ELSE ''
        END || E'\n' ||
      'HORÁRIO: ' || COALESCE(NEW.hora_inicio::text, 'A definir') || E'\n' ||
      'LOCAL: ' || COALESCE(NEW.local, NEW.unidade_cuca) || E'\n' ||
      CASE
        WHEN NEW.flyer_url IS NOT NULL AND NEW.flyer_url != ''
        THEN 'FLYER: ' || NEW.flyer_url || E'\n'
        ELSE ''
      END;

    IF v_doc_id IS NOT NULL THEN
      UPDATE public.documentos_rag SET
        titulo      = NEW.titulo,
        tipo        = 'eventos_pontuais',
        conteudo    = v_conteudo,
        unidade_cuca = NEW.unidade_cuca,
        ativo       = true,
        updated_at  = NOW(),
        metadados   = metadados || jsonb_build_object('indexado_em', NOW())
      WHERE id = v_doc_id;
    ELSE
      INSERT INTO public.documentos_rag (titulo, tipo, conteudo, metadados, unidade_cuca, ativo, created_by)
      VALUES (
        NEW.titulo,
        'eventos_pontuais',
        v_conteudo,
        jsonb_build_object(
          'evento_id',   NEW.id,
          'indexado_em', NOW(),
          'source_type', 'rede_cuca_global'
        ),
        NEW.unidade_cuca,
        true,
        NEW.created_by
      );
    END IF;

  ELSE
    -- Aguardando aprovação / devolvido / cancelado: fora do RAG
    IF v_doc_id IS NOT NULL THEN
      UPDATE public.documentos_rag SET ativo = false, updated_at = NOW() WHERE id = v_doc_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
