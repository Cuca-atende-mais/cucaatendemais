import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { mapearErroSalvarRascunho } from "@/lib/programacao/rascunho"

// S-PROG-09 (item 1): grava um rascunho já existente SEM apagar a campanha — ao contrário de
// `POST /api/programacao/importar`, que resolve conflito de mês/unidade apagando e recriando
// (destrutivo: apaga campanha_historico inteiro via CASCADE e troca o campanha_id, quebrando
// documentos_rag.metadados->>'campanha_id', lido por buscarAtividadeDeterministica no
// motor-agente). Toda a lógica de substituição atômica está na função Postgres
// `programacao_salvar_rascunho` (uma chamada de função = uma transação) — a rota só autentica,
// checa permissão e traduz o erro.
interface AtividadePayload {
    titulo: string
    categoria: string | null
    descricao?: string | null
    local?: string | null
    data_atividade?: string | null
    hora_inicio?: string | null
    hora_fim?: string | null
    unidade_cuca: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any> | null
}

export async function PATCH(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authErr } = await supabase.auth.getUser()

        if (authErr || !user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        const { data: permOk } = await supabase
            .rpc("has_permission", { p_recurso: "programacao", p_acao: "update" })

        if (!permOk) {
            return NextResponse.json({ error: "Sem permissão para editar programação" }, { status: 403 })
        }

        const body = await req.json()
        const { campanha_id, titulo, atividades } = body as {
            campanha_id: string
            titulo: string
            atividades: AtividadePayload[]
        }

        if (!campanha_id || !titulo || !Array.isArray(atividades) || atividades.length === 0) {
            return NextResponse.json(
                { error: "campanha_id, titulo e ao menos uma atividade são obrigatórios" },
                { status: 400 },
            )
        }

        const { data, error } = await supabase.rpc("programacao_salvar_rascunho", {
            p_campanha_id: campanha_id,
            p_titulo: titulo,
            p_atividades: atividades,
        })

        if (error) {
            const { status, error: mensagem } = mapearErroSalvarRascunho(error)
            return NextResponse.json({ error: mensagem }, { status })
        }

        const resultado = Array.isArray(data) ? data[0] : data
        return NextResponse.json({ campanha_id: resultado?.campanha_id, total_atividades: resultado?.total_atividades })

    } catch (e) {
        console.error("[programacao/rascunho]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
