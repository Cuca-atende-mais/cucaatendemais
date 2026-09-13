import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { motivoRecusaCriacao, origemValida } from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"

// S-PROG-13: esta rota grava com a chave de serviço (passa por cima das políticas), então a
// checagem por categoria é toda feita aqui, ANTES de apagar ou inserir qualquer coisa:
//   * a unidade da campanha precisa estar ao alcance de quem pede (regra de `get_my_unit()`), e toda
//     atividade é gravada com a unidade da campanha;
//   * a opção da origem (`origem`: zero, duplicar ou planilha);
//   * "criar atividade" em cada categoria enviada;
//   * substituir o mês exige "excluir programação inteira" e "excluir atividade" em todas as
//     categorias da programação existente.
// A campanha sempre nasce como rascunho: o envio para autorização é outro passo.

export async function POST(req: NextRequest) {
    try {
        // 1. Verifica autenticação via cookies da sessão (server-side, sem depender do JWT do cliente)
        const supabase = await createClient()
        const { data: { user }, error: authErr } = await supabase.auth.getUser()

        if (authErr || !user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        // 2. Lê o payload
        const body = await req.json()
        const { campanha, atividades, confirmarSubstituicao, origem } = body as {
            campanha: {
                titulo: string
                unidade_cuca: string
                mes: number
                ano: number
                total_atividades: number
                status?: string
            }
            atividades: any[]
            // S-PROG-02 (AC4): só apaga campanha existente com essa confirmação explícita —
            // antes este endpoint apagava sem avisar (`campanhas_mensais_mes_ano_unidade_key` é
            // UNIQUE, então inserir sem apagar primeiro sempre falhava; a correção não é pular o
            // delete, é só fazê-lo sob confirmação, não incondicionalmente).
            confirmarSubstituicao?: boolean
            origem: unknown
        }

        if (!campanha || !Array.isArray(atividades) || atividades.length === 0 || !origemValida(origem)) {
            return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
        }

        // 3. Permissão por origem e por categoria, antes de qualquer gravação
        const acesso = await carregarAcessoPgm(user)
        if (typeof campanha.unidade_cuca !== "string" || !campanha.unidade_cuca.trim()) {
            return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
        }
        if (!acesso.alcancaUnidade(campanha.unidade_cuca)) {
            return NextResponse.json({ error: "Sem permissão para criar programação desta unidade" }, { status: 403 })
        }

        const checar = acesso.checar
        const categoriasEnviadas = atividades.map((a: { categoria?: string | null } | null) => a?.categoria ?? null)
        const recusaCriacao = motivoRecusaCriacao(checar, origem, categoriasEnviadas, null)
        if (recusaCriacao) {
            return NextResponse.json({ error: recusaCriacao }, { status: 403 })
        }

        // 4. Usa admin client (service role) para bypassar o RLS no insert
        const admin = createAdminClient()

        // Verifica campanha existente para o mesmo mês/ano/unidade ANTES de decidir apagar.
        const { data: conflito } = await admin
            .from("campanhas_mensais")
            .select("id, status, titulo")
            .eq("mes", campanha.mes)
            .eq("ano", campanha.ano)
            .eq("unidade_cuca", campanha.unidade_cuca)
            .maybeSingle()

        if (conflito && !confirmarSubstituicao) {
            return NextResponse.json({ error: "Já existe programação para este mês/unidade", conflito }, { status: 409 })
        }

        if (conflito) {
            const { data: linhasExistentes, error: existErr } = await admin
                .from("atividades_mensais")
                .select("categoria")
                .eq("campanha_id", conflito.id)
            if (existErr) throw new Error(existErr.message)

            const recusaSubstituicao = motivoRecusaCriacao(
                checar, origem, categoriasEnviadas,
                (linhasExistentes || []).map(l => l.categoria as string | null),
            )
            if (recusaSubstituicao) {
                return NextResponse.json({ error: recusaSubstituicao }, { status: 403 })
            }

            const { error: delErr } = await admin.from("campanhas_mensais").delete().eq("id", conflito.id)
            if (delErr) throw new Error("Erro ao substituir campanha: " + delErr.message)
        }

        const { data: newCamp, error: campErr } = await admin
            .from("campanhas_mensais")
            .insert({
                titulo: campanha.titulo,
                unidade_cuca: campanha.unidade_cuca,
                mes: campanha.mes,
                ano: campanha.ano,
                total_atividades: atividades.length,
                status: "rascunho",
            })
            .select("id")
            .single()

        if (campErr) throw new Error("Erro ao criar campanha: " + campErr.message)

        // 5. Insere atividades em lotes de 50
        const CHUNK = 50
        const batch = atividades.map((a: any) => ({ ...a, unidade_cuca: campanha.unidade_cuca, campanha_id: newCamp.id }))

        for (let i = 0; i < batch.length; i += CHUNK) {
            const { error: batchErr } = await admin
                .from("atividades_mensais")
                .insert(batch.slice(i, i + CHUNK))
            if (batchErr) throw new Error(`Erro ao inserir atividades (lote ${Math.floor(i / CHUNK) + 1}): ` + batchErr.message)
        }

        return NextResponse.json({ campanha_id: newCamp.id })

    } catch (e: any) {
        console.error("[programacao/importar]", e)
        return NextResponse.json({ error: e.message || "Erro interno" }, { status: 500 })
    }
}
