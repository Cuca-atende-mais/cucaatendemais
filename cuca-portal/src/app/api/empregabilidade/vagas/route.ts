import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { verificarLinkParams } from "@/lib/empregabilidade/link-assinado"
import { validarDataSelecaoPrevista } from "@/lib/empregabilidade/data-selecao-prevista"
import { avisarWorkerVagaCriada } from "@/lib/empregabilidade/vaga-criada-worker"
import { validarUnidadesNoServidor } from "@/lib/empregabilidade/unidades-vaga"

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
            unidade_destino, unidade_tratamento,
            setor, email_responsavel, telefone_responsavel,
            pcd_vaga, pcd_tipo, pcd_homologado,
            data_selecao_prevista,
            link_params,
        } = body

        if (!empresa_id || !titulo || !descricao || !tipo_contrato) {
            return NextResponse.json({ error: "Campos obrigatórios ausentes: empresa_id, titulo, descricao e tipo_contrato são obrigatórios." }, { status: 400 })
        }
        const linkOk = verificarLinkParams(link_params, { empresa_id })
        if (!linkOk.valido) {
            return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 403 })
        }
        // S-EMP-GES-13 (AC10): Unidade de Tratamento (unidade específica) e Unidade de Currículos
        // (unidade_destino: Toda a Rede ou unidade) obrigatórias, com as mesmas frases da tela.
        const unidades = await validarUnidadesNoServidor(
            { tratamento: unidade_tratamento, curriculos: unidade_destino },
            async (ids) => {
                const { data: ativas, error: uErr } = await supabaseAdmin
                    .from("unidades_cuca").select("id").eq("ativo", true).in("id", ids)
                if (uErr) throw uErr
                return (ativas ?? []).map(u => u.id as string)
            },
        )
        if (!unidades.ok) {
            return NextResponse.json({ error: unidades.erro }, { status: 400 })
        }
        if (!Array.isArray(setor) || setor.length === 0) {
            return NextResponse.json({ error: "Campo obrigatório ausente: setor deve ser um array com pelo menos uma categoria." }, { status: 400 })
        }
        // S-EMP-AUD-042: validação SEMPRE no servidor também — rota pública, protegida só pelo
        // link assinado; o `required` do formulário é contornável enviando o POST direto.
        const dataSelecaoValidada = validarDataSelecaoPrevista(data_selecao_prevista)
        if (!dataSelecaoValidada.ok) {
            return NextResponse.json({ error: dataSelecaoValidada.erro }, { status: 400 })
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
                // O banco copia o nome da Unidade de Tratamento para unidade_cuca (S-EMP-GES-13).
                unidade_cuca: unidade_cuca || null,
                unidade_destino: unidades.curriculos,
                unidade_tratamento: unidades.tratamento,
                numero_vaga,
                status: "pre_cadastro",
                data_selecao_prevista: dataSelecaoValidada.valor,
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

        // S-EMP-GES-12: avisa o worker na hora (confirmação à empresa + aviso ao transbordo),
        // para cada vaga criada pelo link — inclusive da 2ª em diante. Se falhar, grava a
        // marcação na conversa como antes. Nunca lança: a resposta ao formulário não depende disso.
        await avisarWorkerVagaCriada(
            supabaseAdmin, empresa_id,
            { id: data.id, numero_vaga: data.numero_vaga, titulo: data.titulo },
            "vagas/route",
        )

        return NextResponse.json({ id: data.id, numero_vaga: data.numero_vaga })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 })
    }
}
