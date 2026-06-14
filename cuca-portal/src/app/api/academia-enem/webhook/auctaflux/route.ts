import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import {
    verificarAssinatura, extrairEventos, normalizarTelefone,
    type EventoMeta,
} from "@/lib/auctaflux/webhook"

// Webhook da AuctaFlux (eventos reencaminhados da Meta). Camada PRÓPRIA do módulo (ae_conversas/ae_mensagens);
// não toca conversas/mensagens do uazapi. Rota isenta de auth no middleware (máquina-a-máquina).
//
// SEGURANÇA: a persistência em ae_conversas/ae_mensagens SÓ ocorre com HMAC válido — nunca gravamos
// dado não verificado (o endpoint é público). A captura (ae_webhook_capturas) retém SEMPRE o cru+headers,
// então confirmamos o esquema e podemos reprocessar sem precisar gravar lixo.
// `AE_WEBHOOK_HMAC_ENFORCE` controla só a RESPOSTA a assinatura inválida:
//   - 'true' (após confirmar o esquema): responde 401 e descarta (AC#4).
//   - default (pré-confirmação): responde 200 (para o provedor continuar enviando enquanto confirmamos
//     o esquema pela captura), mas mesmo assim NÃO persiste enquanto não validar.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Resolve a ae_instancia do evento: por phone_number_id (quando o número está conectado);
// senão, cai na única instância ativa (caso atual: 1 instância).
async function resolverInstancia(
    admin: SupabaseClient,
    phoneNumberId: string | null,
): Promise<string | null> {
    if (phoneNumberId) {
        const { data } = await admin
            .from("ae_instancias")
            .select("id")
            .eq("phone_number_id", phoneNumberId)
            .limit(1)
            .maybeSingle()
        if (data?.id) return data.id as string
    }
    const { data: ativa } = await admin
        .from("ae_instancias")
        .select("id")
        .eq("ativa", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
    return (ativa?.id as string | undefined) ?? null
}

// Casa o telefone com um lead existente (leads.telefone é misto com/sem DDI 55).
async function acharLeadId(admin: SupabaseClient, waContact: string): Promise<string | null> {
    const variantes = new Set<string>([waContact])
    if (waContact.startsWith("55")) variantes.add(waContact.slice(2))
    const { data } = await admin.from("leads").select("id, telefone").in("telefone", [...variantes])
    for (const l of data ?? []) {
        if (normalizarTelefone(l.telefone) === waContact) return l.id as string
    }
    return null
}

async function getOrCreateConversa(
    admin: SupabaseClient,
    instanciaId: string,
    waContact: string,
    pushName: string | null,
): Promise<string | null> {
    const sel = () => admin
        .from("ae_conversas")
        .select("id, lead_id")
        .eq("ae_instancia_id", instanciaId)
        .eq("wa_contact", waContact)
        .maybeSingle()

    const { data: existente } = await sel()
    if (existente?.id) {
        // Backfill do lead_id se ainda não vinculado.
        if (!existente.lead_id) {
            const leadId = await acharLeadId(admin, waContact)
            if (leadId) await admin.from("ae_conversas").update({ lead_id: leadId }).eq("id", existente.id)
        }
        return existente.id as string
    }

    const leadId = await acharLeadId(admin, waContact)
    const { data: novo, error } = await admin
        .from("ae_conversas")
        .insert({ ae_instancia_id: instanciaId, wa_contact: waContact, push_name: pushName, lead_id: leadId, status: "ativa", estado: "novo" })
        .select("id")
        .maybeSingle()
    if (error) {
        // Corrida (UNIQUE ae_instancia_id,wa_contact): re-seleciona.
        const { data: again } = await sel()
        return (again?.id as string | undefined) ?? null
    }
    return (novo?.id as string | undefined) ?? null
}

async function persistirEvento(admin: SupabaseClient, ev: EventoMeta): Promise<number> {
    const instanciaId = await resolverInstancia(admin, ev.phone_number_id)
    if (!instanciaId) return 0

    let processados = 0

    // Agrupa mensagens por contato (normalizado).
    const porContato = new Map<string, typeof ev.mensagens>()
    for (const m of ev.mensagens) {
        const wa = normalizarTelefone(m.from)
        if (!porContato.has(wa)) porContato.set(wa, [])
        porContato.get(wa)!.push(m)
    }

    for (const [waContact, msgs] of porContato) {
        const pushName = msgs.find(m => m.push_name)?.push_name ?? null
        const conversaId = await getOrCreateConversa(admin, instanciaId, waContact, pushName)
        if (!conversaId) continue

        const rows = msgs.map(m => ({
            ae_conversa_id: conversaId,
            wa_message_id: m.wa_message_id,
            remetente: "lead",
            tipo: m.tipo,
            conteudo: m.conteudo,
            metadata: { timestamp: m.timestamp },
        }))
        // Idempotência por wa_message_id: só conta o que foi realmente inserido.
        const { data: inseridas } = await admin
            .from("ae_mensagens")
            .upsert(rows, { onConflict: "wa_message_id", ignoreDuplicates: true })
            .select("id")
        const novos = inseridas?.length ?? 0
        processados += novos
        if (novos === 0) continue

        // Atualiza agregados da conversa (timestamp do último, janela de 24h, não lidas).
        const ts = msgs.map(m => (m.timestamp ? Number(m.timestamp) * 1000 : Date.now()))
        const ultima = new Date(Math.max(...ts)).toISOString()
        const { data: conv } = await admin.from("ae_conversas").select("nao_lidas").eq("id", conversaId).maybeSingle()
        await admin.from("ae_conversas").update({
            ultima_mensagem_em: ultima,
            ultima_entrada_em: ultima,
            nao_lidas: (conv?.nao_lidas ?? 0) + novos,
            ...(pushName ? { push_name: pushName } : {}),
            updated_at: new Date().toISOString(),
        }).eq("id", conversaId)
    }

    // Status de entrega/leitura das NOSSAS mensagens enviadas (best-effort).
    for (const s of ev.statuses) {
        await admin.from("ae_mensagens").update({ status: s.status }).eq("wa_message_id", s.wa_message_id)
    }

    return processados
}

export async function POST(req: NextRequest) {
    const admin = createAdminClient()
    const raw = await req.text().catch(() => "")
    const headers = Object.fromEntries(req.headers.entries())
    const url = req.nextUrl.pathname + (req.nextUrl.search || "")

    // Resolve o forward_secret: env primeiro, senão o da instância ativa.
    let secret = process.env.AUCTAFLUX_FORWARD_SECRET || null
    if (!secret) {
        const { data } = await admin
            .from("ae_instancias")
            .select("forward_secret")
            .eq("ativa", true)
            .not("forward_secret", "is", null)
            .limit(1)
            .maybeSingle()
        secret = (data?.forward_secret as string | undefined) ?? null
    }

    const hmac = verificarAssinatura(raw, secret, headers)
    const enforce = process.env.AE_WEBHOOK_HMAC_ENFORCE === "true"

    // Captura sempre (retém headers+corpo cru + resultado HMAC) — confirma o esquema no 1º evento real.
    try {
        await admin.from("ae_webhook_capturas").insert({
            metodo: "POST",
            url,
            headers: { ...headers, _hmac_resultado: JSON.stringify(hmac) },
            corpo: raw,
        })
    } catch (e) {
        console.error("[AE webhook] falha ao gravar captura:", e)
    }

    // Persistência exige HMAC válido (não gravar dado não verificado nas tabelas reais).
    if (!hmac.verificada) {
        // enforce: descarta com 401 (AC#4). Pré-confirmação: 200 para o provedor seguir enviando,
        // mas sem persistir (a captura acima já guardou o cru para confirmarmos o esquema).
        if (enforce) return NextResponse.json({ error: "assinatura inválida" }, { status: 401 })
        return NextResponse.json({ ok: true, processados: 0, verificada: false, hmac: hmac.esquema })
    }

    let processados = 0
    try {
        let body: unknown = null
        try { body = raw ? JSON.parse(raw) : null } catch { body = null }
        const eventos = extrairEventos(body)
        for (const ev of eventos) processados += await persistirEvento(admin, ev)
    } catch (e) {
        console.error("[AE webhook] erro ao processar evento:", e)
        // 200 mesmo assim: já capturamos o cru; não queremos reenfileiramento infinito da AuctaFlux.
    }

    return NextResponse.json({ ok: true, processados, verificada: true, hmac: hmac.esquema })
}

// GET de verificação (handshake): ecoa hub.challenge se vier; captura para diagnóstico.
export async function GET(req: NextRequest) {
    const admin = createAdminClient()
    const headers = Object.fromEntries(req.headers.entries())
    const url = req.nextUrl.pathname + (req.nextUrl.search || "")
    try {
        await admin.from("ae_webhook_capturas").insert({ metodo: "GET", url, headers, corpo: "" })
    } catch { /* best-effort */ }

    const challenge = req.nextUrl.searchParams.get("hub.challenge")
    if (challenge) return new NextResponse(challenge, { status: 200 })
    return NextResponse.json({ ok: true, mode: "capture+process" })
}
