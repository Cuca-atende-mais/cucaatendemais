import { describe, expect, it } from "vitest"
import {
    MSG_UNIDADE_CURRICULOS_AUSENTE,
    MSG_UNIDADE_CURRICULOS_INVALIDA,
    MSG_UNIDADE_TRATAMENTO_AUSENTE,
    MSG_UNIDADE_TRATAMENTO_INVALIDA,
    escolherDataSelecao,
    formatarDataHoraSelecao,
    formatarDataISO,
    primeiroErro,
    rotuloUnidadeCurriculos,
    validarUnidadesNoServidor,
    validarUnidadesVaga,
} from "./unidades-vaga"

const U1 = "ecbc8153-a94f-4d9b-9e61-7b0e0cd68740"
const U2 = "2a1f2bee-f89a-4d2b-b1bd-175c7c9e18d4"

describe("S-EMP-GES-13 — mensagens exatas (AC9)", () => {
    it("usa as frases pedidas pelo Junior", () => {
        expect(MSG_UNIDADE_TRATAMENTO_AUSENTE).toBe("Preencha a unidade de tratamento.")
        expect(MSG_UNIDADE_CURRICULOS_AUSENTE).toBe("Preencha a unidade de currículos.")
    })
})

describe("validarUnidadesVaga", () => {
    it("aponta os dois campos quando os dois faltam", () => {
        expect(validarUnidadesVaga({})).toEqual({
            tratamento: MSG_UNIDADE_TRATAMENTO_AUSENTE,
            curriculos: MSG_UNIDADE_CURRICULOS_AUSENTE,
        })
    })
    it("aceita unidade específica no tratamento e Toda a Rede nos currículos", () => {
        expect(validarUnidadesVaga({ tratamento: U1, curriculos: "global" })).toEqual({})
        expect(validarUnidadesVaga({ tratamento: U1, curriculos: U2 })).toEqual({})
    })
    it("recusa Toda a Rede na Unidade de Tratamento", () => {
        expect(validarUnidadesVaga({ tratamento: "global", curriculos: "global" }).tratamento).toBe(MSG_UNIDADE_TRATAMENTO_INVALIDA)
    })
    it("recusa texto qualquer nos currículos", () => {
        expect(validarUnidadesVaga({ tratamento: U1, curriculos: "CUCA Barra" }).curriculos).toBe(MSG_UNIDADE_CURRICULOS_INVALIDA)
    })
    it("só espaços conta como vazio", () => {
        expect(validarUnidadesVaga({ tratamento: "  ", curriculos: U1 }).tratamento).toBe(MSG_UNIDADE_TRATAMENTO_AUSENTE)
    })
    it("vaga antiga sem unidade (D12): tratamento opcional, mas se vier precisa ser válido", () => {
        const opcoes = { obrigatoria: { tratamento: false } }
        expect(validarUnidadesVaga({ tratamento: "", curriculos: "global" }, opcoes)).toEqual({})
        expect(validarUnidadesVaga({ tratamento: "x", curriculos: "global" }, opcoes).tratamento).toBe(MSG_UNIDADE_TRATAMENTO_INVALIDA)
    })
    it("primeiroErro segue a ordem da tela", () => {
        expect(primeiroErro(validarUnidadesVaga({}))).toBe(MSG_UNIDADE_TRATAMENTO_AUSENTE)
        expect(primeiroErro(validarUnidadesVaga({ tratamento: U1 }))).toBe(MSG_UNIDADE_CURRICULOS_AUSENTE)
        expect(primeiroErro({})).toBeNull()
    })
})

describe("validarUnidadesNoServidor (AC10)", () => {
    const ativas = async (ids: string[]) => ids.filter(id => id === U1 || id === U2)

    it("400 sem as unidades, sem consultar o banco", async () => {
        let consultou = false
        const r = await validarUnidadesNoServidor({}, async () => { consultou = true; return [] })
        expect(r).toEqual({ ok: false, erro: MSG_UNIDADE_TRATAMENTO_AUSENTE })
        expect(consultou).toBe(false)
    })
    it("texto que não é UUID não chega ao banco", async () => {
        let consultou = false
        const r = await validarUnidadesNoServidor({ tratamento: "CUCA Pici", curriculos: "global" }, async () => { consultou = true; return [] })
        expect(r).toEqual({ ok: false, erro: MSG_UNIDADE_TRATAMENTO_INVALIDA })
        expect(consultou).toBe(false)
    })
    it("UUID que não é unidade ativa é recusado", async () => {
        const inexistente = "00000000-0000-4000-8000-000000000000"
        expect(await validarUnidadesNoServidor({ tratamento: inexistente, curriculos: "global" }, ativas))
            .toEqual({ ok: false, erro: MSG_UNIDADE_TRATAMENTO_INVALIDA })
        expect(await validarUnidadesNoServidor({ tratamento: U1, curriculos: inexistente }, ativas))
            .toEqual({ ok: false, erro: MSG_UNIDADE_CURRICULOS_INVALIDA })
    })
    it("ok com unidades ativas", async () => {
        expect(await validarUnidadesNoServidor({ tratamento: U1, curriculos: "global" }, ativas))
            .toEqual({ ok: true, tratamento: U1, curriculos: "global" })
        expect(await validarUnidadesNoServidor({ tratamento: ` ${U1} `, curriculos: U2 }, ativas))
            .toEqual({ ok: true, tratamento: U1, curriculos: U2 })
    })
    it("tipo errado no corpo conta como ausente", async () => {
        expect(await validarUnidadesNoServidor({ tratamento: 123, curriculos: null }, ativas))
            .toEqual({ ok: false, erro: MSG_UNIDADE_TRATAMENTO_AUSENTE })
    })
})

describe("exibição", () => {
    it("formata data ISO sem deslocar o dia", () => {
        expect(formatarDataISO("2026-11-30")).toBe("30/11/2026")
        expect(formatarDataISO("2026-11-30T00:00:00+00:00")).toBe("30/11/2026")
        expect(formatarDataISO(null)).toBe("")
        expect(formatarDataISO("lixo")).toBe("")
    })
    it("rótulo da Unidade de Currículos", () => {
        expect(rotuloUnidadeCurriculos("global", {})).toBe("Toda a Rede CUCA")
        expect(rotuloUnidadeCurriculos(null, {})).toBe("Toda a Rede CUCA")
        expect(rotuloUnidadeCurriculos(U1, { [U1]: "CUCA Barra" })).toBe("CUCA Barra")
    })
})

describe("escolherDataSelecao (AC16)", () => {
    const hoje = "2026-11-24"
    it("vazia ou só datas inválidas → null", () => {
        expect(escolherDataSelecao(null, hoje)).toBeNull()
        expect(escolherDataSelecao([], hoje)).toBeNull()
        expect(escolherDataSelecao([{ data: "" }], hoje)).toBeNull()
    })
    it("pega a próxima a partir de hoje, mesmo fora de ordem", () => {
        const r = escolherDataSelecao([
            { data: "2026-12-10", hora: "09:00" },
            { data: "2026-11-20", hora: "08:00" },
            { data: "2026-11-28", hora: "14:00" },
        ], hoje)
        expect(r?.principal).toEqual({ data: "2026-11-28", hora: "14:00" })
        expect(r?.restantes).toBe(2)
    })
    it("hoje conta como próxima", () => {
        expect(escolherDataSelecao([{ data: "2026-11-24", hora: "08:00" }, { data: "2026-11-30" }], hoje)?.principal.data).toBe("2026-11-24")
    })
    it("todas passadas → a última", () => {
        const r = escolherDataSelecao([{ data: "2026-10-01" }, { data: "2026-11-01", hora: "10:00" }], hoje)
        expect(r?.principal).toEqual({ data: "2026-11-01", hora: "10:00" })
        expect(r?.restantes).toBe(1)
    })
    it("formata com e sem hora", () => {
        expect(formatarDataHoraSelecao({ data: "2026-11-28", hora: "14:00" })).toBe("28/11/2026 14:00")
        expect(formatarDataHoraSelecao({ data: "2026-11-28" })).toBe("28/11/2026")
    })
})
