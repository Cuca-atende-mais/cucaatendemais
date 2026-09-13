/**
 * S-PROG-15: regras puras da Divulgação — mês vigente (o que está no ar no RAG), meses permitidos,
 * nível 1 (programações autorizadas), nível 2 (RAG do mês no ar) e bloqueio do disparo.
 * Usadas pela rota de situação e repetidas no servidor antes de aprovar RAG ou disparar.
 */

export type MesAno = { mes: number; ano: number }

export type EstadoRag = "nao_aprovado" | "indexando" | "falhou" | "no_ar"

export const ROTULO_ESTADO_RAG: Record<EstadoRag, string> = {
    nao_aprovado: "Não aprovado",
    indexando: "Indexando",
    falhou: "Falhou",
    no_ar: "No ar",
}

/** Tempo máximo esperado de indexação; depois disso um documento sem conteúdo conta como falha. */
export const MINUTOS_LIMITE_INDEXACAO = 20

const indice = (m: MesAno) => m.ano * 12 + (m.mes - 1)
const deIndice = (i: number): MesAno => ({ ano: Math.floor(i / 12), mes: (i % 12) + 1 })

export function proximoMes(m: MesAno): MesAno {
    return deIndice(indice(m) + 1)
}

export function mesmoMes(a: MesAno, b: MesAno): boolean {
    return a.mes === b.mes && a.ano === b.ano
}

export type DocAtivoUnidade = { unidade: string; mes: number | null; ano: number | null }

/**
 * Vigente = o menor mês entre os documentos de RAG ativos das unidades. Unidade sem documento ativo
 * ou em outro mês aparece em `foraDeSincronia`. Sem nenhum documento ativo, usa o mês do calendário.
 */
export function mesVigente(
    docsAtivos: DocAtivoUnidade[], unidades: readonly string[], hoje: Date,
): { vigente: MesAno; foraDeSincronia: string[] } {
    const validos = docsAtivos.filter(d => Number.isInteger(d.mes) && Number.isInteger(d.ano)) as { unidade: string; mes: number; ano: number }[]
    if (validos.length === 0) {
        return { vigente: { mes: hoje.getMonth() + 1, ano: hoje.getFullYear() }, foraDeSincronia: [...unidades] }
    }
    const vigente = deIndice(Math.min(...validos.map(indice)))
    const foraDeSincronia = unidades.filter(u => {
        const doc = validos.find(d => d.unidade === u)
        return !doc || !mesmoMes(doc, vigente)
    })
    return { vigente, foraDeSincronia }
}

/** Só o vigente e o seguinte. */
export function mesesPermitidos(vigente: MesAno): MesAno[] {
    return [vigente, proximoMes(vigente)]
}

export function mesPermitido(m: MesAno, vigente: MesAno): boolean {
    return mesesPermitidos(vigente).some(p => mesmoMes(p, m))
}

export type DocDaCampanha = { ativo: boolean; chunks: number; criadoEm: string }

export function estadoRag(
    statusCampanha: string | null, docs: DocDaCampanha[], agora: Date, minutosLimite = MINUTOS_LIMITE_INDEXACAO,
): EstadoRag {
    if (docs.some(d => d.ativo && d.chunks > 0)) return "no_ar"
    if (statusCampanha !== "aprovado") return "nao_aprovado"
    const maisRecente = [...docs].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0]
    if (!maisRecente || maisRecente.chunks > 0) return "falhou"
    const minutos = (agora.getTime() - new Date(maisRecente.criadoEm).getTime()) / 60000
    return minutos <= minutosLimite ? "indexando" : "falhou"
}

export type CategoriaSituacao = { categoria: string; status: string }

/** Nível 1 de uma unidade: programação existe, tem atividade e todas as categorias estão autorizadas. */
export function nivel1Unidade(
    statusCampanha: string | null, categoriasComAtividade: CategoriaSituacao[],
): { ok: boolean; faltando: string[] } {
    if (!statusCampanha) return { ok: false, faltando: ["sem programação"] }
    if (categoriasComAtividade.length === 0) return { ok: false, faltando: ["sem atividades"] }
    const faltando = categoriasComAtividade
        .filter(c => c.status !== "autorizada")
        .map(c => `${c.categoria} (${c.status === "aguardando_autorizacao" ? "aguardando autorização" : "rascunho"})`)
    const campanhaOk = statusCampanha === "autorizada" || statusCampanha === "aprovado"
    if (faltando.length === 0 && !campanhaOk) faltando.push(`programação em ${statusCampanha}`)
    return { ok: faltando.length === 0, faltando }
}

export type UnidadeSituacao = {
    unidade: string
    campanhaId: string | null
    statusCampanha: string | null
    categorias: CategoriaSituacao[]
    nivel1: boolean
    faltando: string[]
    rag: EstadoRag
}

/** A unidade entra no "Aprovar RAG"/"Atualizar RAG"? */
export function unidadePrecisaAprovarRag(u: UnidadeSituacao): boolean {
    if (!u.nivel1 || !u.campanhaId) return false
    if (u.rag === "indexando") return false
    return u.statusCampanha !== "aprovado" || u.rag !== "no_ar"
}

export function resumoNiveis(unidades: UnidadeSituacao[]) {
    const nivel1 = unidades.length > 0 && unidades.every(u => u.nivel1)
    const nivel2 = unidades.length > 0 && unidades.every(u => u.rag === "no_ar")
    const precisamAprovar = unidades.filter(unidadePrecisaAprovarRag).map(u => u.unidade)
    const indexando = unidades.filter(u => u.rag === "indexando").map(u => u.unidade)
    const rotuloAprovar = unidades.some(u => u.rag === "no_ar") ? "Atualizar RAG" : "Aprovar RAG"
    return { nivel1, nivel2, precisamAprovar, indexando, rotuloAprovar }
}

const curto = (unidade: string) => unidade.replace("Cuca ", "")

/** Motivo do bloqueio do "Disparar Aviso Global", ou null se liberado. */
export function motivoBloqueioDisparo(p: {
    temPermissao: boolean
    mesPermitido: boolean
    unidades: UnidadeSituacao[]
    temNumero: boolean
    temTemplate: boolean
}): string | null {
    if (!p.temPermissao) return "Sem permissão para disparar o aviso global"
    if (!p.mesPermitido) return "Mês fora do permitido (só o vigente e o seguinte)"
    const { nivel1, nivel2 } = resumoNiveis(p.unidades)
    if (!nivel1) {
        const faltam = p.unidades.filter(u => !u.nivel1).map(u => `${curto(u.unidade)}: ${u.faltando.join(", ")}`)
        return `Nível 1 pendente — ${faltam.join(" · ")}`
    }
    if (!nivel2) {
        const faltam = p.unidades.filter(u => u.rag !== "no_ar").map(u => `${curto(u.unidade)}: ${ROTULO_ESTADO_RAG[u.rag].toLowerCase()}`)
        return `Nível 2 pendente — RAG do mês ${faltam.join(" · ")}`
    }
    if (!p.temNumero) return "Número Meta Institucional indisponível"
    if (!p.temTemplate) return "Template Meta Institucional aprovado indisponível"
    return null
}
