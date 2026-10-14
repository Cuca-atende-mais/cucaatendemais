import type { EnviarTemplate } from "./feedback-solicitacao-servico"

// S-EMP-GES-02: envio de template pelo worker (/send-message), sem conversa_id — sai pelo número de
// Empregabilidade e volta com wamid, wa_id e o phone number id usado.

export const enviarPeloWorker: EnviarTemplate = async (numero, template, componentes) => {
    const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"
    const token = process.env.WEBHOOK_INTERNAL_TOKEN
    if (!token) return { ok: false, erro: "Integração com o worker não configurada (WEBHOOK_INTERNAL_TOKEN)." }
    try {
        const res = await fetch(`${workerUrl}/send-message/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ number: numero, template_name: template, components: componentes }),
        })
        const corpo = await res.json().catch(() => ({}))
        if (!res.ok) return { ok: false, erro: corpo?.error || `Worker respondeu ${res.status}.` }
        return { ok: true, wamid: corpo?.wamid ?? null, wa_id: corpo?.wa_id ?? null, origem_id: corpo?.origem_id ?? null }
    } catch (e) {
        console.error("[feedback] Erro ao chamar o worker:", e)
        return { ok: false, erro: "Não foi possível falar com o worker." }
    }
}
