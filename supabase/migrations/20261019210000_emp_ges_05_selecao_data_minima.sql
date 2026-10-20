-- S-EMP-GES-05: data da seleção por evento no mínimo hoje + 5 dias (fuso America/Fortaleza).
--
-- Defesa final no banco. A regra já é aplicada no formulário público, no modal interno e em
-- POST /api/empregabilidade/selecao (lib/empregabilidade/data-selecao-evento.ts).
-- Só em INSERT, nunca em UPDATE: editar uma seleção antiga continua funcionando (AC6).
-- Não é CHECK porque o CHECK seria reavaliado em todo update e travaria a edição.
-- Vaga normal (tipo <> 'selecao_evento') passa direto (AC7).
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.emp_vagas_selecao_evento_data_minima()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_minimo date := (now() AT TIME ZONE 'America/Fortaleza')::date + 5;
    v_item jsonb;
    v_texto text;
BEGIN
    IF NEW.tipo IS DISTINCT FROM 'selecao_evento' OR NEW.datas_selecao IS NULL
       OR jsonb_typeof(NEW.datas_selecao) <> 'array' THEN
        RETURN NEW;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.datas_selecao) LOOP
        v_texto := NULLIF(btrim(v_item->>'data'), '');
        CONTINUE WHEN v_texto IS NULL;

        IF v_texto !~ '^\d{4}-\d{2}-\d{2}$' THEN
            RAISE EXCEPTION 'Data da seleção inválida.' USING ERRCODE = 'check_violation';
        END IF;

        IF v_texto::date < v_minimo THEN
            RAISE EXCEPTION 'A data da seleção precisa ser a partir de % (5 dias a partir de hoje).',
                to_char(v_minimo, 'DD/MM/YYYY')
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.emp_vagas_selecao_evento_data_minima() IS
    'S-EMP-GES-05: recusa INSERT de selecao_evento com data em datas_selecao antes de hoje + 5 (America/Fortaleza).';

DROP TRIGGER IF EXISTS trg_vagas_selecao_evento_data_minima ON public.vagas;
CREATE TRIGGER trg_vagas_selecao_evento_data_minima
    BEFORE INSERT ON public.vagas
    FOR EACH ROW
    EXECUTE FUNCTION public.emp_vagas_selecao_evento_data_minima();
