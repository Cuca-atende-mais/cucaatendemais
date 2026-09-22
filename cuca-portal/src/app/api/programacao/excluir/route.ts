import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { PGP } from "@/lib/rbac/catalogo-programacao-pontual"
import { categoriasParaExcluir, opcaoLiberada, slugDaCategoria, temAlgumaOpcaoDeExcluir } from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"
import { STATUS_BLOQUEIAM_EXCLUSAO_PONTUAL, eventoExcluivel } from "@/lib/programacao/pontual"
import { isDeveloperEmail } from "@/lib/auth/developers"

// Mensal — "Excluir minha programação" (decisão do Junior, 2026-09-21): cada pessoa exclui só as
// categorias dela, na unidade ao alcance. Rascunho: "excluir minha programação" (assistente). Enviada
// ou autorizada: "excluir programação enviada ou autorizada" (supervisor) — a unidade fica travada até
// recriar e autorizar. Publicada (RAG no ar) e programação inteira: só Developer. A regra fica aqui
// porque a exclusão usa a chave de serviço, que não passa pelas políticas do banco; a gravação é
// uma transação única em `pgm_excluir_categorias`. A confirmação nominal continua na tela. S-PROG-17: pontual exige
// "Excluir evento" e o evento ao alcance da unidade.

export async function DELETE(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const id = searchParams.get("id")
        const tipo = searchParams.get("tipo")

        if (!id || !tipo) {
            return NextResponse.json({ error: "ID e tipo são obrigatórios" }, { status: 400 })
        }

        if (tipo === 'mensal') {
            const acesso = await carregarAcessoPgm(user)
            const developer = isDeveloperEmail(user.email)
            if (!developer && !temAlgumaOpcaoDeExcluir(acesso.checar)) {
                return NextResponse.json({ error: "Sem permissão para excluir programação." }, { status: 403 })
            }

            const admin = createAdminClient()
            const { data: campanha } = await admin
                .from("campanhas_mensais")
                .select("id, unidade_cuca")
                .eq("id", id)
                .maybeSingle()
            if (!campanha || !acesso.alcancaUnidade(campanha.unidade_cuca as string | null)) {
                return NextResponse.json({ error: "Programação não encontrada" }, { status: 404 })
            }

            const [{ data: publicada, error: pubErr }, { data: linhas, error: lErr }, { data: statusCats, error: sErr }] = await Promise.all([
                admin.rpc("pgm_campanha_publicada", { p_campanha_id: id }),
                admin.from("atividades_mensais").select("categoria").eq("campanha_id", id),
                admin.from("campanha_categoria_status").select("categoria, status").eq("campanha_id", id),
            ])
            if (pubErr) throw pubErr
            if (lErr) throw lErr
            if (sErr) throw sErr

            const nomes = [...new Set((linhas ?? []).map(l => l.categoria as string).filter(Boolean))]
            const statusDe = (nome: string) => (statusCats ?? []).find(s => slugDaCategoria(s.categoria as string) === slugDaCategoria(nome))?.status as string | undefined
            const { categorias, recusa } = categoriasParaExcluir({
                checar: acesso.checar,
                developer,
                publicada: publicada === true,
                categorias: nomes.map(nome => ({ categoria: nome, status: statusDe(nome) ?? null })),
            })
            if (recusa) {
                return NextResponse.json({ error: recusa }, { status: 403 })
            }

            if (developer) {
                // Programação inteira (todas as categorias), inclusive publicada — só Developer.
                await supabase.from("eventos_mensais").delete().eq("campanha_id", id)
                const { error } = await admin.from("campanhas_mensais").delete().eq("id", id)
                if (error) throw error
                return NextResponse.json({ success: true, message: "Programação excluída com sucesso." })
            }

            const { data: colaborador } = await admin.from("colaboradores").select("id").eq("user_id", user.id).maybeSingle()
            const { data: resultado, error: rpcErr } = await admin.rpc("pgm_excluir_categorias", {
                p_campanha_id: id,
                p_categorias: categorias,
                p_usuario_id: colaborador?.id ?? null,
            })
            if (rpcErr) {
                const status = rpcErr.code === "42501" ? 403 : rpcErr.code === "P0002" ? 404 : 500
                return NextResponse.json({ error: rpcErr.message }, { status })
            }
            const rotulo = categorias.join(", ")
            return NextResponse.json({
                success: true,
                categorias,
                message: resultado === "excluida"
                    ? `Programação de ${rotulo} excluída. Não restou atividade de ninguém, então a programação do mês saiu.`
                    : `Programação de ${rotulo} excluída. As outras categorias continuam como estavam.`,
            })
        } else if (tipo === 'pontual') {
            const acesso = await carregarAcessoPgm(user)
            if (!opcaoLiberada(acesso.checar, PGP.excluir)) {
                return NextResponse.json({ error: "Sem permissão para excluir evento pontual." }, { status: 403 })
            }

            const admin = createAdminClient()
            const { data: evento } = await admin
                .from("eventos_pontuais")
                .select("id, unidade_cuca, status")
                .eq("id", id)
                .maybeSingle()
            if (!evento || !acesso.alcancaUnidade(evento.unidade_cuca as string | null)) {
                return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 })
            }
            if (!eventoExcluivel(evento.status as string)) {
                return NextResponse.json({ error: "Evento com envio na fila, em andamento ou pausado não pode ser excluído. Cancele antes ou aguarde o fim do envio." }, { status: 422 })
            }

            // Condicional ao status: se o worker pegou o evento nesse meio tempo, não apaga.
            // O documento do evento sai do RAG pelo gatilho `tr_evento_desativar_rag_ao_excluir`.
            const { data: apagados, error } = await admin
                .from("eventos_pontuais")
                .delete()
                .eq("id", id)
                .not("status", "in", `(${STATUS_BLOQUEIAM_EXCLUSAO_PONTUAL.join(",")})`)
                .select("id")
            if (error) throw error
            if (!apagados?.length) {
                return NextResponse.json({ error: "O evento mudou de status. Atualize a lista e tente de novo." }, { status: 409 })
            }
        } else {
            return NextResponse.json({ error: "Tipo inválido" }, { status: 400 })
        }

        return NextResponse.json({ success: true, message: "Programação excluída com sucesso." })

    } catch (e: any) {
        console.error("[programacao/excluir]", e)
        return NextResponse.json({ error: e.message || "Erro ao excluir programação" }, { status: 500 })
    }
}
