// S-INST-QUAL-04 — `buscar_chunks_similares` calculada localmente, sobre o catálogo congelado.
// Espelha a função do banco (conferida em 12/11/2026 com pg_get_functiondef):
//   WHERE cd.embedding IS NOT NULL AND dr.ativo = true
//     AND (p_unidade_cuca IS NULL OR dr.unidade_cuca IS NULL OR dr.unidade_cuca = p_unidade_cuca)
//     AND (p_tipos IS NULL OR dr.tipo = ANY(p_tipos))
//   ORDER BY cd.embedding <=> query_embedding   -- distância de cosseno
//   LIMIT p_limite
// e devolve similaridade = 1 - distância. Sem limite mínimo de similaridade, como no banco.

export type DocumentoBusca = { id: string; tipo: string; unidade_cuca: string | null; ativo: boolean };
export type TrechoBusca = { id: string; documento_id: string; conteudo: string; metadados: unknown; embedding: number[] | null };
export type ResultadoBuscaLocal = {
  chunk_id: string;
  documento_id: string;
  conteudo: string;
  similaridade: number;
  metadados: unknown;
  fonte_tipo: string;
};

export function similaridadeCosseno(a: number[], b: number[]): number {
  let produto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i++) {
    produto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  if (normaA === 0 || normaB === 0) return 0;
  return produto / (Math.sqrt(normaA) * Math.sqrt(normaB));
}

/** O motor manda o vetor como texto "[0.1,0.2,...]", igual ao que vai ao Postgres. */
export function lerVetor(valor: unknown): number[] {
  const v = typeof valor === "string" ? JSON.parse(valor) : valor;
  if (!Array.isArray(v)) throw new Error("query_embedding fora do formato esperado");
  return v as number[];
}

export function buscarChunksSimilaresLocal(
  documentos: DocumentoBusca[],
  trechos: TrechoBusca[],
  params: { query_embedding: unknown; p_unidade_cuca?: string | null; p_tipos?: string[] | null; p_limite?: number },
): ResultadoBuscaLocal[] {
  const consulta = lerVetor(params.query_embedding);
  const unidade = params.p_unidade_cuca ?? null;
  const tipos = params.p_tipos ?? null;
  const limite = params.p_limite ?? 5;
  const porId = new Map(documentos.map((d) => [d.id, d]));
  const candidatos: ResultadoBuscaLocal[] = [];
  for (const t of trechos) {
    if (!t.embedding) continue;
    const d = porId.get(t.documento_id);
    if (!d || !d.ativo) continue;
    if (unidade !== null && d.unidade_cuca !== null && d.unidade_cuca !== unidade) continue;
    if (tipos !== null && !tipos.includes(d.tipo)) continue;
    candidatos.push({ chunk_id: t.id, documento_id: t.documento_id, conteudo: t.conteudo, similaridade: similaridadeCosseno(t.embedding, consulta), metadados: t.metadados, fonte_tipo: d.tipo });
  }
  return candidatos.sort((a, b) => b.similaridade - a.similaridade).slice(0, limite);
}
