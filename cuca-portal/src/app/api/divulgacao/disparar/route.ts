import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
    erroConfiguracao,
    mensagemDuplicata,
    montarRegistroDisparo,
    periodoValido,
} from "@/app/api/divulgacao/disparar/logic"
import { carregarAcessoDivulgacao } from "@/lib/divulgacao/acesso-server"
import { carregarSituacaoDivulgacao } from "@/lib/divulgacao/situacao-server"
import { motivoBloqueioDisparo } from "@/lib/divulgacao/niveis"

// S-PROG-15: ver = módulo `divulgacao` ou opções de aprovar RAG/disparar; disparar = opção "Disparar
// Aviso Global". O servidor repete o bloqueio duplo da tela: mês vigente ou seguinte, nível 1
// (programações autorizadas) e nível 2 (RAG do mês no ar), além de número e template Meta.

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
        const acesso = await carregarAcessoDivulgacao()
        if (!acesso) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        if (!acesso.podeVer) return NextResponse.json({ error: "Sem permissão para acessar a Divulgação." }, { status: 403 })

        return NextResponse.json(await buscarConfiguracaoMeta())
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro interno"
        console.error("[divulgacao/disparar:get]", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

export async function POST(req: NextRequest) {
    try {
        const acesso = await carregarAcessoDivulgacao()
        if (!acesso) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        if (!acesso.podeDisparar) return NextResponse.json({ error: "Sem permissão para disparar o aviso global." }, { status: 403 })

        const body = await req.json()
        const { mes, ano, titulo } = body
        if (!periodoValido(mes, ano)) {
            return NextResponse.json({ error: "Campos obrigatórios inválidos: mes e ano" }, { status: 400 })
        }

        const situacao = await carregarSituacaoDivulgacao({ mes, ano })
        const bloqueioNiveis = motivoBloqueioDisparo({
            temPermissao: true,
            mesPermitido: situacao.mesPermitido,
            unidades: situacao.unidades,
            temNumero: true,
            temTemplate: true,
        })
        if (bloqueioNiveis) {
            return NextResponse.json({ error: bloqueioNiveis }, { status: 422 })
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
                userId: acesso.user.id,
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
