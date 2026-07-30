import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WORKER_TIMEOUT_MS = 12000

type AuthOk = {
    error: null
    email: string
}

type AuthFail = {
    error: string
    status: 401 | 403
}

function normalizarTelefone(raw: unknown) {
    return String(raw ?? "").replace(/\D/g, "")
}

async function checkAuth(): Promise<AuthOk | AuthFail> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: "Não autenticado", status: 401 }

    const { data: ok } = await supabase.rpc("has_permission", {
        p_recurso: "empreg_vagas",
        p_acao: "update",
    })
    if (!ok) return { error: "Sem permissão", status: 403 }

    return { error: null, email: user.email || user.id }
}

async function notificarLeadAutorizado(conversaId: string, telefone: string) {
    const workerUrl = (process.env.WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL || "").replace(/\/$/, "")
    const token = process.env.WEBHOOK_INTERNAL_TOKEN || ""

    if (!workerUrl || !token) {
        console.warn("[autorizar-whatsapp] Worker não configurado; autorização concluída sem aviso automático.")
        return { sent: false, skippedReason: "worker_not_configured" }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS)
    const text = [
        "Seu acesso foi liberado pela equipe do CUCA Atende Mais.",
        "",
        "Pode reenviar o CNPJ da empresa para continuar o atendimento.",
    ].join("\n")

    try {
        const resp = await fetch(`${workerUrl}/send-message/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ number: telefone, text, conversa_id: conversaId }),
            signal: controller.signal,
        })

        if (!resp.ok) {
            const body = await resp.text()
            console.warn("[autorizar-whatsapp] Falha ao avisar lead:", resp.status, body)
            return { sent: false, skippedReason: "worker_error" }
        }

        return { sent: true, skippedReason: null }
    } catch (error) {
        const reason = error instanceof Error && error.name === "AbortError" ? "worker_timeout" : "worker_error"
        console.warn("[autorizar-whatsapp] Erro ao avisar lead:", error)
        return { sent: false, skippedReason: reason }
    } finally {
        clearTimeout(timeout)
    }
}

async function garantirWhatsappAutorizado(
    admin: ReturnType<typeof createAdminClient>,
    empresaId: string,
    telefone: string,
    autorizadoPor: string,
) {
    const { data: existente, error: existenteErr } = await admin
        .from("empresa_whatsapp_autorizados")
        .select("id, empresa_id, telefone, autorizado_em, autorizado_por")
        .eq("empresa_id", empresaId)
        .eq("telefone", telefone)
        .maybeSingle()
    if (existenteErr) throw existenteErr
    if (existente) return { autorizado: existente, created: false }

    const { data: criado, error: insertErr } = await admin
        .from("empresa_whatsapp_autorizados")
        .insert({
            empresa_id: empresaId,
            telefone,
            autorizado_por: autorizadoPor,
        })
        .select("id, empresa_id, telefone, autorizado_em, autorizado_por")
        .single()

    if (insertErr) {
        if (insertErr.code !== "23505") throw insertErr

        const { data: recuperado, error: recuperadoErr } = await admin
            .from("empresa_whatsapp_autorizados")
            .select("id, empresa_id, telefone, autorizado_em, autorizado_por")
            .eq("empresa_id", empresaId)
            .eq("telefone", telefone)
            .maybeSingle()
        if (recuperadoErr) throw recuperadoErr
        if (recuperado) return { autorizado: recuperado, created: false }
    }

    return { autorizado: criado, created: true }
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const gate = await checkAuth()
        if (gate.error !== null) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const { id } = await params
        const admin = createAdminClient()

        const { data, error } = await admin
            .from("empresa_whatsapp_autorizados")
            .select("id, empresa_id, telefone, autorizado_em, autorizado_por")
            .eq("empresa_id", id)
            .order("autorizado_em", { ascending: false })

        if (error) throw error

        return NextResponse.json({ autorizados: data ?? [] })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Erro interno"
        console.error("[autorizar-whatsapp GET]", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const gate = await checkAuth()
        if (gate.error !== null) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const { id } = await params
        const { telefone: telefoneRaw } = await request.json() as { telefone?: string }
        const telefone = normalizarTelefone(telefoneRaw)

        if (telefone.length < 10 || telefone.length > 15) {
            return NextResponse.json({ error: "Telefone inválido" }, { status: 400 })
        }

        const admin = createAdminClient()

        const { data: empresa, error: empresaErr } = await admin
            .from("empresas")
            .select("id")
            .eq("id", id)
            .maybeSingle()
        if (empresaErr) throw empresaErr
        if (!empresa) return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 })

        const { autorizado, created } = await garantirWhatsappAutorizado(admin, id, telefone, gate.email)

        const variantesTelefone = Array.from(new Set([
            telefone,
            telefone.startsWith("55") ? telefone.slice(2) : `55${telefone}`,
        ]))

        const { data: leads, error: leadsErr } = await admin
            .from("leads")
            .select("id")
            .in("telefone", variantesTelefone)
        if (leadsErr) throw leadsErr

        let conversaReativada = null as string | null
        let avisoLead = { sent: false, skippedReason: "no_awaiting_human_conversation" as string | null }

        const leadIds = (leads ?? []).map((lead) => lead.id)
        if (leadIds.length > 0) {
            const { data: conversa, error: conversaErr } = await admin
                .from("conversas")
                .select("id")
                .in("lead_id", leadIds)
                .eq("status", "awaiting_human")
                .order("updated_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            if (conversaErr) throw conversaErr

            if (conversa) {
                avisoLead = await notificarLeadAutorizado(conversa.id as string, telefone)
                if (!avisoLead.sent) {
                    return NextResponse.json({
                        ok: false,
                        autorizado,
                        autorizacao_criada: created,
                        conversa_reativada: null,
                        aviso_lead: avisoLead,
                        error: "WhatsApp autorizado, mas não foi possível avisar o lead. Tente novamente.",
                    }, { status: 502 })
                }

                const { error: updateErr } = await admin
                    .from("conversas")
                    .update({ status: "ativa", updated_at: new Date().toISOString() })
                    .eq("id", conversa.id)
                if (updateErr) throw updateErr

                conversaReativada = conversa.id as string
            }
        }

        return NextResponse.json({
            ok: true,
            autorizado,
            autorizacao_criada: created,
            conversa_reativada: conversaReativada,
            aviso_lead: avisoLead,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Erro interno"
        console.error("[autorizar-whatsapp POST]", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
