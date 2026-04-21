import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { deleteFromR2 } from "@/lib/r2"

// GET — busca dados da vaga validando posse da empresa (usado pela página de edição pública)
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { id } = await params
    const empresaId = request.nextUrl.searchParams.get("empresa_id")

    if (!id || !empresaId) {
        return NextResponse.json({ error: "Parâmetros ausentes." }, { status: 400 })
    }

    const { data: vaga, error } = await supabaseAdmin
        .from("vagas")
        .select("*, empresas(nome, nome_fantasia)")
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .single()

    if (error || !vaga) {
        return NextResponse.json({ error: "Vaga não encontrada ou não pertence à empresa." }, { status: 404 })
    }

    const empresaNome = (vaga.empresas as any)?.nome_fantasia || (vaga.empresas as any)?.nome || ""

    return NextResponse.json({ ...vaga, empresa_nome: empresaNome })
}

// PATCH — aplica apenas os campos alterados (diff), força status pre_cadastro e registra histórico
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { id } = await params

    try {
        const body = await request.json()
        const { empresa_id, diff } = body

        if (!empresa_id || !diff || typeof diff !== "object" || Object.keys(diff).length === 0) {
            return NextResponse.json({ error: "Parâmetros inválidos ou sem alterações." }, { status: 400 })
        }

        // Validar posse e status atual
        const { data: vaga, error: vagaErr } = await supabaseAdmin
            .from("vagas")
            .select("id, status, historico_alteracoes, titulo, unidade_cuca")
            .eq("id", id)
            .eq("empresa_id", empresa_id)
            .single()

        if (vagaErr || !vaga) {
            return NextResponse.json({ error: "Vaga não encontrada ou não pertence à empresa." }, { status: 404 })
        }

        if (vaga.status === "cancelada") {
            return NextResponse.json({ error: "Vaga cancelada não pode ser editada." }, { status: 403 })
        }

        // Campos permitidos para edição pela empresa (whitelist de segurança)
        const CAMPOS_PERMITIDOS = [
            "titulo", "descricao", "requisitos", "tipo_contrato", "salario",
            "total_vagas", "escolaridade_minima", "beneficios", "limite_curriculos", "tipo_selecao",
        ]
        const payload: Record<string, unknown> = {}
        for (const campo of CAMPOS_PERMITIDOS) {
            if (campo in diff) {
                payload[campo] = diff[campo]
            }
        }

        if (Object.keys(payload).length === 0) {
            return NextResponse.json({ error: "Nenhum campo válido para atualizar." }, { status: 400 })
        }

        // Rebaixar status para pre_cadastro e registrar no histórico
        const historicoExistente = (vaga.historico_alteracoes as unknown[]) || []
        const novaEntrada = {
            tipo: "edicao",
            canal: "portal_link_edicao",
            ator: { empresa_id },
            timestamp: new Date().toISOString(),
            campos_alterados: Object.keys(payload),
            diff: payload,
        }

        const { error: updateErr } = await supabaseAdmin
            .from("vagas")
            .update({
                ...payload,
                status: "pre_cadastro",
                historico_alteracoes: [...historicoExistente, novaEntrada],
                updated_at: new Date().toISOString(),
            })
            .eq("id", id)

        if (updateErr) throw updateErr

        // Notificar worker: gravar marcador vaga_editada_id na conversa ativa da empresa
        try {
            const { data: conversas } = await supabaseAdmin
                .from("conversas")
                .select("id, metadata")
                .filter("metadata->empreg_fluxo->>empresa_id", "eq", empresa_id)
                .in("status", ["ativa", "aberta"])
                .order("updated_at", { ascending: false })
                .limit(1)

            if (conversas && conversas.length > 0) {
                const conversa = conversas[0]
                const metadata = conversa.metadata || {}
                const empreg_fluxo = metadata.empreg_fluxo || {}
                metadata.empreg_fluxo = {
                    ...empreg_fluxo,
                    vaga_editada_id: id,
                    vaga_editada_titulo: vaga.titulo,
                    vaga_editada_unidade: vaga.unidade_cuca,
                }
                await supabaseAdmin
                    .from("conversas")
                    .update({ metadata })
                    .eq("id", conversa.id)
            }
        } catch (notifyErr) {
            console.warn("[vagas/[id]] Erro ao notificar worker:", notifyErr)
        }

        // Notificar lead responsável via worker
        try {
            const { data: vagaLead } = await supabaseAdmin
                .from("vagas")
                .select("created_by, titulo, unidade_cuca")
                .eq("id", id)
                .single()

            if (vagaLead?.created_by) {
                const { data: lead } = await supabaseAdmin
                    .from("leads")
                    .select("telefone")
                    .eq("id", vagaLead.created_by)
                    .single()

                if (lead?.telefone) {
                    const { data: instancias } = await supabaseAdmin
                        .from("instancias_uazapi")
                        .select("nome, token")
                        .eq("unidade_cuca", vagaLead.unidade_cuca)
                        .eq("canal_tipo", "Institucional")
                        .eq("ativa", true)
                        .limit(1)

                    if (instancias && instancias.length > 0) {
                        const { token } = instancias[0]
                        const telLimpo = lead.telefone.replace(/\D/g, "")
                        const mensagem = `📝 *Alteração de Vaga*\n\nA empresa solicitou alterações na vaga *${vagaLead.titulo || id}*.\n\nA vaga voltou para *pré-cadastro* e aguarda sua validação antes de aceitar novas candidaturas.`
                        const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"

                        await fetch(`${workerUrl}/send-message/${token}`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                phone: telLimpo.startsWith("55") ? telLimpo : `55${telLimpo}`,
                                message: mensagem,
                            }),
                        })
                    }
                }
            }
        } catch (leadErr) {
            console.warn("[vagas/[id]] Erro ao notificar lead:", leadErr)
        }

        return NextResponse.json({ ok: true })
    } catch (err: any) {
        console.error("[vagas/[id] PATCH] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 })
    }
}

// DELETE — exclui vaga, candidaturas e entradas do talent_bank vinculadas
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        const { id } = await params

        const { data: vaga, error: vagaErr } = await supabase
            .from("vagas")
            .select("id, titulo")
            .eq("id", id)
            .single()

        if (vagaErr || !vaga) {
            return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 })
        }

        // Limpar CVs das candidaturas no R2
        const { data: candidaturas } = await supabase
            .from("candidaturas")
            .select("id, arquivo_cv_url")
            .eq("vaga_id", id)

        for (const c of candidaturas || []) {
            if (c.arquivo_cv_url) {
                try {
                    await deleteFromR2(c.arquivo_cv_url)
                } catch {
                    console.warn("[vagas/delete] Falha ao deletar CV do R2:", c.id)
                }
            }
        }

        // Deletar candidaturas
        const { error: candErr } = await supabase
            .from("candidaturas")
            .delete()
            .eq("vaga_id", id)
        if (candErr) throw candErr

        // Deletar entradas do talent_bank vinculadas à vaga
        await supabase.from("talent_bank").delete().eq("vaga_origem_id", id)

        // Deletar a vaga
        const { error: deleteErr } = await supabase.from("vagas").delete().eq("id", id)
        if (deleteErr) throw deleteErr

        return NextResponse.json({ ok: true, candidaturasRemovidas: (candidaturas || []).length })
    } catch (err: any) {
        console.error("[vagas/delete] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro ao excluir vaga." }, { status: 500 })
    }
}
