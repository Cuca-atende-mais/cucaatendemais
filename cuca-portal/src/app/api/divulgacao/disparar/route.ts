import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

        // Verificar se é um dos 2 developers autorizados — email é a fonte da verdade
        const DEVELOPER_EMAILS = ['valmir@cucateste.com', 'dev.cucaatendemais@gmail.com']
        if (!DEVELOPER_EMAILS.includes(user.email ?? '')) {
            return NextResponse.json({ error: "Acesso restrito a desenvolvedores autorizados." }, { status: 403 })
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

        // Contar leads opt-in ativos (sem filtro de unidade, com filtro de 60 dias)
        const sessenta_dias_atras = new Date()
        sessenta_dias_atras.setDate(sessenta_dias_atras.getDate() - 60)

        const { count: totalLeads } = await supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("opt_in", true)
            .gte("last_interaction_at", sessenta_dias_atras.toISOString())

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
