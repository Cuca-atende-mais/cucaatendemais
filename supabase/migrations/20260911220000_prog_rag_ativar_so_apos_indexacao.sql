-- S-WM-AUD-004 (AC5) — a troca do monthly_program ativo só acontece DEPOIS de o documento novo
-- estar indexado. Escopo estritamente técnico: muda o GATILHO da troca, não quem libera nem
-- quando (isso é epic de programação, fora da auditoria — ver redução de escopo do @po).
--
-- Problema (CONCERN-1 do gate da S-WM-AUD-001): a indexação não é transacional. O trigger cria o
-- documento e `tr_indexar_documento` dispara `net.http_post` (pg_net) — assíncrono, sem retry e
-- sem checagem de erro. Entre o commit da aprovação e o fim da indexação, o documento novo está
-- ATIVO com ZERO chunks enquanto o mês anterior já saiu do ar: `carregarProgramacaoMensal`,
-- `buscarAtividadeEspecifica` e a busca vetorial ficam mudas. Se o pg_net falhar, é permanente.
--
-- Correção: o documento novo nasce INATIVO e o mês anterior permanece no ar. Quem faz a troca é
-- `processar-documento`, ao terminar com sucesso, chamando `ativar_monthly_program_indexado`.
-- Falha de indexação passa a significar "continua no mês anterior" (que a diretiva de vigência da
-- S-PROG-10 já rotula como mês passado) em vez de "unidade muda" — falha visível, não silenciosa.
--
-- Idempotente (CREATE OR REPLACE) e retrocompatível: nenhuma coluna, tabela ou assinatura de
-- trigger muda. `v_conteudo` e `v_metadados` preservados byte a byte.

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC da troca atômica. Só ativa se o documento REALMENTE tiver chunks — é a checagem que dá
-- sentido a tudo acima. `SECURITY DEFINER` + `search_path` fixo + EXECUTE revogado desde o
-- nascimento (lição do CONCERN-2: função nova nasce pública por default no PostgREST).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ativar_monthly_program_indexado(p_documento_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_unidade text;
  v_chunks integer;
BEGIN
  SELECT d.unidade_cuca INTO v_unidade
  FROM public.documentos_rag d
  WHERE d.id = p_documento_id AND d.tipo = 'monthly_program';

  IF v_unidade IS NULL THEN
    RETURN false;  -- não é monthly_program (ou não existe): nada a fazer
  END IF;

  SELECT count(*) INTO v_chunks FROM public.chunks_documentos c WHERE c.documento_id = p_documento_id;
  IF v_chunks = 0 THEN
    RETURN false;  -- sem conteúdo indexado, NÃO troca — é o ponto inteiro desta migration
  END IF;

  -- Troca atômica: ativa este, desativa os demais da unidade, num único statement. Mantém a
  -- invariante de EXATAMENTE 1 ativo por unidade (`.single()` do motor-agente quebra com 0 e com 2).
  -- `IS DISTINCT FROM` evita carimbar `updated_at` de linha que já está no estado certo.
  UPDATE public.documentos_rag
  SET ativo = (id = p_documento_id), updated_at = NOW()
  WHERE tipo = 'monthly_program'
    AND unidade_cuca = v_unidade
    AND ativo IS DISTINCT FROM (id = p_documento_id);

  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ativar_monthly_program_indexado(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ativar_monthly_program_indexado(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ativar_monthly_program_indexado(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ativar_monthly_program_indexado(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper da S-WM-AUD-001 ganha o mesmo critério: nunca reativar documento sem chunks.
-- Sem isso, excluir a campanha vigente poderia "reativar" o mês novo ainda não indexado — a
-- unidade ficaria com documento ativo e vazio, exatamente o estado que esta migration combate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reativar_monthly_program_mais_recente(
  p_unidade text,
  p_campanha_ignorar uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_doc_id uuid;
BEGIN
  IF p_unidade IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT d.id INTO v_doc_id
  FROM public.documentos_rag d
  JOIN public.campanhas_mensais c ON c.id::text = d.metadados->>'campanha_id'
  WHERE d.tipo = 'monthly_program'
    AND d.unidade_cuca = p_unidade
    AND c.status = 'aprovado'
    AND (p_campanha_ignorar IS NULL OR c.id <> p_campanha_ignorar)
    AND EXISTS (SELECT 1 FROM public.chunks_documentos ch WHERE ch.documento_id = d.id)
  ORDER BY c.ano DESC, c.mes DESC, d.created_at DESC
  LIMIT 1;

  IF v_doc_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.documentos_rag
  SET ativo = (id = v_doc_id), updated_at = NOW()
  WHERE tipo = 'monthly_program'
    AND unidade_cuca = p_unidade
    AND ativo IS DISTINCT FROM (id = v_doc_id);

  RETURN v_doc_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexador: deixa de decidir quem está ativo. Passa a só escrever o conteúdo.
--
--  - caminho INSERT (campanha nova): documento nasce `ativo = false`. O mês anterior continua no
--    ar até a indexação terminar. É a correção central desta migration.
--  - caminho UPDATE (reaprovação): NÃO toca em `ativo`. Reaprovar o mês vigente (editar e aprovar
--    de novo) manteria a unidade no ar; forçar `false` ali a derrubaria até reindexar, e forçar
--    `true` reintroduziria a janela que esta migration remove.
--  - a desativação em massa dos meses anteriores SAI daqui — virou responsabilidade de
--    `ativar_monthly_program_indexado`, que só age com chunks confirmados.
--
-- Todo o resto do corpo (cabeçalho de vigência S-PROG-10 item 2, loop com '• ', fallback de
-- campanha vazia, `v_metadados` do item 1, ramo ELSE de reabertura da S-WM-AUD-001) é idêntico —
-- copiado de `pg_get_functiondef` da produção, não retranscrito de memória.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_indexar_campanha_mensal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_doc_id uuid;
  v_conteudo text;
  v_linha record;
  v_categoria_atual text := '';
  v_metadados jsonb;
  v_nomes_mes text[] := ARRAY['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  v_mes_nome text;
BEGIN
  SELECT id INTO v_doc_id FROM public.documentos_rag
  WHERE metadados->>'campanha_id' = NEW.id::text
  LIMIT 1;

  IF (NEW.status = 'aprovado') THEN
    v_mes_nome := v_nomes_mes[NEW.mes];

    v_conteudo := 'PROGRAMAÇÃO MENSAL DE ' || UPPER(v_mes_nome) || ' DE ' || NEW.ano || ' — ' || NEW.unidade_cuca || chr(10);
    v_conteudo := v_conteudo || 'Esta programação vale para o mês de ' || v_mes_nome || ' de ' || NEW.ano || '.' || chr(10);
    v_conteudo := v_conteudo || 'Título: ' || NEW.titulo || chr(10) || chr(10);

    FOR v_linha IN (
      SELECT categoria, titulo, descricao, local, hora_inicio, hora_fim, data_atividade
      FROM public.atividades_mensais
      WHERE campanha_id = NEW.id
      ORDER BY categoria, data_atividade, hora_inicio
    ) LOOP
      IF v_linha.categoria IS DISTINCT FROM v_categoria_atual THEN
        v_categoria_atual := COALESCE(v_linha.categoria, 'GERAL');
        v_conteudo := v_conteudo || chr(10) || '== ' || v_categoria_atual || ' ==' || chr(10);
      END IF;

      v_conteudo := v_conteudo || '• ' || COALESCE(v_linha.titulo, '') || chr(10);

      IF v_linha.descricao IS NOT NULL AND v_linha.descricao != '' THEN
        v_conteudo := v_conteudo || '  Detalhes: ' || v_linha.descricao || chr(10);
      END IF;

      IF v_linha.local IS NOT NULL AND v_linha.local != '' AND v_linha.local != 'Não informado' THEN
        v_conteudo := v_conteudo || '  Local: ' || v_linha.local || chr(10);
      END IF;

      IF v_linha.hora_inicio IS NOT NULL THEN
        v_conteudo := v_conteudo || '  Horário: ' || v_linha.hora_inicio::text;
        IF v_linha.hora_fim IS NOT NULL THEN
          v_conteudo := v_conteudo || ' às ' || v_linha.hora_fim::text;
        END IF;
        v_conteudo := v_conteudo || chr(10);
      END IF;
    END LOOP;

    IF v_conteudo = 'PROGRAMAÇÃO MENSAL DE ' || UPPER(v_mes_nome) || ' DE ' || NEW.ano || ' — ' || NEW.unidade_cuca || chr(10)
                   || 'Esta programação vale para o mês de ' || v_mes_nome || ' de ' || NEW.ano || '.' || chr(10)
                   || 'Título: ' || NEW.titulo || chr(10) || chr(10) THEN
      v_conteudo := v_conteudo || 'Detalhes: Consulte a programação no Portal da Juventude.';
    END IF;

    v_metadados := jsonb_build_object(
      'campanha_id', NEW.id,
      'mes', NEW.mes,
      'ano', NEW.ano,
      'unidade_cuca', NEW.unidade_cuca
    );

    IF v_doc_id IS NOT NULL THEN
      -- `ativo` deliberadamente AUSENTE deste UPDATE.
      UPDATE public.documentos_rag SET
        titulo = NEW.titulo,
        conteudo = v_conteudo,
        metadados = v_metadados,
        unidade_cuca = NEW.unidade_cuca,
        updated_at = NOW()
      WHERE id = v_doc_id;
    ELSE
      INSERT INTO public.documentos_rag (titulo, tipo, conteudo, metadados, unidade_cuca, ativo, created_by)
      VALUES (
        NEW.titulo,
        'monthly_program',
        v_conteudo,
        v_metadados,
        NEW.unidade_cuca,
        false,  -- espera a indexação; quem ativa é ativar_monthly_program_indexado
        NEW.created_by
      );
    END IF;
  ELSE
    IF v_doc_id IS NOT NULL THEN
      UPDATE public.documentos_rag SET ativo = false, updated_at = NOW() WHERE id = v_doc_id;
      PERFORM public.reativar_monthly_program_mais_recente(NEW.unidade_cuca, NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
