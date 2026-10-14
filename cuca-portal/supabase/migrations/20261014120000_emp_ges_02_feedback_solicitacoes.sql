-- S-EMP-GES-02: solicitação de feedback rastreada — um registro por pedido enviado à empresa, com os
-- candidatos marcados, o wamid da Meta e o status da mensagem (enviado/entregue/lido/falhou).
-- Idempotente e aditiva: só tabelas novas. Nada existente é alterado.
-- Escrita só pelas rotas do portal (service_role) e pelo webhook do worker; leitura com epm_feedback_ver.

CREATE TABLE IF NOT EXISTS public.feedback_solicitacoes (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vaga_id               uuid NOT NULL REFERENCES public.vagas(id) ON DELETE CASCADE,
    tipo                  text NOT NULL DEFAULT 'vaga' CHECK (tipo IN ('vaga', 'selecao')),
    empresa_id            uuid REFERENCES public.empresas(id) ON DELETE SET NULL,
    contato_nome          text,
    contato_telefone      text,
    contato_email         text,
    -- Link da página pública (GES-03). Nulo para seleção (GES-07, sem link).
    token                 text UNIQUE,
    expires_at            timestamptz,
    criado_por            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    wamid                 text,
    status_envio          text NOT NULL DEFAULT 'pendente'
                          CHECK (status_envio IN ('pendente', 'enviado', 'entregue', 'lido', 'falhou', 'aviso', 'apagada')),
    erro_envio            text,
    status_timestamp_meta timestamptz,
    respondido_em         timestamptz,
    conversa_id           uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
    CONSTRAINT feedback_solicitacoes_token_por_tipo CHECK (tipo = 'selecao' OR token IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS feedback_solicitacoes_vaga_idx ON public.feedback_solicitacoes (vaga_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_solicitacoes_empresa_idx ON public.feedback_solicitacoes (empresa_id);
CREATE INDEX IF NOT EXISTS feedback_solicitacoes_wamid_idx ON public.feedback_solicitacoes (wamid) WHERE wamid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.feedback_solicitacao_itens (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitacao_id  uuid NOT NULL REFERENCES public.feedback_solicitacoes(id) ON DELETE CASCADE,
    candidatura_id  uuid NOT NULL REFERENCES public.candidaturas(id) ON DELETE CASCADE,
    -- Preenchida pela página pública da empresa (GES-03).
    resposta_status text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT feedback_solicitacao_itens_unico UNIQUE (solicitacao_id, candidatura_id)
);

CREATE INDEX IF NOT EXISTS feedback_solicitacao_itens_candidatura_idx ON public.feedback_solicitacao_itens (candidatura_id);

ALTER TABLE public.feedback_solicitacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_solicitacao_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feedback_solicitacoes_select ON public.feedback_solicitacoes;
CREATE POLICY feedback_solicitacoes_select ON public.feedback_solicitacoes
    FOR SELECT TO authenticated
    USING (public.has_permission('epm_feedback_ver', 'read'));

DROP POLICY IF EXISTS feedback_solicitacao_itens_select ON public.feedback_solicitacao_itens;
CREATE POLICY feedback_solicitacao_itens_select ON public.feedback_solicitacao_itens
    FOR SELECT TO authenticated
    USING (public.has_permission('epm_feedback_ver', 'read'));

-- Sem policy de escrita: anon/authenticated não gravam. O token não pode vazar pela leitura direta.
REVOKE ALL ON public.feedback_solicitacoes FROM anon;
REVOKE ALL ON public.feedback_solicitacao_itens FROM anon;
-- TRUNCATE passa por cima da RLS: também sai.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.feedback_solicitacoes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.feedback_solicitacao_itens FROM authenticated;
