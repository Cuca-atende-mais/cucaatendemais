import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { PGP } from "@/lib/rbac/catalogo-programacao-pontual"
import { opcaoLiberada } from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"
import { eventoEditavel, lerDadosEventoPontual } from "@/lib/programacao/pontual"

// S-PROG-17: editar evento pontual pelo servidor. Exige "Editar evento", o evento e a unidade nova ao
// alcance de quem pede, e status antes do disparo. O status não muda aqui.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

        const acesso = await carregarAcessoPgm(user)
        if (!opcaoLiberada(acesso.checar, PGP.editar)) {
            return NextResponse.json({ error: "Sem permissão para editar evento pontual" }, { status: 403 })
        }

        const admin = createAdminClient()
        const { data: evento, error: evErr } = await admin
            .from("eventos_pontuais")
            .select("id, unidade_cuca, status")
            .eq("id", id)
            .maybeSingle()
        if (evErr) throw new Error(evErr.message)
        // Chave de serviço ignora a política de leitura por unidade: outra unidade responde 404.
        if (!evento || !acesso.alcancaUnidade(evento.unidade_cuca as string | null)) {
            return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 })
        }
        if (!eventoEditavel(evento.status as string)) {
            return NextResponse.json({ error: "Evento só pode ser editado antes do disparo" }, { status: 422 })
        }

        const lido = lerDadosEventoPontual(await req.json())
        if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 })
        if (!acesso.alcancaUnidade(lido.dados.unidade_cuca)) {
            return NextResponse.json({ error: "Sem permissão para mover o evento para esta unidade" }, { status: 403 })
        }

        // Condicional ao status lido: se o evento foi disparado nesse meio tempo, não altera.
        const { data: alterado, error } = await admin
            .from("eventos_pontuais")
            .update(lido.dados)
            .eq("id", id)
            .eq("status", evento.status as string)
            .select("id")
        if (error) throw new Error(error.message)
        if (!alterado?.length) {
            return NextResponse.json({ error: "O evento mudou de status. Atualize a lista e tente de novo." }, { status: 409 })
        }

        return NextResponse.json({ ok: true })
    } catch (e) {
        console.error("[programacao/pontual PATCH]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
