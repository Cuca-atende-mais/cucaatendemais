// S-PLA-02: regras puras da ficha do projeto do Planejamento (sem React, sem Supabase).
// O banco (`pla_salvar_projeto`) repete as regras que valem para segurança: obrigatórios, escopo de
// setor, regra de status e restrições de data/números. Aqui ficam as regras de tela e a mesma regra
// de status, para mostrar e testar.

export const ANO_PLANEJAMENTO = 2027

// ── Opções ──────────────────────────────────────────────────────────────────────────────────

export const TIPOS_PROJETO = [
    { valor: "evento_pontual", rotulo: "Evento pontual" },
    { valor: "atividade_continua", rotulo: "Atividade contínua" },
    { valor: "projeto", rotulo: "Projeto" },
] as const
export type TipoProjeto = (typeof TIPOS_PROJETO)[number]["valor"]

export const SITUACOES_2026 = [
    { valor: "mantem", rotulo: "Mantém" },
    { valor: "mantem_ajustes", rotulo: "Mantém com ajustes" },
    { valor: "novo", rotulo: "Novo" },
    { valor: "encerrado", rotulo: "Encerrado" },
] as const
export type Situacao2026 = (typeof SITUACOES_2026)[number]["valor"]

export const FREQUENCIAS = [
    { valor: "evento_unico", rotulo: "Evento único" },
    { valor: "semanal", rotulo: "Semanal" },
    { valor: "duas_vezes_semana", rotulo: "2x por semana" },
    { valor: "quinzenal", rotulo: "Quinzenal" },
    { valor: "mensal", rotulo: "Mensal" },
    { valor: "outra", rotulo: "Outra" },
] as const
export type Frequencia = (typeof FREQUENCIAS)[number]["valor"]

export const CATEGORIAS_ORCAMENTO = [
    { valor: "material", rotulo: "Material" },
    { valor: "espaco", rotulo: "Espaço" },
    { valor: "transporte", rotulo: "Transporte" },
    { valor: "alimentacao", rotulo: "Alimentação" },
    { valor: "divulgacao", rotulo: "Divulgação" },
    { valor: "servicos", rotulo: "Serviços" },
    { valor: "outros", rotulo: "Outros" },
] as const
export type CategoriaOrcamento = (typeof CATEGORIAS_ORCAMENTO)[number]["valor"]

// Status do projeto (D2). Os dois primeiros acompanham os botões; os quatro manuais só mudam pelo
// seletor da S-PLA-03. Cores da S-PLA-03 (AC10): âmbar, cinza, verde, azul, roxo e vermelho, usadas
// em todo o módulo. Os ícones ficam em `components/planejamento/status-projeto.tsx` (com React).
export const STATUS_PROJETO = [
    { valor: "em_construcao", rotulo: "Em construção", cor: "bg-amber-100 text-amber-800 border-amber-300" },
    { valor: "projeto_salvo", rotulo: "Projeto salvo", cor: "bg-slate-100 text-slate-700 border-slate-300" },
    { valor: "aprovado", rotulo: "Aprovado", cor: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    { valor: "em_execucao", rotulo: "Em execução", cor: "bg-blue-100 text-blue-800 border-blue-300" },
    { valor: "concluido", rotulo: "Concluído", cor: "bg-purple-100 text-purple-800 border-purple-300" },
    { valor: "reprovado", rotulo: "Reprovado", cor: "bg-rose-100 text-rose-800 border-rose-300" },
] as const
export type StatusProjeto = (typeof STATUS_PROJETO)[number]["valor"]
export const STATUS_DOS_BOTOES: readonly StatusProjeto[] = ["em_construcao", "projeto_salvo"]
export const STATUS_MANUAIS: readonly StatusProjeto[] = ["aprovado", "em_execucao", "concluido", "reprovado"]

export type EstadoFicha = "parcial" | "final"
// 'manter' = botão "Salvar" da caixa de saída: grava sem mudar o estado da ficha.
export type ModoGravacao = "parcial" | "final" | "manter"

function rotuloDe<T extends { valor: string; rotulo: string }>(lista: readonly T[], valor: string | null | undefined): string {
    return lista.find(o => o.valor === valor)?.rotulo ?? ""
}
export const rotuloTipo = (v: string | null | undefined) => rotuloDe(TIPOS_PROJETO, v)
export const rotuloSituacao = (v: string | null | undefined) => rotuloDe(SITUACOES_2026, v)
export const rotuloFrequencia = (v: string | null | undefined) => rotuloDe(FREQUENCIAS, v)
export const rotuloCategoria = (v: string | null | undefined) => rotuloDe(CATEGORIAS_ORCAMENTO, v)
export const rotuloStatus = (v: string | null | undefined) => rotuloDe(STATUS_PROJETO, v)
export function corStatus(v: string | null | undefined): string {
    return STATUS_PROJETO.find(s => s.valor === v)?.cor ?? "bg-slate-100 text-slate-700 border-slate-300"
}

// ── Regra de status e ficha (AC9, espelho de pla_salvar_projeto) ──────────────────────────────

export function statusAposGravacao(atual: StatusProjeto | null, modo: ModoGravacao): StatusProjeto {
    if (atual === null) return modo === "final" ? "projeto_salvo" : "em_construcao"
    if (!STATUS_DOS_BOTOES.includes(atual)) return atual
    if (modo === "final") return "projeto_salvo"
    if (modo === "parcial") return "em_construcao"
    return atual
}

export function fichaAposGravacao(atual: EstadoFicha | null, modo: ModoGravacao): EstadoFicha {
    if (modo === "final") return "final"
    if (modo === "parcial") return "parcial"
    return atual ?? "parcial"
}

// Selo da página do projeto: status manual com a ficha parcial (AC12).
export function mostrarSeloFichaEmConstrucao(status: StatusProjeto, ficha: EstadoFicha): boolean {
    return STATUS_MANUAIS.includes(status) && ficha === "parcial"
}

// ── Formulário ──────────────────────────────────────────────────────────────────────────────

export type LinhaOrcamento = { item: string; categoria: CategoriaOrcamento | ""; quantidade: string; valor_unitario: string }
export type LinhaMeta = { meta: string; indicador: string; resultado_esperado: string }

export type FormProjeto = {
    nome: string
    tipo: TipoProjeto | ""
    setor_id: string
    responsavel_nome: string
    responsavel_contato: string
    situacao_2026: Situacao2026 | ""
    mudancas_2026: string
    justificativa_2026: string
    objetivo_geral: string
    objetivos: string[]
    publico_alvo: string
    faixa_etaria_min: string
    faixa_etaria_max: string
    participantes_estimados: string
    periodo_ano_todo: boolean
    data_inicio: string
    data_fim: string
    duracao: string
    frequencia: Frequencia | ""
    frequencia_outra: string
    dias_horarios: string
    locais_unidades: string[]
    local_outro: boolean
    local_outro_texto: string
    como_sera_realizado: string
    orcamento: LinhaOrcamento[]
    metas: LinhaMeta[]
    resultados_2026_participantes: string
    resultados_2026_principais: string
    resultados_2026_funcionou: string
    resultados_2026_melhorar: string
    observacoes: string
}

export function formVazio(padrao: Partial<Pick<FormProjeto, "responsavel_nome" | "responsavel_contato" | "setor_id">> = {}): FormProjeto {
    return {
        nome: "", tipo: "", setor_id: padrao.setor_id ?? "",
        responsavel_nome: padrao.responsavel_nome ?? "", responsavel_contato: padrao.responsavel_contato ?? "",
        situacao_2026: "", mudancas_2026: "", justificativa_2026: "",
        objetivo_geral: "", objetivos: [], publico_alvo: "",
        faixa_etaria_min: "", faixa_etaria_max: "", participantes_estimados: "",
        periodo_ano_todo: false, data_inicio: "", data_fim: "", duracao: "",
        frequencia: "", frequencia_outra: "", dias_horarios: "",
        locais_unidades: [], local_outro: false, local_outro_texto: "", como_sera_realizado: "",
        orcamento: [], metas: [],
        resultados_2026_participantes: "", resultados_2026_principais: "",
        resultados_2026_funcionou: "", resultados_2026_melhorar: "", observacoes: "",
    }
}

// Linha do banco (planejamento_projetos) + filhas → formulário.
export type LinhaProjeto = {
    id: string
    ano: number
    nome: string
    tipo: TipoProjeto
    setor_id: string
    responsavel_nome: string | null
    responsavel_contato: string | null
    situacao_2026: Situacao2026 | null
    mudancas_2026: string | null
    justificativa_2026: string | null
    objetivo_geral: string | null
    publico_alvo: string | null
    faixa_etaria_min: number | null
    faixa_etaria_max: number | null
    participantes_estimados: number | null
    periodo_ano_todo: boolean
    data_inicio: string | null
    data_fim: string | null
    duracao: string | null
    frequencia: Frequencia | null
    frequencia_outra: string | null
    dias_horarios: string | null
    locais_unidades: string[] | null
    local_outro: boolean
    local_outro_texto: string | null
    como_sera_realizado: string | null
    resultados_2026_participantes: number | null
    resultados_2026_principais: string | null
    resultados_2026_funcionou: string | null
    resultados_2026_melhorar: string | null
    observacoes: string | null
    status: StatusProjeto
    ficha: EstadoFicha
    criado_por_nome: string | null
    atualizado_por_nome: string | null
    created_at: string
    updated_at: string
}
export type FilhasProjeto = {
    objetivos: { ordem: number; texto: string }[]
    orcamento: { ordem: number; item: string | null; categoria: CategoriaOrcamento | null; quantidade: number | string | null; valor_unitario: number | string | null }[]
    metas: { ordem: number; meta: string | null; indicador: string | null; resultado_esperado: string | null }[]
}

const txt = (v: string | null | undefined) => v ?? ""
const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v))

// Número do banco → texto com vírgula decimal ("10.5" → "10,50" para dinheiro; "2" → "2").
export function numeroParaTextoBR(v: number | string | null | undefined, casas?: number): string {
    if (v === null || v === undefined || v === "") return ""
    const n = typeof v === "number" ? v : Number(v)
    if (!Number.isFinite(n)) return ""
    const fixo = casas === undefined ? String(n) : n.toFixed(casas)
    return fixo.replace(".", ",")
}

export function formDeLinha(linha: LinhaProjeto, filhas: FilhasProjeto): FormProjeto {
    const ordenar = <T extends { ordem: number }>(l: T[]) => [...l].sort((a, b) => a.ordem - b.ordem)
    return {
        nome: linha.nome, tipo: linha.tipo, setor_id: linha.setor_id,
        responsavel_nome: txt(linha.responsavel_nome), responsavel_contato: txt(linha.responsavel_contato),
        situacao_2026: linha.situacao_2026 ?? "", mudancas_2026: txt(linha.mudancas_2026), justificativa_2026: txt(linha.justificativa_2026),
        objetivo_geral: txt(linha.objetivo_geral),
        objetivos: ordenar(filhas.objetivos).map(o => o.texto),
        publico_alvo: txt(linha.publico_alvo),
        faixa_etaria_min: num(linha.faixa_etaria_min), faixa_etaria_max: num(linha.faixa_etaria_max),
        participantes_estimados: num(linha.participantes_estimados),
        periodo_ano_todo: linha.periodo_ano_todo, data_inicio: txt(linha.data_inicio), data_fim: txt(linha.data_fim),
        duracao: txt(linha.duracao), frequencia: linha.frequencia ?? "", frequencia_outra: txt(linha.frequencia_outra),
        dias_horarios: txt(linha.dias_horarios), locais_unidades: linha.locais_unidades ?? [],
        local_outro: linha.local_outro, local_outro_texto: txt(linha.local_outro_texto),
        como_sera_realizado: txt(linha.como_sera_realizado),
        orcamento: ordenar(filhas.orcamento).map(o => ({
            item: txt(o.item), categoria: o.categoria ?? "",
            quantidade: numeroParaTextoBR(o.quantidade), valor_unitario: numeroParaTextoBR(o.valor_unitario, 2),
        })),
        metas: ordenar(filhas.metas).map(m => ({ meta: txt(m.meta), indicador: txt(m.indicador), resultado_esperado: txt(m.resultado_esperado) })),
        resultados_2026_participantes: num(linha.resultados_2026_participantes),
        resultados_2026_principais: txt(linha.resultados_2026_principais),
        resultados_2026_funcionou: txt(linha.resultados_2026_funcionou),
        resultados_2026_melhorar: txt(linha.resultados_2026_melhorar),
        observacoes: txt(linha.observacoes),
    }
}

// Texto em formato brasileiro ("1.234,56", "10,5", "3") → número. Vazio → null; inválido → NaN.
// Com vírgula, o ponto é separador de milhar. Sem vírgula, o ponto só é milhar no formato "1.000" /
// "12.500.000"; fora disso é decimal ("10.50" → 10,5), para não multiplicar por 100 quem digita ponto.
export function textoBRParaNumero(texto: string): number | null {
    const t = texto.trim()
    if (t === "") return null
    if (!/^-?[\d.]*(,\d*)?$/.test(t) || !/\d/.test(t)) return Number.NaN
    let normal: string
    if (t.includes(",")) normal = t.replace(/\./g, "").replace(",", ".")
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, "")
    else if ((t.match(/\./g) ?? []).length <= 1) normal = t
    else return Number.NaN
    const n = Number(normal)
    return Number.isFinite(n) ? n : Number.NaN
}

export function formatarReais(valor: number): string {
    return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

export function totalLinhaOrcamento(linha: LinhaOrcamento): number {
    const q = textoBRParaNumero(linha.quantidade)
    const v = textoBRParaNumero(linha.valor_unitario)
    if (q === null || v === null || Number.isNaN(q) || Number.isNaN(v)) return 0
    return Math.round(q * v * 100) / 100
}

export function totalOrcamento(linhas: LinhaOrcamento[]): number {
    return Math.round(linhas.reduce((s, l) => s + totalLinhaOrcamento(l), 0) * 100) / 100
}

// Corpo enviado a pla_salvar_projeto. Os campos que somem na tela continuam guardados (nada se perde
// ao trocar a situação por engano); a tela e os slides só mostram os que se aplicam.
export function payloadDoForm(form: FormProjeto): Record<string, unknown> {
    const dinheiro = (t: string) => {
        const n = textoBRParaNumero(t)
        return n === null || Number.isNaN(n) ? "" : String(n)
    }
    return {
        ...form,
        objetivos: form.objetivos.map(texto => ({ texto })),
        orcamento: form.orcamento.map(l => ({
            item: l.item, categoria: l.categoria, quantidade: dinheiro(l.quantidade), valor_unitario: dinheiro(l.valor_unitario),
        })),
        metas: form.metas,
        data_inicio: form.periodo_ano_todo ? "" : form.data_inicio,
        data_fim: form.periodo_ano_todo ? "" : form.data_fim,
    }
}

// ── Seções e campos que se aplicam (AC4, AC10) ─────────────────────────────────────────────────

export const SECOES = [
    { id: 1, titulo: "Identificação" },
    { id: 2, titulo: "Relação com 2026" },
    { id: 3, titulo: "Objetivos e público" },
    { id: 4, titulo: "Execução" },
    { id: 5, titulo: "Recursos e orçamento estimado" },
    { id: 6, titulo: "Metas e indicadores" },
    { id: 7, titulo: "Resultados de 2026 e observações" },
] as const
export type IdSecao = (typeof SECOES)[number]["id"]
export const ULTIMA_SECAO: IdSecao = 7

// Com "Encerrado", as seções 3 a 6 somem (o projeto só registra que acabou).
export function secoesVisiveis(situacao: Situacao2026 | ""): IdSecao[] {
    return situacao === "encerrado" ? [1, 2, 7] : [1, 2, 3, 4, 5, 6, 7]
}

// Bloco "Resultados de 2026" some quando a situação é "Novo".
export function bloco2026Visivel(situacao: Situacao2026 | ""): boolean {
    return situacao !== "novo"
}

export type CamposSituacao = { mudancas: boolean; justificativa: boolean; rotuloJustificativa: string }
export function camposDaSituacao(situacao: Situacao2026 | ""): CamposSituacao {
    switch (situacao) {
        case "mantem_ajustes": return { mudancas: true, justificativa: true, rotuloJustificativa: "Por que muda (justificativa)" }
        case "novo": return { mudancas: false, justificativa: true, rotuloJustificativa: "Por que criar" }
        case "encerrado": return { mudancas: false, justificativa: true, rotuloJustificativa: "Por que encerra" }
        default: return { mudancas: false, justificativa: false, rotuloJustificativa: "Por que muda (justificativa)" }
    }
}

type CampoAplicavel = { secao: IdSecao; chave: string; preenchido: boolean }
const cheio = (s: string) => s.trim() !== ""

// Campos que contam no indicador, conforme a situação. Nenhum campo da ficha depende do tipo: os três
// tipos usam a mesma ficha, então o tipo só conta como campo preenchido.
export function camposAplicaveis(form: FormProjeto): CampoAplicavel[] {
    const c: CampoAplicavel[] = []
    const add = (secao: IdSecao, chave: string, preenchido: boolean) => c.push({ secao, chave, preenchido })
    const visiveis = secoesVisiveis(form.situacao_2026)

    add(1, "nome", cheio(form.nome))
    add(1, "tipo", form.tipo !== "")
    add(1, "setor_id", form.setor_id !== "")
    add(1, "responsavel_nome", cheio(form.responsavel_nome))
    add(1, "responsavel_contato", cheio(form.responsavel_contato))

    add(2, "situacao_2026", form.situacao_2026 !== "")
    const sit = camposDaSituacao(form.situacao_2026)
    if (sit.mudancas) add(2, "mudancas_2026", cheio(form.mudancas_2026))
    if (sit.justificativa) add(2, "justificativa_2026", cheio(form.justificativa_2026))

    if (visiveis.includes(3)) {
        add(3, "objetivo_geral", cheio(form.objetivo_geral))
        add(3, "objetivos", form.objetivos.some(cheio))
        add(3, "publico_alvo", cheio(form.publico_alvo))
        add(3, "faixa_etaria", cheio(form.faixa_etaria_min) && cheio(form.faixa_etaria_max))
        add(3, "participantes_estimados", cheio(form.participantes_estimados))
    }
    if (visiveis.includes(4)) {
        add(4, "periodo", form.periodo_ano_todo || (cheio(form.data_inicio) && cheio(form.data_fim)))
        add(4, "duracao", cheio(form.duracao))
        add(4, "frequencia", form.frequencia !== "")
        if (form.frequencia === "outra") add(4, "frequencia_outra", cheio(form.frequencia_outra))
        add(4, "dias_horarios", cheio(form.dias_horarios))
        add(4, "local", form.locais_unidades.length > 0 || (form.local_outro && cheio(form.local_outro_texto)))
        add(4, "como_sera_realizado", cheio(form.como_sera_realizado))
    }
    if (visiveis.includes(5)) add(5, "orcamento", form.orcamento.some(l => cheio(l.item) || totalLinhaOrcamento(l) > 0))
    if (visiveis.includes(6)) add(6, "metas", form.metas.some(m => cheio(m.meta) || cheio(m.indicador) || cheio(m.resultado_esperado)))

    if (bloco2026Visivel(form.situacao_2026)) {
        add(7, "resultados_2026_participantes", cheio(form.resultados_2026_participantes))
        add(7, "resultados_2026_principais", cheio(form.resultados_2026_principais))
        add(7, "resultados_2026_funcionou", cheio(form.resultados_2026_funcionou))
        add(7, "resultados_2026_melhorar", cheio(form.resultados_2026_melhorar))
    }
    add(7, "observacoes", cheio(form.observacoes))
    return c
}

export function percentualPreenchido(form: FormProjeto): number {
    const campos = camposAplicaveis(form)
    if (campos.length === 0) return 0
    return Math.round((campos.filter(c => c.preenchido).length / campos.length) * 100)
}

export function primeiraSecaoIncompleta(form: FormProjeto): IdSecao | null {
    return camposAplicaveis(form).find(c => !c.preenchido)?.secao ?? null
}

// ── Obrigatórios, validação e botão "Salvar projeto" (AC6, AC7) ───────────────────────────────

// "Responsável pelo projeto" vem com o nome de quem cria. Sem cadastro de colaborador (as contas
// Developer), usa o e-mail de login, o mesmo que o banco grava como autor (`pla_nome_usuario`).
export function nomePadraoResponsavel(nomeColaborador: string | null | undefined, email: string | null | undefined): string {
    const nome = (nomeColaborador ?? "").trim()
    if (nome) return nome
    return (email ?? "").trim()
}

export function obrigatoriosFaltando(form: FormProjeto): string[] {
    const faltam: string[] = []
    if (!cheio(form.nome)) faltam.push("nome do projeto")
    if (form.tipo === "") faltam.push("tipo")
    if (form.setor_id === "") faltam.push("setor")
    return faltam
}

export function mensagemObrigatorios(faltam: string[]): string | null {
    if (faltam.length === 0) return null
    if (faltam.length === 1) return `Falta preencher: ${faltam[0]}.`
    return `Falta preencher: ${faltam.slice(0, -1).join(", ")} e ${faltam[faltam.length - 1]}.`
}

// Aparece quando o último obrigatório está preenchido ou quando a pessoa chega à última seção.
// Depois de aparecer, fica (convive com o "Salvar parcial").
export function mostrarSalvarProjeto(p: { obrigatoriosOk: boolean; chegouUltimaSecao: boolean; jaMostrado: boolean }): boolean {
    return p.jaMostrado || p.obrigatoriosOk || p.chegouUltimaSecao
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/
export function dataNoAno(data: string, ano = ANO_PLANEJAMENTO): boolean {
    if (!RE_DATA.test(data)) return false
    const d = new Date(`${data}T12:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === data && d.getUTCFullYear() === ano
}

const RE_INTEIRO = /^\d+$/

// Limites das colunas do banco (integer; numeric(12,2) nos valores; numeric(14,2) no total da linha).
// Acima deles o banco recusaria com mensagem técnica; a tela avisa antes, em texto claro.
export const LIMITE_INTEIRO = 2_147_483_647
export const LIMITE_VALOR = 9_999_999_999.99
export const LIMITE_TOTAL_LINHA = 999_999_999_999.99

export type ErroCampo = { campo: string; mensagem: string }

// Erros que impedem gravar (o banco recusaria). Campo vazio não é erro.
export function errosDeValidacao(form: FormProjeto, ano = ANO_PLANEJAMENTO): ErroCampo[] {
    const erros: ErroCampo[] = []
    const inteiro = (campo: string, valor: string, rotulo: string, max?: number) => {
        if (!cheio(valor)) return
        if (!RE_INTEIRO.test(valor.trim()) || (max !== undefined && Number(valor) > max)) {
            erros.push({ campo, mensagem: `${rotulo}: use um número inteiro${max !== undefined ? ` de 0 a ${max}` : " a partir de 0"}.` })
        } else if (Number(valor) > LIMITE_INTEIRO) {
            erros.push({ campo, mensagem: `${rotulo}: número alto demais. Confira o valor digitado.` })
        }
    }
    inteiro("faixa_etaria_min", form.faixa_etaria_min, "Faixa etária (de)", 120)
    inteiro("faixa_etaria_max", form.faixa_etaria_max, "Faixa etária (até)", 120)
    if (RE_INTEIRO.test(form.faixa_etaria_min.trim()) && RE_INTEIRO.test(form.faixa_etaria_max.trim())
        && Number(form.faixa_etaria_min) > Number(form.faixa_etaria_max)) {
        erros.push({ campo: "faixa_etaria_min", mensagem: "Faixa etária: o \"de\" não pode ser maior que o \"até\"." })
    }
    inteiro("participantes_estimados", form.participantes_estimados, "Nº estimado de participantes")
    inteiro("resultados_2026_participantes", form.resultados_2026_participantes, "Participantes atendidos em 2026")

    if (!form.periodo_ano_todo) {
        if (cheio(form.data_inicio) && !dataNoAno(form.data_inicio, ano)) erros.push({ campo: "data_inicio", mensagem: `Data de início: escolha uma data de ${ano}.` })
        if (cheio(form.data_fim) && !dataNoAno(form.data_fim, ano)) erros.push({ campo: "data_fim", mensagem: `Data de fim: escolha uma data de ${ano}.` })
        if (dataNoAno(form.data_inicio, ano) && dataNoAno(form.data_fim, ano) && form.data_fim < form.data_inicio) {
            erros.push({ campo: "data_fim", mensagem: "O fim não pode ser antes do início." })
        }
    }

    form.orcamento.forEach((l, i) => {
        const q = textoBRParaNumero(l.quantidade)
        const v = textoBRParaNumero(l.valor_unitario)
        if (q !== null && (Number.isNaN(q) || q < 0)) erros.push({ campo: `orcamento.${i}.quantidade`, mensagem: `Orçamento, linha ${i + 1}: quantidade inválida.` })
        if (v !== null && (Number.isNaN(v) || v < 0)) erros.push({ campo: `orcamento.${i}.valor_unitario`, mensagem: `Orçamento, linha ${i + 1}: valor unitário inválido.` })
        const qOk = q !== null && !Number.isNaN(q) && q >= 0
        const vOk = v !== null && !Number.isNaN(v) && v >= 0
        if (qOk && q > LIMITE_VALOR) erros.push({ campo: `orcamento.${i}.quantidade`, mensagem: `Orçamento, linha ${i + 1}: quantidade alta demais. Confira o valor digitado.` })
        if (vOk && v > LIMITE_VALOR) erros.push({ campo: `orcamento.${i}.valor_unitario`, mensagem: `Orçamento, linha ${i + 1}: valor unitário alto demais. Confira o valor digitado.` })
        if (qOk && vOk && q <= LIMITE_VALOR && v <= LIMITE_VALOR && q * v > LIMITE_TOTAL_LINHA) {
            erros.push({ campo: `orcamento.${i}.valor_unitario`, mensagem: `Orçamento, linha ${i + 1}: valor total alto demais. Confira quantidade e valor unitário.` })
        }
    })
    return erros
}

// ── Duração sugerida (AC4) ───────────────────────────────────────────────────────────────────

export function sugerirDuracao(inicio: string, fim: string, anoTodo: boolean): string {
    if (anoTodo) return "Ano todo"
    if (!RE_DATA.test(inicio) || !RE_DATA.test(fim)) return ""
    const a = Date.parse(`${inicio}T12:00:00Z`)
    const b = Date.parse(`${fim}T12:00:00Z`)
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return ""
    const dias = Math.round((b - a) / 86_400_000) + 1
    if (dias === 1) return "1 dia"
    if (dias < 14) return `${dias} dias`
    if (dias < 60) {
        const semanas = Math.round(dias / 7)
        return `${semanas} semanas`
    }
    const meses = Math.max(2, Math.round(dias / 30.44))
    return meses >= 12 ? "12 meses" : `${meses} meses`
}
