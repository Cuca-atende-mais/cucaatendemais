// S-INST-QUAL-04 — cliente Supabase falso para o gabarito, lendo o catálogo congelado.
//
// Diferente dos mocks dos testes (que ignoram os filtros e devolvem sempre o mesmo dado), este
// aplica de verdade eq/neq/in/gte/lte/order/limit/single sobre tabelas em memória, para o motor
// receber exatamente o que o banco devolveria para aquele mês. Tabela, RPC ou método que ele não
// conhece LANÇA erro — dado errado nunca passa em silêncio. Nada aqui fala com o banco real.

import { buscarChunksSimilaresLocal, type DocumentoBusca, type ResultadoBuscaLocal, type TrechoBusca } from "./busca_local.ts";

type Linha = Record<string, unknown>;

export const CONVERSA_ID = "00000000-0000-4000-8000-0000000e7a10";
export const LEAD_ID = "00000000-0000-4000-8000-0000000e7a11";
export const TELEFONE_FALSO = "5585000000000";

export type CatalogoMes = { documentos: Linha[]; trechos: TrechoBusca[]; atividades_mensais: Linha[] };
export type CatalogoComum = { documentos: Linha[]; trechos: TrechoBusca[]; prompts_agentes: Linha[]; unidades_cuca: Linha[]; configuracoes: Linha[]; system_config: Linha[] };
export type Catalogo = { exportado_em: string; meses: Record<string, CatalogoMes>; comum: CatalogoComum };

export type EstadoCaso = {
  metadata: Record<string, unknown>;
  status: string;
  /** Histórico em ordem cronológica, já com `created_at` absoluto. */
  historico: { remetente: string; conteudo: string; created_at: string }[];
};

export type Captura = {
  insercoes: { tabela: string; linha: Linha }[];
  buscas: { params: Linha; resultado: ResultadoBuscaLocal[] }[];
  rpcs: string[];
};

const OPERADORES = new Set(["eq", "neq", "in", "gte", "lte", "is"]);

export function criarSupabaseFalso(catalogo: Catalogo, mes: string, estado: EstadoCaso, chaveOpenAI: string) {
  const programacao = catalogo.meses[mes];
  if (!programacao) throw new Error(`catálogo sem o mês ${mes} (rode eval/scripts/exportar_catalogo.ts)`);
  const captura: Captura = { insercoes: [], buscas: [], rpcs: [] };

  // O mês do caso conta como o ativo; os documentos comuns já vieram só os ativos.
  const documentos: Linha[] = [
    ...programacao.documentos.map((d) => ({ ...d, ativo: true })),
    ...catalogo.comum.documentos.map((d) => ({ ...d, ativo: true })),
  ];
  const trechos: TrechoBusca[] = [...programacao.trechos, ...catalogo.comum.trechos];

  const tabelas: Record<string, Linha[]> = {
    leads: [{ id: LEAD_ID, nome: "Fulano", opt_in: true, bloqueado: false, telefone: TELEFONE_FALSO }],
    conversas: [{ id: CONVERSA_ID, status: estado.status, metadata: structuredClone(estado.metadata), lead_id: LEAD_ID, origem_id: "eval", agente_tipo: "Institucional" }],
    mensagens: estado.historico.map((m, i) => ({ id: "hist-" + i, conversa_id: CONVERSA_ID, lead_id: LEAD_ID, ...m })),
    prompts_agentes: catalogo.comum.prompts_agentes.map((p) => ({ ...p, ativo: true })),
    documentos_rag: documentos,
    chunks_documentos: trechos.map((t) => ({ ...t })),
    atividades_mensais: programacao.atividades_mensais,
    unidades_cuca: catalogo.comum.unidades_cuca.map((u) => ({ ativo: true, ...u })),
    configuracoes: catalogo.comum.configuracoes,
    system_config: catalogo.comum.system_config,
  };
  const SO_INSERCAO = new Set(["rag_retrieval_logs", "ai_usage_logs"]);

  function consulta(tabela: string) {
    if (!(tabela in tabelas) && !SO_INSERCAO.has(tabela)) throw new Error(`mock do gabarito: tabela não prevista "${tabela}"`);
    const filtros: { op: string; col: string; val: unknown }[] = [];
    let ordem: { col: string; asc: boolean }[] = [];
    let limite: number | null = null;
    let unico: "single" | "maybeSingle" | null = null;
    let modo: "select" | "insert" | "update" = "select";
    let carga: Linha | Linha[] | null = null;

    const casa = (l: Linha) => filtros.every(({ op, col, val }) => {
      const v = l[col];
      switch (op) {
        case "eq": return v === val;
        case "neq": return v !== val;
        case "in": return Array.isArray(val) && val.includes(v);
        case "gte": return String(v) >= String(val);
        case "lte": return String(v) <= String(val);
        case "is": return v === val;
        default: throw new Error("operador não previsto: " + op);
      }
    });

    function executar(): { data: unknown; error: unknown } {
      if (modo === "insert") {
        const linhas = (Array.isArray(carga) ? carga : [carga]) as Linha[];
        for (const l of linhas) {
          captura.insercoes.push({ tabela, linha: structuredClone(l) });
          if (tabela === "mensagens") tabelas.mensagens.push({ created_at: new Date().toISOString(), ...l });
        }
        return { data: unico ? linhas[0] ?? null : linhas, error: null };
      }
      if (SO_INSERCAO.has(tabela)) throw new Error(`mock do gabarito: leitura não prevista em "${tabela}"`);
      let linhas = tabelas[tabela].filter(casa);
      if (modo === "update") {
        for (const l of linhas) Object.assign(l, carga);
        captura.insercoes.push({ tabela: tabela + ":update", linha: structuredClone(carga as Linha) });
        return { data: null, error: null };
      }
      for (const o of [...ordem].reverse()) {
        linhas = [...linhas].sort((a, b) => {
          const x = a[o.col] as string | number;
          const y = b[o.col] as string | number;
          const c = x < y ? -1 : x > y ? 1 : 0;
          return o.asc ? c : -c;
        });
      }
      if (limite !== null) linhas = linhas.slice(0, limite);
      const copia = structuredClone(linhas);
      if (unico) {
        if (copia.length === 1) return { data: copia[0], error: null };
        if (copia.length === 0) return { data: null, error: unico === "single" ? { code: "PGRST116", message: "0 linhas" } : null };
        return { data: null, error: { code: "PGRST116", message: "várias linhas" } };
      }
      return { data: copia, error: null };
    }

    // A cadeia imita o query builder do supabase-js; tipada como `any` porque o motor encadeia
    // os métodos livremente (mesmo padrão dos mocks dos testes do motor).
    // deno-lint-ignore no-explicit-any
    const cadeia: any = {
      select(_colunas?: string) { return cadeia; },
      insert(c: Linha | Linha[]) { modo = "insert"; carga = c; return cadeia; },
      update(c: Linha) { modo = "update"; carga = c; return cadeia; },
      order(col: string, opcoes?: { ascending?: boolean }) { ordem = [...ordem, { col, asc: opcoes?.ascending !== false }]; return cadeia; },
      limit(n: number) { limite = n; return cadeia; },
      single() { unico = "single"; return cadeia; },
      maybeSingle() { unico = "maybeSingle"; return cadeia; },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        try { return Promise.resolve(resolve(executar())); } catch (e) { return reject ? Promise.resolve(reject(e)) : Promise.reject(e); }
      },
    };
    for (const op of OPERADORES) cadeia[op] = (col: string, val: unknown) => { filtros.push({ op, col, val }); return cadeia; };
    return cadeia;
  }

  function rpc(nome: string, params: Linha = {}) {
    captura.rpcs.push(nome);
    const resultado = (): { data: unknown; error: unknown } => {
      switch (nome) {
        case "get_openai_key": return { data: chaveOpenAI, error: null };
        case "merge_conversa_metadata": {
          const c = tabelas.conversas[0];
          c.metadata = { ...(c.metadata as Linha), ...(params.p_patch as Linha) };
          return { data: null, error: null };
        }
        case "buscar_chunks_similares": {
          const r = buscarChunksSimilaresLocal(documentos as unknown as DocumentoBusca[], trechos, params as Parameters<typeof buscarChunksSimilaresLocal>[2]);
          captura.buscas.push({ params: { p_unidade_cuca: params.p_unidade_cuca ?? null, p_tipos: params.p_tipos ?? null, p_limite: params.p_limite ?? 5 }, resultado: r });
          return { data: r, error: null };
        }
        default: throw new Error(`mock do gabarito: RPC não prevista "${nome}"`);
      }
    };
    return { then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => { try { return Promise.resolve(resolve(resultado())); } catch (e) { return reject ? Promise.resolve(reject(e)) : Promise.reject(e); } } };
  }

  return { cliente: { from: consulta, rpc }, captura, conversa: () => tabelas.conversas[0] };
}
