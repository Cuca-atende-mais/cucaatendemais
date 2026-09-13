import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { linhaIncompleta, LinhaParaAprovacao } from "@/lib/programacao/aprovacao"
import { podeTransicionar } from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"

// S-PROG-04: centraliza as 4 transições do ciclo de aprovação (item 2 da story) — antes
// "aprovado" era gerenciado por um update direto no cliente (bypassando esta rota), e
// "pendente → rascunho" ("Reabrir") não pedia motivo nem gravava histórico. Consolidado aqui
// porque a story pede explicitamente controle explícito no código (item 4), e as 4 transições
// compartilham a mesma checagem de permissão e o mesmo histórico — duplicar essa lógica em dois
// lugares (rota + update direto) é como o motivo obrigatório teria sido esquecido de novo.
// S-PROG-13: a permissão é a ação do fluxo (enviar/autorizar/devolver/reabrir) em todas as categorias
// que a campanha tem, e a gravação usa a chave de serviço — a política de UPDATE de
// `campanhas_mensais` fica só para as contas Developer, então ninguém muda status direto pela API.
// Como a chave de serviço ignora a política de leitura por unidade, a unidade também é conferida
// aqui: campanha de outra unidade responde 404, como antes (a leitura pela sessão não a achava).
const TRANSICOES: Record<string, string[]> = {
    rascunho: ["pendente"],
    pendente: ["aprovado", "rascunho"],
    aprovado: ["rascunho"],
}

export async function PATCH(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authErr } = await supabase.auth.getUser()

        if (authErr || !user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        const body = await req.json()
        const { campanha_id, novoStatus, motivo } = body as { campanha_id: string; novoStatus: string; motivo?: string }

        if (!campanha_id || !novoStatus) {
            return NextResponse.json({ error: "campanha_id e novoStatus são obrigatórios" }, { status: 400 })
        }

        const admin = createAdminClient()
        const acesso = await carregarAcessoPgm(user)
        const { data: campanha, error: campErr } = await admin
            .from("campanhas_mensais")
            .select("id, status, unidade_cuca")
            .eq("id", campanha_id)
            .single()

        if (campErr || !campanha || !acesso.alcancaUnidade(campanha.unidade_cuca as string | null)) {
            return NextResponse.json({ error: "Programação não encontrada" }, { status: 404 })
        }

        const statusAtual = campanha.status as string
        const permitidas = TRANSICOES[statusAtual] || []
        if (!permitidas.includes(novoStatus)) {
            return NextResponse.json({ error: `Transição inválida: ${statusAtual} → ${novoStatus}` }, { status: 400 })
        }

        const { data: categoriasLinhas, error: catErr } = await admin
            .from("atividades_mensais")
            .select("categoria")
            .eq("campanha_id", campanha_id)
        if (catErr) throw new Error(catErr.message)

        const categorias = (categoriasLinhas || []).map(l => l.categoria as string | null)
        if (!podeTransicionar(acesso.checar, statusAtual, novoStatus, categorias)) {
            return NextResponse.json({ error: "Sem permissão para alterar o status desta programação" }, { status: 403 })
        }

        // Item 2: "Devolver para ajuste" (pendente → rascunho) exige motivo obrigatório.
        if (statusAtual === "pendente" && novoStatus === "rascunho" && !motivo?.trim()) {
            return NextResponse.json({ error: "Motivo é obrigatório para devolver a programação" }, { status: 400 })
        }

        // Item 2: "Enviar para aprovação" (rascunho → pendente) bloqueada se houver ponto a
        // revisar. `linhaIncompleta` opera direto na linha gravada no banco, checando os campos
        // obrigatórios de cada categoria (não é o painel de revisão da S-PROG-01
        // `calcularProblemas`, construído sobre o formato de edição da grade — campanhas de
        // outra origem, como import de planilha, têm outro formato de metadata e passariam sem
        // nunca bater). Achado do @qa: a versão anterior usava `linhaTemProblema` (S-PROG-02),
        // que mede contaminação (texto de exemplo, faixa sem dígito) pro selo de qualidade da
        // duplicação — não completude; uma linha só com título passava como "sem problema".
        if (statusAtual === "rascunho" && novoStatus === "pendente") {
            const { data: linhas } = await admin
                .from("atividades_mensais")
                .select("categoria, titulo, descricao, local, hora_inicio, hora_fim, data_atividade, metadata")
                .eq("campanha_id", campanha_id)

            const problemas = (linhas as LinhaParaAprovacao[] || []).filter(linhaIncompleta)
            if (problemas.length > 0) {
                return NextResponse.json({
                    error: `${problemas.length} ponto(s) a revisar antes de enviar para aprovação`,
                    totalProblemas: problemas.length,
                }, { status: 409 })
            }
        }

        const { error: updateErr } = await admin
            .from("campanhas_mensais")
            .update({ status: novoStatus })
            .eq("id", campanha_id)

        if (updateErr) throw new Error(updateErr.message)

        // Item 3: histórico — quem, quando, de/para e o motivo (quando houver). Busca o
        // `colaboradores.id` do usuário atual porque `campanha_historico.usuario_id` referencia
        // `colaboradores`, não `auth.users` diretamente (mesmo padrão de `campanhas_mensais.created_by`).
        const { data: colaborador } = await supabase
            .from("colaboradores")
            .select("id")
            .eq("user_id", user.id)
            .maybeSingle()

        const { error: histErr } = await admin.from("campanha_historico").insert({
            campanha_id,
            de_status: statusAtual,
            para_status: novoStatus,
            motivo: motivo?.trim() || null,
            usuario_id: colaborador?.id || null,
        })
        // Achado do @qa: não checar esse erro deixava a transição "bem-sucedida" pro usuário
        // mesmo se o histórico não tivesse sido gravado, sem nenhum sinal pra depurar depois.
        // Não falha a transição por isso (já efetivada acima) — só loga, pra não perder o rastro.
        if (histErr) console.error("[programacao/status] falha ao gravar histórico:", histErr)

        return NextResponse.json({ ok: true })

    } catch (e) {
        console.error("[programacao/status]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
