import { NextRequest, NextResponse } from "next/server"
import { createAdminClient as createClient } from "@/lib/supabase/admin"

/**
 * TASK 4.3: API de Convocação de Candidatos
 * Dispara convite via WhatsApp e atualiza status no banco.
 */
export async function POST(req: NextRequest) {
    try {
        const supabase = createClient()
        const { candidatura_id, data_entrevista, hora_entrevista, local_entrevista, tipo_local } = await req.json()

        if (!candidatura_id || !data_entrevista || !hora_entrevista || !local_entrevista) {
            return NextResponse.json({ error: "Faltam parâmetros obrigatórios" }, { status: 400 })
        }

        // 1. Buscar detalhes da candidatura e vaga
        const { data: cand, error: candErr } = await supabase
            .from("candidaturas")
            .select(`
                id, 
                nome, 
                telefone, 
                vaga_id,
                vagas (
                    id,
                    titulo,
                    unidade_cuca,
                    coleta_curriculo
                )
            `)
            .eq("id", candidatura_id)
            .single()

        if (candErr || !cand) {
            return NextResponse.json({ error: "Candidatura não encontrada" }, { status: 404 })
        }

        const vaga = (cand as any).vagas
        const telefone = cand.telefone
        const unidade = vaga.unidade_cuca

        // SQS-56 (AC15): convite de entrevista fica desativado para seleções
        // sem coleta de currículo — bloqueio no servidor, não só na UI.
        if (vaga.coleta_curriculo === false) {
            return NextResponse.json(
                { error: "Esta seleção não coleta currículo — convite de entrevista está desativado para ela." },
                { status: 403 }
            )
        }

        if (!telefone) {
            return NextResponse.json({ error: "Candidato sem telefone cadastrado" }, { status: 400 })
        }

        // 2. Atualizar status e detalhes da entrevista no banco
        const { error: updateErr } = await supabase
            .from("candidaturas")
            .update({
                status: "convite_enviado",
                data_entrevista,
                hora_entrevista,
                local_entrevista,
                // Nota: colunas tipo_local_entrevista e endereco_entrevista estão na tabela 'vagas'
                // mas os detalhes específicos do CANDIDATO ficam em candidaturas (Ação 1.2 do plano)
            })
            .eq("id", candidatura_id)

        if (updateErr) throw updateErr

        // 4. Preparar mensagem
        const dataFmt = new Date(data_entrevista + 'T12:00:00').toLocaleDateString('pt-BR')
        const mensagem = `Olá ${cand.nome.split(" ")[0]}! 👋\n\nBoas notícias! Você foi selecionado para uma entrevista na vaga de *${vaga.titulo}*.\n\n📅 *Data:* ${dataFmt}\n🕒 *Horário:* ${hora_entrevista}\n📍 *Local:* ${local_entrevista}\n\nPodemos confirmar sua presença?\n\nResponda:\n1 - Sim, confirmo minha presença\n2 - Não poderei comparecer\n3 - Tenho uma dúvida`

        // 5. Disparar via Worker -> UAZAPI
        const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"
        const telLimpo = telefone.replace(/\D/g, "")
        const phoneFmt = telLimpo.startsWith("55") ? telLimpo : `55${telLimpo}`

        const res = await fetch(`${workerUrl}/send-message/${process.env.WEBHOOK_INTERNAL_TOKEN}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ number: phoneFmt, text: mensagem }),
        })

        if (!res.ok) {
            const errLog = await res.text()
            console.error("[Convocar] Erro no worker:", errLog)
            throw new Error("Falha ao disparar mensagem via WhatsApp")
        }

        return NextResponse.json({ success: true })

    } catch (error: any) {
        console.error("[Convocar] Erro:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
