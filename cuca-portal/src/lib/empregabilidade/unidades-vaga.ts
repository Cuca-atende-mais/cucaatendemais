/**
 * S-EMP-GES-13 — Unidade de Tratamento e Unidade de Currículos de vagas e seleções.
 *
 * - Unidade de Tratamento (`vagas.unidade_tratamento`): a unidade que cuida da vaga. Só unidade
 *   específica (UUID de `unidades_cuca`), nunca "Toda a Rede". Sucessora da antiga "Ancoragem".
 * - Unidade de Currículos (`vagas.unidade_destino`): para onde vão os currículos. "global" (Toda a
 *   Rede) ou o UUID de uma unidade.
 *
 * Um módulo só, usado pelos formulários públicos, pelos modais internos e pelas rotas do servidor,
 * para as mensagens nunca divergirem entre tela e servidor (AC9, AC10).
 */

export const MSG_UNIDADE_TRATAMENTO_AUSENTE = "Preencha a unidade de tratamento."
export const MSG_UNIDADE_CURRICULOS_AUSENTE = "Preencha a unidade de currículos."
export const MSG_UNIDADE_TRATAMENTO_INVALIDA = "Unidade de tratamento inválida. Escolha uma unidade da lista."
export const MSG_UNIDADE_CURRICULOS_INVALIDA = "Unidade de currículos inválida. Escolha uma opção da lista."

/** Valor de "Toda a Rede CUCA" na Unidade de Currículos (mesmo valor já gravado em `unidade_destino`). */
export const UNIDADE_TODA_REDE = "global"

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function ehUuid(valor: unknown): valor is string {
    return typeof valor === "string" && FORMATO_UUID.test(valor.trim())
}

export type CampoUnidade = "tratamento" | "curriculos"
export type ErrosUnidades = Partial<Record<CampoUnidade, string>>

/**
 * Valida as duas unidades. Devolve um objeto com a mensagem de cada campo pendente (vazio = ok).
 * `obrigatoria.tratamento = false` é o caso da vaga antiga sem unidade de tratamento (D12): o campo
 * fica opcional, mas se vier preenchido precisa ser uma unidade válida.
 */
export function validarUnidadesVaga(
    valores: { tratamento?: string | null; curriculos?: string | null },
    opcoes: { obrigatoria?: { tratamento?: boolean; curriculos?: boolean } } = {},
): ErrosUnidades {
    const exigeTratamento = opcoes.obrigatoria?.tratamento ?? true
    const exigeCurriculos = opcoes.obrigatoria?.curriculos ?? true
    const tratamento = (valores.tratamento ?? "").trim()
    const curriculos = (valores.curriculos ?? "").trim()
    const erros: ErrosUnidades = {}

    if (!tratamento) {
        if (exigeTratamento) erros.tratamento = MSG_UNIDADE_TRATAMENTO_AUSENTE
    } else if (!ehUuid(tratamento)) {
        erros.tratamento = MSG_UNIDADE_TRATAMENTO_INVALIDA
    }

    if (!curriculos) {
        if (exigeCurriculos) erros.curriculos = MSG_UNIDADE_CURRICULOS_AUSENTE
    } else if (curriculos !== UNIDADE_TODA_REDE && !ehUuid(curriculos)) {
        erros.curriculos = MSG_UNIDADE_CURRICULOS_INVALIDA
    }
    return erros
}

export function temErros(erros: ErrosUnidades): boolean {
    return Object.keys(erros).length > 0
}

/** Primeira mensagem pendente, na ordem dos campos na tela (tratamento antes de currículos). */
export function primeiroErro(erros: ErrosUnidades): string | null {
    return erros.tratamento ?? erros.curriculos ?? null
}

/**
 * Validação do servidor (AC10): formato e, depois, existência entre as unidades ativas. O formato é
 * checado antes da consulta, para um texto qualquer não virar erro do banco (500) em vez de 400.
 */
export async function validarUnidadesNoServidor(
    valores: { tratamento?: unknown; curriculos?: unknown },
    buscarAtivas: (ids: string[]) => Promise<string[]>,
): Promise<{ ok: true; tratamento: string; curriculos: string } | { ok: false; erro: string }> {
    const tratamento = typeof valores.tratamento === "string" ? valores.tratamento.trim() : ""
    const curriculos = typeof valores.curriculos === "string" ? valores.curriculos.trim() : ""
    const erros = validarUnidadesVaga({ tratamento, curriculos })
    const erro = primeiroErro(erros)
    if (erro) return { ok: false, erro }

    const ids = [tratamento, ...(curriculos === UNIDADE_TODA_REDE ? [] : [curriculos])]
    const ativas = new Set(await buscarAtivas([...new Set(ids)]))
    if (!ativas.has(tratamento)) return { ok: false, erro: MSG_UNIDADE_TRATAMENTO_INVALIDA }
    if (curriculos !== UNIDADE_TODA_REDE && !ativas.has(curriculos)) {
        return { ok: false, erro: MSG_UNIDADE_CURRICULOS_INVALIDA }
    }
    return { ok: true, tratamento, curriculos }
}

/** Rótulo da Unidade de Currículos para exibição. */
export function rotuloUnidadeCurriculos(valor: string | null | undefined, nomes: Record<string, string>): string {
    if (!valor || valor.trim() === "" || valor === UNIDADE_TODA_REDE) return "Toda a Rede CUCA"
    return nomes[valor] ?? "Unidade não encontrada"
}

/** "2026-11-30" → "30/11/2026", sem passar por `Date` (que leria como UTC e mostraria o dia anterior). */
export function formatarDataISO(iso: string | null | undefined): string {
    if (!iso) return ""
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : ""
}

export type DataHoraSelecao = { data: string; hora?: string | null }

/**
 * Data exibida na listagem de seleções (AC16): a próxima a partir de hoje; se todas já passaram, a
 * última. Compara as strings `YYYY-MM-DD` (mesmo formato do `hojeBrasilISO`).
 */
export function escolherDataSelecao(
    datas: DataHoraSelecao[] | null | undefined,
    hojeISO: string,
): { principal: DataHoraSelecao; restantes: number } | null {
    const validas = (datas ?? [])
        .filter(d => d && /^\d{4}-\d{2}-\d{2}/.test(d.data ?? ""))
        .slice()
        .sort((a, b) => (a.data + (a.hora ?? "")).localeCompare(b.data + (b.hora ?? "")))
    if (validas.length === 0) return null
    const proxima = validas.find(d => d.data.slice(0, 10) >= hojeISO) ?? validas[validas.length - 1]
    return { principal: proxima, restantes: validas.length - 1 }
}

/** "30/11/2026 08:00" (sem hora quando ela não existe). */
export function formatarDataHoraSelecao(d: DataHoraSelecao): string {
    const data = formatarDataISO(d.data)
    const hora = (d.hora ?? "").trim()
    return hora ? `${data} ${hora}` : data
}
