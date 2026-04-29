import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"

// OCR pode demorar até 5 min para lotes maiores
export const maxDuration = 300

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    // SOL-06: aceita x-internal-token (Worker Python) OU sessão de usuário autenticado (Portal)
    const internalTokenHeader = request.headers.get("x-internal-token")
    const expectedToken = process.env.WEBHOOK_INTERNAL_TOKEN

    const isWorkerRequest = expectedToken && internalTokenHeader === expectedToken

    if (!isWorkerRequest) {
        const supabaseAuth = await createServerClient()
        const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
        }
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { id: vagaId } = await params
    const body = await request.json().catch(() => ({}))
    const quantidade: number = Math.max(1, Math.min(Number(body.quantidade) || 5, 50))
    // IDs de candidatos TB já exibidos no frontend (enviados pelo cliente)
    const excluirIdsCliente: string[] = Array.isArray(body.excluir_ids) ? body.excluir_ids : []
    // S37B-06: filtros demográficos enviados pelo frontend
    const filtros: Record<string, unknown> = (body.filtros && typeof body.filtros === "object") ? body.filtros : {}

    try {
        const { data: vaga, error: vagaErr } = await supabase
            .from("vagas")
            .select("titulo, descricao, requisitos, escolaridade_minima, tipo_contrato, setor, tipo, cargos_lista")
            .eq("id", vagaId)
            .single()

        if (vagaErr || !vaga) {
            return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 })
        }

        // Buscar telefones de candidatos já inscritos nesta vaga (via candidaturas)
        // Regra: lock é por vaga — exclui apenas status != 'rejeitado'.
        // Candidatos rejeitados voltam a aparecer para a mesma vaga.
        const { data: candidaturasExistentes } = await supabase
            .from("candidaturas")
            .select("telefone")
            .eq("vaga_id", vagaId)
            .neq("status", "rejeitado")
            .not("telefone", "is", null)

        const normalizar = (tel: string) => tel.replace(/\D/g, "")

        // Telefones normalizados (só dígitos) dos já inscritos — enviados ao worker para exclusão por fone
        const telefonesInscritos = (candidaturasExistentes || [])
            .map((c: any) => normalizar(c.telefone || ""))
            .filter(Boolean)

        // IDs a excluir: apenas os enviados pelo cliente (já exibidos)
        // A exclusão por telefone é feita pelo worker via telefones_inscritos
        const excluirIds = Array.from(new Set([...excluirIdsCliente]))

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
                telefones_inscritos: telefonesInscritos,
                filtros,
            }),
            signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!res.ok) {
            const err = await res.text()
            throw new Error(`Worker retornou erro (${res.status}): ${err.slice(0, 200)}`)
        }

        const contentType = res.headers.get("content-type") || ""
        if (!contentType.includes("application/json")) {
            const txt = await res.text()
            throw new Error(`Worker retornou resposta não-JSON (${contentType}): ${txt.slice(0, 200)}`)
        }

        const data = await res.json()
        return NextResponse.json({ candidatos: data.candidatos || [] })
    } catch (err: any) {
        console.error("[triar-banco-talentos] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno." }, { status: 500 })
    }
}
