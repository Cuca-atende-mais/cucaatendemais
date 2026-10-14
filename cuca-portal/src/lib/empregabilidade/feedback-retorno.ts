// S-EMP-GES-03: regras do retorno da empresa que não dependem do banco — resposta pelo link, link de uso
// único, motivo da rejeição (tela interna), reenviar, selo "sem resposta" e taxa de retorno.

/** Só estes mudam pelo link: quem a equipe já marcou como Contratado ou Rejeitado não é mexido pela empresa. */
export const STATUS_AVALIAVEIS_PELA_EMPRESA = ["pendente", "selecionado"] as const

export function avaliavelPelaEmpresa(status: unknown): boolean {
    return typeof status === "string" && (STATUS_AVALIAVEIS_PELA_EMPRESA as readonly string[]).includes(status)
}

// ── Motivo da rejeição (AC4) ────────────────────────────────────────────────────────────────────────

export const MOTIVOS_REJEICAO = [
    "Perfil não compatível",
    "Experiência insuficiente",
    "Não compareceu",
    "Desistiu",
    "Outro",
] as const

export const MAX_TEXTO_OUTRO = 120

/** Valida o motivo enviado pela tela. Sem motivo é válido (é opcional). "Outro" grava "Outro: <texto>". */
export function motivoParaGravar(motivo: unknown, outro: unknown): { ok: true; valor: string | null } | { ok: false; erro: string } {
    if (motivo === undefined || motivo === null || motivo === "") return { ok: true, valor: null }
    if (typeof motivo !== "string" || !(MOTIVOS_REJEICAO as readonly string[]).includes(motivo)) {
        return { ok: false, erro: "Motivo da rejeição inválido." }
    }
    if (motivo !== "Outro") return { ok: true, valor: motivo }
    const texto = typeof outro === "string" ? outro.replace(/\s+/g, " ").trim() : ""
    if (!texto) return { ok: false, erro: "Descreva o motivo em \"Outro\"." }
    if (texto.length > MAX_TEXTO_OUTRO) return { ok: false, erro: `O motivo pode ter até ${MAX_TEXTO_OUTRO} caracteres.` }
    return { ok: true, valor: `Outro: ${texto}` }
}

// ── Pedido e link (AC5, AC7, AC11) ──────────────────────────────────────────────────────────────────

export interface PedidoEstado {
    status_envio: string
    expires_at: string | null
    respondido_em: string | null
    situacao: string | null
    created_at?: string
}

export type EstadoLink = "ativo" | "respondido" | "em_analise" | "substituida" | "expirado"

/** O link vale uma vez: respondido, "em análise" ou substituído encerram; depois do prazo, também. */
export function estadoLink(p: PedidoEstado, agora: Date = new Date()): EstadoLink {
    if (p.respondido_em) return "respondido"
    if (p.situacao === "substituida") return "substituida"
    if (p.situacao === "em_analise") return "em_analise"
    if (!p.expires_at || new Date(p.expires_at).getTime() <= agora.getTime()) return "expirado"
    return "ativo"
}

export const MENSAGEM_LINK_INATIVO: Record<Exclude<EstadoLink, "ativo">, string> = {
    respondido: "Este link já foi utilizado. Obrigado pelo retorno!",
    em_analise: "Este link já foi utilizado. A Rede Cuca enviará um novo link quando vocês concluírem a análise.",
    substituida: "Este link foi substituído por um mais recente. Use o último link enviado pela Rede Cuca.",
    expirado: "Este link expirou. Fale com a Rede Cuca para receber um novo.",
}

export type RespostaEmpresa = { nenhum: true } | { nenhum: false; selecionados: string[] }

/**
 * Lê o corpo enviado pela página. Exige escolha explícita: pelo menos um marcado ou "Nenhum"
 * (regra confirmada pelo Junior em 14/10 — evita rejeitar todos por um clique sem marcar nada).
 */
export function lerResposta(body: unknown): { ok: true; resposta: RespostaEmpresa } | { ok: false; erro: string } {
    const b = (body ?? {}) as { nenhum?: unknown; selecionados?: unknown }
    const nenhum = b.nenhum === true
    const sel = b.selecionados
    if (sel !== undefined && (!Array.isArray(sel) || !sel.every(s => typeof s === "string"))) {
        return { ok: false, erro: "Resposta inválida." }
    }
    const selecionados = Array.from(new Set((sel as string[] | undefined) ?? []))
    if (nenhum && selecionados.length > 0) return { ok: false, erro: "Escolha candidatos ou \"Nenhum\", não os dois." }
    if (nenhum) return { ok: true, resposta: { nenhum: true } }
    if (selecionados.length === 0) return { ok: false, erro: "Marque os candidatos selecionados ou \"Nenhum candidato da lista foi selecionado\"." }
    return { ok: true, resposta: { nenhum: false, selecionados } }
}

/**
 * Decide o status de cada candidato do pedido (AC2). Qualquer id que não esteja entre os do pedido
 * recusa a resposta inteira (AC11) — nada é gravado.
 */
export function decidirStatus(
    candidatosDoPedido: string[],
    resposta: RespostaEmpresa,
): { ok: true; decisao: Map<string, "selecionado" | "rejeitado"> } | { ok: false; erro: string } {
    const doPedido = new Set(candidatosDoPedido)
    const marcados = new Set(resposta.nenhum ? [] : resposta.selecionados)
    for (const id of marcados) if (!doPedido.has(id)) return { ok: false, erro: "Algum candidato marcado não está mais disponível neste pedido. Recarregue a página." }
    const decisao = new Map<string, "selecionado" | "rejeitado">()
    for (const id of candidatosDoPedido) decisao.set(id, marcados.has(id) ? "selecionado" : "rejeitado")
    return { ok: true, decisao }
}

// ── Tela Feedback: reenviar, selo e taxa (AC8-AC10) ─────────────────────────────────────────────────

const enviadoComSucesso = (p: PedidoEstado) => p.status_envio !== "pendente" && p.status_envio !== "falhou"

/** Reenviar: sem resposta (aguardando ou expirado), com falha, ou sinalizado como "em análise". */
export function podeReenviar(p: PedidoEstado): boolean {
    if (p.respondido_em || p.situacao === "substituida") return false
    return p.status_envio !== "pendente"
}

export const HORAS_SELO_SEM_RESPOSTA = 48
const DIA_MS = 24 * 3600_000

/** Selo "sem resposta há X dias": a última solicitação da vaga, enviada, passou de 48h sem resposta. */
export function diasSemResposta(ultima: PedidoEstado | undefined, agora: Date = new Date()): number | null {
    if (!ultima?.created_at || ultima.respondido_em || !enviadoComSucesso(ultima)) return null
    const decorrido = agora.getTime() - new Date(ultima.created_at).getTime()
    if (decorrido < HORAS_SELO_SEM_RESPOSTA * 3600_000) return null
    return Math.floor(decorrido / DIA_MS)
}

/** A mais recente de cada vaga, a partir de uma lista qualquer de pedidos (uma leitura só, sem N+1). */
export function ultimaPorVaga<T extends PedidoEstado & { vaga_id: string; created_at: string }>(pedidos: T[]): Map<string, T> {
    const mapa = new Map<string, T>()
    for (const p of pedidos) {
        const atual = mapa.get(p.vaga_id)
        if (!atual || p.created_at > atual.created_at) mapa.set(p.vaga_id, p)
    }
    return mapa
}

/**
 * Taxa de retorno: respondidos ÷ enviados com sucesso. Pedido substituído por um reenvio não conta,
 * para o mesmo pedido não pesar duas vezes contra a empresa.
 */
export function taxaRetorno(pedidos: PedidoEstado[]): { respondidas: number; enviadas: number; percentual: number | null } {
    const validos = pedidos.filter(p => enviadoComSucesso(p) && p.situacao !== "substituida")
    const respondidas = validos.filter(p => p.respondido_em).length
    const enviadas = validos.length
    return { respondidas, enviadas, percentual: enviadas ? Math.round((respondidas / enviadas) * 100) : null }
}

export function textoSelo(dias: number): string {
    return `Sem resposta há ${dias} ${dias === 1 ? "dia" : "dias"}`
}
