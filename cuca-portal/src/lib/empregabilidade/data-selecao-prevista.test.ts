import { describe, it, expect } from "vitest"
import {
    validarDataSelecaoPrevista,
    hojeBrasilISO,
    MSG_DATA_SELECAO_AUSENTE,
    MSG_DATA_SELECAO_NO_PASSADO,
    MSG_DATA_SELECAO_INVALIDA,
} from "./data-selecao-prevista"

// S-EMP-AUD-042 — data prevista da seleção como campo bloqueante (AC1/AC2/AC3).

describe("hojeBrasilISO", () => {
    it("retorna uma string no formato YYYY-MM-DD", () => {
        expect(hojeBrasilISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
})

describe("validarDataSelecaoPrevista", () => {
    it("rejeita ausência (undefined) com a mensagem de campo obrigatório (AC1/AC2)", () => {
        const r = validarDataSelecaoPrevista(undefined)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.erro).toBe(MSG_DATA_SELECAO_AUSENTE)
    })

    it("rejeita string vazia com a mesma mensagem de ausência", () => {
        const r = validarDataSelecaoPrevista("")
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.erro).toBe(MSG_DATA_SELECAO_AUSENTE)
    })

    it("rejeita string só com espaços como ausência", () => {
        const r = validarDataSelecaoPrevista("   ")
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.erro).toBe(MSG_DATA_SELECAO_AUSENTE)
    })

    it("rejeita tipo não-string (contorno de cliente) como ausência, não crasha", () => {
        const r = validarDataSelecaoPrevista(12345)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.erro).toBe(MSG_DATA_SELECAO_AUSENTE)
    })

    it("rejeita formato inválido com mensagem distinta da de ausência", () => {
        const r = validarDataSelecaoPrevista("06/09/2026")
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.erro).toBe(MSG_DATA_SELECAO_INVALIDA)
        expect(MSG_DATA_SELECAO_INVALIDA).not.toBe(MSG_DATA_SELECAO_AUSENTE)
    })

    it("rejeita data no passado com mensagem distinta da de ausência (AC3)", () => {
        const r = validarDataSelecaoPrevista("2020-01-01")
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.erro).toBe(MSG_DATA_SELECAO_NO_PASSADO)
        expect(MSG_DATA_SELECAO_NO_PASSADO).not.toBe(MSG_DATA_SELECAO_AUSENTE)
    })

    it("aceita a data de hoje (limite exato, não é 'passado')", () => {
        const r = validarDataSelecaoPrevista(hojeBrasilISO())
        expect(r.ok).toBe(true)
    })

    it("aceita uma data futura válida e retorna o valor limpo", () => {
        const r = validarDataSelecaoPrevista("2030-12-31")
        expect(r).toEqual({ ok: true, valor: "2030-12-31" })
    })

    it("aceita e faz trim de espaços ao redor de uma data futura válida", () => {
        const r = validarDataSelecaoPrevista("  2030-12-31  ")
        expect(r).toEqual({ ok: true, valor: "2030-12-31" })
    })

    it("rejeita ano com dígitos a menos (formato mal montado)", () => {
        const r = validarDataSelecaoPrevista("30-12-31")
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.erro).toBe(MSG_DATA_SELECAO_INVALIDA)
    })
})
