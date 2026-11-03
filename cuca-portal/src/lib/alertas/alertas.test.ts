import { describe, expect, it } from "vitest"
import {
    formatarDataAlerta,
    normalizarAlertas,
    paginaValida,
    severidadeInfo,
    situacaoEmail,
    textoContador,
    totalPaginas,
} from "./alertas"

describe("textoContador (S-INST-QUAL-12)", () => {
    it("zero ou inválido não mostra indicador", () => {
        expect(textoContador(0)).toBe("")
        expect(textoContador(-1)).toBe("")
        expect(textoContador(Number.NaN)).toBe("")
    })
    it("mostra o número e limita em 99+", () => {
        expect(textoContador(1)).toBe("1")
        expect(textoContador(99)).toBe("99")
        expect(textoContador(100)).toBe("99+")
    })
})

describe("paginação de 10 em 10", () => {
    it("totalPaginas", () => {
        expect(totalPaginas(0)).toBe(1)
        expect(totalPaginas(10)).toBe(1)
        expect(totalPaginas(11)).toBe(2)
        expect(totalPaginas(25)).toBe(3)
    })
    it("paginaValida corrige página fora do intervalo", () => {
        expect(paginaValida(0, 25)).toBe(1)
        expect(paginaValida(5, 25)).toBe(3)
        expect(paginaValida(2, 25)).toBe(2)
    })
})

describe("severidade, data e e-mail", () => {
    it("rótulos e padrão", () => {
        expect(severidadeInfo("critico").rotulo).toBe("Crítico")
        expect(severidadeInfo("atencao").rotulo).toBe("Atenção")
        expect(severidadeInfo("info").rotulo).toBe("Informativo")
        expect(severidadeInfo("outro").rotulo).toBe("Atenção")
    })
    it("data no horário de Fortaleza", () => {
        expect(formatarDataAlerta("2026-11-03T15:45:00Z")).toBe("03/11/2026, 12:45")
        expect(formatarDataAlerta(null)).toBe("")
    })
    it("situação do e-mail", () => {
        expect(situacaoEmail({ email_enviado_em: "2026-11-03T16:26:36Z", email_erro: null })).toEqual({
            texto: "E-mail enviado em 03/11/2026, 13:26",
            ok: true,
        })
        expect(situacaoEmail({ email_enviado_em: null, email_erro: "HTTP 403" })).toEqual({
            texto: "E-mail não enviado: HTTP 403",
            ok: false,
        })
        expect(situacaoEmail({ email_enviado_em: null, email_erro: null }).ok).toBe(false)
    })
})

describe("normalizarAlertas", () => {
    it("converte o total (bigint) e campos ausentes", () => {
        const [a] = normalizarAlertas([{ id: "x", titulo: "T", total: "12", lido: false }])
        expect(a.total).toBe(12)
        expect(a.detalhe).toBeNull()
        expect(a.severidade).toBe("atencao")
    })
    it("entrada inválida vira lista vazia", () => {
        expect(normalizarAlertas(null)).toEqual([])
    })
})
