import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const {
            empresa_id, titulo, descricao, requisitos,
            tipo_contrato, salario, total_vagas, escolaridade_minima,
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
                status: "pre_cadastro",
            })
            .select("id")
            .single()

        if (error) throw error

        return NextResponse.json({ id: data.id })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 })
    }
}
