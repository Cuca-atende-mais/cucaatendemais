import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST(request: NextRequest) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    try {
        const body = await request.json()
        const {
            empresa_id, titulo, descricao, requisitos,
            tipo_contrato, salario, total_vagas, escolaridade_minima,
            beneficios, limite_curriculos, tipo_selecao, unidade_cuca,
        } = body

        if (!empresa_id || !titulo || !descricao || !tipo_contrato) {
            return NextResponse.json({ error: "Campos obrigatórios ausentes." }, { status: 400 })
        }

        // Verificar se empresa existe e está ativa
        const { data: empresa, error: empErr } = await supabaseAdmin
            .from("empresas")
            .select("id")
            .eq("id", empresa_id)
            .eq("ativa", true)
            .single()

        if (empErr || !empresa) {
            return NextResponse.json({ error: "Empresa não encontrada ou inativa." }, { status: 404 })
        }

        // Calcular número sequencial da vaga para esta empresa
        const { data: maxData } = await supabaseAdmin
            .from("vagas")
            .select("numero_vaga")
            .eq("empresa_id", empresa_id)
            .order("numero_vaga", { ascending: false })
            .limit(1)
            .maybeSingle()

        const numero_vaga = ((maxData?.numero_vaga ?? 0) as number) + 1

        const { data, error } = await supabaseAdmin
            .from("vagas")
            .insert({
                empresa_id,
                titulo,
                descricao,
                requisitos: requisitos || null,
                tipo_contrato,
                salario: salario || null,
                total_vagas: parseInt(total_vagas) || 1,
                escolaridade_minima: escolaridade_minima || null,
                beneficios: beneficios || null,
                limite_curriculos: limite_curriculos ? parseInt(limite_curriculos) : null,
                tipo_selecao: tipo_selecao || null,
                unidade_cuca: unidade_cuca || null,
                numero_vaga,
                status: "pre_cadastro",
            })
            .select("id, titulo, numero_vaga")
            .single()

        if (error) throw error

        // Notificar o worker: buscar conversa da empresa e registrar vaga_criada_id no metadata
        try {
            const { data: conversas } = await supabaseAdmin
                .from("conversas")
                .select("id, metadata")
                .filter("metadata->empreg_fluxo->empresa_id", "eq", empresa_id)
                .in("status", ["ativa", "aberta"])
                .order("updated_at", { ascending: false })
                .limit(1)

            if (conversas && conversas.length > 0) {
                const conversa = conversas[0]
                const metadata = conversa.metadata || {}
                const empreg_fluxo = metadata.empreg_fluxo || {}
                metadata.empreg_fluxo = {
                    ...empreg_fluxo,
                    vaga_criada_id: data.id,
                    vaga_numero: data.numero_vaga,
                    vaga_titulo: data.titulo,
                }
                await supabaseAdmin
                    .from("conversas")
                    .update({ metadata })
                    .eq("id", conversa.id)
            }
        } catch (notifyErr) {
            // Não bloqueia o retorno — o worker reprocessará na próxima mensagem
            console.warn("[vagas/route] Erro ao notificar worker:", notifyErr)
        }

        return NextResponse.json({ id: data.id, numero_vaga: data.numero_vaga })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 })
    }
}
