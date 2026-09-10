import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { linhaTemProblema, LinhaOrigemDuplicacao } from "@/lib/programacao/duplicar"

// S-PROG-04: centraliza as 4 transições do ciclo de aprovação (item 2 da story) — antes
// "aprovado" era gerenciado por um update direto no cliente (bypassando esta rota), e
// "pendente → rascunho" ("Reabrir") não pedia motivo nem gravava histórico. Consolidado aqui
// porque a story pede explicitamente controle explícito no código (item 4), e as 4 transições
// compartilham a mesma checagem de permissão e o mesmo histórico — duplicar essa lógica em dois
// lugares (rota + update direto) é como o motivo obrigatório teria sido esquecido de novo.
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

        const { data: permOk } = await supabase
            .rpc("has_permission", { p_recurso: "programacao", p_acao: "update" })

        if (!permOk) {
            return NextResponse.json({ error: "Sem permissão para alterar status da programação" }, { status: 403 })
        }

        const body = await req.json()
        const { campanha_id, novoStatus, motivo } = body as { campanha_id: string; novoStatus: string; motivo?: string }

        if (!campanha_id || !novoStatus) {
            return NextResponse.json({ error: "campanha_id e novoStatus são obrigatórios" }, { status: 400 })
        }

        const { data: campanha, error: campErr } = await supabase
            .from("campanhas_mensais")
            .select("id, status")
            .eq("id", campanha_id)
            .single()

        if (campErr || !campanha) {
            return NextResponse.json({ error: "Programação não encontrada" }, { status: 404 })
        }

        const statusAtual = campanha.status as string
        const permitidas = TRANSICOES[statusAtual] || []
        if (!permitidas.includes(novoStatus)) {
            return NextResponse.json({ error: `Transição inválida: ${statusAtual} → ${novoStatus}` }, { status: 400 })
        }

        // Item 2: "Devolver para ajuste" (pendente → rascunho) exige motivo obrigatório.
        if (statusAtual === "pendente" && novoStatus === "rascunho" && !motivo?.trim()) {
            return NextResponse.json({ error: "Motivo é obrigatório para devolver a programação" }, { status: 400 })
        }

        // Item 2: "Enviar para aprovação" (rascunho → pendente) bloqueada se houver ponto a
        // revisar. `linhaTemProblema` (S-PROG-02) opera direto na linha gravada no banco — é o
        // equivalente possível aqui, porque o painel de revisão da S-PROG-01 (`calcularProblemas`)
        // é construído sobre o formato de edição da grade (`AtividadeForm`), não sobre o que está
        // gravado; campanhas antigas (import de planilha) têm outro formato de `metadata` (ver
        // S-PROG-02, Dev Agent Record) e passariam pelo checador da S-PROG-01 sem nunca bater.
        if (statusAtual === "rascunho" && novoStatus === "pendente") {
            const { data: linhas } = await supabase
                .from("atividades_mensais")
                .select("categoria, titulo, descricao, local, metadata")
                .eq("campanha_id", campanha_id)

            const problemas = (linhas as LinhaOrigemDuplicacao[] || []).filter(linhaTemProblema)
            if (problemas.length > 0) {
                return NextResponse.json({
                    error: `${problemas.length} ponto(s) a revisar antes de enviar para aprovação`,
                    totalProblemas: problemas.length,
                }, { status: 409 })
            }
        }

        const { error: updateErr } = await supabase
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

        await supabase.from("campanha_historico").insert({
            campanha_id,
            de_status: statusAtual,
            para_status: novoStatus,
            motivo: motivo?.trim() || null,
            usuario_id: colaborador?.id || null,
        })

        return NextResponse.json({ ok: true })

    } catch (e) {
        console.error("[programacao/status]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
