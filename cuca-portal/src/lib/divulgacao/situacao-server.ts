import { createAdminClient } from "@/lib/supabase/admin"
import { unidadesCuca } from "@/lib/constants"
import { slugDaCategoria } from "@/lib/programacao/permissoes-categoria"
import {
    estadoRag, mesPermitido, mesVigente, mesesPermitidos, nivel1Unidade, resumoNiveis,
    type DocDaCampanha, type MesAno, type UnidadeSituacao,
} from "./niveis"

// S-PROG-15: situação da Divulgação calculada no servidor, com a chave de serviço. Quem dispara não tem
// permissão de categoria nem de RAG e leria zero linhas pelas tabelas; aqui só saem contagens e status.

async function contarChunks(documentoId: string): Promise<number> {
    const admin = createAdminClient()
    const { count, error } = await admin
        .from("chunks_documentos")
        .select("id", { count: "exact", head: true })
        .eq("documento_id", documentoId)
    if (error) throw error
    return count ?? 0
}

export async function carregarVigente(hoje = new Date()) {
    const admin = createAdminClient()
    const { data: docs, error } = await admin
        .from("documentos_rag")
        .select("unidade_cuca, metadados")
        .eq("tipo", "monthly_program")
        .eq("ativo", true)
    if (error) throw error

    const idsCampanha = (docs ?? []).map(d => (d.metadados as { campanha_id?: string } | null)?.campanha_id).filter(Boolean) as string[]
    const { data: campanhas, error: errCamp } = idsCampanha.length
        ? await admin.from("campanhas_mensais").select("id, mes, ano").in("id", idsCampanha)
        : { data: [], error: null }
    if (errCamp) throw errCamp

    const ativos = (docs ?? []).map(d => {
        const camp = campanhas?.find(c => c.id === (d.metadados as { campanha_id?: string } | null)?.campanha_id)
        return { unidade: d.unidade_cuca as string, mes: camp?.mes ?? null, ano: camp?.ano ?? null }
    })
    const { vigente, foraDeSincronia } = mesVigente(ativos, unidadesCuca, hoje)
    return { vigente, foraDeSincronia, permitidos: mesesPermitidos(vigente) }
}

export async function carregarSituacaoDivulgacao(selecionado: MesAno | null, agora = new Date()) {
    const admin = createAdminClient()
    const { vigente, foraDeSincronia, permitidos } = await carregarVigente(agora)
    const mes = selecionado ?? vigente

    const { data: campanhas, error: errCamp } = await admin
        .from("campanhas_mensais")
        .select("id, unidade_cuca, status, total_atividades, updated_at")
        .eq("mes", mes.mes)
        .eq("ano", mes.ano)
    if (errCamp) throw errCamp

    const ids = (campanhas ?? []).map(c => c.id)
    const [{ data: atividades, error: errAtv }, { data: statusCats, error: errSt }, { data: docs, error: errDocs }] = ids.length
        ? await Promise.all([
            admin.from("atividades_mensais").select("campanha_id, categoria").in("campanha_id", ids),
            admin.from("campanha_categoria_status").select("campanha_id, categoria, status").in("campanha_id", ids),
            admin.from("documentos_rag").select("id, ativo, created_at, metadados").eq("tipo", "monthly_program")
                .in("metadados->>campanha_id", ids),
        ])
        : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
    if (errAtv) throw errAtv
    if (errSt) throw errSt
    if (errDocs) throw errDocs

    const docsComChunks = await Promise.all((docs ?? []).map(async d => ({
        campanhaId: (d.metadados as { campanha_id?: string } | null)?.campanha_id ?? null,
        doc: { ativo: d.ativo === true, chunks: await contarChunks(d.id), criadoEm: d.created_at as string } satisfies DocDaCampanha,
    })))

    const unidades: UnidadeSituacao[] = unidadesCuca.map(unidade => {
        const camp = campanhas?.find(c => c.unidade_cuca === unidade) ?? null
        const slugsComAtividade = new Set(
            (atividades ?? []).filter(a => a.campanha_id === camp?.id).map(a => slugDaCategoria(a.categoria)).filter(Boolean),
        )
        const categorias = (statusCats ?? [])
            .filter(s => s.campanha_id === camp?.id && slugsComAtividade.has(slugDaCategoria(s.categoria)))
            .map(s => ({ categoria: s.categoria as string, status: s.status as string }))
        const n1 = nivel1Unidade(camp?.status ?? null, categorias)
        return {
            unidade,
            campanhaId: camp?.id ?? null,
            statusCampanha: camp?.status ?? null,
            categorias,
            nivel1: n1.ok,
            faltando: n1.faltando,
            rag: camp
                ? estadoRag(camp.status, docsComChunks.filter(d => d.campanhaId === camp.id).map(d => d.doc), agora)
                : "nao_aprovado",
        }
    })

    return {
        vigente,
        foraDeSincronia,
        permitidos,
        selecionado: mes,
        mesPermitido: mesPermitido(mes, vigente),
        unidades,
        ...resumoNiveis(unidades),
    }
}
