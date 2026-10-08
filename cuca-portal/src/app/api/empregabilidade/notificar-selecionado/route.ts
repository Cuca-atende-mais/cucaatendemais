import { NextResponse } from "next/server"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { avisoSelecionadoAtivo } from "@/lib/empregabilidade/status-candidatura"

// S16-05: Enviar WhatsApp ao candidato aprovado
// S-EMP-GES-01: exige sessão e permissão (AC16) e fica pausado por padrão (AC9 / D3) — o candidato
// fica como "selecionado" aguardando a empresa se comunicar.
export async function POST(request: Request) {
    const permissao = await exigirPermissao("empreg_banco_cv", "update")
    if (!permissao.ok) return permissao.resposta

    if (!avisoSelecionadoAtivo()) {
        console.info("[notificar-selecionado] Aviso ao candidato pausado (EMPREG_NOTIFICAR_SELECIONADO_ATIVO != true). Nada enviado.")
        return NextResponse.json({ ok: true, enviado: false, pausado: true })
    }

    try {
        const { candidatura_id, nome, titulo_vaga, unidade_cuca } = await request.json()

        if (!candidatura_id || !titulo_vaga || !unidade_cuca) {
            return NextResponse.json({ error: "Faltam parâmetros" }, { status: 400 })
        }

        const supabase = permissao.supabase

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

        const internalToken = process.env.WEBHOOK_INTERNAL_TOKEN
        if (!internalToken) {
            return NextResponse.json({ ok: false, motivo: "WEBHOOK_INTERNAL_TOKEN não configurado." })
        }

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
        const number = telLimpo.startsWith("55") ? telLimpo : `55${telLimpo}`

        const res = await fetch(`${workerUrl}/send-message/${internalToken}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ number, text: mensagem }),
        })

        if (!res.ok) {
            const err = await res.text()
            throw new Error(`Worker retornou erro: ${err}`)
        }

        return NextResponse.json({ ok: true, enviado: true })
    } catch (error: any) {
        console.error("Erro S16-05:", error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
}
