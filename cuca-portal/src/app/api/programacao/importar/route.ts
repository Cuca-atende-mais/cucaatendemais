import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { categoriasDaGravacao, motivoRecusaCriacao, origemValida } from "@/lib/programacao/permissoes-categoria"
import { mapearErroSalvarRascunho } from "@/lib/programacao/rascunho"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"

// S-PROG-13: esta rota grava com a chave de serviço (passa por cima das políticas), então a
// checagem por categoria é toda feita aqui, ANTES de apagar ou inserir qualquer coisa:
//   * a unidade da campanha precisa estar ao alcance de quem pede (regra de `get_my_unit()`), e toda
//     atividade é gravada com a unidade da campanha;
//   * a opção da origem (`origem`: zero, duplicar ou planilha);
//   * "criar atividade" em cada categoria enviada;
//   * "criar atividade" em cada categoria enviada.
//
// Mês que JÁ TEM programação nunca é substituído (incidente de produção em 2026-09-22: duas pessoas
// montaram outubro da mesma unidade e a segunda apagou a parte da primeira — a programação é uma só
// por mês e unidade, compartilhada pelas categorias). As categorias de quem pede são gravadas DENTRO
// da programação existente, pela mesma função da edição (`programacao_salvar_rascunho_categorias`),
// que substitui só as categorias declaradas e confere a permissão de cada uma dentro do banco.
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
        const { campanha, atividades, origem } = body as {
            campanha: {
                titulo: string
                unidade_cuca: string
                mes: number
                ano: number
                total_atividades: number
                status?: string
            }
            atividades: any[]
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
        const recusaCriacao = motivoRecusaCriacao(checar, origem, categoriasEnviadas)
        if (recusaCriacao) {
            return NextResponse.json({ error: recusaCriacao }, { status: 403 })
        }

        // 4. Usa admin client (service role) para bypassar o RLS no insert
        const admin = createAdminClient()

        // Programação já existente para o mesmo mês/ano/unidade: as categorias de quem pede entram nela.
        const { data: conflito } = await admin
            .from("campanhas_mensais")
            .select("id, status, titulo")
            .eq("mes", campanha.mes)
            .eq("ano", campanha.ano)
            .eq("unidade_cuca", campanha.unidade_cuca)
            .maybeSingle()

        if (conflito) {
            // Não apaga nada: acrescenta as categorias de quem pede à programação que já existe.
            // A função confere, dentro do banco, permissão por categoria e se a categoria está em
            // rascunho; se a programação não estiver mais em rascunho, ela recusa com a razão.
            // Só as categorias que vieram na tela/arquivo — nunca as do perfil de quem salva.
            const categorias = categoriasDaGravacao(categoriasEnviadas)
            if (categorias.length === 0) {
                return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
            }

            // Com a sessão de quem pede (não com a chave de serviço): a função confere
            // `pgm_pode_categoria` por dentro, e isso depende do usuário logado.
            const { data, error } = await supabase.rpc("programacao_salvar_rascunho_categorias", {
                p_campanha_id: conflito.id,
                p_titulo: (conflito.titulo as string) || campanha.titulo,
                p_atividades: atividades.map(a => ({ ...a, unidade_cuca: campanha.unidade_cuca })),
                p_categorias: categorias,
            })
            if (error) {
                const { status, error: mensagem } = mapearErroSalvarRascunho(error)
                return NextResponse.json({ error: mensagem }, { status })
            }

            const resultado = Array.isArray(data) ? data[0] : data
            return NextResponse.json({
                campanha_id: conflito.id,
                mesclada: true,
                total_atividades: resultado?.total_atividades,
            })
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
                // Sem isso, a campanha ficava gravada VAZIA e a próxima tentativa de salvar caía no
                // conflito de mês/unidade. Desfaz a campanha recém-criada (CASCADE leva o que entrou).
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
