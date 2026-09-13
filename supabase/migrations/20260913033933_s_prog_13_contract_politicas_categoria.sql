-- S-PROG-13 (contract): políticas por categoria na programação mensal.
-- NÃO APLICAR antes de: (1) merge + redeploy do portal com a S-PROG-13; (2) reexecutar a migration
-- `20260913012633_s_prog_12_espelha_permissoes_programacao` (a tela antiga de Perfis apaga as linhas
-- pgm_* ao salvar); (3) confirmar no EasyPanel que o cuca-worker tem SUPABASE_SERVICE_ROLE_KEY
-- (o worker cai na chave anônima se ela faltar, e estas políticas não liberam leitura anônima).
-- Ao aplicar, mover este arquivo para supabase/migrations com a versão devolvida pelo servidor.

-- Quem pode ler a lista de campanhas: qualquer opção da programação mensal ou da Divulgação.
CREATE OR REPLACE FUNCTION public.pgm_pode_ler_campanhas()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.is_developer() THEN
        RETURN TRUE;
    END IF;
    RETURN public.has_permission_exata('pgm_lista', 'read')
        OR public.has_permission_exata('pgm_criar_zero', 'read')
        OR public.has_permission_exata('pgm_duplicar', 'read')
        OR public.has_permission_exata('pgm_importar_planilha', 'read')
        OR public.has_permission_exata('pgm_rag_aprovar', 'read')
        OR public.has_permission_exata('pgm_disparo_global', 'read')
        OR public.has_permission_exata('divulgacao', 'read')
        OR EXISTS (
            SELECT 1 FROM unnest(ARRAY['ESPORTES', 'CURSOS', 'DIA A DIA', 'ESPECIAIS']) AS c(nome)
            WHERE public.pgm_pode_categoria(c.nome, 'read')
        );
END;
$$;

REVOKE ALL ON FUNCTION public.pgm_pode_ler_campanhas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pgm_pode_ler_campanhas() TO authenticated, service_role;

-- atividades_mensais
DROP POLICY IF EXISTS "Atividades: Deleção permitida com permissão" ON public.atividades_mensais;
DROP POLICY IF EXISTS "Atividades: Criação permitida com permissão" ON public.atividades_mensais;
DROP POLICY IF EXISTS "Atividades: Leitura restrita por unidade ou developer" ON public.atividades_mensais;
DROP POLICY IF EXISTS "Atividades: Atualização permitida com permissão" ON public.atividades_mensais;
DROP POLICY IF EXISTS "atividades_mensais_leitura_categoria" ON public.atividades_mensais;
DROP POLICY IF EXISTS "atividades_mensais_insercao_categoria" ON public.atividades_mensais;
DROP POLICY IF EXISTS "atividades_mensais_alteracao_categoria" ON public.atividades_mensais;
DROP POLICY IF EXISTS "atividades_mensais_exclusao_categoria" ON public.atividades_mensais;

CREATE POLICY "atividades_mensais_leitura_categoria" ON public.atividades_mensais
    FOR SELECT TO authenticated
    USING (
        public.is_developer()
        OR (
            (unidade_cuca IS NULL OR unidade_cuca::text = public.get_my_unit() OR public.get_my_unit() IS NULL)
            AND public.pgm_pode_categoria(categoria, 'read')
        )
    );
CREATE POLICY "atividades_mensais_insercao_categoria" ON public.atividades_mensais
    FOR INSERT TO authenticated
    WITH CHECK (public.pgm_pode_categoria(categoria, 'create'));
CREATE POLICY "atividades_mensais_alteracao_categoria" ON public.atividades_mensais
    FOR UPDATE TO authenticated
    USING (public.pgm_pode_categoria(categoria, 'update'))
    WITH CHECK (public.pgm_pode_categoria(categoria, 'update'));
CREATE POLICY "atividades_mensais_exclusao_categoria" ON public.atividades_mensais
    FOR DELETE TO authenticated
    USING (public.pgm_pode_categoria(categoria, 'delete'));

-- campanhas_mensais
DROP POLICY IF EXISTS "Campanhas: Deleção permitida com permissão" ON public.campanhas_mensais;
DROP POLICY IF EXISTS "Campanhas: Criação permitida com permissão" ON public.campanhas_mensais;
DROP POLICY IF EXISTS "Campanhas: Leitura restrita por unidade ou developer" ON public.campanhas_mensais;
DROP POLICY IF EXISTS "Campanhas: Atualização permitida com permissão" ON public.campanhas_mensais;
DROP POLICY IF EXISTS "campanhas_mensais_leitura" ON public.campanhas_mensais;
DROP POLICY IF EXISTS "campanhas_mensais_insercao" ON public.campanhas_mensais;
DROP POLICY IF EXISTS "campanhas_mensais_alteracao_developer" ON public.campanhas_mensais;
DROP POLICY IF EXISTS "campanhas_mensais_exclusao" ON public.campanhas_mensais;

CREATE POLICY "campanhas_mensais_leitura" ON public.campanhas_mensais
    FOR SELECT TO authenticated
    USING (
        public.is_developer()
        OR (
            (unidade_cuca IS NULL OR unidade_cuca::text = public.get_my_unit() OR public.get_my_unit() IS NULL)
            AND public.pgm_pode_ler_campanhas()
        )
    );
CREATE POLICY "campanhas_mensais_insercao" ON public.campanhas_mensais
    FOR INSERT TO authenticated
    WITH CHECK (
        public.has_permission_exata('pgm_criar_zero', 'read')
        OR public.has_permission_exata('pgm_duplicar', 'read')
        OR public.has_permission_exata('pgm_importar_planilha', 'read')
    );
-- Status e demais mudanças passam pelas rotas do servidor (chave de serviço, checagem exata).
CREATE POLICY "campanhas_mensais_alteracao_developer" ON public.campanhas_mensais
    FOR UPDATE TO authenticated
    USING (public.is_developer())
    WITH CHECK (public.is_developer());
CREATE POLICY "campanhas_mensais_exclusao" ON public.campanhas_mensais
    FOR DELETE TO authenticated
    USING (public.has_permission_exata('pgm_excluir_programacao', 'read'));

-- campanha_historico
DROP POLICY IF EXISTS "Historico: insercao com permissao" ON public.campanha_historico;
DROP POLICY IF EXISTS "Historico: leitura com permissao" ON public.campanha_historico;
DROP POLICY IF EXISTS "campanha_historico_leitura" ON public.campanha_historico;
DROP POLICY IF EXISTS "campanha_historico_insercao_developer" ON public.campanha_historico;

CREATE POLICY "campanha_historico_leitura" ON public.campanha_historico
    FOR SELECT TO authenticated
    USING (public.has_permission_exata('pgm_historico', 'read'));
-- O histórico é gravado pela rota de status, com a chave de serviço.
CREATE POLICY "campanha_historico_insercao_developer" ON public.campanha_historico
    FOR INSERT TO authenticated
    WITH CHECK (public.is_developer());

-- A função antiga apagava a campanha inteira ao salvar; o portal novo usa a por categoria.
REVOKE EXECUTE ON FUNCTION public.programacao_salvar_rascunho(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
