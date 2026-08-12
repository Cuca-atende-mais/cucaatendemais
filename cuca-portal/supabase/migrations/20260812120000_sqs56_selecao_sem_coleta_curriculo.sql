-- SQS-56: seleção por evento sem coleta prévia de currículo.
--
-- Aditiva e idempotente. `coleta_curriculo` é NOT NULL DEFAULT true — toda
-- seleção existente e toda vaga_normal mantêm o comportamento atual sem
-- qualquer mudança (AC3/AC17). `telefone_contato` é registro do número
-- digitado pelo candidato na confirmação de presença; `candidaturas.telefone`
-- continua sendo a identidade (número do WhatsApp) — não são a mesma coisa,
-- ver análise de impacto da story (Item 3).

ALTER TABLE public.vagas
    ADD COLUMN IF NOT EXISTS coleta_curriculo boolean NOT NULL DEFAULT true;

ALTER TABLE public.vagas
    ADD COLUMN IF NOT EXISTS observacoes_selecao text;

ALTER TABLE public.candidaturas
    ADD COLUMN IF NOT EXISTS telefone_contato text;

COMMENT ON COLUMN public.vagas.coleta_curriculo IS
'SQS-56: false = seleção por evento sem coleta prévia de currículo (só presença). DEFAULT true preserva o comportamento atual.';
COMMENT ON COLUMN public.vagas.observacoes_selecao IS
'SQS-56: observações exibidas ao candidato na convocação (ex: levar RG, currículo impresso).';
COMMENT ON COLUMN public.candidaturas.telefone_contato IS
'SQS-56: número informado pelo candidato na confirmação de presença — registro para avisos/disparos futuros. Não substitui candidaturas.telefone (identidade).';
