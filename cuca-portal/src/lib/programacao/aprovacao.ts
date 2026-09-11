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

export interface LinhaParaAprovacao extends LinhaOrigemDuplicacao {
    hora_inicio?: string | null
    hora_fim?: string | null
    data_atividade?: string | null
}

function vazio(v: unknown): boolean {
    return v === null || v === undefined || String(v).trim() === ""
}

/** Lista os campos obrigatórios que faltam nesta linha, pelo rótulo em português — usada tanto
 * pra decidir se há problema (`.length > 0`) quanto pra montar uma mensagem legível. */
export function motivosFaltantes(linha: LinhaParaAprovacao): string[] {
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

    return faltas
}

export function linhaIncompleta(linha: LinhaParaAprovacao): boolean {
    return motivosFaltantes(linha).length > 0
}
