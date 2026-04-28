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

        // S29-08: busca telefone, nome e cargo diretamente do banco (pode ter sido preenchido pelo OCR)
        const { data: cand } = await supabase
            .from("candidaturas")
            .select("telefone, nome, cargo_escolhido, vaga_id")
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

        // SQS-49: buscar tipo da vaga para diferenciar mensagem de seleção por evento
        let vagaTipo = "vaga_normal"
        let vagaDatasSelecao: any[] = []
        if (cand?.vaga_id) {
            const { data: vagaData } = await supabase
                .from("vagas")
                .select("tipo, datas_selecao")
                .eq("id", cand.vaga_id)
                .single()
            vagaTipo = vagaData?.tipo || "vaga_normal"
            vagaDatasSelecao = vagaData?.datas_selecao || []
        }

        let mensagem: string
        if (vagaTipo === "selecao_evento") {
            // Mensagem simplificada para processo seletivo por evento
            const cargoTxt = cand?.cargo_escolhido ? ` para o cargo de *${cand.cargo_escolhido}*` : ""
            const datasTxt = vagaDatasSelecao.length > 0
                ? vagaDatasSelecao.map((d: any) => `📅 ${d.data} às ${d.hora}`).join("\n")
                : "📅 Data a confirmar com a equipe CUCA"
            mensagem = `Olá ${primeiroNome}! 🎉\n\nSeu currículo foi *selecionado*${cargoTxt} para entrevista no processo seletivo da *${titulo_vaga || unidade_cuca}*!\n\n${datasTxt}\n\nPor favor, *confirme sua presença* respondendo:\n✅ *SIM* — Vou comparecer\n❌ *NÃO* — Não poderei ir\n\nAguardamos sua confirmação! 💪`
        } else {
            // Mensagem padrão para vaga normal (comportamento anterior intacto)
            mensagem = `Olá ${primeiroNome}! 🎉\n\nSua candidatura para a vaga de *${titulo_vaga}* foi aprovada pela equipe do CUCA Atende Mais.\n\nSeu currículo foi encaminhado para a empresa parceira. Fique atento ao seu WhatsApp — em breve você receberá o contato para a próxima etapa. Boa sorte! 💪`
        }

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
