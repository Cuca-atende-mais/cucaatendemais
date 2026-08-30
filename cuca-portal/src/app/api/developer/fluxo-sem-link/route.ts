import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// S-EMP-FSL-01: interruptor do fluxo do candidato 100% no WhatsApp (sem link). Guardado em
// `system_config.chave='empreg_fluxo_sem_link'`. Só o developer pode ler/alterar — mesmo padrão
// server-side das telas Meta do menu Developer (meta-phone-numbers/route.ts): checagem por e-mail
// no servidor, não só o gate client-side do layout. Defesa em profundidade contra "ligar sem
// querer" (o próprio risco ALTO da story).
const DEVELOPER_EMAILS = [
    "valmir@cucateste.com",
    "dev.cucaatendemais@gmail.com",
    "admin@cucadev.com.br",
]

const CHAVE = "empreg_fluxo_sem_link"
// Espelha a leitura fail-closed do worker (empregabilidade_engine._fluxo_sem_link_ativo): só
// valores explicitamente verdadeiros contam como ligado.
const VALORES_LIGADOS = new Set(["true", "1", "on", "sim"])

function ehLigado(valor: string | null | undefined): boolean {
    return VALORES_LIGADOS.has(String(valor ?? "").trim().toLowerCase())
}

async function assertDeveloper(): Promise<string | null> {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return null
    if (!DEVELOPER_EMAILS.includes(user.email ?? "")) return null
    return user.email!
}

export async function GET() {
    const email = await assertDeveloper()
    if (!email) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
        .from("system_config")
        .select("valor")
        .eq("chave", CHAVE)
        .maybeSingle()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Linha ausente → desligado (fail-safe, igual ao worker).
    return NextResponse.json({ ativo: ehLigado(data?.valor) })
}

export async function POST(req: NextRequest) {
    const email = await assertDeveloper()
    if (!email) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    if (typeof body?.ativo !== "boolean") {
        return NextResponse.json({ error: "Campo 'ativo' (boolean) é obrigatório." }, { status: 400 })
    }

    const valor = body.ativo ? "true" : "false"
    const admin = createAdminClient()
    // Upsert: robusto mesmo se a migration não tiver rodado ainda no ambiente.
    const { error } = await admin
        .from("system_config")
        .upsert(
            { chave: CHAVE, valor, updated_at: new Date().toISOString() },
            { onConflict: "chave" },
        )

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ativo: body.ativo })
}
