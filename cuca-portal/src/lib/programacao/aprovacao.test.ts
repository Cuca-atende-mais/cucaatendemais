import { describe, expect, it } from "vitest"
import { linhaIncompleta, motivosFaltantes } from "./aprovacao"

// Achado do @qa na revisão de S-PROG-02/03/04/05: o bloqueio de "Enviar para aprovação"
// reusava `linhaTemProblema` (mede contaminação, não completude) — uma linha de CURSOS só com
// título passava como "sem problema". Estes testes travam o caso exato que expôs isso.

describe("motivosFaltantes/linhaIncompleta — CURSOS", () => {
    it("só com título é incompleta, e lista os 5 campos que faltam (achado do @qa)", () => {
        const linha = { categoria: "CURSOS", titulo: "Curso qualquer", descricao: null, local: null, metadata: {} }
        expect(linhaIncompleta(linha)).toBe(true)
        expect(motivosFaltantes(linha)).toEqual(
            expect.arrayContaining(["horário de início", "horário de fim", "educador", "vagas", "carga horária", "ementa", "dias da semana"])
        )
    })

    it("com todos os campos obrigatórios não é incompleta", () => {
        const linha = {
            categoria: "CURSOS", titulo: "Violão", descricao: null, local: null,
            hora_inicio: "09:00", hora_fim: "12:00",
            metadata: { educador: "Edmundo", vagas: "10", carga_horaria: "21", ementa: "Estudo de violão.", dias_semana: "Qua e Sex" },
        }
        expect(linhaIncompleta(linha)).toBe(false)
    })
})

describe("motivosFaltantes/linhaIncompleta — ESPORTES", () => {
    it("sem professor/turma/vagas/sexo/faixa/dias é incompleta", () => {
        const linha = { categoria: "ESPORTES", titulo: "Natação", descricao: null, local: null, metadata: {} }
        expect(linhaIncompleta(linha)).toBe(true)
        expect(motivosFaltantes(linha)).toEqual(
            expect.arrayContaining(["professor", "turma", "vagas", "sexo", "faixa etária", "dias da semana"])
        )
    })

    it("completa não acusa nada", () => {
        const linha = {
            categoria: "ESPORTES", titulo: "Natação", descricao: null, local: null,
            hora_inicio: "08:00", hora_fim: "09:00",
            metadata: { professor: "Ricardo", turma: "Turma 1", vagas: "25", sexo: "Misto", faixa_etaria: "7 a 10 anos", dias_semana: "Seg e Qua" },
        }
        expect(linhaIncompleta(linha)).toBe(false)
    })
})

describe("motivosFaltantes/linhaIncompleta — DIA A DIA/ESPECIAIS", () => {
    it("sem data/local/sessão/atividade é incompleta", () => {
        const linha = { categoria: "DIA A DIA", titulo: "Programa X", descricao: null, local: null, metadata: {} }
        expect(linhaIncompleta(linha)).toBe(true)
        expect(motivosFaltantes(linha)).toEqual(
            expect.arrayContaining(["data", "local", "sessão", "descrição da atividade"])
        )
    })

    it("completa não acusa nada", () => {
        const linha = {
            categoria: "DIA A DIA", titulo: "Comunidade em Pauta", descricao: null, local: "Anfiteatro",
            hora_inicio: "19:00", hora_fim: "21:00", data_atividade: "2026-08-11",
            metadata: { sessao: "DPDH", atividade: "Oficina de passinho" },
        }
        expect(linhaIncompleta(linha)).toBe(false)
    })
})

describe("motivosFaltantes — sempre checa horário e título, em toda categoria", () => {
    it("título vazio é sempre falta, mesmo em linha completa nos outros campos", () => {
        const linha = {
            categoria: "ESPORTES", titulo: "", descricao: null, local: null,
            hora_inicio: "08:00", hora_fim: "09:00",
            metadata: { professor: "Ricardo", turma: "Turma 1", vagas: "25", sexo: "Misto", faixa_etaria: "7 a 10 anos", dias_semana: "Seg e Qua" },
        }
        expect(motivosFaltantes(linha)).toContain("título")
    })
})
