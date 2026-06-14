import crypto from "crypto"

// Helpers do webhook da AuctaFlux (eventos reencaminhados da Meta / WhatsApp Cloud API).
// O esquema HMAC exato (header/algoritmo/encoding) NÃO está documentado → a verificação tenta
// candidatos comuns (estilo Meta) e RETORNA qual casou, para auto-confirmar no 1º evento real.

// Mesma normalização canônica dos disparos (worker/campanhas_engine.normalizar_telefone):
// só dígitos; BR de 10/11 dígitos sem DDI recebem prefixo 55.
export function normalizarTelefone(tel: unknown): string {
    const digits = String(tel ?? "").replace(/\D/g, "")
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
        return "55" + digits
    }
    return digits
}

export interface ResultadoHmac {
    verificada: boolean
    esquema: string | null   // ex.: "x-hub-signature-256:sha256-hex" — qual candidato casou
    headerPresente: string | null // primeiro header de assinatura encontrado (mesmo que não case)
}

// Headers candidatos a conter a assinatura (estilo Meta + variações comuns de BSP).
const HEADERS_ASSINATURA = [
    "x-hub-signature-256",
    "x-hub-signature",
    "x-signature",
    "x-auctaflux-signature",
    "x-webhook-signature",
    "x-forward-signature",
    "signature",
]

function comparaSeguro(a: string, b: string): boolean {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ba.length !== bb.length) return false
    try {
        return crypto.timingSafeEqual(ba, bb)
    } catch {
        return false
    }
}

// Verifica a assinatura HMAC do corpo CRU contra o forward_secret, testando esquemas candidatos.
// Modo "monitor": quem chama decide se rejeita (enforce) ou só registra (verificada=false não bloqueia).
export function verificarAssinatura(
    rawBody: string,
    secret: string | null,
    headers: Record<string, string>,
): ResultadoHmac {
    let headerPresente: string | null = null
    if (!secret) return { verificada: false, esquema: null, headerPresente }

    // Digests candidatos do corpo cru.
    const sha256hex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
    const sha256b64 = crypto.createHmac("sha256", secret).update(rawBody).digest("base64")
    const sha1hex = crypto.createHmac("sha1", secret).update(rawBody).digest("hex")

    for (const h of HEADERS_ASSINATURA) {
        const bruto = headers[h]
        if (!bruto) continue
        if (!headerPresente) headerPresente = h
        // Remove prefixos comuns ("sha256=", "sha1=").
        const valor = bruto.replace(/^sha256=/i, "").replace(/^sha1=/i, "").trim()
        const candidatos: [string, string][] = [
            [`${h}:sha256-hex`, sha256hex],
            [`${h}:sha256-base64`, sha256b64],
            [`${h}:sha1-hex`, sha1hex],
        ]
        for (const [esquema, esperado] of candidatos) {
            if (comparaSeguro(valor.toLowerCase(), esperado.toLowerCase()) || comparaSeguro(valor, esperado)) {
                return { verificada: true, esquema, headerPresente }
            }
        }
    }
    return { verificada: false, esquema: null, headerPresente }
}

// ── Parsing do payload (formato Meta WhatsApp Cloud API, possivelmente embrulhado pela AuctaFlux) ──

export interface MensagemEntrada {
    wa_message_id: string
    from: string                 // wa_id do lead (cru, ex.: "5585...")
    tipo: string                 // text | image | audio | interactive | button | ...
    conteudo: string | null
    timestamp: string | null     // unix seconds (string), conforme Meta
    push_name: string | null
}

export interface StatusSaida {
    wa_message_id: string
    status: string               // sent | delivered | read | failed
}

export interface EventoMeta {
    phone_number_id: string | null
    display_phone_number: string | null
    waba_id: string | null
    mensagens: MensagemEntrada[]
    statuses: StatusSaida[]
}

// Procura defensivamente o array `entry` do payload Meta — direto ou embrulhado pela AuctaFlux
// (ex.: { event, data: {...meta...} } ou { payload: {...meta...} }).
function localizarEntries(body: unknown): unknown[] {
    if (!body || typeof body !== "object") return []
    const obj = body as Record<string, unknown>
    if (Array.isArray(obj.entry)) return obj.entry
    for (const k of ["data", "payload", "body", "event"]) {
        const inner = obj[k]
        if (inner && typeof inner === "object" && Array.isArray((inner as Record<string, unknown>).entry)) {
            return (inner as Record<string, unknown>).entry as unknown[]
        }
    }
    return []
}

function extrairConteudo(msg: Record<string, unknown>): string | null {
    const tipo = String(msg.type ?? "")
    switch (tipo) {
        case "text":
            return ((msg.text as Record<string, unknown>)?.body as string) ?? null
        case "button":
            return ((msg.button as Record<string, unknown>)?.text as string) ?? null
        case "interactive": {
            const it = msg.interactive as Record<string, unknown> | undefined
            const lr = it?.list_reply as Record<string, unknown> | undefined
            const br = it?.button_reply as Record<string, unknown> | undefined
            return (lr?.title as string) ?? (br?.title as string) ?? null
        }
        case "image":
        case "audio":
        case "video":
        case "document":
        case "sticker": {
            const media = msg[tipo] as Record<string, unknown> | undefined
            return (media?.caption as string) ?? null
        }
        default:
            return null
    }
}

// Extrai os eventos (mensagens recebidas + status) de um payload Meta (ou embrulhado).
export function extrairEventos(body: unknown): EventoMeta[] {
    const entries = localizarEntries(body)
    const eventos: EventoMeta[] = []

    for (const entry of entries) {
        const e = entry as Record<string, unknown>
        const waba_id = (e.id as string) ?? null
        const changes = Array.isArray(e.changes) ? e.changes : []
        for (const change of changes) {
            const value = (change as Record<string, unknown>).value as Record<string, unknown> | undefined
            if (!value) continue
            const metadata = value.metadata as Record<string, unknown> | undefined
            const contatos = Array.isArray(value.contacts) ? value.contacts as Record<string, unknown>[] : []
            // Mapa wa_id → push_name (profile.name).
            const nomePorWaId = new Map<string, string>()
            for (const c of contatos) {
                const waId = c.wa_id as string | undefined
                const nome = (c.profile as Record<string, unknown>)?.name as string | undefined
                if (waId && nome) nomePorWaId.set(waId, nome)
            }

            const mensagens: MensagemEntrada[] = []
            const msgs = Array.isArray(value.messages) ? value.messages as Record<string, unknown>[] : []
            for (const m of msgs) {
                const id = m.id as string | undefined
                const from = m.from as string | undefined
                if (!id || !from) continue
                mensagens.push({
                    wa_message_id: id,
                    from,
                    tipo: String(m.type ?? "text"),
                    conteudo: extrairConteudo(m),
                    timestamp: (m.timestamp as string) ?? null,
                    push_name: nomePorWaId.get(from) ?? null,
                })
            }

            const statuses: StatusSaida[] = []
            const sts = Array.isArray(value.statuses) ? value.statuses as Record<string, unknown>[] : []
            for (const s of sts) {
                const id = s.id as string | undefined
                const status = s.status as string | undefined
                if (id && status) statuses.push({ wa_message_id: id, status })
            }

            eventos.push({
                phone_number_id: (metadata?.phone_number_id as string) ?? null,
                display_phone_number: (metadata?.display_phone_number as string) ?? null,
                waba_id,
                mensagens,
                statuses,
            })
        }
    }
    return eventos
}
