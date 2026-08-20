import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

const CATEGORIA_NOME = "Academia Enem"

// Mesma normalização já usada em worker/campanhas_engine.normalizar_telefone e replicada em
// academia-enem/presencas/importar (S-AE-07): só dígitos; BR de 10/11 sem DDI recebe prefixo 55.
// leads.telefone tem constraint UNIQUE, mas a base tem registros antigos mistos (com/sem 55) —
// por isso o dedup pré-checa as duas variantes, não confia só no ON CONFLICT.
function normalizarTelefone(tel: unknown): string {
    const digits = String(tel ?? "").replace(/\D/g, "")
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
        return "55" + digits
    }
    return digits
}

type RowIn = { nome?: unknown; telefone?: unknown }

export async function POST(req: NextRequest) {
    try {
        // 1. Auth
        const supabase = await createClient()
        const { data: { user }, error: authErr } = await supabase.auth.getUser()
        if (authErr || !user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        // 2. Permissão server-side — bloqueia upload sem ae_leads_upload:create
        const { data: permOk } = await supabase
            .rpc("has_permission", { p_recurso: "ae_leads_upload", p_acao: "create" })
        if (!permOk) {
            return NextResponse.json({ error: "Sem permissão para importar leads" }, { status: 403 })
        }

        // 3. Payload
        const body = await req.json()
        const linhas = (body?.linhas ?? []) as RowIn[]
        if (!Array.isArray(linhas) || linhas.length === 0) {
            return NextResponse.json({ error: "Nenhuma linha para importar" }, { status: 400 })
        }

        const admin = createAdminClient()

        // 4. Categoria "Academia Enem" (já existe, criada na migração da migração Meta direta)
        const { data: catData } = await admin
            .from("categorias_interesse")
            .select("id")
            .eq("nome", CATEGORIA_NOME)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        const catId = catData?.id as string | undefined
        if (!catId) {
            return NextResponse.json({ error: "Categoria 'Academia Enem' não encontrada" }, { status: 500 })
        }

        // 5. Validação + normalização + dedupe in-batch (evita estourar o upsert com telefone repetido na própria planilha)
        const erros: { linha: number; motivo: string }[] = []
        const validMap = new Map<string, { nome: string | null; telefone: string }>()
        linhas.forEach((row, i) => {
            const telefone = normalizarTelefone(row.telefone)
            if (telefone.length < 12) {
                erros.push({ linha: i + 1, motivo: "Telefone inválido ou vazio" })
                return
            }
            validMap.set(telefone, { nome: String(row.nome ?? "").trim() || null, telefone })
        })
        const validRows = [...validMap.values()]

        if (validRows.length === 0) {
            return NextResponse.json({ total: linhas.length, novos: 0, ignorados: 0, erros })
        }

        // 6. Dedup real contra a base — checa as duas variantes (com/sem DDI 55), já que a base é mista
        const variants = new Set<string>()
        for (const r of validRows) {
            variants.add(r.telefone)
            if (r.telefone.startsWith("55")) variants.add(r.telefone.slice(2))
        }
        const { data: existentesData } = await admin
            .from("leads")
            .select("telefone")
            .in("telefone", [...variants])
        const existentesNorm = new Set(
            (existentesData ?? []).map(l => normalizarTelefone(l.telefone as string))
        )

        const novosRows = validRows.filter(r => !existentesNorm.has(r.telefone))
        const ignorados = validRows.length - novosRows.length

        // 7. Insere só os novos, em lotes — upsert com ON CONFLICT DO NOTHING como rede de segurança
        // extra (corrida/duplicata exata), não como dedup principal (que já foi feito no passo 6).
        let inseridos: { id: string }[] = []
        const CHUNK = 200
        for (let i = 0; i < novosRows.length; i += CHUNK) {
            const lote = novosRows.slice(i, i + CHUNK).map(r => ({
                nome: r.nome,
                telefone: r.telefone,
                opt_in: true,
                bloqueado: false,
            }))
            const { data, error } = await admin
                .from("leads")
                .upsert(lote, { onConflict: "telefone", ignoreDuplicates: true })
                .select("id")
            if (error) {
                throw new Error(`Erro ao gravar (lote ${Math.floor(i / CHUNK) + 1}): ${error.message}`)
            }
            inseridos = inseridos.concat((data ?? []) as { id: string }[])
        }

        // 8. Tag "Academia Enem" nos leads recém-criados
        if (inseridos.length > 0) {
            const tagRows = inseridos.map(l => ({ lead_id: l.id, categoria_id: catId }))
            const { error: tagErr } = await admin
                .from("lead_interesses")
                .upsert(tagRows, { onConflict: "lead_id,categoria_id", ignoreDuplicates: true })
            if (tagErr) {
                console.error("[academia-enem/leads/upload] erro ao taguear novos leads:", tagErr)
            }
        }

        return NextResponse.json({
            total: linhas.length,
            novos: inseridos.length,
            ignorados,
            erros,
        })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/leads/upload]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
