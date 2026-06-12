import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Mesma normalização dos disparos (worker/campanhas_engine.normalizar_telefone):
// só dígitos; números BR de 10/11 dígitos sem DDI recebem prefixo 55. É a chave de identidade/dedup.
function normalizarTelefone(tel: unknown): string {
    const digits = String(tel ?? "").replace(/\D/g, "")
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
        return "55" + digits
    }
    return digits
}

function parsePresente(v: unknown): boolean {
    const s = String(v ?? "").trim().toLowerCase()
    return ["sim", "s", "yes", "y", "true", "1", "presente", "p", "x", "✓"].includes(s)
}

// Normaliza a data para 'YYYY-MM-DD'. Aceita ISO, DD/MM/YYYY e variações; retorna null se inválida.
function parseDataISO(v: unknown): string | null {
    const s = String(v ?? "").trim()
    if (!s) return null
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
    m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
    if (m) {
        const d = m[1].padStart(2, "0")
        const mo = m[2].padStart(2, "0")
        const y = m[3].length === 2 ? "20" + m[3] : m[3]
        if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null
        return `${y}-${mo}-${d}`
    }
    return null
}

type RowIn = { nome?: unknown; telefone?: unknown; presenca?: unknown; data?: unknown }

export async function POST(req: NextRequest) {
    try {
        // 1. Auth (server-side via cookies da sessão)
        const supabase = await createClient()
        const { data: { user }, error: authErr } = await supabase.auth.getUser()
        if (authErr || !user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        // 2. Permissão server-side (AC5): bloqueia import sem ae_presenca:create
        const { data: permOk } = await supabase
            .rpc("has_permission", { p_recurso: "ae_presenca", p_acao: "create" })
        if (!permOk) {
            return NextResponse.json({ error: "Sem permissão para importar presença" }, { status: 403 })
        }

        // 3. Payload
        const body = await req.json()
        const linhas = (body?.linhas ?? []) as RowIn[]
        if (!Array.isArray(linhas) || linhas.length === 0) {
            return NextResponse.json({ error: "Nenhuma linha para importar" }, { status: 400 })
        }

        // 4. Validação + normalização + dedupe in-batch por (telefone, data) — evita estourar o ON CONFLICT
        const invalidas: { linha: number; motivo: string }[] = []
        const validMap = new Map<string, { nome: string | null; telefone: string; presente: boolean; data_encontro: string }>()

        linhas.forEach((row, i) => {
            const telefone = normalizarTelefone(row.telefone)
            const data_encontro = parseDataISO(row.data)
            if (telefone.length < 12) { invalidas.push({ linha: i + 1, motivo: "Telefone inválido ou vazio" }); return }
            if (!data_encontro) { invalidas.push({ linha: i + 1, motivo: "Data inválida ou vazia" }); return }
            validMap.set(`${telefone}__${data_encontro}`, {
                nome: String(row.nome ?? "").trim() || null,
                telefone,
                presente: parsePresente(row.presenca),
                data_encontro,
            })
        })

        const validRows = [...validMap.values()]
        if (validRows.length === 0) {
            return NextResponse.json({ total: linhas.length, importadas: 0, vinculadas: 0, invalidas })
        }

        const admin = createAdminClient()

        // 5. Vínculo com leads (AC3): leads.telefone é misto (com e sem DDI 55) — busca ambas as variantes
        //    e normaliza os dois lados antes de casar.
        const phones = [...new Set(validRows.map(r => r.telefone))]
        const variants = new Set<string>()
        for (const p of phones) {
            variants.add(p)
            if (p.startsWith("55")) variants.add(p.slice(2))
        }
        const { data: leadsData } = await admin
            .from("leads")
            .select("id, telefone")
            .in("telefone", [...variants])
        const leadByPhone = new Map<string, string>()
        for (const l of leadsData ?? []) {
            const norm = normalizarTelefone(l.telefone)
            if (norm && !leadByPhone.has(norm)) leadByPhone.set(norm, l.id as string)
        }

        const payload = validRows.map(r => ({ ...r, lead_id: leadByPhone.get(r.telefone) ?? null }))

        // 6. Upsert idempotente (AC2) por (telefone, data_encontro), em lotes
        const CHUNK = 200
        for (let i = 0; i < payload.length; i += CHUNK) {
            const { error } = await admin
                .from("ae_presencas")
                .upsert(payload.slice(i, i + CHUNK), { onConflict: "telefone,data_encontro" })
            if (error) throw new Error(`Erro ao gravar (lote ${Math.floor(i / CHUNK) + 1}): ${error.message}`)
        }

        return NextResponse.json({
            total: linhas.length,
            importadas: payload.length,
            vinculadas: payload.filter(p => p.lead_id).length,
            invalidas,
        })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/presencas/importar]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
