import { differenceInMonths, parse } from "date-fns"
import { normalizarEscolaridade, rankEscolaridade } from "./escolaridade"
import type { CvDados } from "./curriculo-tipos"

// SQS-57 (T4) — deriva talent_bank.skills_jsonb a partir do currículo estruturado
// (curriculos.dados), sem IA: os dados já estão estruturados pelo próprio
// formulário, então recalcular via LLM seria gasto de crédito para reconstituir
// informação que já temos (ver Dev Notes da story). Mesmo formato de chaves já
// praticado pelo OCR (worker/cv_processor.py): habilidades, experiencia_meses,
// resumo_experiencias, escolaridade, resumo, justificativa_ia, origem.

export const ORIGEM_CURRICULO_ESTRUTURADO = "curriculo_estruturado"

function normalizarDataMesAno(s: string): string {
    const digits = (s || "").replace(/\D/g, "")
    if (digits.length === 6) return `${digits.slice(0, 2)}/${digits.slice(2)}`
    return s
}

/** Meses entre início e fim (ou hoje, se "atual"). 0 se datas ausentes/inválidas. */
function mesesExperiencia(exp: { data_inicio: string; data_fim: string; atual: boolean }): number {
    if (!exp.data_inicio) return 0
    try {
        const start = parse(`01/${normalizarDataMesAno(exp.data_inicio)}`, "dd/MM/yyyy", new Date())
        const end = exp.atual
            ? new Date()
            : exp.data_fim
                ? parse(`01/${normalizarDataMesAno(exp.data_fim)}`, "dd/MM/yyyy", new Date())
                : new Date()
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0
        const meses = differenceInMonths(end, start)
        return meses > 0 ? meses : 0
    } catch {
        return 0
    }
}

/** Escolaridade mais alta entre as formações, já mapeada para o nível canônico. */
function escolaridadeMaisAlta(formacoes: CvDados["formacoes"]): string | null {
    if (!formacoes?.length) return null
    let melhor: string | null = null
    let melhorRank = -1
    for (const f of formacoes) {
        const normalizada = normalizarEscolaridade(f.escolaridade)
        const rank = rankEscolaridade(normalizada)
        if (rank > melhorRank) {
            melhorRank = rank
            melhor = normalizada ?? f.escolaridade
        }
    }
    return melhor
}

export interface SkillsDerivadas {
    skills_jsonb: {
        escolaridade: string | null
        experiencia_meses: number
        resumo_experiencias: string[]
        habilidades: string[]
        resumo: string
        justificativa_ia: string
        origem: string
    }
    escolaridade_normalizada: string | null
    experiencia_meses: number
    primeiro_emprego: boolean
}

export function derivarSkillsDeCurriculo(dados: CvDados): SkillsDerivadas {
    const experiencias = dados.experiencias || []
    const experiencia_meses = experiencias.reduce((soma, e) => soma + mesesExperiencia(e), 0)
    const primeiro_emprego = experiencias.length === 0

    const resumo_experiencias = experiencias
        .map(e => [e.cargo, e.empresa].filter(Boolean).join(" — "))
        .filter(Boolean)

    const habilidades = (dados.habilidades || [])
        .map(h => h.titulo)
        .filter((t): t is string => Boolean(t))

    const escolaridade = escolaridadeMaisAlta(dados.formacoes)
    const resumo = dados.apresentacao || dados.objetivo || ""

    return {
        skills_jsonb: {
            escolaridade,
            experiencia_meses,
            resumo_experiencias,
            habilidades,
            resumo,
            justificativa_ia: "Currículo estruturado preenchido pelo candidato/equipe — dados extraídos diretamente do formulário, sem IA.",
            origem: ORIGEM_CURRICULO_ESTRUTURADO,
        },
        escolaridade_normalizada: normalizarEscolaridade(escolaridade),
        experiencia_meses,
        primeiro_emprego,
    }
}
