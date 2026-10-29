// S-PLA-03: regras puras do seletor de status, da cópia e da navegação depois de duplicar/excluir.
// O banco (`pla_mudar_status`, `pla_duplicar_projeto`) repete o que vale para segurança; aqui fica o
// mesmo cálculo para a tela mostrar e para testar.

import { PLA_STATUS } from "@/lib/rbac/catalogo-planejamento"
import { rotuloStatus, type EstadoFicha, type StatusProjeto } from "./projeto"

export type DestinoStatus = "aprovado" | "em_execucao" | "concluido" | "reprovado" | "ficha"

// Opções do seletor, na ordem em que aparecem, com a permissão de cada uma (AC11).
export const DESTINOS_STATUS: readonly { destino: DestinoStatus; permissao: string }[] = [
    { destino: "aprovado", permissao: PLA_STATUS.aprovado },
    { destino: "em_execucao", permissao: PLA_STATUS.execucao },
    { destino: "concluido", permissao: PLA_STATUS.concluido },
    { destino: "reprovado", permissao: PLA_STATUS.reprovado },
    { destino: "ficha", permissao: PLA_STATUS.ficha },
]

// "Voltar ao status da ficha": Em construção com ficha parcial, Projeto salvo com ficha final.
export function statusDoDestino(destino: DestinoStatus, ficha: EstadoFicha): StatusProjeto {
    if (destino === "ficha") return ficha === "final" ? "projeto_salvo" : "em_construcao"
    return destino
}

export function rotuloDestino(destino: DestinoStatus, ficha: EstadoFicha): string {
    if (destino === "ficha") return `Voltar ao status da ficha (${rotuloStatus(statusDoDestino("ficha", ficha))})`
    return rotuloStatus(destino)
}

// Opções que o usuário pode marcar agora: só as permitidas e só as que mudam o status de fato
// (o banco recusa "O projeto já está com esse status."). Lista vazia = o status aparece só como etiqueta.
export function opcoesDoSeletor(
    atual: StatusProjeto,
    ficha: EstadoFicha,
    temPermissao: (permissao: string) => boolean,
): DestinoStatus[] {
    return DESTINOS_STATUS
        .filter(d => temPermissao(d.permissao) && statusDoDestino(d.destino, ficha) !== atual)
        .map(d => d.destino)
}

// O seletor aparece se o usuário tem alguma das permissões de status (mesmo que, no status atual,
// nenhuma opção mude nada).
export function temAlgumaPermissaoDeStatus(temPermissao: (permissao: string) => boolean): boolean {
    return DESTINOS_STATUS.some(d => temPermissao(d.permissao))
}

export const LIMITE_OBSERVACAO = 2000

// ── Duplicar (AC8) ───────────────────────────────────────────────────────────────────────────

// Espelho do banco: nome "{nome} (cópia)", Em construção, ficha parcial.
export function nomeDaCopia(nome: string): string {
    return `${nome} (cópia)`
}
export const ESTADO_DA_COPIA: { status: StatusProjeto; ficha: EstadoFicha } = { status: "em_construcao", ficha: "parcial" }

// Depois de duplicar: abre a edição da cópia; sem permissão de editar, a página da cópia (D14).
export function rotaDepoisDeDuplicar(idCopia: string, podeEditar: boolean): string {
    return podeEditar ? `/planejamento/projeto/${idCopia}/editar` : `/planejamento/projeto/${idCopia}`
}

// ── Última troca de status (AC13) ────────────────────────────────────────────────────────────

export type EventoStatus = { autor_nome: string | null; created_at: string; detalhe: { observacao?: string | null } | null }

export function textoUltimaTroca(e: EventoStatus | null, formatarData: (iso: string) => string): string | null {
    if (!e) return null
    return `Status alterado por ${e.autor_nome ?? "—"} em ${formatarData(e.created_at)}`
}
