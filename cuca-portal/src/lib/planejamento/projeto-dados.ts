import type { SupabaseClient } from "@supabase/supabase-js"
import { payloadDoForm, type EstadoFicha, type FilhasProjeto, type FormProjeto, type LinhaProjeto, type ModoGravacao, type StatusProjeto } from "./projeto"

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

export const horaFortaleza = (d: Date | string) => FORMATO_HORA.format(typeof d === "string" ? new Date(d) : d)
export const dataHoraFortaleza = (d: string) => FORMATO_DATA_HORA.format(new Date(d))
// Data pura (yyyy-mm-dd) sem deslocamento de fuso.
export const dataCurta = (d: string) => FORMATO_DATA.format(new Date(`${d}T12:00:00Z`))
