-- S-INST-QUAL-02 — Busca exata garantida: remove os índices vetoriais aproximados.
--
-- Por quê:
--   `buscar_chunks_similares` e `ae_buscar_chunks_similares` filtram unidade/tipo/ativo DEPOIS do
--   `ORDER BY embedding <=> ...`. Com um índice aproximado (ivfflat lists=100, probes=1), o banco
--   lê só a "gaveta" mais próxima do vetor da pergunta e aplica o filtro depois. Quando essa gaveta
--   não tem trecho da unidade pedida, a busca volta VAZIA, mesmo existindo conteúdo certo.
--
--   - 12 a 29/09/2026: 51% das buscas com unidade voltaram vazias (267 de 520).
--   - 30/09 a 02/11: o banco deixou de escolher o índice, 2 vazias em 999.
--   - 02/11 13:44 (reanálise automática da tabela): o banco voltou a usar o ivfflat; em 03/11,
--     das 12h às 15h UTC, 30 buscas vazias contra 9 com resultado.
--   - Medição em 03/11 (20 vetores, unidade diferente da origem): com índice 4/20 vazias no
--     Institucional e 11/20 na Academia Enem; sem índice 0/20 nos dois, mesma latência (~2 ms).
--
--   Com ~2,6 mil trechos no Institucional e 5 na Academia Enem, a busca exata (leitura de todos os
--   trechos filtrados) leva poucos milissegundos e nunca perde resultado por causa do filtro.
--
-- Quando recriar: só se a base passar de ~50 mil trechos. Nesse caso, recriar junto com uma busca
-- que filtre ANTES de ordenar (ou com `ivfflat.probes`/`hnsw.ef_search` ajustados e iterative scan),
-- e medir buscas vazias antes de ligar. SQL original, para reversão:
--   create index idx_chunks_documentos_embedding on public.chunks_documentos
--     using ivfflat (embedding vector_cosine_ops) with (lists = 100);
--   create index idx_chunks_embedding_hnsw on public.chunks_documentos
--     using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
--   create index idx_ae_chunks_embedding on public.ae_chunks_documentos
--     using ivfflat (embedding vector_cosine_ops) with (lists = 100);
--
-- Idempotente: `drop index if exists`. Não apaga nenhum trecho (nem de documentos inativos).

drop index if exists public.idx_chunks_documentos_embedding;
drop index if exists public.idx_chunks_embedding_hnsw;
drop index if exists public.idx_ae_chunks_embedding;
