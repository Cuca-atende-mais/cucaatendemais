import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // IMPORTANT: Avoid writing any logic between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make it very hard to debug
    // issues with users being randomly logged out.

    const {
        data: { user },
    } = await supabase.auth.getUser()

    const { pathname } = request.nextUrl

    // SQS-51 (A6): rotas públicas explícitas em /empregabilidade/*.
    // Antes: pathname.startsWith('/empregabilidade') liberava também o dashboard
    // interno (Route Group `(dashboard)`), expondo banco-talentos, candidatos,
    // criar-curriculo etc. sem auth e disparando RLS no talent_bank.
    // ATENÇÃO: só entram aqui rotas que precisam ser acessadas por gente de fora
    // (candidato, empresa) via link assinado. Currículo NÃO é uma delas — ver abaixo.
    const publicEmpregabilidadePrefixes = [
        '/empregabilidade/vagas',         // página pública de listagem/visualização externa
        '/empregabilidade/candidatura',   // formulário público de candidatura
        '/empregabilidade/selecao',       // página pública de seleção/evento
    ]
    // 2026-08-05 — `/empregabilidade/print` REMOVIDO desta whitelist.
    // Estava público por engano: a impressão de currículo só é acionada de dentro
    // do dashboard (lista e editor de Criar Currículo), nunca por link externo —
    // o mecanismo de link assinado (EMPREGABILIDADE_LINK_SECRET) cobre apenas
    // vagas/candidatura/seleção. Deixá-la pública, somada à policy `USING (true)`
    // da tabela `curriculos`, expunha dados pessoais de candidatos a qualquer
    // pessoa na internet. Ver docs/qa/DIAGNOSTICO-exposicao-anon-curriculos-2026-08-05.md.
    const isPublicEmpregabilidade = publicEmpregabilidadePrefixes.some(p =>
        pathname === p || pathname.startsWith(p + '/')
    )

    const isPublicPath =
        pathname === '/login' ||
        pathname.startsWith('/auth') ||
        pathname.startsWith('/setup-senha') ||
        pathname === '/api/colaboradores/setup-password' ||
        pathname === '/api/upload-cv' ||               // upload de currículo por candidatos externos
        pathname === '/api/process-cv' ||              // OCR disparado pelo formulário público
        isPublicEmpregabilidade ||                     // páginas públicas específicas (whitelist)
        pathname.startsWith('/vagas') ||               // páginas públicas de vagas
        pathname.startsWith('/api/empregabilidade') || // APIs públicas de empregabilidade
        pathname === '/api/academia-enem/webhook/auctaflux' || // webhook BSP (máquina-a-máquina, sem sessão; valida HMAC internamente)
        pathname.startsWith('/feedback-empresa')        // formulário público de feedback para empresas

    // Usuário não autenticado tentando acessar rota protegida
    if (!user && !isPublicPath) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // Usuário autenticado tentando acessar login ou raiz → vai pro dashboard
    if (user && (pathname === '/login' || pathname === '/')) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
    }

    // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
    // creating a new response object with NextResponse.next() make sure to:
    // 1. Pass the request in it, like so:
    //    const myNewResponse = NextResponse.next({ request })
    // 2. Copy over the cookies, like so:
    //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
    // 3. Change the myNewResponse object to fit your needs, but avoid changing
    //    the cookies!
    // 4. Finally:
    //    return myNewResponse
    // If this is not done, you may be causing the browser and server to go out
    // of sync and terminate the user's session prematurely!

    return supabaseResponse
}
