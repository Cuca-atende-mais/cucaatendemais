import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// OCR pode demorar até 5 min para lotes maiores
export const maxDuration = 300

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { id: vagaId } = await params
    const body = await request.json().catch(() => ({}))
    const quantidade: number = Math.max(1, Math.min(Number(body.quantidade) || 5, 50))
    // IDs de candidatos TB já exibidos no frontend (enviados pelo cliente)
    const excluirIdsCliente: string[] = Array.isArray(body.excluir_ids) ? body.excluir_ids : []

    try {
        const { data: vaga, error: vagaErr } = await supabase
            .from("vagas")
            .select("titulo, descricao, requisitos, escolaridade_minima, tipo_contrato, setor")
            .eq("id", vagaId)
            .single()

        if (vagaErr || !vaga) {
            return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 })
        }

        // Buscar telefones de candidatos já inscritos nesta vaga (via candidaturas)
        // e encontrar seus IDs no talent_bank para excluir da varredura
        const { data: candidaturasExistentes } = await supabase
            .from("candidaturas")
            .select("telefone")
            .eq("vaga_id", vagaId)
            .not("telefone", "is", null)

        const telefonesInscritos = (candidaturasExistentes || [])
            .map((c: any) => c.telefone)
            .filter(Boolean)

        let excluirIdsTB: string[] = []
        if (telefonesInscritos.length > 0) {
            const { data: tbJaInscritos } = await supabase
                .from("talent_bank")
                .select("id")
                .in("telefone", telefonesInscritos)
            excluirIdsTB = (tbJaInscritos || []).map((r: any) => r.id)
        }

        // Consolidar IDs a excluir: já mostrados no frontend + já inscritos na vaga
        const excluirIds = Array.from(new Set([...excluirIdsCliente, ...excluirIdsTB]))

        const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"
        console.log(`[triar-banco-talentos] vagaId=${vagaId} quantidade=${quantidade} excluindo=${excluirIds.length} candidatos`)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000)
        const res = await fetch(`${workerUrl}/triar-banco-talentos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                vaga_id: vagaId,
                quantidade,
                setor_vaga: (vaga as any).setor || [],
                excluir_ids: excluirIds,
            }),
            signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!res.ok) {
            const err = await res.text()
            throw new Error(`Worker retornou erro: ${err}`)
        }

        const data = await res.json()
        return NextResponse.json({ candidatos: data.candidatos || [] })
    } catch (err: any) {
        console.error("[triar-banco-talentos] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno." }, { status: 500 })
    }
}
