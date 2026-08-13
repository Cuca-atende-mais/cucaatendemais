import crypto from "crypto"
import type { CvDados } from "./curriculo-tipos"

const DOWNLOAD_TTL_SECONDS = 15 * 60

export function normalizarTelefone(valor: string | null | undefined): string {
    let digits = String(valor || "").replace(/\D/g, "")
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
        digits = digits.slice(2)
    }
    return digits
}

export function hashTelefone(valor: string): string {
    return crypto.createHash("sha256").update(normalizarTelefone(valor)).digest("hex")
}

export function hashDownloadToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex")
}

export function criarAssinaturaDownload(params: {
    talentId: string
    token: string
    exp: number
    secret: string
}): string {
    const canonical = new URLSearchParams({
        exp: String(params.exp),
        talent_id: params.talentId,
        token: params.token,
    }).toString()
    return crypto.createHmac("sha256", params.secret).update(canonical).digest("hex")
}

export function verificarAssinaturaDownload(params: {
    talentId: string
    token: string
    exp: string | null
    sig: string | null
    secret: string
}): boolean {
    if (!params.secret || !params.exp || !params.sig) return false
    const expNumero = Number(params.exp)
    if (!Number.isFinite(expNumero) || Date.now() / 1000 > expNumero) return false

    const esperado = criarAssinaturaDownload({
        talentId: params.talentId,
        token: params.token,
        exp: expNumero,
        secret: params.secret,
    })

    const a = Buffer.from(params.sig)
    const b = Buffer.from(esperado)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function criarDownloadToken(talentId: string, secret: string): {
    token: string
    tokenHash: string
    expiresAt: string
    url: string
} {
    const token = crypto.randomBytes(32).toString("base64url")
    const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS
    const sig = criarAssinaturaDownload({ talentId, token, exp, secret })
    const qs = new URLSearchParams({
        talent_id: talentId,
        token,
        exp: String(exp),
        sig,
    })
    return {
        token,
        tokenHash: hashDownloadToken(token),
        expiresAt: new Date(exp * 1000).toISOString(),
        url: `/api/empregabilidade/curriculo/download?${qs.toString()}`,
    }
}

export function criarRespostaCurriculoPublico(params: {
    curriculoId: string
    talentId: string
    downloadUrl: string
    // SQS-63: só presente quando a geração do DOCX deu certo — falha na
    // geração não deve expor um botão de download quebrado (Risco #3 da
    // story), então o campo fica ausente em vez de null/erro.
    docxDownloadUrl?: string
}): {
    curriculo_id: string
    talent_id: string
    pdf_url: string
    docx_url?: string
} {
    return {
        curriculo_id: params.curriculoId,
        talent_id: params.talentId,
        pdf_url: params.downloadUrl,
        ...(params.docxDownloadUrl ? { docx_url: params.docxDownloadUrl } : {}),
    }
}

export function normalizarCvDados(values: Partial<CvDados>, fallback: {
    nome: string
    telefone: string
}): CvDados {
    return {
        nome: String(values.nome || fallback.nome || "").trim(),
        endereco: String(values.endereco || "").trim(),
        telefone: normalizarTelefone(values.telefone || fallback.telefone),
        email: String(values.email || "").trim(),
        linkedin: String(values.linkedin || "").trim(),
        portfolio: String(values.portfolio || "").trim(),
        apresentacao: String(values.apresentacao || "").trim(),
        objetivo: String(values.objetivo || "").trim(),
        experiencias: Array.isArray(values.experiencias) ? values.experiencias : [],
        formacoes: Array.isArray(values.formacoes) ? values.formacoes : [],
        cursos: Array.isArray(values.cursos) ? values.cursos : [],
        habilidades: Array.isArray(values.habilidades) ? values.habilidades : [],
    }
}
