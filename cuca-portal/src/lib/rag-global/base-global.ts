/**
 * S-PROG-16: o que é documento da Base de Conhecimento Global e o que a tela pode mandar gravar.
 * Funções puras, usadas pela lista e pelas rotas `/api/rag-global/**`, para as duas usarem a mesma regra.
 */

/** Tipos que o formulário oferece. */
export const TIPOS_FORMULARIO_BASE_GLOBAL = ["Institucional", "Endereços", "Programas", "Horários", "Contatos", "FAQ", "servicos_rede", "Outro"] as const

/** Tipos que a base global gerencia: os do formulário e o resumo gerado pela `gerar-resumo-rede`. */
export const TIPOS_BASE_GLOBAL: readonly string[] = [...TIPOS_FORMULARIO_BASE_GLOBAL, "resumo_rede"]

export type DocumentoRag = {
    tipo: string
    unidade_cuca: string | null
    metadados: Record<string, unknown> | null
}

/**
 * Allowlist: sem unidade, tipo da base global e fora da Academia Enem. Eventos pontuais, vagas e
 * programação mensal ficam de fora (são geridos pelos próprios módulos).
 */
export function documentoDaBaseGlobal(doc: DocumentoRag): boolean {
    if (doc.unidade_cuca !== null) return false
    if (!TIPOS_BASE_GLOBAL.includes(doc.tipo)) return false
    return doc.metadados?.source_type !== "academia_enem"
}

export type DadosDocumentoGlobal = {
    titulo: string
    tipo: string
    conteudo: string | null
    pdf: { path: string; nome: string } | null
}

const textoOuNull = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)

/** PDF da base global fica em `global/` no storage `rag-documentos`; nada fora dessa pasta. */
export function caminhoPdfValido(path: unknown): path is string {
    return typeof path === "string" && path.startsWith("global/") && !path.includes("..") && path.length > "global/".length
}

/**
 * Lê só os campos do formulário. `tipoAtual` (edição) permite manter um tipo fora do formulário, como
 * `resumo_rede`. Texto exige conteúdo; PDF exige caminho válido, ou nada na edição (mantém o atual).
 */
export function lerDadosDocumentoGlobal(
    body: unknown,
    opcoes: { tipoAtual?: string; temPdfAtual?: boolean } = {},
): { erro: string } | { dados: DadosDocumentoGlobal } {
    const b = (body ?? {}) as Record<string, unknown>
    const titulo = textoOuNull(b.titulo)
    if (!titulo) return { erro: "Título obrigatório" }

    const tipo = textoOuNull(b.tipo)
    const tipoPermitido = !!tipo && ((TIPOS_FORMULARIO_BASE_GLOBAL as readonly string[]).includes(tipo) || tipo === opcoes.tipoAtual)
    if (!tipo || !tipoPermitido) return { erro: "Tipo inválido" }

    if (b.modo === "pdf") {
        if (b.pdf_path === undefined || b.pdf_path === null) {
            if (opcoes.temPdfAtual) return { dados: { titulo, tipo, conteudo: null, pdf: null } }
            return { erro: "Selecione um arquivo PDF" }
        }
        if (!caminhoPdfValido(b.pdf_path)) return { erro: "Arquivo PDF inválido" }
        const nome = textoOuNull(b.pdf_nome) ?? b.pdf_path.slice("global/".length)
        return { dados: { titulo, tipo, conteudo: null, pdf: { path: b.pdf_path, nome } } }
    }

    const conteudo = textoOuNull(b.conteudo)
    if (!conteudo) return { erro: "Conteúdo obrigatório" }
    return { dados: { titulo, tipo, conteudo, pdf: null } }
}
