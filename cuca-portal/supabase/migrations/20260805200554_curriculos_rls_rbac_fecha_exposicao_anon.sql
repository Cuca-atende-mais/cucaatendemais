-- ============================================================================
-- Fecha exposição pública da tabela `curriculos` e aplica RBAC granular
-- ============================================================================
--
-- PROBLEMA (crítico, LGPD):
--   A policy `curriculos_all` era `FOR ALL USING (true)` sem restrição de role.
--   Combinada com a rota `/empregabilidade/print` estar na whitelist pública do
--   middleware, isso permitia que QUALQUER pessoa na internet listasse todos os
--   currículos (nome, telefone, e-mail, endereço) usando apenas a chave anon —
--   que está embutida no bundle JS público do portal e é trivial de extrair.
--   Confirmado empiricamente em 2026-08-05 contra produção.
--
-- DECISÃO (Junior, 2026-08-05): fechar por RBAC, sem conceder permissão nova a
--   ninguém. Currículo é acessível apenas a quem tem o módulo `empreg_curriculos`
--   no RBAC — estar logado não basta.
--
-- IMPACTO MEDIDO (16 colaboradores ativos, simulado antes de aplicar):
--   MANTÉM acesso (11): Admin Empregabilidade (8, CRUD completo),
--                       Developer (2, bypass), Super Admin Cuca (1, bypass).
--   PERDE acesso (5):   Gerente (4) e Institucional (1) — não têm o módulo
--                       `empreg_curriculos` cadastrado. Perda intencional,
--                       conforme decisão acima; se um Gerente precisar, o
--                       caminho correto é conceder a permissão pela tela de RBAC,
--                       não reabrir a policy.
--
-- NOTA sobre nomes de recurso: o RBAC tem dois sistemas. O antigo (`permissoes`)
--   usa recurso 'empregabilidade'; o novo (`sys_permissions`) usa módulo
--   'empreg_curriculos'. `has_permission` casa o novo via `module LIKE recurso||'%'`,
--   então 'empregabilidade' NÃO casa 'empreg_curriculos'. Zero colaboradores passam
--   pelo sistema antigo hoje (verificado) — por isso a policy usa o nome do novo.
--
-- Idempotente e retrocompatível (expand/contract: cria as novas antes de remover
-- a permissiva; DROP ... IF EXISTS em tudo).
-- ============================================================================

-- Garante RLS ligada (já estava, mas idempotente e explícito)
ALTER TABLE public.curriculos ENABLE ROW LEVEL SECURITY;

-- ── Policies granulares por ação, restritas ao role `authenticated` ──────────
-- `TO authenticated` é defesa em profundidade: o role `anon` deixa de ter
-- qualquer policy aplicável e passa a ser negado mesmo que uma futura policy
-- permissiva seja adicionada por engano.

DROP POLICY IF EXISTS curriculos_select_rbac ON public.curriculos;
CREATE POLICY curriculos_select_rbac ON public.curriculos
    FOR SELECT
    TO authenticated
    USING (public.has_permission('empreg_curriculos', 'read'));

DROP POLICY IF EXISTS curriculos_insert_rbac ON public.curriculos;
CREATE POLICY curriculos_insert_rbac ON public.curriculos
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_permission('empreg_curriculos', 'create'));

DROP POLICY IF EXISTS curriculos_update_rbac ON public.curriculos;
CREATE POLICY curriculos_update_rbac ON public.curriculos
    FOR UPDATE
    TO authenticated
    USING (public.has_permission('empreg_curriculos', 'update'))
    WITH CHECK (public.has_permission('empreg_curriculos', 'update'));

DROP POLICY IF EXISTS curriculos_delete_rbac ON public.curriculos;
CREATE POLICY curriculos_delete_rbac ON public.curriculos
    FOR DELETE
    TO authenticated
    USING (public.has_permission('empreg_curriculos', 'delete'));

-- ── Só depois de as novas existirem, remove a permissiva ────────────────────
DROP POLICY IF EXISTS curriculos_all ON public.curriculos;

-- ============================================================================
-- RPC de salvamento — fecha a escrita
-- ============================================================================
-- `salvar_curriculo_estruturado` é SECURITY DEFINER: ela IGNORA as policies
-- acima. Fechar só a tabela deixaria a escrita aberta a qualquer colaborador
-- logado, mesmo sem permissão de currículos. A checagem tem que estar dentro.
--
-- Mudança: troca o gate "é colaborador" por checagem de permissão RBAC, com
-- create/update verificados separadamente no ramo correspondente. Todo o resto
-- da lógica (validações, upsert transacional, sincronização com talent_bank)
-- permanece idêntico ao original.

CREATE OR REPLACE FUNCTION public.salvar_curriculo_estruturado(
    p_talent_id uuid,
    p_curriculo_id uuid DEFAULT NULL::uuid,
    p_dados jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_curriculo_id uuid;
    v_nome text;
    v_telefone text;
    v_pode_criar boolean;
    v_pode_editar boolean;
BEGIN
    v_pode_criar  := public.has_permission('empreg_curriculos', 'create');
    v_pode_editar := public.has_permission('empreg_curriculos', 'update');

    IF NOT (v_pode_criar OR v_pode_editar) THEN
        RAISE EXCEPTION 'Usuario nao autorizado: sem permissao para salvar curriculos.'
            USING ERRCODE = '42501';
    END IF;

    IF p_talent_id IS NULL THEN
        RAISE EXCEPTION 'Candidato e obrigatorio.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.talent_bank
        WHERE id = p_talent_id
    ) THEN
        RAISE EXCEPTION 'Candidato nao encontrado.' USING ERRCODE = 'P0002';
    END IF;

    IF p_dados IS NULL THEN
        p_dados := '{}'::jsonb;
    END IF;

    IF p_curriculo_id IS NOT NULL THEN
        IF NOT v_pode_editar THEN
            RAISE EXCEPTION 'Usuario nao autorizado: sem permissao para editar curriculos.'
                USING ERRCODE = '42501';
        END IF;

        UPDATE public.curriculos
        SET dados = p_dados,
            updated_at = now()
        WHERE id = p_curriculo_id
          AND talent_id = p_talent_id
          AND deleted_at IS NULL
        RETURNING id INTO v_curriculo_id;
    END IF;

    IF v_curriculo_id IS NULL THEN
        SELECT id
        INTO v_curriculo_id
        FROM public.curriculos
        WHERE talent_id = p_talent_id
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 1;

        IF v_curriculo_id IS NOT NULL THEN
            IF NOT v_pode_editar THEN
                RAISE EXCEPTION 'Usuario nao autorizado: sem permissao para editar curriculos.'
                    USING ERRCODE = '42501';
            END IF;

            UPDATE public.curriculos
            SET dados = p_dados,
                updated_at = now()
            WHERE id = v_curriculo_id;
        ELSE
            IF NOT v_pode_criar THEN
                RAISE EXCEPTION 'Usuario nao autorizado: sem permissao para criar curriculos.'
                    USING ERRCODE = '42501';
            END IF;

            INSERT INTO public.curriculos (talent_id, dados)
            VALUES (p_talent_id, p_dados)
            RETURNING id INTO v_curriculo_id;
        END IF;
    END IF;

    v_nome := NULLIF(btrim(COALESCE(p_dados->>'nome', '')), '');
    v_telefone := NULLIF(btrim(COALESCE(p_dados->>'telefone', '')), '');

    UPDATE public.talent_bank
    SET nome = COALESCE(v_nome, nome),
        telefone = COALESCE(v_telefone, telefone),
        curriculo_estruturado = p_dados,
        updated_at = now()
    WHERE id = p_talent_id;

    RETURN v_curriculo_id;
END;
$function$;
