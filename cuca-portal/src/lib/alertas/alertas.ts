// S-INST-QUAL-12 — Central de alertas: tipos e funções puras usadas pelo sino e pelo modal.
// Os dados vêm das funções do banco `alertas_contar_nao_lidos`, `alertas_listar` e
// `alertas_marcar_lidos` (só as contas Developer enxergam algo; a RLS decide).

export type Severidade = "info" | "atencao" | "critico"

export type AlertaItem = {
    id: string
    origem: string
    tipo: string
    severidade: Severidade | string
    titulo: string
    detalhe: string | null
    acao_sugerida: string | null
    criado_em: string
    resolvido_em: string | null
    email_enviado_em: string | null
    email_erro: string | null
    lido: boolean
    total: number
}

export const ALERTAS_POR_PAGINA = 10
/** A contagem atualiza sozinha a cada 60 s (limite pedido na story) e ao voltar para a aba. */
export const ALERTAS_INTERVALO_MS = 60_000

const SEVERIDADE: Record<string, { rotulo: string; classe: string }> = {
    critico: { rotulo: "Crítico", classe: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30" },
    atencao: { rotulo: "Atenção", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
    info: { rotulo: "Informativo", classe: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30" },
}

export function severidadeInfo(severidade: string): { rotulo: string; classe: string } {
    return SEVERIDADE[severidade] ?? SEVERIDADE.atencao
}

/** Texto do contador do sino: vazio quando não há não lidos (nenhum indicador), "99+" acima de 99. */
export function textoContador(naoLidos: number): string {
    if (!Number.isFinite(naoLidos) || naoLidos <= 0) return ""
    return naoLidos > 99 ? "99+" : String(Math.floor(naoLidos))
}

export function totalPaginas(total: number, porPagina: number = ALERTAS_POR_PAGINA): number {
    if (!Number.isFinite(total) || total <= 0) return 1
    return Math.max(1, Math.ceil(total / Math.max(1, porPagina)))
}

/** Garante uma página válida (ex.: a última página ficou vazia depois de uma mudança). */
export function paginaValida(pagina: number, total: number, porPagina: number = ALERTAS_POR_PAGINA): number {
    const max = totalPaginas(total, porPagina)
    if (!Number.isFinite(pagina) || pagina < 1) return 1
    return Math.min(Math.floor(pagina), max)
}

export function formatarDataAlerta(iso: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Fortaleza",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(d)
}

/** Situação do e-mail do alerta, em texto curto para o modal. */
export function situacaoEmail(item: Pick<AlertaItem, "email_enviado_em" | "email_erro">): {
    texto: string
    ok: boolean
} {
    if (item.email_enviado_em) return { texto: "E-mail enviado em " + formatarDataAlerta(item.email_enviado_em), ok: true }
    if (item.email_erro) return { texto: "E-mail não enviado: " + item.email_erro, ok: false }
    return { texto: "E-mail ainda não enviado", ok: false }
}

/** Normaliza o retorno da RPC `alertas_listar` (total vem como bigint/string). */
export function normalizarAlertas(linhas: unknown): AlertaItem[] {
    if (!Array.isArray(linhas)) return []
    return linhas.map((l) => {
        const r = l as Record<string, unknown>
        return {
            id: String(r.id),
            origem: String(r.origem ?? ""),
            tipo: String(r.tipo ?? ""),
            severidade: String(r.severidade ?? "atencao"),
            titulo: String(r.titulo ?? ""),
            detalhe: (r.detalhe as string | null) ?? null,
            acao_sugerida: (r.acao_sugerida as string | null) ?? null,
            criado_em: String(r.criado_em ?? ""),
            resolvido_em: (r.resolvido_em as string | null) ?? null,
            email_enviado_em: (r.email_enviado_em as string | null) ?? null,
            email_erro: (r.email_erro as string | null) ?? null,
            lido: Boolean(r.lido),
            total: Number(r.total ?? 0),
        }
    })
}
