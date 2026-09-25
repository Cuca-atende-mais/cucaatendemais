/**
 * S-PROG-04: verifica se uma linha GRAVADA (formato solto, direto do banco) tem os campos
 * obrigatórios da categoria preenchidos — usado pelo bloqueio de "Enviar para aprovação"
 * (rascunho → pendente, AC2).
 *
 * Achado do @qa: a implementação original reusava `linhaTemProblema` (S-PROG-02), que mede
 * CONTAMINAÇÃO (texto de exemplo, faixa etária sem dígito) pro selo de qualidade do seletor de
 * origem — não "está tudo preenchido". Reproduzido: uma linha de CURSOS com só o título e nada
 * mais (sem educador/vagas/carga_horária/ementa/horário) passava como "sem problema". Este
 * módulo é o checador que faltava — separado de `duplicar.ts` porque a pergunta é outra
 * ("falta algo?", não "isso parece contaminado?").
 */
import { LinhaOrigemDuplicacao } from "./duplicar"
import { horaFimAntesDoInicio } from "./datas-atividade"

export interface LinhaParaAprovacao extends LinhaOrigemDuplicacao {
    hora_inicio?: string | null
    hora_fim?: string | null
    data_atividade?: string | null
    data_inicio?: string | null
    data_fim?: string | null
}

export interface OpcoesAprovacao {
    /** S-PROG-19: campanha de outubro/2026 em diante — CURSOS, DIA A DIA e ESPECIAIS exigem data
     * início e data fim gravadas (mesma regra de `pgm_mudar_status_categoria` no banco). */
    exigirDatasInicioFim?: boolean
}

/** Mesmo corte da trava no banco: (ano, mês) ≥ (2026, 10). */
export function campanhaExigeDatasInicioFim(mes: number | null | undefined, ano: number | null | undefined): boolean {
    if (!mes || !ano) return false
    return ano * 12 + mes >= 2026 * 12 + 10
}

function vazio(v: unknown): boolean {
    return v === null || v === undefined || String(v).trim() === ""
}

/** Lista os campos obrigatórios que faltam nesta linha, pelo rótulo em português — usada tanto
 * pra decidir se há problema (`.length > 0`) quanto pra montar uma mensagem legível. */
export function motivosFaltantes(linha: LinhaParaAprovacao, opcoes: OpcoesAprovacao = {}): string[] {
    const meta = linha.metadata || {}
    const faltas: string[] = []

    if (vazio(linha.titulo)) faltas.push("título")
    if (vazio(linha.hora_inicio)) faltas.push("horário de início")
    if (vazio(linha.hora_fim)) faltas.push("horário de fim")

    if (linha.categoria === "CURSOS") {
        if (vazio(meta.educador)) faltas.push("educador")
        if (vazio(meta.vagas)) faltas.push("vagas")
        if (vazio(meta.carga_horaria)) faltas.push("carga horária")
        if (vazio(meta.ementa)) faltas.push("ementa")
        if (vazio(meta.dias_semana)) faltas.push("dias da semana")
        // Período é obrigatório (decisão do Junior, 2026-09-21): sem ele o curso não pode ser enviado.
        if (vazio(meta.periodo)) faltas.push("período")
    } else if (linha.categoria === "ESPORTES") {
        if (vazio(meta.professor)) faltas.push("professor")
        if (vazio(meta.turma)) faltas.push("turma")
        if (vazio(meta.vagas)) faltas.push("vagas")
        if (vazio(meta.sexo)) faltas.push("sexo")
        if (vazio(meta.faixa_etaria)) faltas.push("faixa etária")
        if (vazio(meta.dias_semana)) faltas.push("dias da semana")
    } else if (linha.categoria === "DIA A DIA" || linha.categoria === "ESPECIAIS") {
        if (vazio(linha.data_atividade)) faltas.push("data")
        if (vazio(linha.local)) faltas.push("local")
        if (vazio(meta.sessao)) faltas.push("sessão")
        if (vazio(meta.atividade)) faltas.push("descrição da atividade")
    }

    if (opcoes.exigirDatasInicioFim && (linha.categoria === "CURSOS" || linha.categoria === "DIA A DIA" || linha.categoria === "ESPECIAIS")) {
        if (vazio(linha.data_inicio)) faltas.push("data de início")
        if (vazio(linha.data_fim)) faltas.push("data de fim")
        const di = linha.data_inicio ? String(linha.data_inicio) : null
        const df = linha.data_fim ? String(linha.data_fim) : null
        if (horaFimAntesDoInicio(linha.categoria, linha.hora_inicio, linha.hora_fim, di, df)) faltas.push("horário de fim antes do de início")
    }

    return faltas
}

export function linhaIncompleta(linha: LinhaParaAprovacao, opcoes: OpcoesAprovacao = {}): boolean {
    return motivosFaltantes(linha, opcoes).length > 0
}
