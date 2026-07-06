import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
    AcaoDivulgacao,
    avaliarAcesso,
    erroConfiguracao,
    mensagemDuplicata,
    montarRegistroDisparo,
    periodoValido,
    PermissaoDivulgacao,
    ResultadoAutorizacao,
} from "@/app/api/divulgacao/disparar/logic"

const DEVELOPER_EMAILS = [
    "valmir@cucateste.com",
    "dev.cucaatendemais@gmail.com",
    "admin@cucadev.com.br",
]

async function autorizar(
    supabase: Awaited<ReturnType<typeof createClient>>,
    acao: AcaoDivulgacao,
): Promise<ResultadoAutorizacao> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return avaliarAcesso(null, [], acao, DEVELOPER_EMAILS)
    if (DEVELOPER_EMAILS.includes(user.email ?? "")) return avaliarAcesso(user, [], acao, DEVELOPER_EMAILS)

    const { data: colab } = await supabase
        .from("colaboradores")
        .select("sys_roles(sys_permissions(module, can_read, can_create))")
        .eq("user_id", user.id)
        .single()

    const role = colab?.sys_roles as { sys_permissions?: PermissaoDivulgacao[] } | null
    return avaliarAcesso(user, role?.sys_permissions ?? [], acao, DEVELOPER_EMAILS)
}

async function buscarConfiguracaoMeta() {
    const admin = createAdminClient()
    const { data: numero, error: erroNumero } = await admin
        .from("meta_phone_numbers")
        .select("display_name, phone_number_id")
        .eq("canal_tipo", "Institucional")
        .eq("ativo", true)
        .limit(1)
        .maybeSingle()

    if (erroNumero) throw erroNumero
    if (!numero) return { numero: null, template: null }

    // Espelha o lookup do worker: automação exata + phone_number_id contido no array.
    // Igualdade exata em coluna array precisa da sintaxe de array literal do Postgres
    // (ex.: '{"Institucional"}'), não de um array JS — o client serializa array via
    // toString() ("Institucional", sem chaves), que o Postgrest rejeita com 400
    // (malformed array literal). .contains() não serve: combinaria também com
    // templates multi-tag, quebrando o match exato que este lookup exige.
    const { data: template, error: erroTemplate } = await admin
        .from("meta_templates")
        .select("nome, corpo_texto")
        .eq("automacoes", '{"Institucional"}')
        .contains("phone_number_ids", [numero.phone_number_id])
        .eq("ativo", true)
        .eq("status", "aprovado")
        .limit(1)
        .maybeSingle()

    if (erroTemplate) throw erroTemplate
    return {
        numero,
        template: template?.corpo_texto ? template : null,
    }
}

export async function GET() {
    try {
        const supabase = await createClient()
        const acesso = await autorizar(supabase, "can_read")
        if (!acesso.autorizado) {
            return NextResponse.json({ error: acesso.error }, { status: acesso.status })
        }

        return NextResponse.json(await buscarConfiguracaoMeta())
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro interno"
        console.error("[divulgacao/disparar:get]", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient()
        const acesso = await autorizar(supabase, "can_create")
        if (!acesso.autorizado) {
            return NextResponse.json({ error: acesso.error }, { status: acesso.status })
        }

        const body = await req.json()
        const { mes, ano, titulo } = body
        if (!periodoValido(mes, ano)) {
            return NextResponse.json({ error: "Campos obrigatórios inválidos: mes e ano" }, { status: 400 })
        }

        const admin = createAdminClient()
        const { data: jaExiste, error: erroDuplicata } = await admin
            .from("disparos_divulgacao")
            .select("id, status")
            .eq("mes", mes)
            .eq("ano", ano)
            .in("status", ["pendente", "em_andamento"])
            .limit(1)
            .maybeSingle()

        if (erroDuplicata) throw erroDuplicata
        const erroJaExiste = mensagemDuplicata(jaExiste, mes, ano)
        if (erroJaExiste) {
            return NextResponse.json({ error: erroJaExiste }, { status: 409 })
        }

        const { numero, template } = await buscarConfiguracaoMeta()
        const erroConfig = erroConfiguracao(numero, template)
        if (erroConfig) {
            return NextResponse.json({ error: erroConfig }, { status: 422 })
        }

        // O helper acima garante o narrowing lógico; estas guardas mantêm o contrato TS explícito.
        if (!numero || !template) throw new Error("Configuração Meta inválida")

        const { count: totalLeads, error: erroContagem } = await admin
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("opt_in", true)

        if (erroContagem) throw erroContagem

        // instancia_uazapi é legado: guarda apenas o snapshot auditável do
        // phone_number_id resolvido no enqueue. O worker resolve o remetente novamente.
        const { data: disparo, error: erroInsert } = await admin
            .from("disparos_divulgacao")
            .insert(montarRegistroDisparo({
                mes,
                ano,
                titulo,
                corpoTemplate: template.corpo_texto,
                phoneNumberId: numero.phone_number_id,
                totalLeads: totalLeads ?? 0,
                userId: acesso.userId,
            }))
            .select("id")
            .single()

        if (erroInsert) throw erroInsert

        return NextResponse.json({
            success: true,
            id: disparo.id,
            total_leads: totalLeads ?? 0,
            phone_number_id: numero.phone_number_id,
            template: template.nome,
            message: `Disparo criado com sucesso. O motor enviará para ${totalLeads ?? 0} leads.`,
        })
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro interno"
        console.error("[divulgacao/disparar]", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
