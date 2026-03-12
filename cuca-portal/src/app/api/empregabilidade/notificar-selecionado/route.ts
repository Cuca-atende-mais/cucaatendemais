import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// S16-05: Enviar WhatsApp ao candidato aprovado
export async function POST(request: Request) {
    try {
        const { candidatura_id, nome, titulo_vaga, unidade_cuca } = await request.json()

        if (!candidatura_id || !titulo_vaga || !unidade_cuca) {
            return NextResponse.json({ error: "Faltam parâmetros" }, { status: 400 })
        }

        const supabase = await createClient()

        // S29-08: busca telefone e nome diretamente do banco para garantir dado mais atualizado (pode ter sido preenchido pelo OCR)
        const { data: cand } = await supabase
            .from("candidaturas")
            .select("telefone, nome")
            .eq("id", candidatura_id)
            .single()

        const telefone = cand?.telefone
        const nomeAtual = cand?.nome || nome

        if (!telefone) {
            return NextResponse.json({ ok: false, motivo: "Candidato sem telefone cadastrado." })
        }

        // Busca instância Institucional ativa para a unidade
        const { data: instancias } = await supabase
            .from("instancias_uazapi")
            .select("nome, token")
            .eq("unidade_cuca", unidade_cuca)
            .eq("canal_tipo", "Institucional")
            .eq("ativa", true)
            .limit(1)

        if (!instancias || instancias.length === 0) {
            return NextResponse.json({ ok: false, motivo: "Nenhuma instância institucional ativa para esta unidade." })
        }

        const { nome: instNome, token } = instancias[0]
        const primeiroNome = nomeAtual?.split(" ")?.[0] || "Candidato"
        const mensagem = `Olá ${primeiroNome}! 🎉\n\nSua candidatura para a vaga de *${titulo_vaga}* foi aprovada pela equipe do CUCA Atende Mais.\n\nSeu currículo foi encaminhado para a empresa parceira. Fique atento ao seu WhatsApp — em breve você receberá o contato para a próxima etapa. Boa sorte! 💪`

        const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"
        const telLimpo = telefone.replace(/\D/g, "")

        const res = await fetch(`${workerUrl}/send-message/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phone: telLimpo.startsWith("55") ? telLimpo : `55${telLimpo}`,
                message: mensagem,
            }),
        })

        if (!res.ok) {
            const err = await res.text()
            throw new Error(`Worker retornou erro: ${err}`)
        }

        return NextResponse.json({ ok: true })
    } catch (error: any) {
        console.error("Erro S16-05:", error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
}
