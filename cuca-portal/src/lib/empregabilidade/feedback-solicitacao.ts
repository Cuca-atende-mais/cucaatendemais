// S-EMP-GES-02: regras do pedido de feedback à empresa que não dependem do banco — parâmetros do
// template aprovado, texto gravado no Atendimento, número de destino e rótulos do acompanhamento.

export const TEMPLATE_FEEDBACK_EMPRESA = "empregabilidade_feedback_empresa_v1"

/** Validade do link: o corpo do template aprovado diz "O link permanecerá disponível por 48 horas". */
export const VALIDADE_LINK_HORAS = 48

/**
 * Selo "Feedback" na lista do Atendimento: a conversa recebeu um pedido de feedback cujo link ainda
 * vale. `conversas.feedback_pedido_ate` recebe a validade do link no envio, então o selo some sozinho.
 */
export function pedidoFeedbackAtivo(ate: string | null | undefined, agora: Date = new Date()): boolean {
    if (!ate) return false
    const fim = new Date(ate).getTime()
    return Number.isFinite(fim) && fim > agora.getTime()
}

export interface VariavelTemplate {
    posicao: number
    descricao: string
}

export interface ValoresPedido {
    nome_empresa: string
    titulo_vaga: string
    link_feedback: string
}

/** A Meta recusa parâmetro com quebra de linha, tabulação ou mais de 4 espaços seguidos. */
export function limparParametro(valor: string): string {
    return valor.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim()
}

/** Template NAMED: um parâmetro por variável, com o nome cadastrado em `meta_templates.variaveis`. */
export function montarComponentesTemplate(variaveis: VariavelTemplate[], valores: ValoresPedido): unknown[] {
    const ordenadas = [...variaveis].sort((a, b) => a.posicao - b.posicao)
    const parametros = ordenadas.map(v => {
        const valor = valores[v.descricao as keyof ValoresPedido]
        if (typeof valor !== "string" || !limparParametro(valor)) {
            throw new Error(`Variável do template sem valor: ${v.descricao}`)
        }
        return { type: "text", parameter_name: v.descricao, text: limparParametro(valor) }
    })
    return [{ type: "body", parameters: parametros }]
}

/** Texto que a empresa recebe, para gravar a mensagem na conversa do Atendimento. */
export function renderizarCorpo(corpo: string, variaveis: VariavelTemplate[], valores: ValoresPedido): string {
    let texto = corpo
    for (const v of variaveis) {
        const valor = valores[v.descricao as keyof ValoresPedido] ?? ""
        texto = texto.split(`{{${v.posicao}}}`).join(limparParametro(valor))
    }
    return texto
}

/** Número para a Meta: só dígitos, com o 55 do Brasil. Nulo quando não dá um telefone plausível. */
export function telefoneDestino(telefone: string | null | undefined): string | null {
    const d = (telefone ?? "").replace(/\D/g, "")
    if (d.length === 10 || d.length === 11) return `55${d}`
    if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d
    return null
}

/**
 * Mesmo ajuste do webhook de entrada do worker (`_normalizar_telefone_br`): celular de 12 dígitos
 * ganha o 9. É o valor com que o worker grava o lead quando a empresa responde — por isso a busca e a
 * criação do lead no envio usam exatamente este número (decisão do Junior, 2026-10-14).
 */
export function normalizarWaId(waId: string): string {
    const d = waId.replace(/\D/g, "")
    if (d.length === 12 && d.startsWith("55") && d[4] !== "9") return `${d.slice(0, 4)}9${d.slice(4)}`
    return d
}

export type StatusEnvio = "pendente" | "enviado" | "entregue" | "lido" | "falhou" | "aviso" | "apagada"

const ROTULO_ENVIO: Record<StatusEnvio, string> = {
    pendente: "Enviando",
    enviado: "Enviada",
    entregue: "Entregue",
    lido: "Lida",
    falhou: "Falhou",
    aviso: "Aviso da Meta",
    apagada: "Apagada",
}

export function rotuloStatusEnvio(status: string, erro?: string | null): string {
    const rotulo = ROTULO_ENVIO[status as StatusEnvio] ?? status
    return (status === "falhou" || status === "aviso") && erro ? `${rotulo} (${erro})` : rotulo
}

export interface SolicitacaoResumo {
    status_envio: string
    expires_at: string | null
    respondido_em: string | null
    situacao?: string | null
}

export type StatusFeedback = "aguardando" | "expirado" | "respondido" | "nao_enviado" | "em_analise" | "substituida"

/** Status do feedback no acompanhamento (respondido, em análise e substituído vêm da GES-03). */
export function statusFeedback(s: SolicitacaoResumo, agora: Date = new Date()): StatusFeedback {
    if (s.respondido_em) return "respondido"
    if (s.situacao === "substituida") return "substituida"
    if (s.situacao === "em_analise") return "em_analise"
    if (s.status_envio === "falhou" || s.status_envio === "pendente") return "nao_enviado"
    if (s.expires_at && new Date(s.expires_at).getTime() <= agora.getTime()) return "expirado"
    return "aguardando"
}
