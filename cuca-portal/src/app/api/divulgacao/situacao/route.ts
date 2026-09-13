import { NextRequest, NextResponse } from "next/server"
import { carregarAcessoDivulgacao, lerMesAno } from "@/lib/divulgacao/acesso-server"
import { carregarSituacaoDivulgacao } from "@/lib/divulgacao/situacao-server"

// S-PROG-15: mês vigente, meses permitidos e os dois níveis do mês selecionado (padrão: vigente).
export async function GET(req: NextRequest) {
    try {
        const acesso = await carregarAcessoDivulgacao()
        if (!acesso) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        if (!acesso.podeVer) return NextResponse.json({ error: "Sem permissão para acessar a Divulgação." }, { status: 403 })

        const { searchParams } = new URL(req.url)
        const selecionado = searchParams.has("mes") ? lerMesAno(searchParams.get("mes"), searchParams.get("ano")) : null
        if (searchParams.has("mes") && !selecionado) {
            return NextResponse.json({ error: "Mês ou ano inválido" }, { status: 400 })
        }

        const situacao = await carregarSituacaoDivulgacao(selecionado)
        return NextResponse.json({
            ...situacao,
            permissoes: { aprovarRag: acesso.podeAprovarRag, disparar: acesso.podeDisparar },
        })
    } catch (error: unknown) {
        console.error("[divulgacao/situacao]", error)
        return NextResponse.json({ error: error instanceof Error ? error.message : "Erro interno" }, { status: 500 })
    }
}
