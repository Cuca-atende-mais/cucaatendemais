import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { EPM_RELATORIO } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import {
    agruparLinhas,
    lerPeriodo,
    listarMeses,
    periodoAnterior,
    resolverEscopo,
    type LinhaRpc,
    type Unidade,
    type VagaDetalhe,
} from "@/lib/empregabilidade/relatorio"

// S-EMP-GES-04 (AC4, AC13): GET /api/empregabilidade/relatorio?inicio=AAAA-MM&fim=AAAA-MM&unidade=&exportar=1
// - exige sessão e epm_relatorio_ver; o escopo de unidade sai da permissão (epm_relatorio_rede) e do cadastro
//   do colaborador — o parâmetro `unidade` nunca amplia o escopo;
// - agrega no banco (RPC relatorio_emprega_mais, só service_role executa);
// - `exportar=1` exige epm_relatorio_exportar e devolve também o detalhe das vagas, usado só no Excel.

async function tem(supabase: SupabaseClient, recurso: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: "read" })
    return !error && data === true
}

export async function GET(request: NextRequest) {
    const permissao = await exigirPermissao(EPM_RELATORIO.ver)
    if (!permissao.ok) return permissao.resposta

    const params = request.nextUrl.searchParams
    const periodo = lerPeriodo(params.get("inicio"), params.get("fim"))
    if (!periodo.ok) return NextResponse.json({ error: periodo.erro }, { status: 400 })

    const exportar = params.get("exportar") === "1"
    const [temRede, temExportar] = await Promise.all([tem(permissao.supabase, EPM_RELATORIO.rede), tem(permissao.supabase, EPM_RELATORIO.exportar)])
    if (exportar && !temExportar) {
        return NextResponse.json({ error: "Sem permissão para baixar o relatório." }, { status: 403 })
    }

    const admin = createAdminClient()
    try {
        const [{ data: unidadesRaw, error: uErr }, { data: colab, error: cErr }] = await Promise.all([
            admin.from("unidades_cuca").select("id, nome").eq("ativo", true).order("nome"),
            admin.from("colaboradores").select("nome_completo, unidade_cuca").eq("user_id", permissao.user.id).maybeSingle(),
        ])
        if (uErr) throw uErr
        if (cErr) throw cErr
        const unidades = (unidadesRaw ?? []) as Unidade[]

        const escopo = resolverEscopo({
            temRede,
            unidadePedida: params.get("unidade"),
            unidadeDoColaborador: colab?.unidade_cuca ?? null,
            unidades,
        })
        if (!escopo.ok) return NextResponse.json({ error: escopo.erro }, { status: 403 })

        const anterior = periodoAnterior(periodo.inicio, periodo.fim)
        const rpc = (ini: string, fim: string) => admin.rpc("relatorio_emprega_mais", { p_inicio: `${ini}-01`, p_fim: `${fim}-01` })
        const [atual, ant] = await Promise.all([rpc(periodo.inicio, periodo.fim), rpc(anterior.inicio, anterior.fim)])
        if (atual.error) throw atual.error
        if (ant.error) throw ant.error

        let detalhe: VagaDetalhe[] | undefined
        if (exportar) {
            const { data, error } = await admin.rpc("relatorio_emprega_mais_detalhe", { p_inicio: `${periodo.inicio}-01`, p_fim: `${periodo.fim}-01` })
            if (error) throw error
            detalhe = ((data ?? []) as VagaDetalhe[])
                .filter(v => escopo.chaves.includes(v.unidade))
                .map(v => ({
                    numero_vaga: v.numero_vaga, titulo: v.titulo, empresa: v.empresa, tipo: v.tipo, unidade: v.unidade,
                    origem: v.origem, postos: v.postos, encaminhados: Number(v.encaminhados), criada_em: v.criada_em,
                }))
        }

        return NextResponse.json({
            periodo: { inicio: periodo.inicio, fim: periodo.fim, meses: periodo.meses },
            anterior: { ...anterior, meses: listarMeses(anterior.inicio, anterior.fim) },
            escopo: { rede: escopo.rede, selecionada: escopo.selecionada, chaves: escopo.chaves },
            unidades: escopo.rede ? unidades : unidades.filter(u => escopo.chaves.includes(u.id)),
            serie: agruparLinhas((atual.data ?? []) as LinhaRpc[], escopo),
            serieAnterior: agruparLinhas((ant.data ?? []) as LinhaRpc[], escopo),
            geradoPor: colab?.nome_completo || permissao.user.email || "",
            permissoes: { exportar: temExportar, rede: temRede },
            ...(detalhe ? { detalhe } : {}),
        })
    } catch (e) {
        console.error("[empregabilidade/relatorio] Erro:", e)
        return NextResponse.json({ error: "Erro ao montar o relatório." }, { status: 500 })
    }
}
