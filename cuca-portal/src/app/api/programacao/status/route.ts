import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { linhaIncompleta, LinhaParaAprovacao } from "@/lib/programacao/aprovacao"
import {
    acaoDaTransicaoCategoria, podeTransicionarCategoria, slugDaCategoria, transicaoExigeMotivo,
} from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"

// S-PROG-14: transições por CATEGORIA (enviar, autorizar, devolver, reabrir), cada uma com a opção da
// categoria (S-PROG-12). A rota confere unidade, permissão e campos obrigatórios da categoria; a função
// `pgm_mudar_status_categoria` valida a transição, exige motivo, grava histórico com a categoria e
// deriva o status da campanha (`autorizada` com todas autorizadas, senão `rascunho`). Nada aqui mexe
// no RAG: publicar é o "Aprovar RAG" da Divulgação (S-PROG-15).
export async function PATCH(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authErr } = await supabase.auth.getUser()
        if (authErr || !user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        const body = await req.json()
        const { campanha_id, categoria, novoStatus, motivo } = body as {
            campanha_id: string; categoria: string; novoStatus: string; motivo?: string
        }
        if (!campanha_id || !categoria || !novoStatus || !slugDaCategoria(categoria)) {
            return NextResponse.json({ error: "campanha_id, categoria e novoStatus são obrigatórios" }, { status: 400 })
        }

        const admin = createAdminClient()
        const acesso = await carregarAcessoPgm(user)
        const { data: campanha, error: campErr } = await admin
            .from("campanhas_mensais")
            .select("id, unidade_cuca")
            .eq("id", campanha_id)
            .maybeSingle()
        if (campErr) throw new Error(campErr.message)
        // Chave de serviço ignora a política de leitura por unidade: outra unidade responde 404.
        if (!campanha || !acesso.alcancaUnidade(campanha.unidade_cuca as string | null)) {
            return NextResponse.json({ error: "Programação não encontrada" }, { status: 404 })
        }

        const { data: linhaStatus, error: stErr } = await admin
            .from("campanha_categoria_status")
            .select("categoria, status")
            .eq("campanha_id", campanha_id)
        if (stErr) throw new Error(stErr.message)
        const atual = (linhaStatus || []).find(s => slugDaCategoria(s.categoria) === slugDaCategoria(categoria))
        const statusAtual = (atual?.status as string | undefined) ?? "rascunho"

        if (!acaoDaTransicaoCategoria(statusAtual, novoStatus)) {
            return NextResponse.json({ error: `Transição inválida: ${statusAtual} → ${novoStatus}` }, { status: 400 })
        }
        if (!podeTransicionarCategoria(acesso.checar, categoria, statusAtual, novoStatus)) {
            return NextResponse.json({ error: `Sem permissão para esta ação em ${categoria}` }, { status: 403 })
        }
        if (transicaoExigeMotivo(statusAtual, novoStatus) && !motivo?.trim()) {
            return NextResponse.json({ error: "Motivo é obrigatório para devolver ou reabrir" }, { status: 400 })
        }

        // Enviar para autorização: bloqueado se faltar campo obrigatório nas linhas DESTA categoria.
        if (statusAtual === "rascunho" && novoStatus === "aguardando_autorizacao") {
            const { data: linhas, error: lErr } = await admin
                .from("atividades_mensais")
                .select("categoria, titulo, descricao, local, hora_inicio, hora_fim, data_atividade, metadata")
                .eq("campanha_id", campanha_id)
            if (lErr) throw new Error(lErr.message)
            const daCategoria = (linhas as LinhaParaAprovacao[] || []).filter(l => slugDaCategoria(l.categoria) === slugDaCategoria(categoria))
            const problemas = daCategoria.filter(linhaIncompleta)
            if (problemas.length > 0) {
                return NextResponse.json({
                    error: `${problemas.length} ponto(s) a revisar em ${categoria} antes de enviar para autorização`,
                    totalProblemas: problemas.length,
                }, { status: 409 })
            }
        }

        const { data: colaborador } = await admin.from("colaboradores").select("id").eq("user_id", user.id).maybeSingle()

        const { data: statusCampanha, error: rpcErr } = await admin.rpc("pgm_mudar_status_categoria", {
            p_campanha_id: campanha_id,
            p_categoria: categoria,
            p_para: novoStatus,
            p_motivo: motivo?.trim() || null,
            p_usuario_id: colaborador?.id ?? null,
        })
        if (rpcErr) {
            const status = rpcErr.code === "P0002" ? 404 : rpcErr.code === "P0001" ? 409 : 500
            return NextResponse.json({ error: rpcErr.message }, { status })
        }

        return NextResponse.json({ ok: true, statusCampanha })
    } catch (e) {
        console.error("[programacao/status]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
