import { describe, expect, it } from "vitest"
import {
    criarAssinaturaDownload,
    criarDownloadToken,
    criarRespostaCurriculoPublico,
    hashDownloadToken,
    normalizarCvDados,
    normalizarTelefone,
    verificarAssinaturaDownload,
} from "./curriculo-publico"

describe("curriculo publico", () => {
    it("normaliza telefone com DDI brasileiro", () => {
        expect(normalizarTelefone("+55 (85) 99999-9999")).toBe("85999999999")
        expect(normalizarTelefone("(85) 3333-4444")).toBe("8533334444")
    })

    it("gera e valida assinatura de download vinculada ao talent_id", () => {
        const secret = "segredo-test"
        const exp = Math.floor(Date.now() / 1000) + 60
        const token = "token-test"
        const sig = criarAssinaturaDownload({ talentId: "talent-a", token, exp, secret })

        expect(verificarAssinaturaDownload({
            talentId: "talent-a",
            token,
            exp: String(exp),
            sig,
            secret,
        })).toBe(true)

        expect(verificarAssinaturaDownload({
            talentId: "talent-b",
            token,
            exp: String(exp),
            sig,
            secret,
        })).toBe(false)
    })

    it("cria token opaco com hash e URL sem apontar para print/id publico", () => {
        const token = criarDownloadToken("talent-a", "segredo-test")
        expect(token.tokenHash).toBe(hashDownloadToken(token.token))
        expect(token.url).toContain("/api/empregabilidade/curriculo/download")
        expect(token.url).not.toContain("/empregabilidade/print")
    })

    it("response publico retorna apenas o link one-use de download", () => {
        const response = criarRespostaCurriculoPublico({
            curriculoId: "curriculo-a",
            talentId: "talent-a",
            downloadUrl: "/api/empregabilidade/curriculo/download?token=one-use",
        })
        const serializado = JSON.stringify(response)

        expect(response).toEqual({
            curriculo_id: "curriculo-a",
            talent_id: "talent-a",
            pdf_url: "/api/empregabilidade/curriculo/download?token=one-use",
        })
        expect(serializado).not.toContain("arquivo_cv_url")
        expect(serializado).not.toContain("talent_bank")
        expect(serializado).not.toContain("http://")
        expect(serializado).not.toContain("https://")
        expect(serializado).not.toContain("/empregabilidade/print")
    })

    it("SQS-63: inclui docx_url só quando a geração do DOCX deu certo", () => {
        const semDocx = criarRespostaCurriculoPublico({
            curriculoId: "curriculo-a",
            talentId: "talent-a",
            downloadUrl: "/api/empregabilidade/curriculo/download?token=one-use-pdf",
        })
        expect(semDocx).not.toHaveProperty("docx_url")

        const comDocx = criarRespostaCurriculoPublico({
            curriculoId: "curriculo-a",
            talentId: "talent-a",
            downloadUrl: "/api/empregabilidade/curriculo/download?token=one-use-pdf",
            docxDownloadUrl: "/api/empregabilidade/curriculo/download?token=one-use-docx",
        })
        expect(comDocx.docx_url).toBe("/api/empregabilidade/curriculo/download?token=one-use-docx")
    })

    it("preserva o formato CvDados usado pelo PDF", () => {
        const dados = normalizarCvDados({ nome: " Maria ", telefone: "+55 85 99999-9999" }, {
            nome: "",
            telefone: "",
        })

        expect(dados.nome).toBe("Maria")
        expect(dados.telefone).toBe("85999999999")
        expect(dados.experiencias).toEqual([])
        expect(dados.formacoes).toEqual([])
    })
})
