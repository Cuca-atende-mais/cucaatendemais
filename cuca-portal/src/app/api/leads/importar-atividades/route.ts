import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * POST /api/leads/importar-atividades
 *
 * Importação em batch de atividades de leads via API da Prefeitura.
 * Suporta offset para retomar importação após timeout sem duplicar dados.
 *
 * Body: {
 *   registros: Array<{
 *     telefone: string
 *     nome?: string
 *     data_nascimento?: string   // YYYY-MM-DD
 *     equipamento: string        // Ex: "CUCA BARRA"
 *     atividade: string          // Ex: "NATAÇÃO"
 *     contagem?: number          // default 1
 *   }>
 *   offset?: number              // Para retomar batch após timeout
 * }
 *
 * Response: {
 *   processados: number
 *   erros: number
 *   proximo_offset: number | null   // null = concluído
 *   detalhes_erros?: string[]
 * }
 */
export async function POST(request: NextRequest) {
    const supabase = await createClient()

    // Verificar autenticação
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    let body: any
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
    }

    const { registros, offset = 0 } = body

    if (!Array.isArray(registros) || registros.length === 0) {
        return NextResponse.json({ error: "Campo 'registros' deve ser um array não vazio" }, { status: 400 })
    }

    // Processar em batch de 100 por vez para evitar timeout
    const BATCH_SIZE = 100
    const inicio = offset
    const fim = Math.min(inicio + BATCH_SIZE, registros.length)
    const lote = registros.slice(inicio, fim)

    let processados = 0
    const erros: string[] = []

    for (const reg of lote) {
        try {
            if (!reg.telefone?.trim()) {
                erros.push(`Registro sem telefone: ${JSON.stringify(reg)}`)
                continue
            }

            const telefone = reg.telefone.trim()
            const equipamento = (reg.equipamento ?? "").trim().toUpperCase()
            const atividade = (reg.atividade ?? "").trim().toUpperCase()
            const contagem = Number(reg.contagem) || 1

            if (!equipamento || !atividade) {
                erros.push(`Telefone ${telefone}: equipamento ou atividade vazio`)
                continue
            }

            // 1. UPSERT no lead (conflict: telefone)
            const { data: leadData, error: leadError } = await supabase
                .from("leads")
                .upsert(
                    {
                        telefone,
                        nome: reg.nome?.trim() || undefined,
                        data_nascimento: reg.data_nascimento || undefined,
                        opt_in: true,
                        bloqueado: false,
                        equipamentos_principais: [],
                        atividades_principais: [],
                    },
                    { onConflict: "telefone", ignoreDuplicates: false }
                )
                .select("id")
                .single()

            if (leadError) {
                erros.push(`Telefone ${telefone}: ${leadError.message}`)
                continue
            }

            const leadId = leadData.id

            // 2. UPSERT em lead_atividades (conflict: lead_id + equipamento + atividade → incrementa contagem)
            const { error: atividadeError } = await supabase.rpc("upsert_lead_atividade", {
                p_lead_id: leadId,
                p_equipamento: equipamento,
                p_atividade: atividade,
                p_contagem: contagem,
            })

            if (atividadeError) {
                // Fallback: insert direto se RPC não existir ainda
                const { error: insertError } = await supabase
                    .from("lead_atividades")
                    .upsert(
                        { lead_id: leadId, equipamento, atividade, contagem },
                        { onConflict: "lead_id,equipamento,atividade" }
                    )
                if (insertError) {
                    erros.push(`Telefone ${telefone} atividade: ${insertError.message}`)
                    continue
                }
            }

            processados++
        } catch (err: any) {
            erros.push(`Erro inesperado: ${err.message}`)
        }
    }

    const proximo_offset = fim < registros.length ? fim : null

    return NextResponse.json({
        processados,
        erros: erros.length,
        proximo_offset,
        total_registros: registros.length,
        ...(erros.length > 0 && { detalhes_erros: erros.slice(0, 20) }),
    })
}
