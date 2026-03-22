import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function POST(req: NextRequest) {
    try {
        // 1. Verifica autenticação via cookies da sessão (server-side, sem depender do JWT do cliente)
        const supabase = await createClient()
        const { data: { user }, error: authErr } = await supabase.auth.getUser()

        if (authErr || !user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        // 2. Verifica permissão no banco (server-side, JWT válido garantido pelo SSR)
        const { data: permOk } = await supabase
            .rpc("has_permission", { p_recurso: "programacao", p_acao: "create" })

        if (!permOk) {
            return NextResponse.json({ error: "Sem permissão para criar programação" }, { status: 403 })
        }

        // 3. Lê o payload
        const body = await req.json()
        const { campanha, atividades } = body as {
            campanha: {
                titulo: string
                unidade_cuca: string
                mes: number
                ano: number
                total_atividades: number
                status: string
            }
            atividades: any[]
        }

        if (!campanha || !atividades || atividades.length === 0) {
            return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
        }

        // 4. Usa admin client (service role) para bypassar o RLS no insert
        const admin = createAdminClient()

        // Remove campanha existente para o mesmo mês/ano/unidade (pode ser órfã de import com falha)
        await admin
            .from("campanhas_mensais")
            .delete()
            .eq("mes", campanha.mes)
            .eq("ano", campanha.ano)
            .eq("unidade_cuca", campanha.unidade_cuca)

        const { data: newCamp, error: campErr } = await admin
            .from("campanhas_mensais")
            .insert(campanha)
            .select("id")
            .single()

        if (campErr) throw new Error("Erro ao criar campanha: " + campErr.message)

        // 5. Insere atividades em lotes de 50
        const CHUNK = 50
        const batch = atividades.map((a: any) => ({ ...a, campanha_id: newCamp.id }))

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
