import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST(request: NextRequest) {
    // Rota pública: acesso via link gerado pelo worker (empresa_id validado abaixo)
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    try {
        const body = await request.json()
        const {
            empresa_id, titulo, descricao, requisitos,
            tipo_contrato, salario, total_vagas, escolaridade_minima,
            faixa_etaria, carga_horaria, local, local_entrevista,
            beneficios, limite_curriculos, tipo_selecao, unidade_cuca,
            unidade_destino,
            setor, email_responsavel, telefone_responsavel,
            pcd_vaga, pcd_tipo, pcd_homologado,
        } = body

        if (!empresa_id || !titulo || !descricao || !tipo_contrato) {
            return NextResponse.json({ error: "Campos obrigatórios ausentes: empresa_id, titulo, descricao e tipo_contrato são obrigatórios." }, { status: 400 })
        }
        if (!unidade_destino) {
            return NextResponse.json({ error: "Campo obrigatório ausente: unidade_destino não pode ser nulo ou vazio." }, { status: 400 })
        }
        if (!Array.isArray(setor) || setor.length === 0) {
            return NextResponse.json({ error: "Campo obrigatório ausente: setor deve ser um array com pelo menos uma categoria." }, { status: 400 })
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

        // Número sequencial atômico — evita race condition com múltiplos requests simultâneos
        const { data: seqData, error: seqError } = await supabaseAdmin.rpc("next_numero_vaga")
        if (seqError) throw new Error("Erro ao gerar número de vaga: " + seqError.message)
        const numero_vaga = seqData as number

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
                faixa_etaria: faixa_etaria || "15 a 29 anos",
                carga_horaria: carga_horaria || null,
                local: local || null,
                local_entrevista: local_entrevista || "na_empresa",
                beneficios: beneficios || null,
                limite_curriculos: limite_curriculos ? parseInt(limite_curriculos) : null,
                tipo_selecao: tipo_selecao || null,
                unidade_cuca: unidade_cuca || null,
                unidade_destino: unidade_destino,
                numero_vaga,
                status: "pre_cadastro",
                setor: setor,
                email_responsavel: email_responsavel || null,
                email_contato_empresa: email_responsavel || null,
                telefone_responsavel: telefone_responsavel || null,
                pcd_vaga: pcd_vaga ?? false,
                pcd_tipo: pcd_tipo || null,
                pcd_homologado: pcd_homologado ?? false,
            })
            .select("id, titulo, numero_vaga")
            .single()

        if (error) throw error

        // Notificar o worker: buscar conversa da empresa e registrar vaga_criada_id no metadata
        try {
            const { data: conversas } = await supabaseAdmin
                .from("conversas")
                .select("id, metadata")
                .filter("metadata->empreg_fluxo->>empresa_id", "eq", empresa_id)
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
