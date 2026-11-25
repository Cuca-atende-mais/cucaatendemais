-- S-EMP-GES-13, parte 2 de 2: obrigatoriedade das unidades no banco.
-- APLICAR SÓ DEPOIS DO REDEPLOY DO PORTAL. Antes disso, o portal em produção ainda cria vagas sem
-- unidade_tratamento e esta recusa travaria todo cadastro de vaga e seleção (pelo link e pelo modal).
-- Idempotente.
--
-- - INSERT sem Unidade de Tratamento ou sem Unidade de Currículos é recusado, com a mesma frase das telas.
-- - UPDATE nunca é recusado por falta de unidade (D12): as vagas que já existiam seguem como antes. A única
--   trava é não esvaziar uma Unidade de Tratamento já gravada; a exclusão de uma unidade (ON DELETE SET NULL)
--   continua permitida.
-- - Repete a transferência da parte 1 para as vagas criadas entre a parte 1 e o deploy do portal.

CREATE OR REPLACE FUNCTION public.emp_vagas_exigir_unidades()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.unidade_tratamento IS NULL THEN
            RAISE EXCEPTION 'Preencha a unidade de tratamento.' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.unidade_destino IS NULL OR btrim(NEW.unidade_destino) = '' THEN
            RAISE EXCEPTION 'Preencha a unidade de currículos.' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.unidade_tratamento IS NOT NULL AND NEW.unidade_tratamento IS NULL
       AND EXISTS (SELECT 1 FROM unidades_cuca u WHERE u.id = OLD.unidade_tratamento) THEN
        RAISE EXCEPTION 'Preencha a unidade de tratamento.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emp_vagas_exigir_unidades() FROM PUBLIC, anon, authenticated;

-- Vagas criadas pelo portal antigo entre a parte 1 e o deploy.
ALTER TABLE public.vagas
    DISABLE TRIGGER tr_vagas_registrar_liberacao,
    DISABLE TRIGGER tr_vaga_index,
    DISABLE TRIGGER update_vagas_updated_at,
    DISABLE TRIGGER tr_vagas_copiar_unidade_tratamento;

WITH ativas AS (
    SELECT id, lower(btrim(nome)) AS nome FROM public.unidades_cuca WHERE ativo
),
calculo AS (
    SELECT v.id,
           COALESCE(
               (SELECT a.id FROM ativas a
                 WHERE a.id::text = btrim(v.unidade_cuca) OR a.nome = lower(btrim(v.unidade_cuca))
                 LIMIT 1),
               CASE WHEN v.tipo IS DISTINCT FROM 'selecao_evento' THEN
                   (SELECT a.id FROM ativas a WHERE a.id::text = btrim(v.unidade_destino) LIMIT 1)
               END
           ) AS unidade
    FROM public.vagas v
    WHERE v.unidade_tratamento IS NULL
)
UPDATE public.vagas v
SET unidade_tratamento = c.unidade
FROM calculo c
WHERE v.id = c.id AND c.unidade IS NOT NULL;

ALTER TABLE public.vagas
    ENABLE TRIGGER tr_vagas_registrar_liberacao,
    ENABLE TRIGGER tr_vaga_index,
    ENABLE TRIGGER update_vagas_updated_at,
    ENABLE TRIGGER tr_vagas_copiar_unidade_tratamento;

DROP TRIGGER IF EXISTS tr_vagas_exigir_unidades ON public.vagas;
CREATE TRIGGER tr_vagas_exigir_unidades
    BEFORE INSERT OR UPDATE ON public.vagas
    FOR EACH ROW EXECUTE FUNCTION public.emp_vagas_exigir_unidades();
