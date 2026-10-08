import { describe, expect, it } from "vitest"
import { candidatoEntraNaLista, contarPorVaga, rotuloVaga, textoConfirmacaoLote, vagaEntraNoSeletor } from "./feedback-tela"
import { telefoneValido, validarContato } from "./contato"

describe("tela Feedback — seletor e lista (AC2, AC4, D1)", () => {
    const contagens = contarPorVaga([
        { vaga_id: "v1", email_enviado_em: "2026-09-01" },
        { vaga_id: "v1", email_enviado_em: null },
        { vaga_id: "s1", email_enviado_em: null },
        { vaga_id: "v2", email_enviado_em: null },
        { vaga_id: null, email_enviado_em: "2026-09-01" },
    ])

    it("conta total e enviados por vaga", () => {
        expect(contagens.get("v1")).toEqual({ total: 2, enviados: 1 })
        expect(contagens.get("s1")).toEqual({ total: 1, enviados: 0 })
    })

    it("vaga normal entra só com currículo enviado; seleção entra com qualquer inscrito", () => {
        expect(vagaEntraNoSeletor("vaga_normal", contagens.get("v1"))).toBe(true)
        expect(vagaEntraNoSeletor("vaga_normal", contagens.get("v2"))).toBe(false)
        expect(vagaEntraNoSeletor("selecao_evento", contagens.get("s1"))).toBe(true)
        expect(vagaEntraNoSeletor("selecao_evento", undefined)).toBe(false)
    })

    it("lista: vaga normal só os enviados, seleção todos os inscritos", () => {
        expect(candidatoEntraNaLista("vaga_normal", { email_enviado_em: null })).toBe(false)
        expect(candidatoEntraNaLista("vaga_normal", { email_enviado_em: "2026-09-01" })).toBe(true)
        expect(candidatoEntraNaLista("selecao_evento", { email_enviado_em: null })).toBe(true)
    })

    it("confirmação do lote com contagem e rótulo do status (AC7)", () => {
        expect(textoConfirmacaoLote(17, "rejeitado")).toBe("Mudar 17 candidatos para Rejeitado?")
        expect(textoConfirmacaoLote(1, "selecionado")).toBe("Mudar 1 candidato para Selecionado?")
    })

    it("rótulo da vaga com número e tipo", () => {
        expect(rotuloVaga({ numero_vaga: 42, titulo: "Vendedor", tipo: "selecao_evento" })).toBe("#42 · Vendedor · Seleção")
        expect(rotuloVaga({ numero_vaga: null, titulo: null, tipo: "vaga_normal" })).toBe("Sem título · Vaga")
    })
})

describe("validação de contato (AC3, AC15)", () => {
    it("telefone com DDD, com ou sem 55", () => {
        expect(telefoneValido("(85) 99999-9999")).toBe(true)
        expect(telefoneValido("5585999999999")).toBe(true)
        expect(telefoneValido("8533334444")).toBe(true)
        expect(telefoneValido("99999999")).toBe(false)
    })

    it("obrigatório: exige nome, telefone e e-mail", () => {
        const r = validarContato({ nome: " ", telefone: "", email: "" }, { obrigatorio: true })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.erros).toHaveLength(3)
    })

    it("opcional aceita vazio, mas recusa formato inválido", () => {
        expect(validarContato({}, { obrigatorio: false })).toEqual({ ok: true, contato: { nome: null, telefone: null, email: null } })
        expect(validarContato({ email: "sem-arroba" }, { obrigatorio: false }).ok).toBe(false)
    })

    it("normaliza: telefone só com dígitos e e-mail em minúsculas", () => {
        expect(validarContato({ nome: " RH ", telefone: "(85) 99999-9999", email: "RH@Empresa.com" }, { obrigatorio: true }))
            .toEqual({ ok: true, contato: { nome: "RH", telefone: "85999999999", email: "rh@empresa.com" } })
    })
})
