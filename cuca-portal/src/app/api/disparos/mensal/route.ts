import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { campanhaId } = body

        if (!campanhaId) {
            return NextResponse.json({ error: "campanhaId is required" }, { status: 400 })
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
        const supabase = createClient(supabaseUrl, supabaseKey)

        // 1. Obter detalhes da Campanha Mensal
        const { data: campanha, error: campErr } = await supabase
            .from("campanhas_mensais")
            .select("*")
            .eq("id", campanhaId)
            .single()

        if (campErr || !campanha) {
            return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 })
        }

        // 2. Resgatar portal_url_producao
        const { data: configs, error: cfgErr } = await supabase
            .from("system_config")
            .select("valor")
            .eq("chave", "portal_url_producao")
            .single()

        const portalUrl = configs?.valor || "https://cucaatendemais.com.br"

        // 3. Resgatar uma instância WhatsApp disponível (preferência pela da mesma unidade)
        const { data: instancia } = await supabase
            .from("instancias_uazapi")
            .select("nome")
            .eq("ativa", true)
            .order("unidade_cuca", { ascending: false }) // Tenta priorizar algo se houver sorting, mas ok pegar a primeira
            .limit(1)
            .single()

        const instanciaNome = instancia?.nome || "Padrao_Sistema"

        // 4. Contar leads para total_destinatarios (da unidade e opt_in = true)
        const { count, error: leadErr } = await supabase
            .from("leads")
            .select("*", { count: 'exact', head: true })
            .eq("unidade_cuca", campanha.unidade_cuca)
            .eq("opt_in", true)
            .eq("bloqueado", false)

        const totalDest = count || 0

        // 5. Montar a Mensagem
        const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
        const nomeMes = meses[campanha.mes - 1] || `${campanha.mes}`

        const template = `Olá {nome}! A programação do mês de ${nomeMes} do ${campanha.unidade_cuca} já está no ar. Temos ${campanha.total_atividades} atividades preparadas.\n\nCaso você queira saber mais informações diga qual sua categoria de interesse:\n1 - CURSOS\n2 - DIA A DIA\n3 - ESPORTES\n4 - EVENTOS DESTAQUES\n\nOu siga ${portalUrl}/programacao`

        // 6. Criar o registro de Disparo
        const { data: novoDisparo, error: dispErr } = await supabase
            .from("disparos")
            .insert({
                tipo: "campanha_mensal",
                campanha_mensal_id: campanha.id,
                instancia_uazapi: instanciaNome,
                mensagem_template: template,
                total_destinatarios: totalDest,
                total_enviados: 0,
                total_erros: 0,
                status: "pendente"
            })
            .select("id")
            .single()

        if (dispErr) {
            console.error("Erro disparos insert:", dispErr)
            return NextResponse.json({ error: "Erro ao criar envio na fila" }, { status: 500 })
        }

        // 7. Salvar disparo_id na campanha (para o front ver que já tem disparo linkado)
        await supabase
            .from("campanhas_mensais")
            .update({ disparo_id: novoDisparo.id })
            .eq("id", campanha.id)

        return NextResponse.json({ success: true, disparoId: novoDisparo.id, message: template })
    } catch (e: any) {
        console.error("Disparo API route error:", e)
        return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 })
    }
}
