import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
    avaliarAcesso,
    PermissaoAcompanhamentoEnvios,
    ResultadoAutorizacao,
} from "@/app/api/configuracoes/acompanhamento-envios/logic"
import { validarCorpoReenvio } from "@/app/api/configuracoes/acompanhamento-envios/reenviar/logic"

const DEVELOPER_EMAILS = [
    "valmir@cucateste.com",
    "dev.cucaatendemais@gmail.com",
    "admin@cucadev.com.br",
]

// S-WM-59 (item 2): botão "Reenviar pendentes" — dispara envio real de WhatsApp, é uma
// ESCRITA (can_update), não leitura. Gatear em can_read (como a listagem) deixaria
// qualquer role com acesso de visualização acionar reenvios de verdade.
async function autorizar(
    supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ResultadoAutorizacao> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return avaliarAcesso(null, [], "can_update", DEVELOPER_EMAILS)
    if (DEVELOPER_EMAILS.includes(user.email ?? "")) return avaliarAcesso(user, [], "can_update", DEVELOPER_EMAILS)

    const { data: colab } = await supabase
        .from("colaboradores")
        .select("sys_roles(sys_permissions(module, can_read, can_update))")
        .eq("user_id", user.id)
        .single()

    const role = colab?.sys_roles as { sys_permissions?: PermissaoAcompanhamentoEnvios[] } | null
    return avaliarAcesso(user, role?.sys_permissions ?? [], "can_update", DEVELOPER_EMAILS)
}

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient()
        const acesso = await autorizar(supabase)
        if (!acesso.autorizado) {
            return NextResponse.json({ error: acesso.error }, { status: acesso.status })
        }

        const body = await req.json().catch(() => null)
        const validado = validarCorpoReenvio(body)
        if ("erro" in validado) {
            return NextResponse.json({ error: validado.erro }, { status: 400 })
        }

        const internalToken = process.env.WEBHOOK_INTERNAL_TOKEN
        if (!internalToken) {
            console.error("[acompanhamento-envios/reenviar] WEBHOOK_INTERNAL_TOKEN não configurado no portal")
            return NextResponse.json({ error: "Integração com o worker não configurada." }, { status: 500 })
        }

        const workerUrl = (process.env.WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL || "http://127.0.0.1:8000").replace(/\/$/, "")
        // S-WM-59: o worker responde de forma SÍNCRONA agora (claim atômico aguardado antes
        // de responder — ver worker/main.py) — 200 = retomada iniciada de verdade, 404/409
        // = erro real (item não existe / não está mais pausado / corrida perdida pra outra
        // chamada), não um 200 genérico que esconderia o resultado real.
        const resp = await fetch(
            `${workerUrl}/retomar-disparo/${validado.origem}/${encodeURIComponent(validado.item_id)}`,
            {
                method: "POST",
                headers: { "x-internal-token": internalToken },
            },
        )

        const texto = await resp.text()
        if (!resp.ok) {
            return NextResponse.json({ error: texto || "Falha ao acionar a retomada" }, { status: resp.status })
        }

        return NextResponse.json({ ok: true, worker: texto })
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro interno"
        console.error("[acompanhamento-envios/reenviar]", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
