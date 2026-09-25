-- S-PROG-19 (ajuste, decisão do Junior em 2026-09-25): o fim nunca é assumido igual ao início.
-- 1. `pgm_datas_padrao` (hoje usada só pela função de salvar rascunho quando o portal antigo, sem as
--    chaves novas, salva — até o redeploy): DIA A DIA/ESPECIAIS → fim vazio; CURSOS com uma data só no
--    período → término vazio. Sem isso, um salvamento pelo portal antigo voltaria a preencher o fim.
-- 2. Limpa a data fim do DIA A DIA/ESPECIAIS de outubro/2026 que o preenchimento tinha assumido igual ao
--    início (a tela antiga só tinha uma data): a unidade preenche antes de enviar para autorização.
--    Backup já existe (`backup_pgm_datas_inicio_fim_20260925`). Idempotente.

CREATE OR REPLACE FUNCTION public.pgm_datas_padrao(p_categoria text, p_data_atividade date, p_periodo text)
RETURNS TABLE(data_inicio date, data_fim date)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_slug text := public.pgm_slug_categoria(p_categoria);
    v_datas date[] := ARRAY[]::date[];
    v_txt text;
    v_d date;
BEGIN
    IF v_slug = 'cursos' THEN
        FOR v_txt IN SELECT m[1] FROM regexp_matches(coalesce(p_periodo, ''), '(\d{2}/\d{2}/\d{4})', 'g') AS m LOOP
            BEGIN
                v_d := to_date(v_txt, 'DD/MM/YYYY');
                IF to_char(v_d, 'DD/MM/YYYY') = v_txt THEN
                    v_datas := v_datas || v_d;
                END IF;
            EXCEPTION WHEN others THEN
                NULL;
            END;
            EXIT WHEN cardinality(v_datas) >= 2;
        END LOOP;
        data_inicio := coalesce(v_datas[1], p_data_atividade);
        -- Término só se o período trouxer a 2ª data (e ela não for antes do início).
        data_fim := CASE WHEN cardinality(v_datas) >= 2 AND v_datas[2] >= data_inicio THEN v_datas[2] END;
    ELSIF v_slug IN ('dia_a_dia', 'especiais') THEN
        data_inicio := p_data_atividade;
        data_fim := NULL;
    END IF;
    RETURN NEXT;
END;
$$;

-- Só usada por dentro das funções do servidor (SECURITY DEFINER); ninguém chama direto.
REVOKE ALL ON FUNCTION public.pgm_datas_padrao(text, date, text) FROM PUBLIC, anon, authenticated;

UPDATE public.atividades_mensais a
SET data_fim = NULL
FROM public.campanhas_mensais c
WHERE c.id = a.campanha_id
  AND c.ano = 2026 AND c.mes = 10
  AND public.pgm_slug_categoria(a.categoria) IN ('dia_a_dia', 'especiais')
  AND a.data_fim IS NOT NULL
  AND a.data_fim = a.data_inicio;
