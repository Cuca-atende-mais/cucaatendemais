import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

        // Verificar acesso: dev por email OU permissão RBAC can_create em divulgacao
        const DEVELOPER_EMAILS = ['valmir@cucateste.com', 'dev.cucaatendemais@gmail.com']
        const isDevEmail = DEVELOPER_EMAILS.includes(user.email ?? '')

        if (!isDevEmail) {
            const { data: colab } = await supabase
                .from("colaboradores")
                .select("sys_roles(name, sys_permissions(module, can_create))")
                .eq("user_id", user.id)
                .single()

            const role = (colab?.sys_roles as any)
            const perms: any[] = role?.sys_permissions ?? []
            const podeCriar = perms.some((p: any) => p.module === 'divulgacao' && p.can_create)

            // Sem can_create marcado na matriz → sem acesso ao disparo
            if (!podeCriar) {
                return NextResponse.json({ error: "Sem permissão para disparar. Solicite can_create em divulgacao." }, { status: 403 })
            }
        }

        const body = await req.json()
        const { mes, ano, titulo, mensagem_template } = body

        if (!mes || !ano || !mensagem_template) {
            return NextResponse.json({ error: "Campos obrigatórios: mes, ano, mensagem_template" }, { status: 400 })
        }

        // Verificar se já existe disparo pendente/em_andamento para este mês
        const { data: jaExiste } = await supabase
            .from("disparos_divulgacao")
            .select("id, status")
            .eq("mes", mes)
            .eq("ano", ano)
            .in("status", ["pendente", "em_andamento"])
            .maybeSingle()

        if (jaExiste) {
            return NextResponse.json({
                error: `Já existe um disparo ${jaExiste.status} para ${mes}/${ano}. Aguarde a conclusão antes de criar outro.`
            }, { status: 409 })
        }

        // Buscar instância Divulgação ativa
        const { data: instancia } = await supabase
            .from("instancias_uazapi")
            .select("nome")
            .eq("canal_tipo", "Divulgação")
            .eq("ativa", true)
            .limit(1)
            .maybeSingle()

        if (!instancia) {
            return NextResponse.json({
                error: "Nenhuma instância do tipo Divulgação está conectada. Configure o chip antes de disparar."
            }, { status: 422 })
        }

        const { count: totalLeads } = await supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("opt_in", true)

        // Criar o registro de disparo
        const { data: disparo, error: errInsert } = await supabase
            .from("disparos_divulgacao")
            .insert({
                mes,
                ano,
                titulo: titulo || `Aviso Programação ${mes}/${ano}`,
                mensagem_template,
                instancia_uazapi: instancia.nome,
                status: "pendente",
                total_leads: totalLeads ?? 0,
                criado_por: user.id,
            })
            .select("id")
            .single()

        if (errInsert) throw errInsert

        return NextResponse.json({
            success: true,
            id: disparo.id,
            total_leads: totalLeads ?? 0,
            instancia: instancia.nome,
            message: `Disparo criado com sucesso. O motor enviará para ${totalLeads ?? 0} leads.`
        })

    } catch (e: any) {
        console.error("[divulgacao/disparar]", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
