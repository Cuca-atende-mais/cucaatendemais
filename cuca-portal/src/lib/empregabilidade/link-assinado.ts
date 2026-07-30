import crypto from "crypto"

const SECRET = process.env.EMPREGABILIDADE_LINK_SECRET || ""

export type ResultadoLinkAssinado = {
    valido: boolean
    motivo?: string
}

function canonicalizar(params: URLSearchParams): string {
    const entries = [...params.entries()]
        .filter(([key]) => key !== "sig")
        .sort(([a], [b]) => a.localeCompare(b))

    return new URLSearchParams(entries).toString()
}

function compararSeguro(a: string, b: string): boolean {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ba.length !== bb.length) return false
    try {
        return crypto.timingSafeEqual(ba, bb)
    } catch {
        return false
    }
}

export function verificarLinkAssinado(searchParams: URLSearchParams): ResultadoLinkAssinado {
    if (!SECRET) return { valido: true }

    const sig = searchParams.get("sig")
    const exp = searchParams.get("exp")
    if (!sig || !exp) return { valido: false, motivo: "assinatura ausente" }

    const expNumero = Number(exp)
    if (!Number.isFinite(expNumero)) return { valido: false, motivo: "expiração inválida" }
    if (Date.now() / 1000 > expNumero) return { valido: false, motivo: "link expirado" }

    const canonical = canonicalizar(searchParams)
    const esperado = crypto.createHmac("sha256", SECRET).update(canonical).digest("hex")

    if (!compararSeguro(sig, esperado)) {
        return { valido: false, motivo: "assinatura inválida" }
    }
    return { valido: true }
}

export function parseLinkParams(value: unknown): URLSearchParams | null {
    if (typeof value === "string") return new URLSearchParams(value)
    if (!value || typeof value !== "object" || Array.isArray(value)) return null

    const params = new URLSearchParams()
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (raw === null || raw === undefined) continue
        params.set(key, String(raw))
    }
    return params
}

export function verificarLinkParams(
    value: unknown,
    esperados: Record<string, string | number | null | undefined> = {},
): ResultadoLinkAssinado {
    const params = parseLinkParams(value)
    if (!params && !SECRET) return { valido: true }
    if (!params) return { valido: false, motivo: "parâmetros de assinatura ausentes" }

    const resultado = verificarLinkAssinado(params)
    if (!resultado.valido) return resultado

    for (const [key, esperado] of Object.entries(esperados)) {
        if (esperado === null || esperado === undefined || String(esperado) === "") continue
        if (params.get(key) !== String(esperado)) {
            return { valido: false, motivo: "parâmetros do link não conferem" }
        }
    }

    return { valido: true }
}
