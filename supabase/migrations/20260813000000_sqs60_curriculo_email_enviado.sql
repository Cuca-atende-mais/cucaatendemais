-- SQS-60: rastreia se o currículo público já teve email de confirmação
-- enviado, pra não reenviar em edições seguintes do mesmo currículo.

ALTER TABLE public.talent_bank
    ADD COLUMN IF NOT EXISTS email_enviado_em timestamptz;

COMMENT ON COLUMN public.talent_bank.email_enviado_em IS
'SQS-60: timestamp do envio do email de confirmação do currículo público (opt-in). NULL = nunca enviado. Só o primeiro salvamento com o checkbox marcado envia; edições seguintes não reenviam.';
