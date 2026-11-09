import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { EPM_SITUACAO_VAGAS } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import { CHAVE_REDE, resolverEscopo, type Unidade } from "@/lib/empregabilidade/relatorio"
import {
    contarEnviadosPorVaga,
    montarLinha,
    ordenarPorCadastro,
    rotuloUnidade,
    type CandidaturaEnviada,
    type VagaAberta,
} from "@/lib/empregabilidade/relatorio-situacao-vagas"

// S-EMP-GES-09 (AC7, AC8): GET /api/empregabilidade/relatorio/situacao-vagas?unidade=
// - exige sessão e epm_vagas_abertas_ver; o escopo de unidade sai de epm_vagas_abertas_rede e do cadastro do
//   colaborador, pela mesma regra do Relatório mensal — o parâmetro `unidade` nunca amplia o escopo;
// - só lê; devolve contagens, nunca nome, telefone ou outro dado de candidato.

const PAGINA = 1000

async function tem(supabase: SupabaseClient, recurso: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: "read" })
    return !error && data === true
}

/** Lê todas as candidaturas já enviadas à empresa das vagas pedidas, em páginas (o PostgREST corta em 1000). */
async function lerEnviadas(admin: SupabaseClient, vagaIds: string[]): Promise<CandidaturaEnviada[]> {
    if (vagaIds.length === 0) return []
    const todas: CandidaturaEnviada[] = []
    for (let de = 0; ; de += PAGINA) {
        const { data, error } = await admin
            .from("candidaturas")
            .select("id, vaga_id, observacoes")
            .in("vaga_id", vagaIds)
            .not("email_enviado_em", "is", null)
            .order("id")
            .range(de, de + PAGINA - 1)
        if (error) throw error
        const lote = (data ?? []) as (CandidaturaEnviada & { id: string })[]
        todas.push(...lote.map(c => ({ vaga_id: c.vaga_id, observacoes: c.observacoes })))
        if (lote.length < PAGINA) return todas
    }
}

interface VagaBanco {
    id: string
    tipo: string | null
    titulo: string | null
    empresa_id: string | null
    created_at: string
    liberada_em: string | null
    liberada_por: string | null
    data_selecao_prevista: string | null
    datas_selecao: unknown
}

export async function GET(request: NextRequest) {
    const permissao = await exigirPermissao(EPM_SITUACAO_VAGAS.ver)
    if (!permissao.ok) return permissao.resposta

    const temRede = await tem(permissao.supabase, EPM_SITUACAO_VAGAS.rede)
    const admin = createAdminClient()

    try {
        const [{ data: unidadesRaw, error: uErr }, { data: colab, error: cErr }] = await Promise.all([
            admin.from("unidades_cuca").select("id, nome").eq("ativo", true).order("nome"),
            admin.from("colaboradores").select("unidade_cuca").eq("user_id", permissao.user.id).maybeSingle(),
        ])
        if (uErr) throw uErr
        if (cErr) throw cErr
        const unidades = (unidadesRaw ?? []) as Unidade[]

        const escopo = resolverEscopo({
            temRede,
            unidadePedida: request.nextUrl.searchParams.get("unidade"),
            unidadeDoColaborador: colab?.unidade_cuca ?? null,
            unidades,
        })
        if (!escopo.ok) return NextResponse.json({ error: escopo.erro }, { status: 403 })

        const { data: vagasRaw, error: vErr } = await admin
            .from("vagas")
            .select("id, tipo, titulo, empresa_id, created_at, liberada_em, liberada_por, data_selecao_prevista, datas_selecao")
            .eq("status", "aberta")
        if (vErr) throw vErr
        const vagas = (vagasRaw ?? []) as VagaBanco[]
        const ids = vagas.map(v => v.id)

        // Unidade de cada vaga pela regra do GES-04 (quem liberou → destino → base → rede).
        const { data: unidadesVagas, error: uvErr } = ids.length
            ? await admin.rpc("emp_relatorio_unidade_vagas").in("vaga_id", ids)
            : { data: [], error: null }
        if (uvErr) throw uvErr
        // Unidade que não está entre as ativas (inativada, ou nome antigo) conta como Rede: assim o filtro e o
        // rótulo concordam, e a vaga não some do "Todas".
        const ativas = new Set(unidades.map(u => u.id))
        const unidadeDaVaga = new Map<string, string>(
            ((unidadesVagas ?? []) as { vaga_id: string; unidade: string }[])
                .map(u => [u.vaga_id, ativas.has(u.unidade) ? u.unidade : CHAVE_REDE]),
        )

        const noEscopo = vagas.filter(v => escopo.chaves.includes(unidadeDaVaga.get(v.id) ?? CHAVE_REDE))

        const empresaIds = [...new Set(noEscopo.map(v => v.empresa_id).filter((x): x is string => !!x))]
        const colaboradorIds = [...new Set(noEscopo.map(v => v.liberada_por).filter((x): x is string => !!x))]
        const vagasNormais = noEscopo.filter(v => v.tipo !== "selecao_evento").map(v => v.id)

        const [empresasRes, colaboradoresRes, enviadas] = await Promise.all([
            empresaIds.length ? admin.from("empresas").select("id, nome").in("id", empresaIds) : Promise.resolve({ data: [], error: null }),
            colaboradorIds.length ? admin.from("colaboradores").select("id, email").in("id", colaboradorIds) : Promise.resolve({ data: [], error: null }),
            lerEnviadas(admin, vagasNormais),
        ])
        if (empresasRes.error) throw empresasRes.error
        if (colaboradoresRes.error) throw colaboradoresRes.error

        const nomeEmpresa = new Map(((empresasRes.data ?? []) as { id: string; nome: string | null }[]).map(e => [e.id, e.nome]))
        const emailColaborador = new Map(((colaboradoresRes.data ?? []) as { id: string; email: string | null }[]).map(c => [c.id, c.email]))
        const enviadosPorVaga = contarEnviadosPorVaga(enviadas)

        const agora = new Date()
        const linhas = ordenarPorCadastro(noEscopo.map(v => {
            const vaga: VagaAberta = {
                id: v.id,
                tipo: v.tipo,
                titulo: v.titulo,
                empresa: v.empresa_id ? nomeEmpresa.get(v.empresa_id) ?? null : null,
                created_at: v.created_at,
                liberada_em: v.liberada_em,
                liberada_por_email: v.liberada_por ? emailColaborador.get(v.liberada_por) ?? null : null,
                data_selecao_prevista: v.data_selecao_prevista,
                datas_selecao: v.datas_selecao,
            }
            return montarLinha({
                vaga,
                unidadeNome: rotuloUnidade(unidadeDaVaga.get(v.id), unidades),
                enviados: enviadosPorVaga.get(v.id),
                agora,
            })
        }))

        return NextResponse.json({
            escopo: { rede: escopo.rede, selecionada: escopo.selecionada },
            unidades: escopo.rede ? unidades : unidades.filter(u => escopo.chaves.includes(u.id)),
            linhas,
        })
    } catch (e) {
        console.error("[empregabilidade/relatorio/situacao-vagas] Erro:", e)
        return NextResponse.json({ error: "Erro ao montar o relatório." }, { status: 500 })
    }
}
