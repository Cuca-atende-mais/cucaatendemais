// S-INST-QUAL-04 — correção de cada execução e critério de comparação (item 7 da story).
//
// - Uma execução passa quando: a rota (camada registrada) está entre as aceitas, o transbordo bate
//   com o esperado, todos os `deve_conter` aparecem e nenhum `nao_deve_conter` aparece.
// - Os padrões são comparados SEM acento e sem diferença de maiúscula, dos dois lados: o modelo
//   escreve "natação", "Natação" ou "natacao", e o caso não deve falhar por isso.
// - Um caso passa quando acerta em pelo menos 2 de 3 execuções (generalizado: 2/3 arredondado
//   para cima).
// - Uma mudança está "sem piora" quando nenhuma categoria cai na taxa de acerto e nenhum caso que
//   passava na linha de base passa a falhar.

export type Esperado = {
  rota?: string[];
  handover?: boolean;
  deve_conter?: string[];
  nao_deve_conter?: string[];
};

export type Caso = {
  id: string;
  categoria: string;
  descricao: string;
  origem: string;
  previa?: number;
  conversa_curta?: string | null;
  data_simulada: string;
  mes_catalogo: string;
  estado: { metadata: Record<string, unknown>; status?: string };
  historico: { remetente: "lead" | "agente"; conteudo: string; minutos_antes: number }[];
  mensagem: string;
  esperado: Esperado;
  depois_da_07?: boolean;
  observacao?: string;
};

export type SaidaExecucao = { resposta: string; handover: boolean; camada: string | null };
export type ResultadoExecucao = { passou: boolean; falhas: string[] };

export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function casa(padrao: string, texto: string): boolean {
  return new RegExp(normalizar(padrao), "i").test(texto);
}

export function avaliarExecucao(esperado: Esperado, saida: SaidaExecucao): ResultadoExecucao {
  const falhas: string[] = [];
  const texto = normalizar(saida.resposta);
  if (esperado.rota && !esperado.rota.includes(saida.camada ?? "")) falhas.push(`rota "${saida.camada}" fora de [${esperado.rota.join(", ")}]`);
  if (esperado.handover !== undefined && esperado.handover !== saida.handover) falhas.push(`transbordo ${saida.handover ? "aconteceu" : "não aconteceu"}`);
  for (const p of esperado.deve_conter ?? []) if (!casa(p, texto)) falhas.push(`faltou /${p}/`);
  for (const p of esperado.nao_deve_conter ?? []) if (casa(p, texto)) falhas.push(`apareceu /${p}/`);
  return { passou: falhas.length === 0, falhas };
}

export function minimoDeAcertos(execucoes: number): number {
  return Math.ceil((execucoes * 2) / 3);
}

export type ResultadoCaso = { id: string; categoria: string; depois_da_07: boolean; acertos: number; execucoes: number; passou: boolean };

export function taxaPorCategoria(resultados: ResultadoCaso[]): Record<string, { passaram: number; total: number; taxa: number }> {
  const r: Record<string, { passaram: number; total: number; taxa: number }> = {};
  for (const c of resultados) {
    if (c.depois_da_07) continue; // conteúdo que só existe depois da story 07: relatado à parte
    const k = r[c.categoria] ?? { passaram: 0, total: 0, taxa: 0 };
    k.total += 1;
    if (c.passou) k.passaram += 1;
    k.taxa = k.passaram / k.total;
    r[c.categoria] = k;
  }
  return r;
}

export type Comparacao = { sem_piora: boolean; categorias_que_cairam: string[]; casos_que_pioraram: string[] };

export function compararComBase(atual: ResultadoCaso[], base: ResultadoCaso[]): Comparacao {
  const taxaAtual = taxaPorCategoria(atual);
  const taxaBase = taxaPorCategoria(base);
  const categorias_que_cairam = Object.keys(taxaBase).filter((k) => taxaAtual[k] !== undefined && taxaAtual[k].taxa < taxaBase[k].taxa);
  const atualPorId = new Map(atual.map((c) => [c.id, c]));
  const casos_que_pioraram = base.filter((b) => b.passou && atualPorId.get(b.id)?.passou === false).map((b) => b.id);
  return { sem_piora: categorias_que_cairam.length === 0 && casos_que_pioraram.length === 0, categorias_que_cairam, casos_que_pioraram };
}

/** Dado pessoal que não pode entrar num caso commitado (AC6). Os telefones públicos das unidades
 * e dos canais oficiais são permitidos. */
const TELEFONES_PUBLICOS = ["997960256", "997960300", "997960198", "997960354", "997960190", "989763733", "999401057"];
export function dadosPessoaisEm(texto: string): string[] {
  const achados: string[] = [];
  for (const m of texto.matchAll(/\+?\d[\d\s().-]{7,}\d/g)) {
    const digitos = m[0].replace(/\D/g, "");
    if (digitos.length < 8) continue;
    if (TELEFONES_PUBLICOS.some((t) => digitos.endsWith(t))) continue;
    if (/^20\d{2}/.test(digitos) && digitos.length <= 8) continue; // datas como 2026-09-28
    achados.push(m[0]);
  }
  for (const m of texto.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) achados.push(m[0]);
  return achados;
}
