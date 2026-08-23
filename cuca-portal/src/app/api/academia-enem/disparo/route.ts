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
// Achado QA (2026-08-23): canal_tipo/agente_tipo da Academia Enem seguem o padrão minúsculo/
// snake_case já usado por "maria"/"sofia"/"ana"/"Empregabilidade" — ver
// developer/meta-numeros/page.tsx (AGENTES_META/CANAL_TIPOS_META) e o dispatch real em
// worker/meta_adapter_inbound.py (`elif agente_tipo == "academia_enem":`). O valor
// "AcademiaEnem" (PascalCase) usado aqui antes era um mismatch real — o número foi cadastrado
// errado em meta_phone_numbers (corrigido via UPDATE direto) e essa constante também estava
// errada, o que faria esta rota nunca encontrar o número cadastrado.
const CANAL_TIPO = "academia_enem"

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

const CHUNK = 200 // mesmo tamanho de lote já usado em academia-enem/leads/upload/route.ts

// Achado QA A-2 (2026-08-23, CONFIRMADO — mesma classe de bug já documentada e corrigida em
// worker/campanhas_engine.py::_query_leads_sync, 2026-07-24): buscar leads por categoria via
// `.in("id", ids)` com centenas/milhares de UUIDs estoura o limite de URL do GET do PostgREST
// — a S-AE-13 existe justamente pra importar um CSV de ~7.950 linhas com a tag "Academia
// Enem", volume que reproduziria a falha já vista no projeto. Corrigido usando a MESMA RPC já
// validada (`buscar_leads_por_categoria`) em vez de buscar os ids em duas etapas.
async function resolverPublicoDefault(admin: SupabaseClient): Promise<ContatoPublico[]> {
    const catId = await getCategoriaId(admin)
    if (!catId) return []
    const { data: leads, error } = await admin.rpc("buscar_leads_por_categoria", { p_categorias: [catId] })
    if (error) throw error
    return ((leads ?? []) as { id: string; nome: string | null; telefone: string }[]).map(l => ({
        lead_id: l.id,
        nome: l.nome ?? "",
        telefone: normalizarTelefone(l.telefone),
    }))
}

// Público veio de sessionStorage (hook das telas S-AE-08/S-AE-11: {nome, telefone}, sem
// lead_id — telefone é a chave de identidade, por desenho). Re-resolve lead_id contra a
// base de leads real, pra habilitar o breadcrumb (S-AE-10) — quando não encontra, envia
// mesmo assim, só sem breadcrumb (não é bloqueante).
// Achado QA A-2 (mesma classe, alcance secundário): paginado em lotes de 200 — uma seleção
// manual grande (ex.: segmento "faltou≥N" ou upload direto de leads-publico) também podia
// estourar o `.in()` de uma vez só.
async function resolverLeadIds(admin: SupabaseClient, contatos: ContatoPublico[]): Promise<ContatoPublico[]> {
    const telefones = contatos.map(c => c.telefone).filter(Boolean)
    if (telefones.length === 0) return contatos

    const porTelefone = new Map<string, string>()
    for (let i = 0; i < telefones.length; i += CHUNK) {
        const lote = telefones.slice(i, i + CHUNK)
        const { data: leads, error } = await admin.from("leads").select("id, telefone").in("telefone", lote)
        if (error) throw error
        for (const l of leads ?? []) porTelefone.set(l.telefone as string, l.id as string)
    }
    return contatos.map(c => ({ ...c, lead_id: porTelefone.get(c.telefone) ?? null }))
}

function dedupPorTelefone(contatos: ContatoPublico[]): ContatoPublico[] {
    const vistos = new Map<string, ContatoPublico>()
    for (const c of contatos) {
        if (c.telefone && !vistos.has(c.telefone)) vistos.set(c.telefone, c)
    }
    return [...vistos.values()]
}

type TemplateRow = { id: string; nome: string; categoria: string | null; corpo_texto_aprovado: string | null; variaveis: { posicao?: number; descricao?: string }[] | null }

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
                aviso: `Nenhum número Meta ativo cadastrado para a Academia Enem (canal_tipo='${CANAL_TIPO}' em meta_phone_numbers).`,
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

        // A-4: sinaliza pro front quais templates têm mais de 1 variável — o envio hoje só
        // preenche "nome", então esses ficam desabilitados na seleção (ver Select da tela).
        const templatesAnotados = ((templates ?? []) as TemplateRow[]).map(t => ({
            ...t,
            suportado: (t.variaveis?.length ?? 0) <= 1,
        }))
        const algumSuportado = templatesAnotados.some(t => t.suportado)

        return NextResponse.json({
            phone_number_id: phoneNumberId,
            templates: templatesAnotados,
            publico_default_count: publicoDefault.length,
            disparos: disparos ?? [],
            aviso: templatesAnotados.length === 0
                ? "Nenhum template aprovado cadastrado para este número ainda — cadastre em /developer/meta-templates antes de disparar."
                : !algumSuportado
                    ? "Os templates aprovados para este número exigem mais de 1 variável — o disparo da Academia Enem hoje só preenche o nome. Ajuste o template ou aguarde a próxima versão."
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
            .select("nome, variaveis")
            .eq("nome", templateNome)
            .eq("status", "aprovado")
            .eq("ativo", true)
            .contains("phone_number_ids", [phoneNumberId])
            .limit(1)
            .maybeSingle()
        if (!template) {
            return NextResponse.json({ error: "Template não encontrado, não aprovado, ou não vinculado a este número" }, { status: 400 })
        }
        // A-4: mesma validação simétrica ao guard do worker (defesa em profundidade) — falha
        // aqui é imediata e explicável, em vez de silenciosa no meio do envio.
        const variaveis = (template.variaveis as { posicao?: number }[] | null) ?? []
        if (variaveis.length > 1) {
            return NextResponse.json({
                error: `Este template exige ${variaveis.length} variáveis — o disparo da Academia Enem hoje só preenche o nome (1 variável). Ajuste o template antes de disparar.`,
            }, { status: 400 })
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
