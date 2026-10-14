import { describe, expect, it } from "vitest"
import {
    limparParametro,
    montarComponentesTemplate,
    normalizarWaId,
    renderizarCorpo,
    rotuloStatusEnvio,
    statusFeedback,
    telefoneDestino,
} from "./feedback-solicitacao"

const variaveis = [
    { posicao: 2, descricao: "titulo_vaga" },
    { posicao: 1, descricao: "nome_empresa" },
    { posicao: 3, descricao: "link_feedback" },
]
const valores = { nome_empresa: "Mercado\nBom  Preço", titulo_vaga: "Repositor", link_feedback: "https://portal/feedback-empresa/abc" }

describe("parâmetros do template aprovado (AC2)", () => {
    it("monta o corpo NAMED na ordem das posições, com os nomes cadastrados", () => {
        expect(montarComponentesTemplate(variaveis, valores)).toEqual([{
            type: "body",
            parameters: [
                { type: "text", parameter_name: "nome_empresa", text: "Mercado Bom Preço" },
                { type: "text", parameter_name: "titulo_vaga", text: "Repositor" },
                { type: "text", parameter_name: "link_feedback", text: "https://portal/feedback-empresa/abc" },
            ],
        }])
    })

    it("recusa variável sem valor em vez de mandar parâmetro vazio à Meta", () => {
        expect(() => montarComponentesTemplate(variaveis, { ...valores, nome_empresa: "  " })).toThrow("nome_empresa")
    })

    it("tira quebra de linha, tabulação e espaços repetidos", () => {
        expect(limparParametro(" a\r\n\tb    c ")).toBe("a b c")
    })

    it("renderiza o texto que vai para o Atendimento", () => {
        const corpo = "Olá, equipe de RH da {{1}}. Vaga {{2}}. Acesse: {{3}}"
        expect(renderizarCorpo(corpo, variaveis, valores)).toBe("Olá, equipe de RH da Mercado Bom Preço. Vaga Repositor. Acesse: https://portal/feedback-empresa/abc")
    })
})

describe("números", () => {
    it("destino: põe o 55 e recusa telefone sem DDD", () => {
        expect(telefoneDestino("(85) 98888-7777")).toBe("5585988887777")
        expect(telefoneDestino("558588887777")).toBe("558588887777")
        expect(telefoneDestino("98888-7777")).toBeNull()
        expect(telefoneDestino(null)).toBeNull()
    })

    it("wa_id: mesmo ajuste do webhook de entrada (12 dígitos ganha o 9)", () => {
        expect(normalizarWaId("558588887777")).toBe("5585988887777")
        expect(normalizarWaId("5585988887777")).toBe("5585988887777")
        expect(normalizarWaId("558598887777")).toBe("558598887777")
    })
})

describe("acompanhamento (AC4)", () => {
    const agora = new Date("2026-10-14T12:00:00Z")

    it("status da mensagem com o código do erro na falha", () => {
        expect(rotuloStatusEnvio("lido")).toBe("Lida")
        expect(rotuloStatusEnvio("falhou", "131049")).toBe("Falhou (131049)")
    })

    it("feedback: aguardando, expirado, não enviado e respondido", () => {
        const base = { status_envio: "entregue", expires_at: "2026-10-15T12:00:00Z", respondido_em: null }
        expect(statusFeedback(base, agora)).toBe("aguardando")
        expect(statusFeedback({ ...base, expires_at: "2026-10-14T11:00:00Z" }, agora)).toBe("expirado")
        expect(statusFeedback({ ...base, status_envio: "falhou" }, agora)).toBe("nao_enviado")
        expect(statusFeedback({ ...base, respondido_em: "2026-10-14T10:00:00Z" }, agora)).toBe("respondido")
    })
})
