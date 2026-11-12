// Cálculos e textos do painel Developer → Consumo OpenAI (`developer/consumo`).
// Separado da página para ser testável sem renderizar nada.

export type LinhaConsumo = {
    feature: string | null
    modelo: string
    agente_tipo: string | null
    tokens_total: number | null
    tokens_prompt_cached: number | null
    // custo real (modelo + cache). `custo_estimado_usd` é coluna gerada com preço fixo e
    // superestima o gpt-4o-mini em ~30x — não é usada aqui.
    custo_usd: number | string | null
    created_at: string
}

export const FEATURE_LABEL: Record<string, string> = {
    chat: "Chat / Resposta IA",
    transcription: "Transcrição (Whisper)",
    embedding: "Embedding (RAG)",
    sentiment: "Análise de Sentimento",
    ocr: "OCR / Documento",
    matching: "Triagem de currículos",
    intencao: "Detecção de intenção",
    categorias: "Categorias da programação",
    ouvidoria: "Ouvidoria (manifestação)",
    empregabilidade_cargos: "Empregabilidade (cargos)",
    empregabilidade_rota: "Empregabilidade (troca de rota)",
    classificador_emprego: "Institucional (classificador de emprego)",
    classificacao_rota: "Institucional (escolha da unidade)",
    interpretacao_programacao: "Institucional (leitura da pergunta de programação)",
}

/** O worker grava sem `agente_tipo`: as linhas sem agente são dele, não "desconhecidas". */
export const ROTULO_SEM_AGENTE = "Worker (currículo, triagem, intenção, Empregabilidade, ouvidoria, áudio)"

export function rotuloFeature(feature: string): string {
    return FEATURE_LABEL[feature] ?? feature
}

export function rotuloAgente(agente: string | null | undefined): string {
    return agente ? agente : ROTULO_SEM_AGENTE
}

/** Início do mês em UTC — o mesmo corte que a fatura da OpenAI usa. */
export function inicioDoMesUtc(agora: Date = new Date()): string {
    return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString()
}

/** `null` quando a linha não tem preço (ex.: Whisper), para não somar como zero. */
export function custoDaLinha(linha: Pick<LinhaConsumo, "custo_usd">): number | null {
    if (linha.custo_usd === null || linha.custo_usd === undefined || linha.custo_usd === "") return null
    const valor = Number(linha.custo_usd)
    return Number.isFinite(valor) ? valor : null
}

export type ResumoFeature = { feature: string; custo: number; chamadas: number; chamadasComPreco: number }

export function resumirPorFeature(linhas: LinhaConsumo[]): ResumoFeature[] {
    const mapa = new Map<string, ResumoFeature>()
    for (const linha of linhas) {
        const feature = linha.feature || "chat"
        const atual = mapa.get(feature) ?? { feature, custo: 0, chamadas: 0, chamadasComPreco: 0 }
        const custo = custoDaLinha(linha)
        atual.chamadas += 1
        if (custo !== null) {
            atual.custo += custo
            atual.chamadasComPreco += 1
        }
        mapa.set(feature, atual)
    }
    return [...mapa.values()].sort((a, b) => b.custo - a.custo || b.chamadas - a.chamadas)
}

export function resumirTokensPorAgente(linhas: LinhaConsumo[]): { agente: string; tokens: number }[] {
    const mapa = new Map<string, number>()
    for (const linha of linhas) {
        const rotulo = rotuloAgente(linha.agente_tipo)
        mapa.set(rotulo, (mapa.get(rotulo) ?? 0) + (linha.tokens_total || 0))
    }
    return [...mapa.entries()].map(([agente, tokens]) => ({ agente, tokens })).sort((a, b) => b.tokens - a.tokens)
}

export function totais(linhas: LinhaConsumo[]): { custo: number; tokens: number; tokensEmCache: number; chamadas: number } {
    let custo = 0
    let tokens = 0
    let tokensEmCache = 0
    for (const linha of linhas) {
        custo += custoDaLinha(linha) ?? 0
        tokens += linha.tokens_total || 0
        tokensEmCache += linha.tokens_prompt_cached || 0
    }
    return { custo, tokens, tokensEmCache, chamadas: linhas.length }
}

/**
 * Valor de uma feature no painel:
 * - nenhuma chamada com preço (ex.: Whisper) → "sem preço", nunca "$0.0000";
 * - custo real, mas menor que a 4ª casa (ex.: embeddings) → "< $0.0001", não um zero enganoso.
 */
export function formatarCustoFeature(resumo: Pick<ResumoFeature, "custo" | "chamadasComPreco">): string {
    if (resumo.chamadasComPreco === 0) return "sem preço"
    if (resumo.custo > 0 && resumo.custo < 0.0001) return "< $0.0001"
    return "$" + resumo.custo.toFixed(4)
}
