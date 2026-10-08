import { rotuloStatusCandidatura } from "./status-candidatura"

// S-EMP-GES-01: regras da tela Feedback que não dependem do banco (AC2, AC4, AC7).

export type TipoVaga = "vaga_normal" | "selecao_evento" | string | null

export interface ContagemVaga {
    total: number
    enviados: number
}

/** Conta, por vaga, quantas candidaturas existem e quantas foram enviadas à empresa. */
export function contarPorVaga(linhas: { vaga_id: string | null; email_enviado_em: string | null }[]): Map<string, ContagemVaga> {
    const mapa = new Map<string, ContagemVaga>()
    for (const l of linhas) {
        if (!l.vaga_id) continue
        const atual = mapa.get(l.vaga_id) ?? { total: 0, enviados: 0 }
        atual.total += 1
        if (l.email_enviado_em) atual.enviados += 1
        mapa.set(l.vaga_id, atual)
    }
    return mapa
}

/** AC2 + D1: vaga normal entra com currículo enviado; seleção entra com qualquer inscrito. */
export function vagaEntraNoSeletor(tipo: TipoVaga, contagem: ContagemVaga | undefined): boolean {
    if (!contagem) return false
    return tipo === "selecao_evento" ? contagem.total > 0 : contagem.enviados > 0
}

/** AC4 + D1: vaga normal lista os enviados à empresa; seleção lista todos os inscritos. */
export function candidatoEntraNaLista(tipo: TipoVaga, candidatura: { email_enviado_em: string | null }): boolean {
    return tipo === "selecao_evento" ? true : !!candidatura.email_enviado_em
}

export function textoConfirmacaoLote(quantidade: number, status: string): string {
    const plural = quantidade === 1 ? "candidato" : "candidatos"
    return `Mudar ${quantidade} ${plural} para ${rotuloStatusCandidatura(status)}?`
}

export function rotuloVaga(v: { numero_vaga: number | null; titulo: string | null; tipo: TipoVaga }): string {
    const numero = v.numero_vaga ? `#${v.numero_vaga} · ` : ""
    const tipo = v.tipo === "selecao_evento" ? "Seleção" : "Vaga"
    return `${numero}${v.titulo || "Sem título"} · ${tipo}`
}
