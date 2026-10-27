import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { EPM_FEEDBACK } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import { ordenarPorUltimoEnvio, ultimoPedidoPorVaga, type LinhaFeedback, type PedidoDaLista } from "@/lib/empregabilidade/feedback-lista"

// S-EMP-GES-08 (AC2, AC3, AC11): lista dos feedbacks enviados — uma linha por vaga com o pedido mais
// recente. Mesmo recorte de visibilidade da rota por vaga: os pedidos são lidos com o cliente admin, mas
// só voltam os das vagas que o cliente do usuário consegue ler (RLS de `vagas`). Nunca devolve o token.

const PAGINA = 1000
const LOTE_IDS = 200

interface PedidoBanco {
    id: string
    vaga_id: string
    created_at: string
    criado_por: string | null
    status_envio: string
    erro_envio: string | null
    expires_at: string | null
    respondido_em: string | null
    situacao: string | null
    feedback_solicitacao_itens: { count: number }[] | null
}

interface VagaBanco {
    id: string
    numero_vaga: number | null
    titulo: string | null
    tipo: string | null
    empresa_id: string | null
    empresas: { nome: string | null; nome_fantasia: string | null } | { nome: string | null; nome_fantasia: string | null }[] | null
}

export async function GET() {
    const permissao = await exigirPermissao(EPM_FEEDBACK.ver)
    if (!permissao.ok) return permissao.resposta

    try {
        const admin = createAdminClient()

        const pedidos: PedidoBanco[] = []
        for (let inicio = 0; ; inicio += PAGINA) {
            const { data, error } = await admin
                .from("feedback_solicitacoes")
                .select("id, vaga_id, created_at, criado_por, status_envio, erro_envio, expires_at, respondido_em, situacao, feedback_solicitacao_itens(count)")
                .order("created_at", { ascending: false })
                .order("id", { ascending: false })
                .range(inicio, inicio + PAGINA - 1)
            if (error) throw error
            pedidos.push(...((data ?? []) as unknown as PedidoBanco[]))
            if (!data || data.length < PAGINA) break
        }

        const porVaga = ultimoPedidoPorVaga(pedidos)
        const ids = Array.from(porVaga.keys())

        // Recorte de visibilidade: vaga que o usuário não lê não volta na consulta e some da lista.
        const vagas = new Map<string, VagaBanco>()
        for (let i = 0; i < ids.length; i += LOTE_IDS) {
            const { data, error } = await permissao.supabase
                .from("vagas")
                .select("id, numero_vaga, titulo, tipo, empresa_id, empresas(nome, nome_fantasia)")
                .in("id", ids.slice(i, i + LOTE_IDS))
            if (error) throw error
            for (const v of (data ?? []) as VagaBanco[]) vagas.set(v.id, v)
        }

        const autores = Array.from(new Set(
            Array.from(porVaga.entries())
                .filter(([vagaId]) => vagas.has(vagaId))
                .map(([, g]) => g.ultimo.criado_por)
                .filter((x): x is string => !!x),
        ))
        const nomes = new Map<string, string>()
        if (autores.length > 0) {
            const { data: cols } = await admin.from("colaboradores").select("user_id, nome_completo").in("user_id", autores)
            for (const c of cols ?? []) if (c.user_id && c.nome_completo) nomes.set(c.user_id, c.nome_completo)
        }

        const linhas: LinhaFeedback[] = []
        for (const [vagaId, { ultimo, total }] of porVaga) {
            const vaga = vagas.get(vagaId)
            if (!vaga) continue
            const emp = Array.isArray(vaga.empresas) ? vaga.empresas[0] ?? null : vaga.empresas
            const pedido: PedidoDaLista = {
                id: ultimo.id,
                vaga_id: ultimo.vaga_id,
                created_at: ultimo.created_at,
                enviado_por: (ultimo.criado_por && nomes.get(ultimo.criado_por)) || null,
                candidatos: ultimo.feedback_solicitacao_itens?.[0]?.count ?? 0,
                status_envio: ultimo.status_envio,
                erro_envio: ultimo.erro_envio,
                expires_at: ultimo.expires_at,
                respondido_em: ultimo.respondido_em,
                situacao: ultimo.situacao,
            }
            linhas.push({
                vaga_id: vaga.id,
                empresa_id: vaga.empresa_id,
                empresa_nome: emp?.nome_fantasia || emp?.nome || "Empresa sem nome",
                numero_vaga: vaga.numero_vaga,
                titulo: vaga.titulo,
                tipo: vaga.tipo,
                pedidos: total,
                ultimo: pedido,
            })
        }

        return NextResponse.json({ linhas: ordenarPorUltimoEnvio(linhas) })
    } catch (e) {
        console.error("[feedback/lista] Erro:", e)
        return NextResponse.json({ error: "Erro ao carregar os feedbacks enviados." }, { status: 500 })
    }
}
