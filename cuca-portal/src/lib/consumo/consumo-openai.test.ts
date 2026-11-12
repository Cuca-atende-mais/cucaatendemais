import { describe, expect, it } from "vitest"
import {
    custoDaLinha,
    formatarCustoFeature,
    inicioDoMesUtc,
    type LinhaConsumo,
    resumirPorFeature,
    resumirTokensPorAgente,
    ROTULO_SEM_AGENTE,
    rotuloFeature,
    totais,
} from "./consumo-openai"

function linha(parcial: Partial<LinhaConsumo>): LinhaConsumo {
    return { feature: "chat", modelo: "gpt-4o-mini", agente_tipo: "Institucional", tokens_total: 0, tokens_prompt_cached: 0, custo_usd: 0, created_at: "2026-11-12T00:00:00Z", ...parcial }
}

describe("rótulos", () => {
    it("classificador_emprego tem nome legível e Whisper sem espaço sobrando", () => {
        expect(rotuloFeature("classificador_emprego")).toBe("Institucional (classificador de emprego)")
        expect(rotuloFeature("transcription")).toBe("Transcrição (Whisper)")
        expect(rotuloFeature("feature_nova")).toBe("feature_nova")
    })

    it("linhas sem agente aparecem como Worker, não como desconhecido", () => {
        const r = resumirTokensPorAgente([linha({ agente_tipo: null, tokens_total: 10 }), linha({ agente_tipo: "Institucional", tokens_total: 30 })])
        expect(r).toEqual([{ agente: "Institucional", tokens: 30 }, { agente: ROTULO_SEM_AGENTE, tokens: 10 }])
    })
})

describe("custo", () => {
    it("custo vazio é sem preço, não zero; texto numérico do banco vira número", () => {
        expect(custoDaLinha({ custo_usd: null })).toBeNull()
        expect(custoDaLinha({ custo_usd: "" })).toBeNull()
        expect(custoDaLinha({ custo_usd: "0.0125" })).toBe(0.0125)
        expect(custoDaLinha({ custo_usd: 0 })).toBe(0)
    })

    it("Whisper (sem preço) mostra 'sem preço'; embedding minúsculo mostra '< $0.0001'", () => {
        const resumo = resumirPorFeature([
            linha({ feature: "transcription", custo_usd: null }),
            linha({ feature: "transcription", custo_usd: null }),
            linha({ feature: "embedding", custo_usd: 0.000002 }),
            linha({ feature: "chat", custo_usd: 1.23456 }),
        ])
        const porFeature = Object.fromEntries(resumo.map((r) => [r.feature, r]))
        expect(formatarCustoFeature(porFeature.transcription)).toBe("sem preço")
        expect(porFeature.transcription.chamadas).toBe(2)
        expect(formatarCustoFeature(porFeature.embedding)).toBe("< $0.0001")
        expect(formatarCustoFeature(porFeature.chat)).toBe("$1.2346")
        expect(formatarCustoFeature({ custo: 0, chamadasComPreco: 3 })).toBe("$0.0000")
        expect(resumo[0].feature).toBe("chat")
    })

    it("totais somam custo só das linhas com preço e contam os tokens em cache", () => {
        const t = totais([
            linha({ custo_usd: 0.5, tokens_total: 1000, tokens_prompt_cached: 600 }),
            linha({ feature: "transcription", custo_usd: null, tokens_total: 0, tokens_prompt_cached: null }),
        ])
        expect(t).toEqual({ custo: 0.5, tokens: 1000, tokensEmCache: 600, chamadas: 2 })
    })
})

describe("início do mês", () => {
    it("usa o corte em UTC, como a fatura da OpenAI (01/11 às 02h em Fortaleza ainda é 01/11 UTC)", () => {
        expect(inicioDoMesUtc(new Date("2026-11-12T15:00:00Z"))).toBe("2026-11-01T00:00:00.000Z")
        // 31/10 às 22h em Fortaleza = 01/11 01h UTC: já é novembro na OpenAI
        expect(inicioDoMesUtc(new Date("2026-11-01T01:00:00Z"))).toBe("2026-11-01T00:00:00.000Z")
    })
})
