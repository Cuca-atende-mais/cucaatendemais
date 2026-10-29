import type { SupabaseClient } from "@supabase/supabase-js"
import { payloadDoForm, type EstadoFicha, type FilhasProjeto, type FormProjeto, type LinhaProjeto, type ModoGravacao, type StatusProjeto } from "./projeto"
import type { ProjetoLista } from "./lista"
import type { DestinoStatus, EventoStatus } from "./status"

// S-PLA-02: leitura com o cliente do usuário (RLS de setor + permissão) e gravação só pela função
// `pla_salvar_projeto`, que confere tudo no banco e grava a ficha e as listas numa transação só.

export type Setor = { id: string; nome: string; cor: string; ordem: number }
export type Unidade = { id: string; nome: string }

export type ProjetoCarregado = { linha: LinhaProjeto; filhas: FilhasProjeto }

// null = não existe ou está fora do escopo (mesma resposta, AC14).
export async function carregarProjeto(supabase: SupabaseClient, id: string): Promise<ProjetoCarregado | null> {
    const { data: linha, error } = await supabase.from("planejamento_projetos").select("*").eq("id", id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!linha) return null
    const [objetivos, orcamento, metas] = await Promise.all([
        supabase.from("planejamento_projeto_objetivos").select("ordem, texto").eq("projeto_id", id).order("ordem"),
        supabase.from("planejamento_projeto_orcamento").select("ordem, item, categoria, quantidade, valor_unitario").eq("projeto_id", id).order("ordem"),
        supabase.from("planejamento_projeto_metas").select("ordem, meta, indicador, resultado_esperado").eq("projeto_id", id).order("ordem"),
    ])
    const erro = objetivos.error ?? orcamento.error ?? metas.error
    if (erro) throw new Error(erro.message)
    return {
        linha: linha as LinhaProjeto,
        filhas: {
            objetivos: (objetivos.data ?? []) as FilhasProjeto["objetivos"],
            orcamento: (orcamento.data ?? []) as FilhasProjeto["orcamento"],
            metas: (metas.data ?? []) as FilhasProjeto["metas"],
        },
    }
}

export async function carregarSetores(supabase: SupabaseClient): Promise<Setor[]> {
    const { data, error } = await supabase.from("planejamento_setores").select("id, nome, cor, ordem").order("ordem")
    if (error) throw new Error(error.message)
    return (data ?? []) as Setor[]
}

// Setores em que o usuário logado pode atuar, pela mesma função das policies (S-PLA-01).
export async function carregarSetoresPermitidos(supabase: SupabaseClient, setores: Setor[]): Promise<Setor[]> {
    const respostas = await Promise.all(setores.map(s => supabase.rpc("pla_pode_atuar_setor", { p_setor: s.id })))
    const falha = respostas.find(r => r.error)
    if (falha?.error) throw new Error(falha.error.message)
    return setores.filter((_, i) => respostas[i].data === true)
}

export async function carregarUnidades(supabase: SupabaseClient): Promise<Unidade[]> {
    const { data, error } = await supabase.from("unidades_cuca").select("id, nome").eq("ativo", true).order("nome")
    if (error) throw new Error(error.message)
    return (data ?? []) as Unidade[]
}

// Telefone do cadastro de colaborador de quem cria (pode não existir, ex.: conta Developer).
export async function carregarTelefoneDoUsuario(supabase: SupabaseClient, userId: string): Promise<string> {
    const { data } = await supabase.from("colaboradores").select("telefone").eq("user_id", userId).maybeSingle()
    return (data?.telefone as string | null | undefined) ?? ""
}

export type ResultadoGravacao = {
    id: string
    status: StatusProjeto
    ficha: EstadoFicha
    ficha_anterior: EstadoFicha | null
    atualizado_em: string
}

export async function salvarProjeto(supabase: SupabaseClient, id: string | null, modo: ModoGravacao, form: FormProjeto): Promise<ResultadoGravacao> {
    const { data, error } = await supabase.rpc("pla_salvar_projeto", { p_id: id, p_modo: modo, p_dados: payloadDoForm(form) })
    if (error) throw new Error(mensagemDeErro(error.message))
    return data as ResultadoGravacao
}

// ── S-PLA-03: lista, status, duplicar e excluir ──────────────────────────────────────────────

const TAMANHO_PAGINA = 1000

// Projetos visíveis ao usuário (a RLS já tira os excluídos e os de fora do setor) + total do orçamento.
export async function carregarLista(supabase: SupabaseClient, ano: number): Promise<ProjetoLista[]> {
    const linhas: Omit<ProjetoLista, "orcamento_total" | "correcoes_abertas" | "validado">[] = []
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data, error } = await supabase.from("planejamento_projetos")
            .select("id, nome, setor_id, tipo, status, ficha, situacao_2026, participantes_estimados, periodo_ano_todo, data_inicio, data_fim, updated_at")
            .eq("ano", ano).is("excluido_em", null).order("id").range(de, de + TAMANHO_PAGINA - 1)
        if (error) throw new Error(error.message)
        linhas.push(...((data ?? []) as typeof linhas))
        if (!data || data.length < TAMANHO_PAGINA) break
    }
    if (linhas.length === 0) return []
    // Sem filtro por id (evita URL gigante com muitos projetos): a RLS das filhas já devolve só as
    // linhas dos projetos visíveis; o que não for desta lista é ignorado no mapa. Em páginas de
    // 1.000 (limite de linhas por consulta do Supabase), para nenhum total sair cortado.
    const orc: { projeto_id: string; valor_total: number | string | null }[] = []
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data: pagina, error: erroOrc } = await supabase.from("planejamento_projeto_orcamento")
            .select("projeto_id, valor_total").order("id").range(de, de + TAMANHO_PAGINA - 1)
        if (erroOrc) throw new Error(erroOrc.message)
        orc.push(...((pagina ?? []) as typeof orc))
        if (!pagina || pagina.length < TAMANHO_PAGINA) break
    }
    const totais = new Map<string, number>()
    for (const o of orc) {
        totais.set(o.projeto_id, (totais.get(o.projeto_id) ?? 0) + Number(o.valor_total ?? 0))
    }
    return linhas.map(l => ({ ...l, orcamento_total: Math.round((totais.get(l.id) ?? 0) * 100) / 100, correcoes_abertas: 0, validado: false }))
}

export type ResultadoTrocaStatus = { status: StatusProjeto; status_anterior: StatusProjeto; alterado_em: string; alterado_por: string | null }

export async function mudarStatus(supabase: SupabaseClient, id: string, destino: DestinoStatus, observacao: string): Promise<ResultadoTrocaStatus> {
    const { data, error } = await supabase.rpc("pla_mudar_status", { p_id: id, p_destino: destino, p_observacao: observacao.trim() || null })
    if (error) throw new Error(mensagemDeErro(error.message))
    return data as ResultadoTrocaStatus
}

export async function duplicarProjeto(supabase: SupabaseClient, id: string): Promise<string> {
    const { data, error } = await supabase.rpc("pla_duplicar_projeto", { p_id: id })
    if (error) throw new Error(mensagemDeErro(error.message))
    return (data as { id: string }).id
}

export async function excluirProjeto(supabase: SupabaseClient, id: string): Promise<void> {
    const { error } = await supabase.rpc("pla_excluir_projeto", { p_id: id })
    if (error) throw new Error(mensagemDeErro(error.message))
}

// Última troca manual de status (AC13), pela tabela única de eventos.
export async function carregarUltimaTrocaStatus(supabase: SupabaseClient, id: string): Promise<EventoStatus | null> {
    const { data, error } = await supabase.from("planejamento_projeto_eventos")
        .select("autor_nome, created_at, detalhe").eq("projeto_id", id).eq("tipo", "status_alterado")
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as EventoStatus | null) ?? null
}

// Restrições do banco viram texto que a pessoa entende (a tela valida antes; isto é a última linha).
export function mensagemDeErro(mensagem: string): string {
    if (mensagem.includes("planejamento_projetos_datas_ano_ck")) return "As datas precisam ser de 2027."
    if (mensagem.includes("planejamento_projetos_datas_ordem_ck")) return "O fim não pode ser antes do início."
    if (mensagem.includes("planejamento_projetos_faixa_ck")) return "Faixa etária: o \"de\" não pode ser maior que o \"até\"."
    if (mensagem.includes("out of range") || mensagem.includes("numeric field overflow")) {
        return "Algum número está alto demais. Confira participantes, quantidades e valores."
    }
    if (mensagem.includes("invalid input syntax")) return "Algum número ou data está em formato inválido."
    if (mensagem.includes("violates check constraint")) return "Algum valor está fora do permitido. Confira números e datas."
    if (mensagem.toLowerCase().includes("failed to fetch")) return "Sem conexão com o servidor. Nada foi perdido: tente salvar de novo."
    return mensagem
}

const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" })
const FORMATO_DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
})
const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" })
const FORMATO_DATA_FORTALEZA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric" })

export const horaFortaleza = (d: Date | string) => FORMATO_HORA.format(typeof d === "string" ? new Date(d) : d)
export const dataHoraFortaleza = (d: string) => FORMATO_DATA_HORA.format(new Date(d))
// Só a data de um instante (timestamptz), no fuso de Fortaleza. Ex.: "Validado em 29/10/2026".
export const dataFortaleza = (d: string) => FORMATO_DATA_FORTALEZA.format(new Date(d))
// Data pura (yyyy-mm-dd) sem deslocamento de fuso.
export const dataCurta = (d: string) => FORMATO_DATA.format(new Date(`${d}T12:00:00Z`))
