import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// S-AE-06: contato(s) de transbordo humano PRÓPRIO da Academia Enem — reaproveita a tabela
// compartilhada `transbordo_humano` (sem tabela nova, decisão do Junior), sempre travado em
// modulo='academia_enem'. `transbordo_humano` tem RLS hardcoded por nome de role (Developer/
// Super Admin Cuca — ver 20260417000000_fix_transbordo_rls_role_names.sql), incompatível com o
// RBAC granular que esta story pede (ae_transbordo_config); por isso, mesmo padrão já usado em
// academia-enem/leads/route.ts (S-AE-13): checkAuth() via has_permission + admin client
// (service-role, bypassa a RLS hardcoded) para a escrita de fato.
const MODULO = "academia_enem"

async function checkAuth(recurso: string, acao: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: "Não autenticado", status: 401 as const }
    const { data: ok } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: acao })
    if (!ok) return { error: "Sem permissão", status: 403 as const }
    return { error: null }
}

// GET → lista os contatos de transbordo da Academia Enem (modulo fixo).
export async function GET() {
    try {
        const gate = await checkAuth("ae_transbordo_config", "read")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const admin = createAdminClient()
        const { data, error } = await admin
            .from("transbordo_humano")
            .select("id, responsavel, telefone, ativo")
            .eq("modulo", MODULO)
            .order("responsavel", { ascending: true })
        if (error) throw error
        return NextResponse.json({ contatos: data ?? [] })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/transbordo GET]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

// POST { responsavel, telefone } → cadastra novo contato (modulo fixo, unidade_cuca NULL —
// Academia Enem não é segmentada por unidade, confirmado no seed de meta_phone_numbers).
export async function POST(req: NextRequest) {
    try {
        const gate = await checkAuth("ae_transbordo_config", "update")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const body = await req.json() as { responsavel?: string; telefone?: string }
        const responsavel = (body.responsavel ?? "").trim()
        const telefone = (body.telefone ?? "").trim()
        if (!responsavel || !telefone) {
            return NextResponse.json({ error: "responsavel e telefone são obrigatórios" }, { status: 400 })
        }

        const admin = createAdminClient()
        const { error } = await admin.from("transbordo_humano").insert({
            modulo: MODULO,
            unidade_cuca: null,
            responsavel,
            telefone,
            ativo: true,
        })
        if (error) throw error
        return NextResponse.json({ ok: true })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/transbordo POST]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

// PATCH { id, responsavel?, telefone?, ativo? } → edita um contato existente (só do modulo AE).
export async function PATCH(req: NextRequest) {
    try {
        const gate = await checkAuth("ae_transbordo_config", "update")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const body = await req.json() as {
            id?: string; responsavel?: string; telefone?: string; ativo?: boolean
        }
        if (!body.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 })

        const update: Record<string, string | boolean> = {}
        if (body.responsavel !== undefined) update.responsavel = body.responsavel.trim()
        if (body.telefone !== undefined) update.telefone = body.telefone.trim()
        if (body.ativo !== undefined) update.ativo = body.ativo
        if (Object.keys(update).length === 0) {
            return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 })
        }

        const admin = createAdminClient()
        // .eq("modulo", MODULO) — trava a edição ao registro da Academia Enem, mesmo que
        // alguém adivinhe o id de um contato de outro módulo.
        const { error } = await admin
            .from("transbordo_humano")
            .update(update)
            .eq("id", body.id)
            .eq("modulo", MODULO)
        if (error) throw error
        return NextResponse.json({ ok: true })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/transbordo PATCH]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

// DELETE ?id=... → remove um contato (só do modulo AE).
export async function DELETE(req: NextRequest) {
    try {
        const gate = await checkAuth("ae_transbordo_config", "update")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const id = new URL(req.url).searchParams.get("id")
        if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 })

        const admin = createAdminClient()
        const { error } = await admin
            .from("transbordo_humano")
            .delete()
            .eq("id", id)
            .eq("modulo", MODULO)
        if (error) throw error
        return NextResponse.json({ ok: true })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/transbordo DELETE]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
