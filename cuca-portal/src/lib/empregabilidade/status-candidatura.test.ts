import { describe, expect, it } from "vitest"
import {
    avisoSelecionadoAtivo,
    mensagemRejeicao,
    chaveTelefone,
    decidirAcaoTalento,
    ehStatusEditavel,
    novoTalento,
    origemCandidatura,
    preencherCamposVazios,
    rotuloStatusCandidatura,
    temCurriculo,
    type CandidaturaParaTalento,
} from "./status-candidatura"

const cand = (extra: Partial<CandidaturaParaTalento> = {}): CandidaturaParaTalento => ({
    id: "cand-1",
    vaga_id: "vaga-1",
    nome: "Fulana de Tal",
    telefone: "85987654321",
    data_nascimento: "2004-05-10",
    arquivo_cv_url: "https://x/cv.pdf",
    dados_ocr_json: { experiencia_meses: 0, cargo: "Vendedora" },
    area_interesse: ["Comércio"],
    created_at: "2026-09-01T10:00:00Z",
    pcd_candidato: false,
    pcd_tipo_candidato: null,
    ...extra,
})

describe("chaveTelefone (espelha emp_chave_telefone do banco)", () => {
    it("casa o mesmo número com e sem 55, com e sem o 9 extra e com máscara", () => {
        const esperado = "8587654321"
        expect(chaveTelefone("5585987654321")).toBe(esperado)
        expect(chaveTelefone("85987654321")).toBe(esperado)
        expect(chaveTelefone("8587654321")).toBe(esperado)
        expect(chaveTelefone("558587654321")).toBe(esperado)
        expect(chaveTelefone("+55 (85) 9 8765-4321")).toBe(esperado)
    })

    it("vazio vira null e formato fora do padrão fica com todos os dígitos", () => {
        expect(chaveTelefone("")).toBeNull()
        expect(chaveTelefone(null)).toBeNull()
        expect(chaveTelefone("85987654321 / 85912345678")).toBe("8598765432185912345678")
    })
})

describe("decidirAcaoTalento", () => {
    const base = { cadastrosExistentes: 1, processoAtivoEmOutraVaga: false, temCurriculo: true }

    it("D2: selecionado e contratado travam o talento existente", () => {
        expect(decidirAcaoTalento({ ...base, novoStatus: "selecionado" })).toEqual({ tipo: "travar", status: "selecionado" })
        expect(decidirAcaoTalento({ ...base, novoStatus: "contratado" })).toEqual({ tipo: "travar", status: "contratado" })
    })

    it("selecionado sem cadastro não cria nada", () => {
        expect(decidirAcaoTalento({ ...base, cadastrosExistentes: 0, novoStatus: "selecionado" }))
            .toEqual({ tipo: "nenhuma", motivo: "sem_cadastro" })
    })

    it("rejeitado libera o cadastro existente (inclusive duplicados), sem criar outro", () => {
        expect(decidirAcaoTalento({ ...base, cadastrosExistentes: 3, novoStatus: "rejeitado" })).toEqual({ tipo: "liberar" })
    })

    it("D4: rejeitado com processo ativo em outra vaga não libera", () => {
        expect(decidirAcaoTalento({ ...base, processoAtivoEmOutraVaga: true, novoStatus: "rejeitado" }))
            .toEqual({ tipo: "nenhuma", motivo: "processo_ativo" })
    })

    it("rejeitado sem cadastro cria só se tiver currículo (D5)", () => {
        expect(decidirAcaoTalento({ ...base, cadastrosExistentes: 0, novoStatus: "rejeitado" })).toEqual({ tipo: "criar" })
        expect(decidirAcaoTalento({ ...base, cadastrosExistentes: 0, temCurriculo: false, novoStatus: "rejeitado" }))
            .toEqual({ tipo: "nenhuma", motivo: "sem_curriculo" })
    })

    it("pendente não mexe no Banco de Talentos", () => {
        expect(decidirAcaoTalento({ ...base, novoStatus: "pendente" })).toEqual({ tipo: "nenhuma", motivo: "status_sem_reflexo" })
    })
})

describe("preencherCamposVazios", () => {
    it("nunca apaga nem sobrescreve habilidades, currículo ou nome já existentes", () => {
        const talento = { nome: "Nome Antigo", skills_jsonb: { python: true }, arquivo_cv_url: "https://x/antigo.pdf", area_interesse: ["TI"] }
        expect(preencherCamposVazios(talento, cand({ dados_ocr_json: {} }))).toEqual({
            data_nascimento: "2004-05-10",
            data_curriculo: "2026-09-01T10:00:00Z",
        })
    })

    it("preenche o que estiver vazio", () => {
        const patch = preencherCamposVazios({ nome: "", skills_jsonb: null, arquivo_cv_url: null, area_interesse: [] }, cand())
        expect(patch).toMatchObject({
            nome: "Fulana de Tal",
            skills_jsonb: { experiencia_meses: 0, cargo: "Vendedora" },
            arquivo_cv_url: "https://x/cv.pdf",
            area_interesse: ["Comércio"],
        })
    })
})

describe("novoTalento", () => {
    it("monta o cadastro com status disponível e origem na candidatura", () => {
        expect(novoTalento(cand())).toMatchObject({
            status: "disponivel",
            candidatura_origem_id: "cand-1",
            vaga_origem_id: "vaga-1",
            primeiro_emprego: true,
        })
    })

    it("OCR vazio não vira habilidades", () => {
        expect(novoTalento(cand({ dados_ocr_json: {} })).skills_jsonb).toBeNull()
    })
})

describe("auxiliares", () => {
    it("temCurriculo considera arquivo ou OCR preenchido", () => {
        expect(temCurriculo({ arquivo_cv_url: "x", dados_ocr_json: null })).toBe(true)
        expect(temCurriculo({ arquivo_cv_url: null, dados_ocr_json: { a: 1 } })).toBe(true)
        expect(temCurriculo({ arquivo_cv_url: null, dados_ocr_json: {} })).toBe(false)
    })

    it("origem: Banco de Talentos pelo prefixo das observações", () => {
        expect(origemCandidatura("banco_talentos:abc")).toBe("banco_talentos")
        expect(origemCandidatura("Incluído manualmente")).toBe("direta")
        expect(origemCandidatura(null)).toBe("direta")
    })

    it("só os 4 status da tela são editáveis", () => {
        expect(["pendente", "selecionado", "contratado", "rejeitado"].every(ehStatusEditavel)).toBe(true)
        expect(["convite_enviado", "aprovado_empresa", "banco_talentos", "x", null].some(ehStatusEditavel)).toBe(false)
        expect(rotuloStatusCandidatura("aprovado_empresa")).toBe("Aprovado pela empresa")
    })

    it("D3: aviso de selecionado pausado salvo EMPREG_NOTIFICAR_SELECIONADO_ATIVO=true", () => {
        expect(avisoSelecionadoAtivo(undefined)).toBe(false)
        expect(avisoSelecionadoAtivo("false")).toBe(false)
        expect(avisoSelecionadoAtivo(" TRUE ")).toBe(true)
    })
})

describe("mensagemRejeicao (observação 1 do QA)", () => {
    it("só diz que voltou ao Banco de Talentos quando a regra devolveu", () => {
        expect(mensagemRejeicao("liberar")).toBe("Candidato rejeitado e devolvido ao Banco de Talentos.")
        expect(mensagemRejeicao("criar")).toBe("Candidato rejeitado e devolvido ao Banco de Talentos.")
        expect(mensagemRejeicao("nenhuma", "processo_ativo")).toContain("está em processo em outra vaga")
        expect(mensagemRejeicao("nenhuma", "sem_curriculo")).toContain("Sem currículo")
        expect(mensagemRejeicao(undefined)).toBe("Candidato rejeitado.")
    })
})
