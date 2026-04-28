// SQS-49: Endpoint exclusivo para criação de Processo Seletivo por Evento (selecao_evento)
// Validações propositalmente mais simples que /vagas — formulário simplificado.
// NÃO altera nem conflita com /api/empregabilidade/vagas/route.ts
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
            empresa_id,
            unidade_cuca,       // null quando "todas as unidades"
            cargos_lista,       // array: [{titulo, quantidade, faixa_etaria}]
            datas_selecao,      // array: [{data, hora}]
            email_responsavel,
            telefone_responsavel,
        } = body

        if (!empresa_id) {
            return NextResponse.json({ error: "empresa_id é obrigatório." }, { status: 400 })
        }
        if (!cargos_lista || !Array.isArray(cargos_lista) || cargos_lista.length === 0) {
            return NextResponse.json({ error: "É necessário informar ao menos um cargo." }, { status: 400 })
        }
        if (!datas_selecao || !Array.isArray(datas_selecao) || datas_selecao.length === 0) {
            return NextResponse.json({ error: "É necessário informar ao menos uma data de seleção." }, { status: 400 })
        }

        const { data: empresa, error: empErr } = await supabaseAdmin
            .from("empresas")
            .select("id, nome, nome_fantasia")
            .eq("id", empresa_id)
            .eq("ativa", true)
            .single()

        if (empErr || !empresa) {
            return NextResponse.json({ error: "Empresa não encontrada ou inativa." }, { status: 404 })
        }

        // Número sequencial atômico (mesma função do fluxo de vagas normais)
        const { data: seqData, error: seqError } = await supabaseAdmin.rpc("next_numero_vaga")
        if (seqError) throw new Error("Erro ao gerar número de vaga: " + seqError.message)
        const numero_vaga = seqData as number

        const nomeEmpresa = empresa.nome_fantasia || empresa.nome
        // Primeira data para o título automático
        const primeiraData = datas_selecao[0]
        const titulo = `Processo Seletivo — ${nomeEmpresa}`

        const { data, error } = await supabaseAdmin
            .from("vagas")
            .insert({
                empresa_id,
                titulo,
                descricao: cargos_lista.map((c: any) => `${c.titulo}${c.quantidade ? ` (${c.quantidade})` : ""}`).join(", "),
                requisitos: null,
                tipo_contrato: "a_definir",
                tipo: "selecao_evento",
                cargos_lista,
                datas_selecao,
                faixa_etaria: cargos_lista[0]?.faixa_etaria || "A partir de 14 anos",
                unidade_cuca: unidade_cuca || null,
                // Seleções por evento são sempre visíveis para toda a rede
                unidade_destino: "global",
                numero_vaga,
                status: "pre_cadastro",
                setor: [],
                email_responsavel: email_responsavel || null,
                email_contato_empresa: email_responsavel || null,
                telefone_responsavel: telefone_responsavel || null,
                pcd_vaga: false,
                total_vagas: cargos_lista.reduce((acc: number, c: any) => acc + (parseInt(c.quantidade) || 1), 0),
            })
            .select("id, titulo, numero_vaga")
            .single()

        if (error) throw error

        // Notificar worker via metadata da conversa (mesmo mecanismo de vagas normais)
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
            console.warn("[selecao/route] Erro ao notificar worker:", notifyErr)
        }

        return NextResponse.json({ id: data.id, numero_vaga: data.numero_vaga })
    } catch (err: any) {
        console.error("[selecao/route] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 })
    }
}
