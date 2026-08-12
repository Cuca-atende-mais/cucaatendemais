import { describe, it, expect } from "vitest"
import { derivarSkillsDeCurriculo, ORIGEM_CURRICULO_ESTRUTURADO } from "./curriculo-skills"
import type { CvDados } from "./curriculo-tipos"

// SQS-57 (T7) — cobre a derivação determinística de skills_jsonb: é o que faz
// candidatos montados na plataforma passarem a concorrer na triagem (AC4/AC6),
// sem gastar crédito de IA para reconstituir dados que já são estruturados.

function baseDados(overrides: Partial<CvDados> = {}): CvDados {
    return {
        nome: "Fulano de Tal",
        endereco: "", telefone: "", email: "", linkedin: "", portfolio: "",
        apresentacao: "", objetivo: "",
        experiencias: [], formacoes: [], cursos: [], habilidades: [],
        ...overrides,
    }
}

describe("derivarSkillsDeCurriculo", () => {
    it("marca primeiro_emprego quando não há experiências", () => {
        const r = derivarSkillsDeCurriculo(baseDados())
        expect(r.primeiro_emprego).toBe(true)
        expect(r.experiencia_meses).toBe(0)
    })

    it("soma meses de experiência entre múltiplas experiências", () => {
        const r = derivarSkillsDeCurriculo(baseDados({
            experiencias: [
                { empresa: "Empresa A", cargo: "Auxiliar", data_inicio: "01/2022", data_fim: "01/2023", atual: false, atividades: [] },
                { empresa: "Empresa B", cargo: "Estagiário", data_inicio: "01/2021", data_fim: "01/2022", atual: false, atividades: [] },
            ],
        }))
        expect(r.primeiro_emprego).toBe(false)
        expect(r.experiencia_meses).toBe(24)
        expect(r.skills_jsonb.resumo_experiencias).toEqual([
            "Auxiliar — Empresa A",
            "Estagiário — Empresa B",
        ])
    })

    it("escolhe a escolaridade mais alta entre múltiplas formações", () => {
        const r = derivarSkillsDeCurriculo(baseDados({
            formacoes: [
                { escolaridade: "Ensino Médio Completo", instituicao: "", status: "concluido", ano: "2018" },
                { escolaridade: "Superior Incompleto", instituicao: "", status: "cursando", ano: "2026" },
            ],
        }))
        expect(r.escolaridade_normalizada).toBe("Superior Incompleto")
        expect(r.skills_jsonb.escolaridade).toBe("Superior Incompleto")
    })

    it("extrai títulos de habilidades, ignorando entradas vazias", () => {
        const r = derivarSkillsDeCurriculo(baseDados({
            habilidades: [
                { titulo: "Excel", descricao: "Avançado" },
                { titulo: "", descricao: "sem título" },
            ],
        }))
        expect(r.skills_jsonb.habilidades).toEqual(["Excel"])
    })

    it("usa apresentação como resumo, com objetivo como fallback", () => {
        const comApresentacao = derivarSkillsDeCurriculo(baseDados({ apresentacao: "Perfil X", objetivo: "Cargo Y" }))
        expect(comApresentacao.skills_jsonb.resumo).toBe("Perfil X")

        const soObjetivo = derivarSkillsDeCurriculo(baseDados({ objetivo: "Cargo Y" }))
        expect(soObjetivo.skills_jsonb.resumo).toBe("Cargo Y")
    })

    it("identifica a origem como curriculo_estruturado, distinto do OCR", () => {
        const r = derivarSkillsDeCurriculo(baseDados())
        expect(r.skills_jsonb.origem).toBe(ORIGEM_CURRICULO_ESTRUTURADO)
        expect(r.skills_jsonb.origem).toBe("curriculo_estruturado")
    })

    it("não gera meses negativos para experiência com datas invertidas", () => {
        const r = derivarSkillsDeCurriculo(baseDados({
            experiencias: [
                { empresa: "Empresa A", cargo: "Auxiliar", data_inicio: "01/2024", data_fim: "01/2020", atual: false, atividades: [] },
            ],
        }))
        expect(r.experiencia_meses).toBe(0)
    })
})
