-- S-INST-QUAL-12 — Fecha duas funções do cofre (vault) que qualquer pessoa podia executar.
--
-- Achado em 03/11, ao preparar o e-mail da central de alertas:
--   - `get_resend_key()` (SECURITY DEFINER) devolve a chave do Resend do cofre;
--   - `update_vault_secret(p_name, p_value)` (SECURITY DEFINER) troca o valor de QUALQUER segredo
--     do cofre (chave da OpenAI, `supabase_anon_key` usada no gatilho de indexação, Resend).
--   As duas tinham EXECUTE para PUBLIC, `anon` e `authenticated`: bastava a chave pública do portal
--   (que vai no navegador) para ler a chave do Resend ou sobrescrever um segredo.
--
-- Quem chama hoje (conferido em 03/11):
--   - `update_vault_secret`: só a rota do portal `api/developer/update-vault-secret`, que confere a
--     conta Developer e chama com a chave de serviço (`service_role`);
--   - `get_resend_key`: só a Edge Function `send-cv-email`, com a chave de serviço (código baixado
--     do Supabase, ela não tem fonte no repositório); a nova `enviar-alerta-email` também usa a
--     chave de serviço. O worker e o portal não chamam com a chave pública.
--   O `service_role` continua com acesso, então nada que funciona hoje deixa de funcionar.
--
-- Idempotente: revoke/grant podem rodar de novo sem efeito.

revoke execute on function public.get_resend_key() from public, anon, authenticated;
grant execute on function public.get_resend_key() to service_role;

revoke execute on function public.update_vault_secret(text, text) from public, anon, authenticated;
grant execute on function public.update_vault_secret(text, text) to service_role;
