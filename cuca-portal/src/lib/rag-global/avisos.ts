/**
 * S-INST-QUAL-08: avisos da rede com data de validade (tipo `aviso` em `documentos_rag`, sem unidade).
 * Funções puras, usadas pela tela e pelas rotas `/api/rag-global/avisos/**` — a rota grava com a chave
 * de serviço, então a regra precisa valer no servidor, não só no formulário.
 *
 * Datas em AAAA-MM-DD, inclusivas, no fuso de Fortaleza (mesma regra do motor-agente, `avisosValidos`).
 */

export const TIPO_AVISO = "aviso"
export const LIMITE_TITULO_AVISO = 100
export const LIMITE_TEXTO_AVISO = 500
/** Soma de título + texto dos avisos gerais válidos ao mesmo tempo (é o que vai inteiro ao bot). */
export const LIMITE_TOTAL_AVISOS = 3000
export const CATEGORIAS_AVISO = ["geral", "matricula"] as const
export type CategoriaAviso = (typeof CATEGORIAS_AVISO)[number]

export type Aviso = {
    id: string
    titulo: string
    conteudo: string
    metadados: Record<string, unknown> | null
    ativo: boolean
    created_at: string
}

export type DadosAviso = {
    titulo: string
    conteudo: string
    valido_de: string
    valido_ate: string
    categoria: CategoriaAviso
}

export type EstadoAviso = "programado" | "valido" | "vencido" | "desativado"

export const ROTULO_ESTADO_AVISO: Record<EstadoAviso, string> = {
    programado: "Programado",
    valido: "Válido",
    vencido: "Vencido",
    desativado: "Desativado",
}

/** Hoje em Fortaleza. Nunca `toISOString()`: depois das 21h em Fortaleza o UTC já é o dia seguinte. */
export function hojeFortaleza(agora: Date = new Date()): string {
    const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora)
    const p = (tipo: string) => partes.find(x => x.type === tipo)?.value ?? ""
    return `${p("year")}-${p("month")}-${p("day")}`
}

/** AAAA-MM-DD de um dia que existe no calendário (31/02 não passa). */
export function dataValida(v: unknown): v is string {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
    const [a, m, d] = v.split("-").map(Number)
    const data = new Date(Date.UTC(a, m - 1, d))
    return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d
}

export function formatarData(iso: string): string {
    const [a, m, d] = iso.split("-")
    return `${d}/${m}/${a}`
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "")

/** Lê e confere o que a tela manda gravar (AC1). `hoje` é a data de Fortaleza. */
export function lerDadosAviso(body: unknown, hoje: string): { erro: string } | { dados: DadosAviso } {
    const b = (body ?? {}) as Record<string, unknown>
    const titulo = texto(b.titulo)
    if (!titulo) return { erro: "Título obrigatório" }
    if (titulo.length > LIMITE_TITULO_AVISO) return { erro: `Título com mais de ${LIMITE_TITULO_AVISO} caracteres` }

    const conteudo = texto(b.conteudo)
    if (!conteudo) return { erro: "Texto do aviso obrigatório" }
    if (conteudo.length > LIMITE_TEXTO_AVISO) return { erro: `Texto com ${conteudo.length} caracteres; o limite é ${LIMITE_TEXTO_AVISO}` }

    if (b.valido_ate === undefined || b.valido_ate === null || b.valido_ate === "") return { erro: "Data de fim obrigatória" }
    if (!dataValida(b.valido_ate)) return { erro: "Data de fim inválida" }
    const deInformado = b.valido_de !== undefined && b.valido_de !== null && b.valido_de !== ""
    if (deInformado && !dataValida(b.valido_de)) return { erro: "Data de início inválida" }
    const valido_de = deInformado ? (b.valido_de as string) : hoje
    const valido_ate = b.valido_ate
    if (valido_ate < valido_de) return { erro: "A data de fim não pode ser antes da data de início" }
    if (valido_ate < hoje) return { erro: "A data de fim já passou" }

    const categoria = b.categoria === undefined || b.categoria === null || b.categoria === "" ? "geral" : b.categoria
    if (!(CATEGORIAS_AVISO as readonly unknown[]).includes(categoria)) return { erro: "Categoria inválida" }

    return { dados: { titulo, conteudo, valido_de, valido_ate, categoria: categoria as CategoriaAviso } }
}

function periodo(a: Aviso): { de: string | null; ate: string | null } {
    const m = a.metadados ?? {}
    return {
        de: dataValida(m.valido_de) ? (m.valido_de as string) : null,
        ate: dataValida(m.valido_ate) ? (m.valido_ate as string) : null,
    }
}

export function categoriaDoAviso(a: Aviso): string {
    const c = a.metadados?.categoria
    return typeof c === "string" && c ? c : "geral"
}

/** Estado mostrado na tela. Vencido vale mesmo com o aviso ainda ativo (o cron só roda de madrugada). */
export function estadoAviso(a: Aviso, hoje: string): EstadoAviso {
    const { de, ate } = periodo(a)
    if (!ate || ate < hoje) return "vencido"
    if (!a.ativo) return "desativado"
    if (de && de > hoje) return "programado"
    return "valido"
}

export const tamanhoAviso = (a: { titulo: string; conteudo: string }) => a.titulo.length + a.conteudo.length

/**
 * Total de caracteres no período do aviso novo (ou editado): ele + os outros avisos gerais ativos, não
 * vencidos, cujo período cruza o dele. Estimativa por cima do que pode ir junto ao bot num mesmo dia.
 * Aviso de outra categoria não entra no bloco do bot e não conta.
 */
export function totalNoPeriodo(outros: Aviso[], novo: DadosAviso, hoje: string, idEditado?: string): number {
    if (novo.categoria !== "geral") return 0
    let total = tamanhoAviso(novo)
    for (const a of outros) {
        if (a.id === idEditado || !a.ativo || categoriaDoAviso(a) !== "geral") continue
        const { de, ate } = periodo(a)
        if (!ate || ate < hoje) continue
        const inicio = de ?? hoje
        if (inicio <= novo.valido_ate && novo.valido_de <= ate) total += tamanhoAviso(a)
    }
    return total
}

/** Mensagem de erro quando o período passaria do limite total; null quando cabe. */
export function conferirTotal(outros: Aviso[], novo: DadosAviso, hoje: string, idEditado?: string): string | null {
    const total = totalNoPeriodo(outros, novo, hoje, idEditado)
    if (total <= LIMITE_TOTAL_AVISOS) return null
    return `Os avisos que valem nesse período somariam ${total} caracteres; o limite é ${LIMITE_TOTAL_AVISOS}. Encurte o texto ou desative outro aviso.`
}

/**
 * Qualquer aviso pode ser editado, inclusive o vencido e o desativado (Junior, 16/11). Salvar exige fim
 * de hoje em diante (`lerDadosAviso`) e grava `ativo = true`: o aviso volta a valer no período informado.
 */
export function voltaAValerAoSalvar(a: Aviso, hoje: string): boolean {
    const e = estadoAviso(a, hoje)
    return e === "vencido" || e === "desativado"
}

export function metadadosDoAviso(d: DadosAviso, anteriores: Record<string, unknown> | null = null): Record<string, unknown> {
    return { ...(anteriores ?? {}), source_type: "rede_cuca_global", valido_de: d.valido_de, valido_ate: d.valido_ate, categoria: d.categoria }
}
