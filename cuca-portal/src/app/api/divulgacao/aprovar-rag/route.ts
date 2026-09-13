import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { carregarAcessoDivulgacao, lerMesAno } from "@/lib/divulgacao/acesso-server"
import { carregarSituacaoDivulgacao } from "@/lib/divulgacao/situacao-server"
import { unidadePrecisaAprovarRag } from "@/lib/divulgacao/niveis"

// S-PROG-15: "Aprovar RAG" (ou "Atualizar RAG") do mês. Confere de novo permissão, mês permitido e
// nível 1 das 5 unidades; para cada unidade que precisa, grava `aprovado` e monta documento novo inativo
// (`pgm_aprovar_rag_campanha`). O mês só entra no ar em cada unidade quando a indexação termina.
// `unidade` opcional = "Tentar de novo" só para ela.
export async function POST(req: NextRequest) {
    try {
        const acesso = await carregarAcessoDivulgacao()
        if (!acesso) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        if (!acesso.podeAprovarRag) return NextResponse.json({ error: "Sem permissão para aprovar o RAG do mês." }, { status: 403 })

        const body = await req.json()
        const mes = lerMesAno(body?.mes, body?.ano)
        if (!mes) return NextResponse.json({ error: "Mês ou ano inválido" }, { status: 400 })
        const unidadeAlvo = typeof body?.unidade === "string" ? body.unidade : null

        const situacao = await carregarSituacaoDivulgacao(mes)
        if (!situacao.mesPermitido) {
            return NextResponse.json({ error: "Mês fora do permitido (só o vigente e o seguinte)" }, { status: 422 })
        }
        if (!situacao.nivel1) {
            return NextResponse.json({ error: "Nível 1 pendente: nem todas as programações do mês estão autorizadas" }, { status: 422 })
        }

        const alvo = situacao.unidades.filter(u => (unidadeAlvo ? u.unidade === unidadeAlvo : true) && unidadePrecisaAprovarRag(u))
        if (alvo.length === 0) {
            return NextResponse.json({ error: "Nenhuma unidade precisa de aprovação do RAG agora" }, { status: 409 })
        }

        const admin = createAdminClient()
        const { data: colaborador } = await admin.from("colaboradores").select("id").eq("user_id", acesso.user.id).maybeSingle()

        const resultados = []
        for (const u of alvo) {
            const { data, error } = await admin.rpc("pgm_aprovar_rag_campanha", {
                p_campanha_id: u.campanhaId,
                p_usuario_id: colaborador?.id ?? null,
            })
            resultados.push({ unidade: u.unidade, ok: !error, documentoId: data ?? null, erro: error?.message ?? null })
            if (error) console.error("[divulgacao/aprovar-rag]", u.unidade, error)
        }

        const falhas = resultados.filter(r => !r.ok)
        return NextResponse.json({ resultados }, { status: falhas.length === resultados.length ? 500 : 200 })
    } catch (error: unknown) {
        console.error("[divulgacao/aprovar-rag]", error)
        return NextResponse.json({ error: error instanceof Error ? error.message : "Erro interno" }, { status: 500 })
    }
}
