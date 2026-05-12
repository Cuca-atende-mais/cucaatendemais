# SQS-54 - Empregabilidade - Publicacao de vaga nao deve falhar por RAG sem conteudo

## Status
InProgress

## Contexto
Ao mudar uma vaga de rascunho/pre-cadastro para aberta/publica, o banco retornava:

`null value in column "conteudo" of relation "documentos_rag" violates not-null constraint`

O erro ocorria no trigger `tr_vaga_index`, executado em `public.vagas`, que cria/atualiza o documento RAG da vaga em `public.documentos_rag`.

## Diagnostico
A funcao `public.trigger_indexar_vaga()` montava o campo `conteudo` por concatenacao direta.

Quando `NEW.local` e `NEW.unidade_cuca` vinham nulos, a parte final:

`'LOCAL: ' || COALESCE(NEW.local, NEW.unidade_cuca)`

retornava `NULL`, contaminando toda a concatenacao e tentando inserir `conteudo = NULL` em `documentos_rag`, coluna marcada como `NOT NULL`.

## Implementacao
Foram criadas as migrations:

- `cuca-portal/supabase/migrations/20260512154109_fix_vaga_rag_conteudo_not_null.sql`
- `cuca-portal/supabase/migrations/20260512154334_secure_trigger_indexar_vaga_execute.sql`

A funcao `public.trigger_indexar_vaga()` agora:

- monta campos intermediarios com fallback seguro;
- usa `concat_ws(E'\n', ...)` para montar o texto final;
- usa `NEW.unidade_destino` como fallback adicional de local;
- cai para `Nao informado` quando nenhum local/unidade estiver disponivel;
- atualiza `tipo = 'job_posting'` tambem quando o documento ja existe.
- revoga `EXECUTE` publico/autenticado da funcao de trigger, mantendo o uso pelo trigger do banco.

## Criterios de Aceite
- [x] Publicar vaga nao deve tentar inserir `documentos_rag.conteudo = NULL`.
- [x] Funcao de trigger atualizada em producao via Supabase migration.
- [x] Execucao direta da funcao de trigger revogada de `PUBLIC`, `anon` e `authenticated`.
- [x] Migration local adicionada ao repositorio.
- [ ] Smoke test manual: alterar uma vaga rascunho/pre-cadastro para aberta/publica no portal.

## QA
- [x] SQL de simulacao confirmou conteudo nao nulo mesmo sem local/unidade.
- [x] SQL confirmou que `public.trigger_indexar_vaga()` ativa contem `v_conteudo := concat_ws`.
- [x] Supabase advisor consultado; avisos antigos permanecem, e a funcao tocada recebeu `REVOKE EXECUTE`.
- [ ] `npm run lint` nao executado: alteracao limitada a DDL/migration SQL.
- [ ] `npm run typecheck` nao executado: alteracao limitada a DDL/migration SQL.
- [ ] `npm test` nao executado: alteracao limitada a DDL/migration SQL.

## File List
- `cuca-portal/supabase/migrations/20260512154109_fix_vaga_rag_conteudo_not_null.sql`
- `cuca-portal/supabase/migrations/20260512154334_secure_trigger_indexar_vaga_execute.sql`
- `docs/stories/SQS-54-Empregabilidade-Publicacao-Vaga-RAG-Conteudo.md`
