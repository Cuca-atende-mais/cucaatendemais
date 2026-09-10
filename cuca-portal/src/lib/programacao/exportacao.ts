/**
 * S-PROG-05: monta as abas/linhas de exportação da programação mensal — extraído de
 * `handleExportarXLSX` (`programacao/mensal/[id]/page.tsx`), que era a única especificação viva
 * do formato que a gráfica aceita (os `.xlsx` originais não existem em nenhum storage do
 * sistema, ver S-WM-35). Extração sem mudança de comportamento: mesmos headers, mesma ordem,
 * mesmo "—" pra ausência, mesmo nome de aba — o teste de snapshot (`exportacao.test.ts`) congela
 * exatamente isso, antes de qualquer coisa nova (PDF) ser construída em cima.
 */

export const MESES_NOME_EXPORTACAO = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]

export interface CampanhaParaExportacao {
    mes: number
    ano: number
    unidade_cuca: string | null
}

export interface AtividadeParaExportacao {
    titulo: string
    categoria: string | null
    local?: string | null
    hora_inicio?: string | null
    hora_fim?: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any> | null
}

export interface AbaExportacao {
    /** Nome da categoria, ex.: "CURSOS" — chave de filtro, não o rótulo exibido. */
    chave: string
    /** Nome da aba no arquivo (`"{CATEGORIA} - {MÊS EM MAIÚSCULO}"`). */
    tituloAba: string
    /** Linha 1 da planilha: título visual (`"{CATEGORIA} {UNIDADE} — {MÊS} {ANO}"`). */
    tituloVisual: string
    /** Linha 2: cabeçalhos, na ordem exata do contrato congelado. */
    headers: string[]
    /** Linha 3+: uma linha por atividade, já com "#" e "—" para ausência aplicados. */
    linhas: (string | number)[][]
}

interface DefinicaoCategoria {
    key: string
    headers: string[]
    extrator: (a: AtividadeParaExportacao) => (string | number)[]
}

const CATEGORIAS_EXPORTACAO: DefinicaoCategoria[] = [
    {
        key: "CURSOS",
        headers: ["#", "Curso", "Carga Horária", "Vagas", "Ementa", "Requisitos", "Período", "Horário", "Educador"],
        extrator: (a) => {
            const m = a.metadata || {}
            return [a.titulo, m.carga_horaria ? `${m.carga_horaria}h` : "—", m.vagas || "—", m.ementa || "—", m.requisitos || "—", m.periodo || "—", m.horario || "—", m.educador || "—"]
        },
    },
    {
        key: "ESPORTES",
        headers: ["#", "Modalidade", "Professor", "Turma", "Faixa Etária", "Sexo", "Vagas", "Dias", "Horário"],
        extrator: (a) => {
            const m = a.metadata || {}
            return [a.titulo, m.professor || "—", m.turma || "—", m.faixa_etaria || "—", m.sexo || "—", m.vagas || "—", m.dias_semana || "—", m.horario || "—"]
        },
    },
    {
        key: "DIA A DIA",
        headers: ["#", "Sessão", "Data", "Dia da Semana", "Atividade", "Horário Início", "Horário Fim", "Local", "Informações"],
        extrator: (a) => {
            const m = a.metadata || {}
            return [m.sessao || "—", m.data_real || "—", m.dia_semana || "—", m.atividade || a.titulo, a.hora_inicio?.substring(0, 5) || "—", a.hora_fim?.substring(0, 5) || "—", a.local || m.local || "—", m.informacoes || "—"]
        },
    },
    {
        key: "ESPECIAIS",
        headers: ["#", "Sessão", "Data", "Dia da Semana", "Atividade", "Horário Início", "Horário Fim", "Local", "Informações"],
        extrator: (a) => {
            const m = a.metadata || {}
            return [m.sessao || "—", m.data_real || "—", m.dia_semana || "—", m.atividade || a.titulo, a.hora_inicio?.substring(0, 5) || "—", a.hora_fim?.substring(0, 5) || "—", a.local || m.local || "—", m.informacoes || "—"]
        },
    },
]

/** Só abas com pelo menos 1 atividade aparecem — mesma regra de sempre. */
export function montarAbasExportacao(campanha: CampanhaParaExportacao, atividades: AtividadeParaExportacao[]): AbaExportacao[] {
    const nomeMes = MESES_NOME_EXPORTACAO[campanha.mes] || String(campanha.mes)
    const unidade = campanha.unidade_cuca || ""

    const abas: AbaExportacao[] = []
    for (const cat of CATEGORIAS_EXPORTACAO) {
        const itens = atividades.filter(a => a.categoria === cat.key)
        if (itens.length === 0) continue
        abas.push({
            chave: cat.key,
            tituloAba: `${cat.key} - ${nomeMes.toUpperCase()}`,
            tituloVisual: `${cat.key} ${unidade.toUpperCase()} — ${nomeMes.toUpperCase()} ${campanha.ano}`,
            headers: cat.headers,
            linhas: itens.map((a, i) => [i + 1, ...cat.extrator(a)]),
        })
    }
    return abas
}

/** `Programacao_{Unidade}_{Mes}_{Ano}.{xlsx|pdf}` — mesmo nome para os dois formatos, só a extensão muda. */
export function nomeArquivoExportacao(campanha: CampanhaParaExportacao, extensao: "xlsx" | "pdf"): string {
    const nomeMes = MESES_NOME_EXPORTACAO[campanha.mes] || String(campanha.mes)
    const unidade = campanha.unidade_cuca || ""
    return `Programacao_${unidade.replace(/\s+/g, "_")}_${nomeMes}_${campanha.ano}.${extensao}`
}
