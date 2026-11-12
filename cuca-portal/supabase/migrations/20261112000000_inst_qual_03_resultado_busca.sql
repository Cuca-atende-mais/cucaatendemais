-- S-INST-QUAL-03: registrar o resultado de cada busca do motor-agente em rag_retrieval_logs.
--
-- Hoje o `error` de `buscar_chunks_similares` é ignorado: uma busca que falhou vira
-- `camada = 'sem_match_rag'`, igual a uma busca que não achou nada. As colunas abaixo separam
-- os dois casos sem mudar `camada` (o alarme de busca vazia da S-INST-QUAL-02 continua lendo
-- `camada` como antes).
--
-- Aditiva e idempotente: colunas novas, todas aceitam vazio, sem valor padrão e sem CHECK.
-- Sem CHECK de propósito: um valor fora da lista faria o insert do turno inteiro falhar, e o
-- registro some em silêncio (o motor não espera nem confere esse insert). A lista de valores
-- é garantida pelo tipo no código e documentada nos comentários das colunas.

alter table public.rag_retrieval_logs add column if not exists resolucao_atividade text;
alter table public.rag_retrieval_logs add column if not exists resultado_busca text;
alter table public.rag_retrieval_logs add column if not exists p_limite int;
alter table public.rag_retrieval_logs add column if not exists erro text;

comment on column public.rag_retrieval_logs.resolucao_atividade is
  'S-INST-QUAL-03: resultado das buscas determinísticas de atividade (metadata e texto) no turno: encontrada | nao_encontrada | ambigua | sem_documento. NULL quando o turno não passou por elas.';
comment on column public.rag_retrieval_logs.resultado_busca is
  'S-INST-QUAL-03: resultado da chamada a buscar_chunks_similares no turno: sucesso_com_resultado | sucesso_vazio | erro | nao_aplicavel (turno sem busca vetorial).';
comment on column public.rag_retrieval_logs.p_limite is
  'S-INST-QUAL-03: p_limite pedido na chamada a buscar_chunks_similares. NULL quando não houve busca.';
comment on column public.rag_retrieval_logs.erro is
  'S-INST-QUAL-03: mensagem de erro devolvida por buscar_chunks_similares, quando resultado_busca = erro.';
