import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { PGR } from "@/lib/rbac/catalogo-divulgacao-rag-global"
import { AVS } from "@/lib/rbac/catalogo-avisos"
import { opcaoLiberada } from "@/lib/programacao/permissoes-categoria"
import { exigirOpcaoRagGlobal } from "@/lib/rag-global/acesso-server"
import { conferirTotal, hojeFortaleza, lerDadosAviso, metadadosDoAviso, TIPO_AVISO } from "@/lib/rag-global/avisos"
import { listarAvisos } from "@/lib/rag-global/avisos-server"

// S-INST-QUAL-08: lista de avisos da rede ("Ver base global") e as opções de quem pede.
export async function GET() {
    try {
        const acesso = await exigirOpcaoRagGlobal(PGR.ver)
        if ("resposta" in acesso) return acesso.resposta
        const opcoes = Object.fromEntries(Object.entries(AVS).map(([chave, modulo]) => [chave, opcaoLiberada(acesso.checar, modulo)]))
        return NextResponse.json({ avisos: await listarAvisos(), hoje: hojeFortaleza(), opcoes })
    } catch (e) {
        console.error("[rag-global/avisos GET]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}

// Criar aviso ("Criar aviso"). Nasce ativo; vale a partir do início e sai do bot depois do fim.
export async function POST(req: NextRequest) {
    try {
        const acesso = await exigirOpcaoRagGlobal(AVS.criar)
        if ("resposta" in acesso) return acesso.resposta

        const hoje = hojeFortaleza()
        const lido = lerDadosAviso(await req.json(), hoje)
        if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 })
        const erroTotal = conferirTotal(await listarAvisos(), lido.dados, hoje)
        if (erroTotal) return NextResponse.json({ error: erroTotal }, { status: 400 })

        const admin = createAdminClient()
        const { data, error } = await admin
            .from("documentos_rag")
            .insert({
                titulo: lido.dados.titulo,
                tipo: TIPO_AVISO,
                conteudo: lido.dados.conteudo,
                unidade_cuca: null,
                ativo: true,
                metadados: metadadosDoAviso(lido.dados, { criado_por: acesso.user.id }),
            })
            .select("id")
            .single()
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true, id: data.id })
    } catch (e) {
        console.error("[rag-global/avisos POST]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
