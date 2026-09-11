-- Fase 2 / Passo 1 — nenhuma unidade pode ficar sem `monthly_program` ativo.
--
-- Contexto (confirmado em produção em 2026-09-11): Cuca Mondubim (11:57) e Cuca Jangurussu
-- (13:09) ficaram, no mesmo dia, com ZERO `monthly_program` ativo — o agente não conseguia
-- responder nada sobre programação nessas duas unidades. Campanhas de 9/2026 seguiam
-- `aprovado`, com 98 e 93 atividades, e os chunks nunca foram apagados: só o flag `ativo` caiu.
--
-- Causa-raiz, rastreada até os dois triggers:
--   1. `trigger_indexar_campanha_mensal` (AFTER INSERT OR UPDATE) desativa, como PRIMEIRO
--      statement do ramo 'aprovado', todo `monthly_program` anterior da unidade.
--   2. `delete_rag_on_campanha_delete` (BEFORE DELETE) apaga o `documentos_rag` da campanha
--      excluída — e não reativa nada no lugar.
-- Sequência real: campanha nova (teste de outubro) aprovada -> (1) derruba o mês vigente;
-- campanha excluída -> (2) apaga o documento dela. Resultado: zero ativo e zero órfão —
-- exatamente o estado observado.
--
-- Esta migration fecha TRÊS caminhos que levam ao mesmo estado zerado, não só o observado:
--   A. exclusão de campanha (o caso que aconteceu);
--   B. reabertura/desaprovação de campanha (ramo ELSE do indexador) — NÃO exige exclusão
--      nenhuma e é o caminho MAIS provável na operação normal de outubro: basta reabrir a
--      campanha vigente pra corrigir um typo e a unidade fica muda até reaprovar;
--   C. ordem do indexador — a desativação em massa passa a rodar DEPOIS da escrita do
--      documento novo (defesa em profundidade; ver nota de honestidade abaixo).
--
-- NOTA DE HONESTIDADE sobre (C): o trigger já roda dentro da transação do statement, então um
-- erro no INSERT/UPDATE já desfazia a desativação por rollback. Reordenar NÃO era o que
-- causava o incidente — o incidente veio do DELETE (A). (C) entra como defesa em profundidade
-- pra que a ordem não vire uma armadilha se alguém adicionar um bloco EXCEPTION no futuro.
-- O que de fato corrige o incidente é (A); o que evita o próximo é (B).
--
-- Idempotente (CREATE OR REPLACE) e retrocompatível: nenhuma coluna, tabela, assinatura de
-- trigger ou nome de função existente é alterada ou removida — só acrescenta uma função nova e
-- substitui o corpo de duas já existentes, preservando integralmente o texto indexado
-- (`v_conteudo`) e os `metadados` da S-PROG-10.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper compartilhado pelos dois triggers.
-- Reativa o `monthly_program` mais recente que SOBROU pra unidade (campanha ainda existente e
-- ainda 'aprovado') e, no mesmo statement, garante a invariante de EXATAMENTE 1 ativo por
-- unidade — `carregarProgramacaoMensal`, `buscarAtividadeEspecifica` e
-- `buscarAtividadeDeterministica` (motor-agente) consultam com `.single()`: dois documentos
-- ativos quebram a consulta tanto quanto zero.
-- Devolve NULL (e não mexe em nada) quando não há candidato — nunca reativa mês de campanha
-- excluída, rascunho ou reprovada, e nunca inventa um documento.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reativar_monthly_program_mais_recente(
  p_unidade text,
  p_campanha_ignorar uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_doc_id uuid;
BEGIN
  IF p_unidade IS NULL THEN
    RETURN NULL;
  END IF;

  -- Ordena por ano/mês da CAMPANHA (não por created_at do documento): reimportar um mês antigo
  -- depois de um mês novo criaria um documento mais recente de uma programação mais velha.
  -- `created_at` fica só como desempate estável.
  SELECT d.id INTO v_doc_id
  FROM public.documentos_rag d
  JOIN public.campanhas_mensais c ON c.id::text = d.metadados->>'campanha_id'
  WHERE d.tipo = 'monthly_program'
    AND d.unidade_cuca = p_unidade
    AND c.status = 'aprovado'
    AND (p_campanha_ignorar IS NULL OR c.id <> p_campanha_ignorar)
  ORDER BY c.ano DESC, c.mes DESC, d.created_at DESC
  LIMIT 1;

  IF v_doc_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- `ativo IS DISTINCT FROM (...)` no WHERE: só toca nas linhas que realmente mudam de estado.
  -- Sem isso, cada chamada carimbaria `updated_at` do histórico inteiro da unidade — foi
  -- justamente esse carimbo em massa que denunciou o incidente de 11/09, e ele não deve virar
  -- ruído recorrente.
  UPDATE public.documentos_rag
  SET ativo = (id = v_doc_id), updated_at = NOW()
  WHERE tipo = 'monthly_program'
    AND unidade_cuca = p_unidade
    AND ativo IS DISTINCT FROM (id = v_doc_id);

  RETURN v_doc_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) Exclusão de campanha: apaga o documento dela (comportamento existente, preservado) e
-- reativa o mês anterior válido da unidade.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_rag_on_campanha_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  DELETE FROM public.documentos_rag
  WHERE tipo = 'monthly_program'
    AND metadados->>'campanha_id' = OLD.id::text;

  -- BEFORE DELETE: a linha OLD ainda existe neste ponto, por isso o `p_campanha_ignorar`.
  PERFORM public.reativar_monthly_program_mais_recente(OLD.unidade_cuca, OLD.id);

  RETURN OLD;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) + (C) Indexador: desativação em massa movida pra DEPOIS da escrita, e o ramo de
-- reabertura/desaprovação passa a reativar o mês anterior em vez de deixar a unidade muda.
-- Todo o resto do corpo (cabeçalho de vigência S-PROG-10 item 2, loop de atividades com o
-- delimitador '• ', fallback de campanha vazia, `v_metadados` do item 1) é idêntico à versão
-- em produção — copiado de `pg_get_functiondef`, não retranscrito de memória.
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
      UPDATE public.documentos_rag SET
        titulo = NEW.titulo,
        conteudo = v_conteudo,
        metadados = v_metadados,
        unidade_cuca = NEW.unidade_cuca,
        ativo = true,
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
        true,
        NEW.created_by
      );
    END IF;

    -- (C) Só agora — depois de o documento novo existir e estar ativo — os meses anteriores
    -- saem do ar. Nunca existe um instante lógico com a unidade sem nada.
    UPDATE public.documentos_rag
    SET ativo = false, updated_at = NOW()
    WHERE tipo = 'monthly_program'
      AND unidade_cuca = NEW.unidade_cuca
      AND metadados->>'campanha_id' != NEW.id::text
      AND ativo = true;
  ELSE
    IF v_doc_id IS NOT NULL THEN
      UPDATE public.documentos_rag SET ativo = false, updated_at = NOW() WHERE id = v_doc_id;

      -- (B) Reabrir/desaprovar a campanha vigente não pode deixar a unidade muda: volta pro
      -- mês anterior válido. Se não houver nenhum (1ª campanha da unidade), segue sem ativo —
      -- estado legítimo, não há o que reativar.
      PERFORM public.reativar_monthly_program_mais_recente(NEW.unidade_cuca, NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
