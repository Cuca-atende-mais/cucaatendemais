import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { motivoRecusaCriacao, motivoRecusaSubstituicao, origemValida } from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"

// S-PROG-13: esta rota grava com a chave de serviço (passa por cima das políticas), então a
// checagem por categoria é toda feita aqui, ANTES de apagar ou inserir qualquer coisa:
//   * a unidade da campanha precisa estar ao alcance de quem pede (regra de `get_my_unit()`), e toda
//     atividade é gravada com a unidade da campanha;
//   * a opção da origem (`origem`: zero, duplicar ou planilha);
//   * "criar atividade" em cada categoria enviada;
//   * substituir o mês exige "excluir programação inteira" e "excluir atividade" em todas as
//     categorias da programação existente, e só vale para rascunho que nunca foi enviado nem publicado
//     (decisão do Junior, 2026-09-21): autorizada, aprovada ou publicada só sai por "Excluir
//     programação inteira" — escolher o mês atual por engano não pode derrubar o RAG no ar.
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
        if (!Number.isInteger(campanha.mes) || campanha.mes < 1 || campanha.mes > 12
            || !Number.isInteger(campanha.ano) || campanha.ano < 2000 || campanha.ano > 2100) {
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

        if (conflito) {
            const [{ data: statusCats, error: stErr }, { count: docsRag, error: ragErr }] = await Promise.all([
                admin.from("campanha_categoria_status").select("status, exigir_recriacao").eq("campanha_id", conflito.id),
                admin.from("documentos_rag").select("id", { count: "exact", head: true })
                    .eq("tipo", "monthly_program").eq("metadados->>campanha_id", conflito.id),
            ])
            if (stErr) throw new Error(stErr.message)
            if (ragErr) throw new Error(ragErr.message)
            // 422 (não 409): a tela só abre o "Substituir?" com 409 + `conflito`; aqui não há o que confirmar.
            const recusaRascunho = motivoRecusaSubstituicao({
                statusCampanha: conflito.status as string,
                // Categoria excluída pelo supervisor (a recriar) conta como já enviada: não é rascunho novo.
                statusCategorias: (statusCats || []).map(l => (l.exigir_recriacao ? "excluida" : l.status as string)),
                temDocumentoRag: (docsRag ?? 0) > 0,
            })
            if (recusaRascunho) {
                return NextResponse.json({ error: recusaRascunho }, { status: 422 })
            }
        }

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

            // Condicional ao status: se ela saiu do rascunho depois da checagem acima, não apaga.
            const { data: apagadas, error: delErr } = await admin
                .from("campanhas_mensais").delete().eq("id", conflito.id).eq("status", "rascunho").select("id")
            if (delErr) throw new Error("Erro ao substituir campanha: " + delErr.message)
            if (!apagadas?.length) {
                return NextResponse.json({ error: "A programação existente mudou de status. Atualize e tente de novo." }, { status: 409 })
            }
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
        // Data vazia fica vazia (ESPORTES nunca tem data; DIA A DIA/ESPECIAIS/CURSOS sem data são
        // barrados no "Enviar para autorização") — nenhuma data é inventada.
        const batch = atividades.map(a => ({ ...a, unidade_cuca: campanha.unidade_cuca, campanha_id: newCamp.id }))

        for (let i = 0; i < batch.length; i += CHUNK) {
            const { error: batchErr } = await admin
                .from("atividades_mensais")
                .insert(batch.slice(i, i + CHUNK))
            if (batchErr) {
                // Sem isso, a campanha ficava gravada VAZIA (só parte dos lotes, ou nenhum) e a
                // próxima tentativa de salvar caía no conflito de mês/unidade. Desfaz a campanha
                // recém-criada (CASCADE leva as atividades já inseridas) — a grade continua na tela
                // e a pessoa pode salvar de novo.
                const { error: rollbackErr } = await admin.from("campanhas_mensais").delete().eq("id", newCamp.id)
                if (rollbackErr) console.error("[programacao/importar] falha ao desfazer campanha vazia", rollbackErr)
                throw new Error(`Erro ao inserir atividades (lote ${Math.floor(i / CHUNK) + 1}): ` + batchErr.message)
            }
        }

        return NextResponse.json({ campanha_id: newCamp.id })

    } catch (e: any) {
        console.error("[programacao/importar]", e)
        return NextResponse.json({ error: e.message || "Erro interno" }, { status: 500 })
    }
}
