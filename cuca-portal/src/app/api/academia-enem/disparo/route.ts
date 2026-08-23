import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"

// S-AE-09 — Disparo de Avisos Próprio da Academia Enem (fila, público e envio).
// Mesma normalização já usada em todo o módulo (worker/campanhas_engine.normalizar_telefone,
// replicada localmente em cada rota — convenção já estabelecida no projeto, não um util
// compartilhado importável).
function normalizarTelefone(tel: unknown): string {
    const digits = String(tel ?? "").replace(/\D/g, "")
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
        return "55" + digits
    }
    return digits
}

const CATEGORIA_NOME = "Academia Enem"
const CANAL_TIPO = "AcademiaEnem"

async function checkAuth(recurso: string, acao: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: "Não autenticado", status: 401 as const, userId: null }
    const { data: ok } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: acao })
    if (!ok) return { error: "Sem permissão", status: 403 as const, userId: null }
    return { error: null, status: 200 as const, userId: user.id }
}

async function getPhoneNumberId(admin: SupabaseClient): Promise<string | null> {
    const { data } = await admin
        .from("meta_phone_numbers")
        .select("phone_number_id")
        .eq("canal_tipo", CANAL_TIPO)
        .eq("ativo", true)
        .limit(1)
        .maybeSingle()
    return (data?.phone_number_id as string | undefined) ?? null
}

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

type ContatoPublico = { lead_id?: string | null; nome: string; telefone: string }

// Resolve o público default (sem seleção manual): leads com a tag "Academia Enem",
// opt_in=true, bloqueado=false — mesmo recorte que _query_leads_sync (worker) já usa,
// e o mesmo default documentado no AC#3 da story.
async function resolverPublicoDefault(admin: SupabaseClient): Promise<ContatoPublico[]> {
    const catId = await getCategoriaId(admin)
    if (!catId) return []
    const { data: interesses } = await admin.from("lead_interesses").select("lead_id").eq("categoria_id", catId)
    const ids = (interesses ?? []).map(i => i.lead_id as string)
    if (ids.length === 0) return []
    const { data: leads } = await admin
        .from("leads")
        .select("id, nome, telefone")
        .in("id", ids)
        .eq("opt_in", true)
        .eq("bloqueado", false)
    return (leads ?? []).map(l => ({
        lead_id: l.id as string,
        nome: (l.nome as string) ?? "",
        telefone: normalizarTelefone(l.telefone),
    }))
}

// Público veio de sessionStorage (hook das telas S-AE-08/S-AE-11: {nome, telefone}, sem
// lead_id — telefone é a chave de identidade, por desenho). Re-resolve lead_id contra a
// base de leads real, pra habilitar o breadcrumb (S-AE-10) — quando não encontra, envia
// mesmo assim, só sem breadcrumb (não é bloqueante).
async function resolverLeadIds(admin: SupabaseClient, contatos: ContatoPublico[]): Promise<ContatoPublico[]> {
    const telefones = contatos.map(c => c.telefone).filter(Boolean)
    if (telefones.length === 0) return contatos
    const { data: leads } = await admin.from("leads").select("id, telefone").in("telefone", telefones)
    const porTelefone = new Map((leads ?? []).map(l => [l.telefone as string, l.id as string]))
    return contatos.map(c => ({ ...c, lead_id: porTelefone.get(c.telefone) ?? null }))
}

function dedupPorTelefone(contatos: ContatoPublico[]): ContatoPublico[] {
    const vistos = new Map<string, ContatoPublico>()
    for (const c of contatos) {
        if (c.telefone && !vistos.has(c.telefone)) vistos.set(c.telefone, c)
    }
    return [...vistos.values()]
}

// GET → estado da tela: número configurado, templates aprovados disponíveis, tamanho do
// público default e histórico recente de disparos (AC#1: aviso claro quando não há template).
export async function GET() {
    try {
        const gate = await checkAuth("ae_disparo", "read")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const admin = createAdminClient()
        const phoneNumberId = await getPhoneNumberId(admin)

        if (!phoneNumberId) {
            return NextResponse.json({
                phone_number_id: null,
                templates: [],
                publico_default_count: 0,
                disparos: [],
                aviso: "Nenhum número Meta ativo cadastrado para a Academia Enem (canal_tipo='AcademiaEnem' em meta_phone_numbers).",
            })
        }

        const { data: templates } = await admin
            .from("meta_templates")
            .select("id, nome, categoria, corpo_texto_aprovado, variaveis")
            .eq("status", "aprovado")
            .eq("ativo", true)
            .contains("phone_number_ids", [phoneNumberId])
            .order("nome", { ascending: true })

        const publicoDefault = await resolverPublicoDefault(admin)

        const { data: disparos } = await admin
            .from("disparos_academia_enem")
            .select("id, titulo, template_nome, status, total_destinatarios, total_enviados, total_erros, created_at, concluido_em")
            .order("created_at", { ascending: false })
            .limit(30)

        return NextResponse.json({
            phone_number_id: phoneNumberId,
            templates: templates ?? [],
            publico_default_count: publicoDefault.length,
            disparos: disparos ?? [],
            aviso: (templates ?? []).length === 0
                ? "Nenhum template aprovado cadastrado para este número ainda — cadastre em /developer/meta-templates antes de disparar."
                : null,
        })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/disparo GET]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

type PublicoInput = { origem?: string; contatos?: { nome?: string; telefone?: string }[] }
type PostBody = { titulo?: string; template_nome?: string; publico?: PublicoInput }

// POST { titulo, template_nome, publico?: {origem, contatos:[{nome,telefone}]} }
// Sem `publico` (ou vazio) → AC#3: default = tag "Academia Enem" (opt_in, não bloqueado).
export async function POST(req: NextRequest) {
    try {
        const gate = await checkAuth("ae_disparo", "create")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const body = await req.json() as PostBody
        const titulo = (body.titulo ?? "").trim()
        const templateNome = (body.template_nome ?? "").trim()
        if (!titulo) return NextResponse.json({ error: "titulo obrigatório" }, { status: 400 })
        if (!templateNome) return NextResponse.json({ error: "template_nome obrigatório" }, { status: 400 })

        const admin = createAdminClient()
        const phoneNumberId = await getPhoneNumberId(admin)
        if (!phoneNumberId) {
            return NextResponse.json({ error: "Nenhum número Meta ativo cadastrado para a Academia Enem" }, { status: 400 })
        }

        // AC#1: template precisa estar aprovado/ativo pra ESTE número — revalidado no envio
        // pelo worker também (defesa em profundidade), não só aqui na criação.
        const { data: template } = await admin
            .from("meta_templates")
            .select("nome")
            .eq("nome", templateNome)
            .eq("status", "aprovado")
            .eq("ativo", true)
            .contains("phone_number_ids", [phoneNumberId])
            .limit(1)
            .maybeSingle()
        if (!template) {
            return NextResponse.json({ error: "Template não encontrado, não aprovado, ou não vinculado a este número" }, { status: 400 })
        }

        // AC#3/AC#4: público — seleção manual (sessionStorage, mais de uma fonte possível já
        // mesclada pelo front) ou default (tag Academia Enem), sempre deduplicado por telefone.
        let contatos: ContatoPublico[]
        const publicoInput = body.publico
        if (publicoInput?.contatos && publicoInput.contatos.length > 0) {
            const brutos = publicoInput.contatos
                .map(c => ({ nome: (c.nome ?? "").trim(), telefone: normalizarTelefone(c.telefone) }))
                .filter(c => c.telefone)
            contatos = await resolverLeadIds(admin, brutos)
        } else {
            contatos = await resolverPublicoDefault(admin)
        }
        contatos = dedupPorTelefone(contatos)

        if (contatos.length === 0) {
            return NextResponse.json({ error: "Público vazio — nenhum contato elegível encontrado" }, { status: 400 })
        }

        const { data: inserted, error } = await admin
            .from("disparos_academia_enem")
            .insert({
                titulo,
                template_nome: templateNome,
                instancia_uazapi: phoneNumberId,
                publico_origem: publicoInput?.origem || "tag_academia_enem",
                contatos,
                total_destinatarios: contatos.length,
                status: "pendente",
                criado_por: gate.userId,
            })
            .select("id, titulo, template_nome, total_destinatarios, status, created_at")
            .single()
        if (error) throw error

        return NextResponse.json({ ok: true, disparo: inserted })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/disparo POST]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
