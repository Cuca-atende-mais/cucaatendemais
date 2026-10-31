import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { PLA_INDIC } from "@/lib/rbac/catalogo-planejamento"
import { ANO_PLANEJAMENTO } from "@/lib/planejamento/projeto"
import { carregarSetores, carregarSetoresPermitidos } from "@/lib/planejamento/projeto-dados"
import {
    agregarIndicadores, aplicarFiltrosIndicadores, filtrosIndicadoresDaUrl, lerProjetoIndicador,
} from "@/lib/planejamento/indicadores"

// S-PLA-08 (AC1, AC8, AC9, AC10): GET /api/planejamento/indicadores?setor=&status=&situacao=&tipo=&exportar=1
// - exige sessão e `pla_indic_ver`; `exportar=1` exige também `pla_indic_exportar` e devolve a lista de
//   projetos, usada só na planilha;
// - o escopo de setor é calculado aqui, com a função da S-PLA-01 (`pla_pode_atuar_setor`) no cliente do
//   próprio usuário (ela lê o usuário logado): sem setor marcado no cadastro, todos; com setores, só eles.
//   O `setor=` do endereço só estreita, nunca amplia;
// - os fatos por projeto vêm da função `pla_indicadores_projetos` (só o cliente de serviço executa), já
//   limitados ao escopo; as contas são feitas aqui. O navegador recebe só os números.

async function tem(supabase: SupabaseClient, recurso: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: "read" })
    return !error && data === true
}

export async function GET(request: NextRequest) {
    const permissao = await exigirPermissao(PLA_INDIC.ver)
    if (!permissao.ok) return permissao.resposta

    const exportar = request.nextUrl.searchParams.get("exportar") === "1"
    const temExportar = await tem(permissao.supabase, PLA_INDIC.exportar)
    if (exportar && !temExportar) {
        return NextResponse.json({ error: "Sem permissão para exportar a planilha dos indicadores." }, { status: 403 })
    }

    try {
        const todos = await carregarSetores(permissao.supabase)
        const escopo = await carregarSetoresPermitidos(permissao.supabase, todos)
        if (escopo.length === 0) {
            return NextResponse.json({
                error: "Seu usuário não está ligado a nenhum setor do Planejamento (falta o cadastro de colaborador). Peça o ajuste a quem administra os cadastros.",
            }, { status: 403 })
        }
        const idsEscopo = escopo.map(s => s.id)
        const filtros = filtrosIndicadoresDaUrl(request.nextUrl.searchParams, idsEscopo)

        const { data, error } = await createAdminClient().rpc("pla_indicadores_projetos", { p_ano: ANO_PLANEJAMENTO, p_setores: idsEscopo })
        if (error) throw error
        const brutos = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
        // Redundância de propósito: mesmo que a função devolvesse algo fora do escopo, aqui não passa.
        const projetos = brutos.map(lerProjetoIndicador).filter(p => idsEscopo.includes(p.setor_id))
        const filtrados = aplicarFiltrosIndicadores(projetos, filtros)
        const visiveis = filtros.setor ? [filtros.setor] : idsEscopo

        return NextResponse.json({
            ano: ANO_PLANEJAMENTO,
            setores: escopo,
            filtros,
            indicadores: agregarIndicadores(filtrados, visiveis),
            permissoes: { exportar: temExportar },
            ...(exportar ? { projetos: filtrados } : {}),
        })
    } catch (e) {
        console.error("[planejamento/indicadores] Erro:", e)
        return NextResponse.json({ error: "Não foi possível montar os indicadores." }, { status: 500 })
    }
}
