// S-EMP-GES-01: regra única de mudança de status de candidatura e do reflexo no Banco de Talentos.
// Usada pela tela Feedback (individual e lote), pela tela do candidato e pela rota `rejeitar`.
// Decisões do Junior (2026-10-08):
//   D2 — selecionado/contratado trava o talento; só "rejeitado" devolve ao Banco de Talentos.
//   D4 — quem tem processo ativo em outra vaga continua travado mesmo sendo rejeitado aqui.
//   D5 — sem currículo, não se cria cadastro novo no Banco de Talentos.
// Este módulo é puro (sem banco); a execução fica em aplicar-status-candidatura.ts.

export const STATUS_EDITAVEIS = ["pendente", "selecionado", "contratado", "rejeitado"] as const
export type StatusEditavel = (typeof STATUS_EDITAVEIS)[number]

export function ehStatusEditavel(status: unknown): status is StatusEditavel {
    return typeof status === "string" && (STATUS_EDITAVEIS as readonly string[]).includes(status)
}

// Rótulos de todos os valores da CHECK `check_candidaturas_status`.
export const ROTULO_STATUS_CANDIDATURA: Record<string, string> = {
    pendente: "Pendente",
    selecionado: "Selecionado",
    contratado: "Contratado",
    rejeitado: "Rejeitado",
    banco_talentos: "Banco de Talentos",
    aprovado_empresa: "Aprovado pela empresa",
    convite_enviado: "Convite enviado",
    entrevista_confirmada: "Entrevista confirmada",
    entrevista_recusada: "Entrevista recusada",
    duvida: "Dúvida",
    enviada: "Enviada",
}

export function rotuloStatusCandidatura(status: string | null | undefined): string {
    if (!status) return "—"
    return ROTULO_STATUS_CANDIDATURA[status] ?? status
}

/**
 * Chave para casar a mesma pessoa com telefones em formatos diferentes: só dígitos, sem o 55,
 * e DDD + últimos 8 dígitos (casa números com e sem o 9 extra). Espelha `emp_chave_telefone` no banco.
 */
export function chaveTelefone(telefone: string | null | undefined): string | null {
    const digitos = (telefone ?? "").replace(/\D/g, "")
    const semDdi = (digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")
        ? digitos.slice(2)
        : digitos
    if (semDdi === "") return null
    if (semDdi.length === 10 || semDdi.length === 11) return semDdi.slice(0, 2) + semDdi.slice(-8)
    return semDdi
}

type DadosOcr = Record<string, unknown> | null | undefined

function ocrPreenchido(ocr: DadosOcr): ocr is Record<string, unknown> {
    return !!ocr && typeof ocr === "object" && Object.keys(ocr).length > 0
}

export function temCurriculo(candidatura: { arquivo_cv_url?: string | null; dados_ocr_json?: DadosOcr }): boolean {
    return !!candidatura.arquivo_cv_url || ocrPreenchido(candidatura.dados_ocr_json)
}

export type AcaoTalento =
    | { tipo: "travar"; status: "selecionado" | "contratado" }
    | { tipo: "liberar" }
    | { tipo: "criar" }
    | { tipo: "nenhuma"; motivo: "status_sem_reflexo" | "sem_cadastro" | "processo_ativo" | "sem_curriculo" }

export function decidirAcaoTalento(entrada: {
    novoStatus: StatusEditavel
    cadastrosExistentes: number
    processoAtivoEmOutraVaga: boolean
    temCurriculo: boolean
}): AcaoTalento {
    const { novoStatus, cadastrosExistentes, processoAtivoEmOutraVaga } = entrada
    if (novoStatus === "selecionado" || novoStatus === "contratado") {
        return cadastrosExistentes > 0 ? { tipo: "travar", status: novoStatus } : { tipo: "nenhuma", motivo: "sem_cadastro" }
    }
    if (novoStatus === "rejeitado") {
        if (processoAtivoEmOutraVaga) return { tipo: "nenhuma", motivo: "processo_ativo" }
        if (cadastrosExistentes > 0) return { tipo: "liberar" }
        return entrada.temCurriculo ? { tipo: "criar" } : { tipo: "nenhuma", motivo: "sem_curriculo" }
    }
    return { tipo: "nenhuma", motivo: "status_sem_reflexo" }
}

export interface CandidaturaParaTalento {
    id: string
    vaga_id: string | null
    nome: string | null
    telefone: string | null
    data_nascimento: string | null
    arquivo_cv_url: string | null
    dados_ocr_json: DadosOcr
    area_interesse: string[] | null
    created_at: string | null
    pcd_candidato: boolean | null
    pcd_tipo_candidato: string | null
}

function primeiroEmprego(ocr: DadosOcr): boolean {
    const meses = ocrPreenchido(ocr) ? ocr.experiencia_meses : null
    return typeof meses === "number" ? meses === 0 : false
}

function urlCurriculo(c: CandidaturaParaTalento): string | null {
    const doOcr = ocrPreenchido(c.dados_ocr_json) ? c.dados_ocr_json.arquivo_cv_url : null
    return (typeof doOcr === "string" && doOcr) || c.arquivo_cv_url || null
}

/** Cadastro novo no Banco de Talentos a partir da candidatura rejeitada (mesmos campos da rota antiga). */
export function novoTalento(c: CandidaturaParaTalento) {
    return {
        nome: c.nome,
        telefone: c.telefone || null,
        data_nascimento: c.data_nascimento || null,
        arquivo_cv_url: urlCurriculo(c),
        candidatura_origem_id: c.id,
        vaga_origem_id: c.vaga_id || null,
        skills_jsonb: ocrPreenchido(c.dados_ocr_json) ? c.dados_ocr_json : null,
        area_interesse: c.area_interesse || null,
        status: "disponivel" as const,
        data_curriculo: c.created_at || null,
        primeiro_emprego: primeiroEmprego(c.dados_ocr_json),
        pcd_candidato: c.pcd_candidato ?? false,
        pcd_tipo_candidato: c.pcd_tipo_candidato || null,
    }
}

const CAMPOS_PREENCHIVEIS = [
    "nome", "data_nascimento", "arquivo_cv_url", "skills_jsonb", "area_interesse",
    "data_curriculo", "pcd_tipo_candidato",
] as const

function vazio(valor: unknown): boolean {
    if (valor === null || valor === undefined || valor === "") return true
    if (Array.isArray(valor)) return valor.length === 0
    if (typeof valor === "object") return Object.keys(valor as object).length === 0
    return false
}

/**
 * Ao devolver um talento existente ao banco, só preenche o que está vazio — nunca apaga nem
 * sobrescreve currículo, habilidades extraídas ou outros dados que o cadastro já tem.
 */
export function preencherCamposVazios(talento: Record<string, unknown>, c: CandidaturaParaTalento): Record<string, unknown> {
    const base = novoTalento(c) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const campo of CAMPOS_PREENCHIVEIS) {
        if (vazio(talento[campo]) && !vazio(base[campo])) patch[campo] = base[campo]
    }
    return patch
}

/** Origem exibida na tela Feedback: convocado do Banco de Talentos ou candidatura direta. */
export function origemCandidatura(observacoes: string | null | undefined): "banco_talentos" | "direta" {
    return (observacoes ?? "").startsWith("banco_talentos:") ? "banco_talentos" : "direta"
}

/**
 * D3 (2026-10-08): o aviso automático de "selecionado" ao jovem fica pausado. Religar = definir
 * EMPREG_NOTIFICAR_SELECIONADO_ATIVO=true no portal; qualquer outro valor (ou ausente) mantém pausado.
 */
export function avisoSelecionadoAtivo(valor: string | undefined = process.env.EMPREG_NOTIFICAR_SELECIONADO_ATIVO): boolean {
    return (valor ?? "").trim().toLowerCase() === "true"
}

/** Mensagem da tela do candidato depois de rejeitar, conforme o que a regra fez no Banco de Talentos. */
export function mensagemRejeicao(talento?: AcaoTalento["tipo"], motivo?: string): string {
    if (talento === "liberar" || talento === "criar") return "Candidato rejeitado e devolvido ao Banco de Talentos."
    if (motivo === "processo_ativo") return "Candidato rejeitado. Ele continua fora do Banco de Talentos porque está em processo em outra vaga."
    if (motivo === "sem_curriculo") return "Candidato rejeitado. Sem currículo, ele não entra no Banco de Talentos."
    return "Candidato rejeitado."
}
