-- S-EMP-GES-02 (ajuste pós-produção, 2026-10-19): selo "Feedback" na lista do Atendimento.
--
-- No envio do pedido de feedback à empresa, o portal pausa a IA na conversa (status
-- 'awaiting_human') e grava aqui a validade do link (feedback_solicitacoes.expires_at). A lista do
-- Atendimento mostra o selo enquanto essa data não passou, então ele some sozinho, sem limpeza.
--
-- Fica em `conversas`, e não numa leitura de `feedback_solicitacoes`, porque essa tabela só é visível
-- com a permissão epm_feedback_ver e guarda o token do link: quem atende já enxerga a conversa, mas não
-- deve passar a enxergar o token.
--
-- Aditiva e retrocompatível: coluna nula, sem default (só metadado, sem reescrever a tabela). Nenhum
-- leitor atual depende dela; o worker não a escreve (o upsert de conversas lista as colunas).
-- Idempotente: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.conversas
    ADD COLUMN IF NOT EXISTS feedback_pedido_ate timestamptz;

COMMENT ON COLUMN public.conversas.feedback_pedido_ate IS
    'S-EMP-GES-02: validade do link do último pedido de feedback enviado nesta conversa. Usada só para o selo "Feedback" do Atendimento.';
