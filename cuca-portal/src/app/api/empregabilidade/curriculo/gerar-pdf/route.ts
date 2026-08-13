import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { gerarEArmazenarPdfCurriculo } from "@/lib/empregabilidade/curriculo-pdf-service"
import type { CvDados } from "@/lib/empregabilidade/curriculo-tipos"

// SQS-57 (T3/T5/T6) — gera e armazena o PDF de um currículo estruturado.
// Chamada por: (1) o salvamento do "Criar Currículo" logo após
// salvar_curriculo_estruturado (AC1), e (2) o botão manual "Gerar PDF" do
// Banco de Talentos para os currículos legados sem arquivo (AC8).
//
// SQS-58: esta rota nao precisa ser publica. O formulario publico chama o
// servico de PDF internamente apos validar link/telefone/rate-limit; aqui fica
// somente o fluxo autenticado do dashboard.
export async function POST(request: NextRequest) {
    const authClient = await createServerClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: "Não autenticado." }, { status: 401 })
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        const { talent_id } = await request.json()

        if (!talent_id) {
            return NextResponse.json({ error: "talent_id é obrigatório." }, { status: 400 })
        }

        const { data: talent, error: talentErr } = await supabase
            .from("talent_bank")
            .select("nome, telefone, curriculo_estruturado")
            .eq("id", talent_id)
            .single()

        if (talentErr || !talent) {
            return NextResponse.json({ error: "Candidato não encontrado." }, { status: 404 })
        }

        const { data: curriculo } = await supabase
            .from("curriculos")
            .select("dados")
            .eq("talent_id", talent_id)
            .is("deleted_at", null)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle()

        // Fallback: currículos legados podem ter sido gravados só em
        // talent_bank.curriculo_estruturado (mesma origem, mesmo formato).
        const dadosBase = (curriculo?.dados || talent.curriculo_estruturado) as Partial<CvDados> | null

        if (!dadosBase || Object.keys(dadosBase).length === 0) {
            return NextResponse.json(
                { error: "Este candidato ainda não tem currículo estruturado preenchido." },
                { status: 400 }
            )
        }

        const dados: CvDados = {
            nome: talent.nome,
            telefone: talent.telefone || "",
            endereco: "", email: "", linkedin: "", portfolio: "",
            apresentacao: "", objetivo: "",
            experiencias: [], formacoes: [], cursos: [], habilidades: [],
            ...dadosBase,
        }

        const resultado = await gerarEArmazenarPdfCurriculo(supabase, talent_id, dados)

        return NextResponse.json({ url: resultado.url })
    } catch (err: unknown) {
        console.error("[curriculo/gerar-pdf] Erro:", err)
        const message = err instanceof Error ? err.message : "Erro ao gerar PDF do currículo."
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
