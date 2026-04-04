import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"

const DEVELOPER_EMAILS = ["valmir@cucateste.com", "dev.cucaatendemais@gmail.com"]

// 10 macro-categorias oficiais de empregabilidade do CUCA
// Correspondem às AREAS usadas no Banco de Talentos e nos filtros do portal
const CATEGORIAS_EMPREGABILIDADE = [
    { nome: "Comércio e Vendas",        icone: "🛒", ordem: 10 },
    { nome: "Administrativo",           icone: "🏢", ordem: 11 },
    { nome: "Logística e Entregas",     icone: "🚚", ordem: 12 },
    { nome: "Serviços Gerais",          icone: "🔧", ordem: 13 },
    { nome: "Alimentação",              icone: "🍽️", ordem: 14 },
    { nome: "Criativo / Digital",       icone: "🎨", ordem: 15 },
    { nome: "Construção Civil",         icone: "🏗️", ordem: 16 },
    { nome: "Tecnologia",               icone: "💻", ordem: 17 },
    { nome: "Beleza e Estética",        icone: "✂️", ordem: 18 },
    { nome: "Cuidados Pessoais",        icone: "💛", ordem: 19 },
]

export async function POST(request: NextRequest) {
    // Valida que o solicitante é um desenvolvedor autenticado
    const serverClient = await createServerClient()
    const { data: { user }, error: authError } = await serverClient.auth.getUser()

    if (authError || !user || !DEVELOPER_EMAILS.includes(user.email ?? "")) {
        return NextResponse.json(
            { error: "Acesso negado. Apenas desenvolvedores podem executar seeds." },
            { status: 403 }
        )
    }

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const resultados: { nome: string; acao: "inserida" | "ja_existe" | "erro"; detalhe?: string }[] = []

    for (const cat of CATEGORIAS_EMPREGABILIDADE) {
        // Verifica se já existe (evita duplicatas em re-execuções)
        const { data: existente } = await supabaseAdmin
            .from("categorias_interesse")
            .select("id")
            .eq("nome", cat.nome)
            .is("pai_id", null)
            .maybeSingle()

        if (existente) {
            resultados.push({ nome: cat.nome, acao: "ja_existe" })
            continue
        }

        const { error } = await supabaseAdmin
            .from("categorias_interesse")
            .insert({
                nome: cat.nome,
                icone: cat.icone,
                ordem: cat.ordem,
                ativo: true,
                pai_id: null,
            })

        if (error) {
            resultados.push({ nome: cat.nome, acao: "erro", detalhe: error.message })
        } else {
            resultados.push({ nome: cat.nome, acao: "inserida" })
        }
    }

    const inseridas = resultados.filter(r => r.acao === "inserida").length
    const jaExistem = resultados.filter(r => r.acao === "ja_existe").length
    const erros = resultados.filter(r => r.acao === "erro").length

    return NextResponse.json({
        sucesso: erros === 0,
        resumo: `${inseridas} inseridas, ${jaExistem} já existiam, ${erros} erros`,
        resultados,
    })
}
