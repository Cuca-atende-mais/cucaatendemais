/**
 * S-PROG-03 (item 2.1): fonte única do aviso que substitui a quantidade de vagas no texto que
 * alimenta o RAG (`atividades_mensais.descricao`).
 *
 * A quantidade de vagas continua gravada em `metadata.vagas` e continua saindo na exportação para
 * a gráfica (`handleExportarXLSX`) — sai apenas do que o agente conta ao cidadão, porque o número
 * muda com frequência e informar um valor desatualizado gera deslocamento perdido até a unidade.
 *
 * O mesmo texto existe, propositalmente duplicado, em `supabase/functions/motor-agente/index.ts`
 * (`AVISO_VAGAS`): Edge Function roda em Deno e não importa de `cuca-portal/`. Os dois precisam
 * ser alterados juntos — não há import possível entre eles.
 */
export const AVISO_VAGAS =
    "A quantidade de vagas muda com frequencia; oriente a pessoa a procurar a unidade CUCA para verificar a disponibilidade."
