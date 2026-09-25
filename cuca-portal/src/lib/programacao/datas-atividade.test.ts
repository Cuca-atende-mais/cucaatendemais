import { describe, expect, it } from "vitest"
import { aplicarDataFimEvento, aplicarDataInicioEvento, datasDaAtividade, diaMes, horaFimAntesDoInicio, isoOuNulo } from "./datas-atividade"
import { montarAtividadePayload } from "./payload"
import { aplicarMascaraDataDigitando } from "./mascaras"
import type { AtividadeForm } from "./tipos"

const evento = (over: Partial<AtividadeForm> = {}): AtividadeForm => ({
    _tempId: "1", categoria: "DIA A DIA", titulo: "Hora Pintada", descricao: null, local: "Biblioteca",
    data_atividade: null, hora_inicio: "14:00", hora_fim: "17:00", metadata: {}, ...over,
})

describe("datas-atividade (S-PROG-19)", () => {
    it("isoOuNulo só aceita data completa", () => {
        expect(isoOuNulo("2026-10-07")).toBe("2026-10-07")
        expect(isoOuNulo("07/10/20")).toBeNull()
        expect(isoOuNulo("")).toBeNull()
        expect(isoOuNulo(null)).toBeNull()
        expect(diaMes("2026-10-07")).toBe("07/10")
    })

    it("datasDaAtividade por categoria", () => {
        expect(datasDaAtividade({ categoria: "CURSOS", data_atividade: "2026-10-01", metadata: { data_inicio_raw: "2026-10-02", data_fim_raw: "2026-10-30" } }))
            .toEqual({ data_inicio: "2026-10-02", data_fim: "2026-10-30" })
        expect(datasDaAtividade({ categoria: "DIA A DIA", data_atividade: "2026-10-07", metadata: { data_fim_raw: "07/10/2" } }))
            .toEqual({ data_inicio: "2026-10-07", data_fim: null })
        expect(datasDaAtividade({ categoria: "ESPORTES", data_atividade: "2026-10-07", metadata: { data_fim_raw: "2026-10-07" } }))
            .toEqual({ data_inicio: null, data_fim: null })
    })

    it("data início: texto incompleto é guardado bruto; ao fechar, deriva dia da semana e NÃO preenche o fim", () => {
        expect(aplicarDataInicioEvento(evento(), "07/10/2").data_atividade).toBe("07/10/2")
        const a = aplicarDataInicioEvento(evento(), "07/10/2026")
        expect(a.data_atividade).toBe("2026-10-07")
        expect(a.metadata).toMatchObject({ dia_semana: "Quarta-feira", data_real: "07/10" })
        expect(a.metadata.data_fim_raw).toBeUndefined()
        expect(a.hora_fim).toBe("17:00")
    })

    it("data fim: só o que a pessoa digita; início digitado depois não mexe nela", () => {
        let a = aplicarDataFimEvento(evento(), "09/10/2")
        expect(a.metadata.data_fim_raw).toBe("09/10/2")
        a = aplicarDataFimEvento(a, "09/10/2026")
        expect(a.metadata.data_fim_raw).toBe("2026-10-09")
        expect(aplicarDataInicioEvento(a, "08/10/2026").metadata.data_fim_raw).toBe("2026-10-09")
    })

    it("horaFimAntesDoInicio: igual vale; CURSOS sempre compara; eventos só no mesmo dia", () => {
        expect(horaFimAntesDoInicio("DIA A DIA", "19:00", "19:00", "2026-10-07", "2026-10-07")).toBe(false)
        expect(horaFimAntesDoInicio("DIA A DIA", "19:00", "08:00", "2026-10-07", "2026-10-07")).toBe(true)
        expect(horaFimAntesDoInicio("ESPECIAIS", "19:00", "08:00", "2026-10-07", "2026-10-08")).toBe(false)
        expect(horaFimAntesDoInicio("CURSOS", "12:00", "09:00:00", "2026-10-01", "2026-10-30")).toBe(true)
        expect(horaFimAntesDoInicio("CURSOS", null, "09:00", null, null)).toBe(false)
    })

    it("digitação real, tecla a tecla, numa linha nova: data fim e hora fim continuam vazias", () => {
        let a = evento({ hora_fim: null })
        let digitado = ""
        for (const tecla of "08102026") {
            digitado = aplicarMascaraDataDigitando(digitado + tecla)
            a = aplicarDataInicioEvento(a, digitado)
        }
        expect(a.data_atividade).toBe("2026-10-08")
        expect(a.metadata.data_fim_raw).toBeUndefined()
        expect(a.hora_fim).toBeNull()
        expect(montarAtividadePayload(a, "Cuca Pici")).toMatchObject({ data_inicio: "2026-10-08", data_fim: null, hora_fim: null })
    })
})
