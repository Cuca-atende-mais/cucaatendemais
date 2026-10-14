import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { EPM_FEEDBACK } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import { aplicarStatusCandidatura, type ResultadoStatus } from "@/lib/empregabilidade/aplicar-status-candidatura"
import { ehStatusEditavel } from "@/lib/empregabilidade/status-candidatura"

// S-EMP-GES-01 (AC6-AC10, AC13): mudança de status pela tela Feedback, um a um ou em lote.
// Não avisa o jovem (decisão 5 do épico / D3). Devolve o resultado por candidatura para a tela
// mostrar quantos foram atualizados e quais falharam.

const MAX_POR_LOTE = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}))
    const modo = body?.modo === "lote" ? "lote" : "individual"

    const permissao = await exigirPermissao(modo === "lote" ? EPM_FEEDBACK.statusLote : EPM_FEEDBACK.statusIndividual)
    if (!permissao.ok) return permissao.resposta

    const vagaId: unknown = body?.vaga_id
    const ids: unknown = body?.candidatura_ids
    if (typeof vagaId !== "string" || !UUID_RE.test(vagaId)) {
        return NextResponse.json({ error: "Vaga inválida." }, { status: 400 })
    }
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(i => typeof i === "string" && UUID_RE.test(i))) {
        return NextResponse.json({ error: "Nenhum candidato válido informado." }, { status: 400 })
    }
    if (modo === "individual" && ids.length !== 1) {
        return NextResponse.json({ error: "A mudança individual é de um candidato por vez." }, { status: 400 })
    }
    if (ids.length > MAX_POR_LOTE) {
        return NextResponse.json({ error: `Máximo de ${MAX_POR_LOTE} candidatos por lote.` }, { status: 400 })
    }
    if (!ehStatusEditavel(body?.status)) {
        return NextResponse.json({ error: "Status inválido." }, { status: 400 })
    }
    const status = body.status
    const unicos = Array.from(new Set(ids as string[]))

    // Mesma regra de unidade da leitura: só candidaturas desta vaga que o usuário enxerga pela RLS.
    const { data: visiveis, error: visErr } = await permissao.supabase
        .from("candidaturas")
        .select("id, status")
        .eq("vaga_id", vagaId)
        .in("id", unicos)
    if (visErr) return NextResponse.json({ error: "Erro ao conferir os candidatos." }, { status: 500 })
    const statusAtual = new Map((visiveis ?? []).map(c => [c.id as string, c.status as string]))

    const admin = createAdminClient()
    const resultados: ResultadoStatus[] = []
    for (const id of unicos) {
        const atual = statusAtual.get(id)
        if (atual === undefined) {
            resultados.push({ candidaturaId: id, ok: false, erro: "Candidato não encontrado nesta vaga ou sem acesso." })
            continue
        }
        if (!ehStatusEditavel(atual)) {
            resultados.push({ candidaturaId: id, ok: false, erro: "Status atual não pode ser alterado por esta tela." })
            continue
        }
        resultados.push(await aplicarStatusCandidatura(admin, id, status))
    }

    const atualizados = resultados.filter(r => r.ok).length
    return NextResponse.json({ atualizados, falhas: resultados.filter(r => !r.ok), total: unicos.length })
}
