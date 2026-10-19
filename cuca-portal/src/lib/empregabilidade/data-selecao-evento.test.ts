import { describe, it, expect } from "vitest"
import {
    somarDiasISO,
    dataMinimaSelecaoEvento,
    formatarDataBR,
    mensagemDataMinimaSelecaoEvento,
    validarDatasSelecaoEvento,
    MSG_DATA_SELECAO_EVENTO_INVALIDA,
} from "./data-selecao-evento"

// S-EMP-GES-05 — data da seleção por evento no mínimo hoje + 5 dias (AC1, AC2, AC9).

const HOJE = "2026-10-19"

describe("dataMinimaSelecaoEvento", () => {
    it("soma 5 dias corridos", () => {
        expect(dataMinimaSelecaoEvento(HOJE)).toBe("2026-10-24")
    })

    it("vira o mês", () => {
        expect(dataMinimaSelecaoEvento("2026-10-29")).toBe("2026-11-03")
    })

    it("vira o ano", () => {
        expect(dataMinimaSelecaoEvento("2026-12-29")).toBe("2027-01-03")
    })

    it("considera fevereiro de ano bissexto", () => {
        expect(somarDiasISO("2028-02-26", 5)).toBe("2028-03-02")
        expect(somarDiasISO("2027-02-26", 5)).toBe("2027-03-03")
    })

    it("sem argumento, usa o hoje do fuso de Fortaleza e devolve YYYY-MM-DD", () => {
        expect(dataMinimaSelecaoEvento()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
})

describe("mensagemDataMinimaSelecaoEvento", () => {
    it("usa a data mínima em dd/mm/aaaa", () => {
        expect(formatarDataBR("2026-10-24")).toBe("24/10/2026")
        expect(mensagemDataMinimaSelecaoEvento("2026-10-24")).toBe(
            "A data da seleção precisa ser a partir de 24/10/2026 (5 dias a partir de hoje).",
        )
    })
})

describe("validarDatasSelecaoEvento", () => {
    const msg = mensagemDataMinimaSelecaoEvento("2026-10-24")

    it("recusa hoje + 4", () => {
        expect(validarDatasSelecaoEvento([{ data: "2026-10-23", hora: "08:00" }], HOJE)).toEqual({ ok: false, erro: msg })
    })

    it("aceita hoje + 5", () => {
        expect(validarDatasSelecaoEvento([{ data: "2026-10-24", hora: "08:00" }], HOJE)).toEqual({ ok: true })
    })

    it("recusa quando uma de várias datas é inválida", () => {
        const r = validarDatasSelecaoEvento(
            [{ data: "2026-11-10", hora: "08:00" }, { data: "2026-10-20", hora: "13:00" }],
            HOJE,
        )
        expect(r).toEqual({ ok: false, erro: msg })
    })

    it("recusa data no passado", () => {
        expect(validarDatasSelecaoEvento([{ data: "2026-09-01" }], HOJE).ok).toBe(false)
    })

    it("ignora linhas sem data", () => {
        expect(validarDatasSelecaoEvento([{ data: "2026-10-30" }, { data: "", hora: "08:00" }], HOJE)).toEqual({ ok: true })
    })

    it("recusa formato fora de YYYY-MM-DD e entrada que não é lista (cliente contornado)", () => {
        expect(validarDatasSelecaoEvento([{ data: "24/10/2026" }], HOJE)).toEqual({ ok: false, erro: MSG_DATA_SELECAO_EVENTO_INVALIDA })
        expect(validarDatasSelecaoEvento([{ data: 20261024 }], HOJE)).toEqual({ ok: false, erro: MSG_DATA_SELECAO_EVENTO_INVALIDA })
        expect(validarDatasSelecaoEvento("2026-10-24", HOJE)).toEqual({ ok: false, erro: MSG_DATA_SELECAO_EVENTO_INVALIDA })
    })
})
