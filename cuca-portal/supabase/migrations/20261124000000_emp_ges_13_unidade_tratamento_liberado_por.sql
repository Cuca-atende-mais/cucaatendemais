-- S-EMP-GES-13, parte 1 de 2: Unidade de Tratamento e "Liberado por".
-- Só acrescenta: não recusa nada. Pode ser aplicada antes do deploy do portal, porque o portal antigo
-- continua criando e editando vagas como antes (a obrigatoriedade fica na parte 2,
-- 20261124000100_emp_ges_13_obrigatoriedade_unidades.sql, aplicada depois do deploy).
-- Idempotente.
--
-- 1. vagas.unidade_tratamento: a unidade que cuida da vaga. Sucessora da "Ancoragem" (unidade_cuca), com o
--    mesmo peso e a mesma finalidade (D13). Só unidade específica.
-- 2. vagas.liberada_por_usuario: o usuário do login que passou a vaga de rascunho para aberta. Gravado mesmo
--    quando a pessoa não tem cadastro de colaborador. Sem nome ou e-mail na tabela: a RLS deixa `anon` ler as
--    vagas abertas, então o nome é resolvido pela função emp_vagas_liberado_por, que exige permissão.
-- 3. Cópia do nome da Unidade de Tratamento para unidade_cuca, só quando a unidade é gravada ou trocada:
--    o worker continua lendo unidade_cuca nas mensagens, sem mudar código.
-- 4. Transferência dos dados que já existem, com os gatilhos de `vagas` desligados (AC5c): sem isso o gatilho
--    de liberação desfaria a herança de liberada_por_usuario, o tr_vaga_index reescreveria o RAG das vagas
--    abertas e o updated_at das vagas mudaria sem ninguém as ter editado.

-- ── Colunas ────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.vagas ADD COLUMN IF NOT EXISTS unidade_tratamento uuid NULL;
ALTER TABLE public.vagas ADD COLUMN IF NOT EXISTS liberada_por_usuario uuid NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'vagas_unidade_tratamento_fkey' AND conrelid = 'public.vagas'::regclass
    ) THEN
        ALTER TABLE public.vagas
            ADD CONSTRAINT vagas_unidade_tratamento_fkey
            FOREIGN KEY (unidade_tratamento) REFERENCES public.unidades_cuca(id) ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_vagas_unidade_tratamento ON public.vagas(unidade_tratamento);

COMMENT ON COLUMN public.vagas.unidade_tratamento IS
    'S-EMP-GES-13: unidade que cuida da vaga/seleção (só unidade específica). Sucessora da Ancoragem (unidade_cuca); o nome é copiado para unidade_cuca quando esta coluna é gravada.';
COMMENT ON COLUMN public.vagas.liberada_por_usuario IS
    'S-EMP-GES-13: auth.users.id de quem passou a vaga de rascunho para aberta (primeira liberação). Nome resolvido por emp_vagas_liberado_por.';

-- ── Gatilho de liberação: passa a gravar o usuário do login e a hora mesmo sem colaborador ──────────────
CREATE OR REPLACE FUNCTION public.emp_vagas_registrar_liberacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario uuid;
    v_colaborador uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'aberta' THEN
            RAISE EXCEPTION 'Vaga não pode ser criada já publicada: ela nasce em pré-cadastro e é liberada depois pela equipe de Empregabilidade.'
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.liberada_por := NULL;
        NEW.liberada_em := NULL;
        NEW.liberada_por_usuario := NULL;
        RETURN NEW;
    END IF;

    -- Valores enviados pelo cliente são sempre descartados.
    NEW.liberada_por := OLD.liberada_por;
    NEW.liberada_em := OLD.liberada_em;
    NEW.liberada_por_usuario := OLD.liberada_por_usuario;

    -- Só a primeira liberação registra o autor. Liberação sem login (serviço) não registra.
    IF NEW.status = 'aberta' AND OLD.status IS DISTINCT FROM 'aberta' AND OLD.liberada_em IS NULL THEN
        v_usuario := auth.uid();
        IF v_usuario IS NOT NULL THEN
            SELECT c.id INTO v_colaborador FROM colaboradores c WHERE c.user_id = v_usuario LIMIT 1;
            NEW.liberada_por := v_colaborador;
            NEW.liberada_por_usuario := v_usuario;
            NEW.liberada_em := now();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emp_vagas_registrar_liberacao() FROM PUBLIC, anon, authenticated;

-- ── Cópia do nome da Unidade de Tratamento para unidade_cuca ─────────────────────────────────────────────
-- Só quando a unidade é gravada (INSERT) ou trocada: uma mudança de status em vaga antiga não reescreve a
-- Ancoragem histórica.
CREATE OR REPLACE FUNCTION public.emp_vagas_copiar_unidade_tratamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_nome text;
BEGIN
    IF NEW.unidade_tratamento IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.unidade_tratamento IS NOT DISTINCT FROM OLD.unidade_tratamento THEN
        RETURN NEW;
    END IF;
    SELECT u.nome INTO v_nome FROM unidades_cuca u WHERE u.id = NEW.unidade_tratamento;
    IF v_nome IS NOT NULL THEN
        NEW.unidade_cuca := v_nome;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emp_vagas_copiar_unidade_tratamento() FROM PUBLIC, anon, authenticated;

-- ── Nome de quem liberou, só para quem pode ver vagas ou seleções ───────────────────────────────────────
-- Nome do cadastro do colaborador do login; se vazio, o e-mail do login. Vaga sem autor não volta.
CREATE OR REPLACE FUNCTION public.emp_vagas_liberado_por(p_vaga_ids uuid[])
RETURNS TABLE (vaga_id uuid, nome text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT (public.has_permission('empreg_vagas', 'read') OR public.has_permission('empreg_selecao', 'read')) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT v.id,
           COALESCE(
               NULLIF(btrim(c_login.nome_completo), ''),
               NULLIF(btrim(c_lib.nome_completo), ''),
               NULLIF(btrim(u.email::text), ''),
               NULLIF(btrim(c_lib.email), '')
           )::text
    FROM vagas v
    LEFT JOIN LATERAL (
        SELECT c.nome_completo FROM colaboradores c
        WHERE v.liberada_por_usuario IS NOT NULL AND c.user_id = v.liberada_por_usuario
        LIMIT 1
    ) c_login ON true
    LEFT JOIN colaboradores c_lib ON c_lib.id = v.liberada_por
    LEFT JOIN auth.users u ON u.id = COALESCE(v.liberada_por_usuario, c_lib.user_id)
    WHERE v.id = ANY(p_vaga_ids)
      AND (v.liberada_por_usuario IS NOT NULL OR v.liberada_por IS NOT NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emp_vagas_liberado_por(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emp_vagas_liberado_por(uuid[]) TO authenticated;

-- ── Transferência dos dados que já existem (gatilhos desligados) ────────────────────────────────────────
ALTER TABLE public.vagas
    DISABLE TRIGGER tr_vagas_registrar_liberacao,
    DISABLE TRIGGER tr_vaga_index,
    DISABLE TRIGGER update_vagas_updated_at;

-- Unidade de Tratamento: 1º a Ancoragem (unidade_cuca, por UUID ou nome); 2º, só em vaga comum, o destino
-- específico (unidade_destino); senão fica nula ("Toda a Rede", "Todas", vazio ou valor desconhecido).
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

-- Quem liberou: o usuário do login do colaborador já registrado (GES-04).
UPDATE public.vagas v
SET liberada_por_usuario = c.user_id
FROM public.colaboradores c
WHERE c.id = v.liberada_por
  AND v.liberada_por_usuario IS NULL
  AND c.user_id IS NOT NULL;

ALTER TABLE public.vagas
    ENABLE TRIGGER tr_vagas_registrar_liberacao,
    ENABLE TRIGGER tr_vaga_index,
    ENABLE TRIGGER update_vagas_updated_at;

-- Criado depois da transferência, para ela não copiar nada para unidade_cuca.
DROP TRIGGER IF EXISTS tr_vagas_copiar_unidade_tratamento ON public.vagas;
CREATE TRIGGER tr_vagas_copiar_unidade_tratamento
    BEFORE INSERT OR UPDATE ON public.vagas
    FOR EACH ROW EXECUTE FUNCTION public.emp_vagas_copiar_unidade_tratamento();
