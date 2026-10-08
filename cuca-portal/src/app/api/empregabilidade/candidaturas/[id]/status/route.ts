import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { aplicarStatusCandidatura } from "@/lib/empregabilidade/aplicar-status-candidatura"
import { ehStatusEditavel } from "@/lib/empregabilidade/status-candidatura"

// S-EMP-GES-01: mudança de status pela tela do candidato, pela mesma regra da tela Feedback.
// Permissão igual à de escrita em `candidaturas` hoje (policy com `empreg_banco_cv`).
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const permissao = await exigirPermissao("empreg_banco_cv", "update")
    if (!permissao.ok) return permissao.resposta

    const { id: candidaturaId } = await params
    const body = await request.json().catch(() => ({}))
    if (!ehStatusEditavel(body?.status)) {
        return NextResponse.json({ error: "Status inválido." }, { status: 400 })
    }

    const { data: visivel } = await permissao.supabase
        .from("candidaturas")
        .select("id")
        .eq("id", candidaturaId)
        .maybeSingle()
    if (!visivel) return NextResponse.json({ error: "Candidatura não encontrada." }, { status: 404 })

    const resultado = await aplicarStatusCandidatura(createAdminClient(), candidaturaId, body.status)
    if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 500 })
    return NextResponse.json({ ok: true, talento: resultado.talento })
}
