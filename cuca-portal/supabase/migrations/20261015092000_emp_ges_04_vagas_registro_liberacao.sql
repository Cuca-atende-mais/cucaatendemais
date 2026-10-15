-- S-EMP-GES-04 (AC11) + decisão do Junior (2026-10-14): o banco registra quem liberou a vaga/seleção.
-- - A liberação (status → 'aberta') é feita pela equipe de Empregabilidade dentro do portal. Na primeira
--   liberação, o gatilho grava o colaborador logado (auth.uid() → colaboradores) e a hora. Reabrir ou editar
--   uma vaga já aberta não troca o autor. Liberação sem colaborador logado (serviço) não grava autor; o
--   relatório usa o critério de reserva (destino → base → Rede).
-- - Os valores de liberada_por/liberada_em enviados pelo cliente são sempre descartados.
-- - Nenhuma vaga nasce publicada: INSERT com status 'aberta' é recusado. Toda vaga nasce em pré-cadastro e
--   passa pela análise do setor (decisão do Junior, 2026-10-14). Hoje nenhum caminho cria vaga aberta
--   (0 de 97 vagas); o cadastro do portal deixa de oferecer essa opção.
-- Gatilho escolhido no lugar de rota de servidor porque a RLS de `vagas` permite UPDATE direto do cliente
-- (empreg_vagas update): uma rota não garantiria o registro. Idempotente.

CREATE OR REPLACE FUNCTION public.emp_vagas_registrar_liberacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_colaborador uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'aberta' THEN
            RAISE EXCEPTION 'Vaga não pode ser criada já publicada: ela nasce em pré-cadastro e é liberada depois pela equipe de Empregabilidade.'
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.liberada_por := NULL;
        NEW.liberada_em := NULL;
        RETURN NEW;
    END IF;

    NEW.liberada_por := OLD.liberada_por;
    NEW.liberada_em := OLD.liberada_em;

    IF NEW.status = 'aberta' AND OLD.status IS DISTINCT FROM 'aberta' AND OLD.liberada_em IS NULL THEN
        SELECT c.id INTO v_colaborador FROM colaboradores c WHERE c.user_id = auth.uid() LIMIT 1;
        IF v_colaborador IS NOT NULL THEN
            NEW.liberada_por := v_colaborador;
            NEW.liberada_em := now();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emp_vagas_registrar_liberacao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_vagas_registrar_liberacao ON public.vagas;
CREATE TRIGGER tr_vagas_registrar_liberacao
    BEFORE INSERT OR UPDATE ON public.vagas
    FOR EACH ROW EXECUTE FUNCTION public.emp_vagas_registrar_liberacao();
