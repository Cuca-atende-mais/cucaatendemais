-- S-EMP-FSL-01 — Fundação do fluxo do candidato 100% no WhatsApp (sem link).
--
-- Cria o interruptor (feature flag) que liga/desliga o fluxo sem link, guardado na tabela
-- reaproveitada `system_config` (chave/valor, já lida no portal e editável no menu Developer).
-- O worker lê este flag a cada conversa do Empregabilidade, ANTES de decidir link vs. fluxo novo.
--
-- Default: DESLIGADO (valor = 'false') => comportamento 100% idêntico ao de hoje (envio do link).
-- Leitura no worker é fail-closed: qualquer valor que não seja explicitamente verdadeiro
-- ('true'/'1'/'on'/'sim') é tratado como desligado.
--
-- Idempotente e não-destrutivo: `ON CONFLICT (chave) DO NOTHING` — se a linha já existir (ex.:
-- o Junior já ligou o flag manualmente pelo menu Developer), a migration NÃO re-desliga nem
-- sobrescreve o valor corrente. `chave` é PRIMARY KEY (confirmado em produção).
INSERT INTO public.system_config (chave, valor, descricao)
VALUES (
    'empreg_fluxo_sem_link',
    'false',
    'Empregabilidade — fluxo do candidato 100% no WhatsApp (sem link). Ligado = true/1/on/sim; qualquer outro valor = desligado. Default false. Controlado pelo menu Developer > Fluxo sem link (S-EMP-FSL-01).'
)
ON CONFLICT (chave) DO NOTHING;
