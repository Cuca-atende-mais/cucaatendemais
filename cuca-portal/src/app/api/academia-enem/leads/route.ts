import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"

const CATEGORIA_NOME = "Academia Enem"

// Resolve o id da categoria de forma defensiva (há nomes duplicados em categorias_interesse → maybeSingle/limit 1).
async function getCategoriaId(admin: SupabaseClient): Promise<string | null> {
    const { data } = await admin
        .from("categorias_interesse")
        .select("id")
        .eq("nome", CATEGORIA_NOME)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
    return (data?.id as string | undefined) ?? null
}

async function checkAuth(recurso: string, acao: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: "Não autenticado", status: 401 as const }
    const { data: ok } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: acao })
    if (!ok) return { error: "Sem permissão", status: 403 as const }
    return { error: null }
}

// GET ?mode=recorte&unidade=&optIn=true  → público (matriculados elegíveis)
// GET ?mode=buscar&q=...                 → leads para marcar/desmarcar (com flag matriculado)
export async function GET(req: NextRequest) {
    try {
        const gate = await checkAuth("ae_leads_filtro", "read")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const admin = createAdminClient()
        const catId = await getCategoriaId(admin)
        if (!catId) return NextResponse.json({ error: "Categoria 'Academia Enem' não encontrada" }, { status: 500 })

        const url = new URL(req.url)
        const mode = url.searchParams.get("mode") ?? "recorte"

        // ids dos leads marcados (matriculados)
        const { data: interesses } = await admin.from("lead_interesses").select("lead_id").eq("categoria_id", catId)
        const matriculadoIds = new Set((interesses ?? []).map(i => i.lead_id as string))

        if (mode === "buscar") {
            const raw = (url.searchParams.get("q") ?? "").trim()
            // Sanitiza caracteres estruturais do filtro PostgREST (.or) e curingas, para não quebrar nem injetar condições.
            const q = raw.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim()
            if (q.length < 2) return NextResponse.json({ leads: [] })
            const { data: leads } = await admin
                .from("leads")
                .select("id, nome, telefone, unidade_cuca")
                .or(`nome.ilike.%${q}%,telefone.ilike.%${q}%`)
                .limit(20)
            return NextResponse.json({
                leads: (leads ?? []).map(l => ({ ...l, matriculado: matriculadoIds.has(l.id as string) })),
            })
        }

        // mode = recorte: leads matriculados (S-AE-13 — inclui bloqueados, pra permitir gerenciar/
        // desbloquear na tela; quem monta o público de disparo em si filtra bloqueado no cliente,
        // igual à lógica de _query_leads_sync que já exclui bloqueado=true nesse ponto).
        if (matriculadoIds.size === 0) return NextResponse.json({ leads: [] })
        const unidade = url.searchParams.get("unidade") || ""
        const somenteOptIn = url.searchParams.get("optIn") !== "false" // default: só opt-in

        let query = admin
            .from("leads")
            .select("id, nome, telefone, unidade_cuca, opt_in, bloqueado, motivo_bloqueio")
            .in("id", [...matriculadoIds])
        if (somenteOptIn) query = query.eq("opt_in", true)
        if (unidade) query = query.eq("unidade_cuca", unidade)
        const { data: leads } = await query.order("nome", { ascending: true })
        return NextResponse.json({ leads: leads ?? [] })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/leads GET]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

// POST { lead_id, matriculado } → adiciona/remove a tag de matrícula (lead_interesses)
export async function POST(req: NextRequest) {
    try {
        const gate = await checkAuth("ae_leads_filtro", "update")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const { lead_id, matriculado } = await req.json() as { lead_id?: string; matriculado?: boolean }
        if (!lead_id) return NextResponse.json({ error: "lead_id obrigatório" }, { status: 400 })

        const admin = createAdminClient()
        const catId = await getCategoriaId(admin)
        if (!catId) return NextResponse.json({ error: "Categoria 'Academia Enem' não encontrada" }, { status: 500 })

        if (matriculado) {
            // idempotente: UNIQUE (lead_id, categoria_id) → ignora duplicata
            const { error } = await admin
                .from("lead_interesses")
                .upsert({ lead_id, categoria_id: catId }, { onConflict: "lead_id,categoria_id", ignoreDuplicates: true })
            if (error) throw error
        } else {
            const { error } = await admin
                .from("lead_interesses")
                .delete()
                .eq("lead_id", lead_id)
                .eq("categoria_id", catId)
            if (error) throw error
        }
        return NextResponse.json({ ok: true, lead_id, matriculado: !!matriculado })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/leads POST]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

// PATCH { ids, acao: 'editar'|'bloquear'|'desbloquear', nome?, telefone?, motivo? }
// S-AE-13: CRUD/status do lead, mesma semântica de campos (bloqueado/motivo_bloqueio) já usada
// pela tela geral de Leads (cuca-portal/src/app/(dashboard)/leads/page.tsx) — não existe uma
// função/API compartilhada pra importar de lá (a tela geral escreve direto via client Supabase,
// inline no componente), então o reaproveito aqui é de campo/valor, não de função importada.
export async function PATCH(req: NextRequest) {
    try {
        const gate = await checkAuth("ae_leads_filtro", "update")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const body = await req.json() as {
            ids?: string[]; acao?: string; nome?: string; telefone?: string; motivo?: string
        }
        const ids = (body.ids ?? []).filter(Boolean)
        if (ids.length === 0) return NextResponse.json({ error: "ids obrigatório" }, { status: 400 })

        const admin = createAdminClient()

        if (body.acao === "editar") {
            if (ids.length !== 1) return NextResponse.json({ error: "Edição é só por lead individual" }, { status: 400 })
            const update: Record<string, string> = {}
            if (body.nome !== undefined) update.nome = body.nome.trim()
            if (body.telefone !== undefined) {
                const tel = body.telefone.replace(/\D/g, "")
                if (!tel) return NextResponse.json({ error: "Telefone inválido" }, { status: 400 })
                update.telefone = tel
            }
            if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 })
            const { error } = await admin.from("leads").update(update).eq("id", ids[0])
            if (error) throw error
        } else if (body.acao === "bloquear") {
            const { error } = await admin
                .from("leads")
                .update({ bloqueado: true, motivo_bloqueio: body.motivo || null })
                .in("id", ids)
            if (error) throw error
        } else if (body.acao === "desbloquear") {
            const { error } = await admin
                .from("leads")
                .update({ bloqueado: false, motivo_bloqueio: null })
                .in("id", ids)
            if (error) throw error
        } else {
            return NextResponse.json({ error: "acao inválida (use editar|bloquear|desbloquear)" }, { status: 400 })
        }
        return NextResponse.json({ ok: true })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/leads PATCH]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
