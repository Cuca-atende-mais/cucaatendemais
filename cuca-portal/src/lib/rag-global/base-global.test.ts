import { describe, expect, it } from "vitest"
import { caminhoPdfValido, documentoDaBaseGlobal, lerDadosDocumentoGlobal } from "./base-global"

const doc = (tipo: string, unidade_cuca: string | null = null, metadados: Record<string, unknown> | null = { source_type: "rede_cuca_global" }) =>
    ({ tipo, unidade_cuca, metadados })

describe("documento da base global (AC 10)", () => {
    it("aceita os tipos do formulário e o resumo da rede, sem unidade", () => {
        for (const tipo of ["FAQ", "servicos_rede", "resumo_rede", "Institucional", "Outro"]) expect(documentoDaBaseGlobal(doc(tipo))).toBe(true)
        expect(documentoDaBaseGlobal(doc("FAQ", null, null))).toBe(true)
    })

    it("recusa eventos pontuais, vagas, programação mensal e Academia Enem", () => {
        for (const tipo of ["eventos_pontuais", "job_posting", "vagas", "monthly_program"]) expect(documentoDaBaseGlobal(doc(tipo))).toBe(false)
        expect(documentoDaBaseGlobal(doc("FAQ", null, { source_type: "academia_enem" }))).toBe(false)
    })

    it("recusa documento com unidade", () => {
        expect(documentoDaBaseGlobal(doc("FAQ", "Cuca Barra"))).toBe(false)
    })
})

describe("dados do formulário da base global", () => {
    it("texto exige título, tipo do formulário e conteúdo", () => {
        const r = lerDadosDocumentoGlobal({ titulo: " Endereços ", tipo: "Endereços", modo: "texto", conteudo: "Rua X", ativo: true })
        expect(r).toEqual({ dados: { titulo: "Endereços", tipo: "Endereços", conteudo: "Rua X", pdf: null } })
        expect(lerDadosDocumentoGlobal({ tipo: "FAQ", conteudo: "x" })).toHaveProperty("erro")
        expect(lerDadosDocumentoGlobal({ titulo: "a", tipo: "FAQ", conteudo: " " })).toHaveProperty("erro")
    })

    it("tipo fora do formulário só se já era o tipo do documento", () => {
        expect(lerDadosDocumentoGlobal({ titulo: "a", tipo: "monthly_program", conteudo: "x" })).toHaveProperty("erro")
        expect(lerDadosDocumentoGlobal({ titulo: "a", tipo: "resumo_rede", conteudo: "x" })).toHaveProperty("erro")
        expect(lerDadosDocumentoGlobal({ titulo: "a", tipo: "resumo_rede", conteudo: "x" }, { tipoAtual: "resumo_rede" })).toHaveProperty("dados")
    })

    it("PDF só dentro de global/; edição sem PDF novo mantém o atual", () => {
        expect(caminhoPdfValido("global/1_a.pdf")).toBe(true)
        for (const p of ["outra/a.pdf", "global/../x.pdf", "global/", 42]) expect(caminhoPdfValido(p)).toBe(false)
        expect(lerDadosDocumentoGlobal({ titulo: "a", tipo: "FAQ", modo: "pdf", pdf_path: "enem/a.pdf" })).toHaveProperty("erro")
        expect(lerDadosDocumentoGlobal({ titulo: "a", tipo: "FAQ", modo: "pdf" })).toHaveProperty("erro")
        expect(lerDadosDocumentoGlobal({ titulo: "a", tipo: "FAQ", modo: "pdf" }, { temPdfAtual: true }))
            .toEqual({ dados: { titulo: "a", tipo: "FAQ", conteudo: null, pdf: null } })
        expect(lerDadosDocumentoGlobal({ titulo: "a", tipo: "FAQ", modo: "pdf", pdf_path: "global/1_a.pdf", pdf_nome: "a.pdf" }))
            .toEqual({ dados: { titulo: "a", tipo: "FAQ", conteudo: null, pdf: { path: "global/1_a.pdf", nome: "a.pdf" } } })
    })
})
