-- Remove o "Resumo de Rede - Atividades por Unidade - 7/2026" (tipo resumo_rede).
--
-- Documento inserido à mão em 13/07/2026 como provisório e nunca substituído. Em outubro o
-- motor-agente ainda o colocava inteiro no prompt de perguntas sem unidade e respondia com a
-- lista de cursos de julho (conversa 1657d9b0, 09/10/2026, Libras). A partir desta
-- correção a programação de atividades vem só do monthly_program ativo de cada unidade, e o
-- motor-agente deixou de ler resumo_rede.
--
-- Já aplicado direto em produção em 09/10/2026 (backup do conteúdo em
-- backups/resumo_rede_7-2026_excluido_2026-10-09.md). Idempotente: rodar de novo não faz nada.
-- Não há chunks (resumo_rede não é indexado); a FK de chunks_documentos é ON DELETE CASCADE.

DELETE FROM public.documentos_rag
WHERE id = '8b0b4157-7024-421d-bdc3-a7d5ec944d6a'
  AND tipo = 'resumo_rede';
