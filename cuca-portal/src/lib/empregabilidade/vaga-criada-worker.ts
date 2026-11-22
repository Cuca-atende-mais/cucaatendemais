// S-EMP-GES-12: avisa o worker no momento em que a empresa cria uma vaga/seleção pelo link.
//
// Antes, as rotas só gravavam `vaga_criada_id`/`vaga_numero`/`vaga_titulo` na conversa da
// empresa, e o worker só lia essa marcação enquanto a conversa estava esperando o formulário.
// Da 2ª vaga em diante pelo mesmo link (válido 48h), a marcação caía numa etapa que ninguém lia:
// nem a empresa recebia confirmação nem o transbordo era avisado. Agora a rota chama o worker
// (`POST /empregabilidade/vaga-criada`), que confirma e avisa na hora. Se a chamada falhar, a
// marcação é gravada como antes e o loop/caminho de resposta do worker entregam depois.

export const TIMEOUT_WORKER_VAGA_CRIADA_MS = 10_000

export type ResultadoAvisoVagaCriada = "worker" | "marcacao" | "sem_conversa" | "erro"

type VagaCriada = { id: string; numero_vaga: number | null; titulo: string }

// Cliente Supabase com chave de serviço, como as rotas já criam. Tipado de forma solta para
// aceitar o cliente real e os fakes dos testes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any

function urlDoWorker(): string {
    // Mesmo endereço usado pela rota do chat das atendentes (api/chat/send-message/route.ts).
    return (process.env.WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL || "").replace(/\/$/, "")
}

async function buscarConversaDaEmpresa(supabaseAdmin: SupabaseAdmin, empresaId: string) {
    const { data: conversas } = await supabaseAdmin
        .from("conversas")
        .select("id, metadata")
        .filter("metadata->empreg_fluxo->>empresa_id", "eq", empresaId)
        .in("status", ["ativa", "aberta"])
        .order("updated_at", { ascending: false })
        .limit(1)
    return conversas && conversas.length > 0 ? (conversas[0] as { id: string }) : null
}

async function gravarMarcacao(supabaseAdmin: SupabaseAdmin, conversaId: string, vaga: VagaCriada) {
    // Relê a conversa logo antes de gravar: o worker pode ter trocado a etapa enquanto a rota
    // esperava a resposta (timeout). Junta só os 3 campos da marcação ao empreg_fluxo atual,
    // nunca regrava o metadata lido antes da chamada.
    const { data: atual } = await supabaseAdmin
        .from("conversas")
        .select("metadata")
        .eq("id", conversaId)
        .single()
    const metadata = (atual?.metadata as Record<string, unknown>) || {}
    const empregFluxo = (metadata.empreg_fluxo as Record<string, unknown>) || {}
    await supabaseAdmin
        .from("conversas")
        .update({
            metadata: {
                ...metadata,
                empreg_fluxo: {
                    ...empregFluxo,
                    vaga_criada_id: vaga.id,
                    vaga_numero: vaga.numero_vaga,
                    vaga_titulo: vaga.titulo,
                },
            },
        })
        .eq("id", conversaId)
}

async function chamarWorker(vagaId: string, conversaId: string, token: string): Promise<{ ok: boolean; motivo: string }> {
    const url = urlDoWorker()
    if (!url) return { ok: false, motivo: "WORKER_URL não configurado" }
    const controle = new AbortController()
    const timer = setTimeout(() => controle.abort(), TIMEOUT_WORKER_VAGA_CRIADA_MS)
    try {
        const res = await fetch(`${url}/empregabilidade/vaga-criada`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-token": token },
            body: JSON.stringify({ vaga_id: vagaId, conversa_id: conversaId }),
            signal: controle.signal,
        })
        return res.ok ? { ok: true, motivo: "" } : { ok: false, motivo: `worker respondeu ${res.status}` }
    } catch (err) {
        const abortado = err instanceof Error && err.name === "AbortError"
        return { ok: false, motivo: abortado ? "timeout" : `erro de rede: ${err instanceof Error ? err.message : String(err)}` }
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Chamado pelas rotas de criação **só quando o pedido veio com link assinado** (formulário da
 * empresa). Nunca lança exceção: a criação da vaga já aconteceu e a resposta ao formulário
 * não pode depender deste aviso.
 *
 * - sem conversa ativa/aberta da empresa → nada (como antes; D2 fora de escopo);
 * - worker respondeu 2xx → não grava marcação (evita envio em dobro pelo loop);
 * - qualquer falha (sem token, sem URL, resposta não-2xx inclusive 404, timeout, rede) →
 *   grava a marcação como antes, relendo a conversa antes de gravar.
 */
export async function avisarWorkerVagaCriada(
    supabaseAdmin: SupabaseAdmin,
    empresaId: string,
    vaga: VagaCriada,
    rota: string,
): Promise<ResultadoAvisoVagaCriada> {
    try {
        const conversa = await buscarConversaDaEmpresa(supabaseAdmin, empresaId)
        if (!conversa) return "sem_conversa"

        const token = process.env.WEBHOOK_INTERNAL_TOKEN
        if (!token) {
            console.error(`[${rota}] WEBHOOK_INTERNAL_TOKEN não configurado no portal — gravando a marcação na conversa`)
            await gravarMarcacao(supabaseAdmin, conversa.id, vaga)
            return "marcacao"
        }

        const resultado = await chamarWorker(vaga.id, conversa.id, token)
        if (resultado.ok) return "worker"

        console.warn(`[${rota}] Aviso ao worker falhou (${resultado.motivo}) — gravando a marcação na conversa ${conversa.id}, vaga ${vaga.id}`)
        await gravarMarcacao(supabaseAdmin, conversa.id, vaga)
        return "marcacao"
    } catch (err) {
        console.warn(`[${rota}] Erro ao avisar o worker da vaga ${vaga.id}:`, err)
        return "erro"
    }
}
