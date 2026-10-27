import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { statusFeedback, type SolicitacaoResumo, type StatusFeedback } from "./feedback-solicitacao"

// Rótulos e cores do pedido de feedback na tela Feedback, usados pelo acompanhamento do detalhe
// (GES-02/03) e pela lista de feedbacks enviados (GES-08). Movidos do page.tsx sem mudar texto nem cor.

export const COR_ENVIO: Record<string, string> = {
    pendente: "bg-slate-100 text-slate-700 border-slate-300",
    enviado: "bg-sky-100 text-sky-800 border-sky-300",
    entregue: "bg-blue-100 text-blue-800 border-blue-300",
    lido: "bg-emerald-100 text-emerald-800 border-emerald-300",
    falhou: "bg-rose-100 text-rose-800 border-rose-300",
    aviso: "bg-amber-100 text-amber-900 border-amber-300",
    apagada: "bg-slate-100 text-slate-700 border-slate-300",
}

export const ROTULO_FEEDBACK: Record<StatusFeedback, string> = {
    aguardando: "Aguardando",
    expirado: "Expirado",
    respondido: "Respondido",
    nao_enviado: "Não enviado",
    em_analise: "Empresa sinalizou: em análise",
    substituida: "Substituída",
}

export function rotuloFeedback(s: SolicitacaoResumo, agora: Date = new Date()): string {
    const st = statusFeedback(s, agora)
    if (st === "respondido" && s.respondido_em) return `Respondido em ${format(new Date(s.respondido_em), "dd/MM", { locale: ptBR })}`
    return ROTULO_FEEDBACK[st]
}
