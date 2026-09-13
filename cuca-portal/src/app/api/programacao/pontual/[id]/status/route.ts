import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"
import {
    acaoDaTransicaoPontual, podeTransicionarPontual, transicaoPontualExigeMotivo,
} from "@/lib/programacao/pontual"

// S-PROG-17: autorizar, devolver (com motivo), disparar e cancelar evento pontual pelo servidor. Cada
// transição exige a opção própria e o evento ao alcance da unidade de quem pede. Disparar grava
// `aprovado`, que o worker pega (`claim_evento_pontual`). O RAG acompanha pelo gatilho
// `trigger_indexar_evento`: entra a partir de `autorizado`, sai em `aguardando_aprovacao`/`cancelado`.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

        const body = await req.json()
        const { novoStatus, motivo } = (body ?? {}) as { novoStatus?: string; motivo?: string }
        if (!novoStatus) return NextResponse.json({ error: "novoStatus é obrigatório" }, { status: 400 })

        const admin = createAdminClient()
        const acesso = await carregarAcessoPgm(user)
        const { data: evento, error: evErr } = await admin
            .from("eventos_pontuais")
            .select("id, unidade_cuca, status")
            .eq("id", id)
            .maybeSingle()
        if (evErr) throw new Error(evErr.message)
        if (!evento || !acesso.alcancaUnidade(evento.unidade_cuca as string | null)) {
            return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 })
        }

        const statusAtual = evento.status as string
        const acao = acaoDaTransicaoPontual(statusAtual, novoStatus)
        if (!acao) {
            return NextResponse.json({ error: `Transição inválida: ${statusAtual} → ${novoStatus}` }, { status: 422 })
        }
        if (!podeTransicionarPontual(acesso.checar, statusAtual, novoStatus)) {
            return NextResponse.json({ error: "Sem permissão para esta ação no evento" }, { status: 403 })
        }
        const motivoLimpo = motivo?.trim() || null
        if (transicaoPontualExigeMotivo(statusAtual, novoStatus) && !motivoLimpo) {
            return NextResponse.json({ error: "Motivo é obrigatório para devolver" }, { status: 400 })
        }

        const alteracao: Record<string, unknown> = { status: novoStatus }
        if (acao === "devolver") alteracao.motivo_devolucao = motivoLimpo
        if (acao === "autorizar") alteracao.motivo_devolucao = null

        // Condicional ao status lido: evita cancelar/devolver um evento que o worker acabou de pegar.
        const { data: alterado, error } = await admin
            .from("eventos_pontuais")
            .update(alteracao)
            .eq("id", id)
            .eq("status", statusAtual)
            .select("id")
        if (error) throw new Error(error.message)
        if (!alterado?.length) {
            return NextResponse.json({ error: "O evento mudou de status. Atualize a lista e tente de novo." }, { status: 409 })
        }

        return NextResponse.json({ ok: true, status: novoStatus })
    } catch (e) {
        console.error("[programacao/pontual/status]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
