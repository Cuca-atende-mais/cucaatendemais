import { describe, expect, it } from "vitest"
import {
    estadoRag, mesPermitido, mesVigente, mesesPermitidos, motivoBloqueioAprovarRag, motivoBloqueioDisparo, nivel1Unidade, proximoMes,
    resumoNiveis, unidadePrecisaAprovarRag, type UnidadeSituacao,
} from "./niveis"

const UNIDADES = ["Cuca Barra", "Cuca Pici"] as const
const hoje = new Date("2026-10-05T12:00:00Z")

const unidade = (over: Partial<UnidadeSituacao> = {}): UnidadeSituacao => ({
    unidade: "Cuca Barra", campanhaId: "c1", statusCampanha: "aprovado",
    categorias: [{ categoria: "ESPORTES", status: "autorizada" }], nivel1: true, faltando: [], rag: "no_ar", ...over,
})

describe("mês vigente e meses permitidos", () => {
    it("vigente é o mês no ar no RAG, não o calendário (AC1b)", () => {
        const r = mesVigente([{ unidade: "Cuca Barra", mes: 9, ano: 2026 }, { unidade: "Cuca Pici", mes: 9, ano: 2026 }], UNIDADES, hoje)
        expect(r.vigente).toEqual({ mes: 9, ano: 2026 })
        expect(r.foraDeSincronia).toEqual([])
        expect(mesesPermitidos(r.vigente)).toEqual([{ mes: 9, ano: 2026 }, { mes: 10, ano: 2026 }])
    })

    it("unidades em meses diferentes: vigente é o menor e aponta quem está fora", () => {
        const r = mesVigente([{ unidade: "Cuca Barra", mes: 10, ano: 2026 }, { unidade: "Cuca Pici", mes: 9, ano: 2026 }], UNIDADES, hoje)
        expect(r.vigente).toEqual({ mes: 9, ano: 2026 })
        expect(r.foraDeSincronia).toEqual(["Cuca Barra"])
    })

    it("unidade sem documento ativo fica fora de sincronia; sem nenhum, usa o calendário", () => {
        expect(mesVigente([{ unidade: "Cuca Barra", mes: 9, ano: 2026 }], UNIDADES, hoje).foraDeSincronia).toEqual(["Cuca Pici"])
        expect(mesVigente([], UNIDADES, hoje).vigente).toEqual({ mes: 10, ano: 2026 })
    })

    it("virada de ano e nada de dois meses à frente ou mês anterior", () => {
        expect(proximoMes({ mes: 12, ano: 2026 })).toEqual({ mes: 1, ano: 2027 })
        expect(mesPermitido({ mes: 11, ano: 2026 }, { mes: 9, ano: 2026 })).toBe(false)
        expect(mesPermitido({ mes: 8, ano: 2026 }, { mes: 9, ano: 2026 })).toBe(false)
        expect(mesPermitido({ mes: 1, ano: 2027 }, { mes: 12, ano: 2026 })).toBe(true)
    })
})

describe("estado do RAG por unidade", () => {
    const agora = new Date("2026-10-05T12:00:00Z")
    it("no ar quando há documento ativo com conteúdo", () => {
        expect(estadoRag("autorizada", [{ ativo: true, chunks: 85, criadoEm: "2026-09-01T00:00:00Z" }], agora)).toBe("no_ar")
    })
    it("não aprovado sem aprovação; indexando dentro do limite; falhou depois dele", () => {
        expect(estadoRag("autorizada", [], agora)).toBe("nao_aprovado")
        expect(estadoRag("aprovado", [{ ativo: false, chunks: 0, criadoEm: "2026-10-05T11:55:00Z" }], agora)).toBe("indexando")
        expect(estadoRag("aprovado", [{ ativo: false, chunks: 0, criadoEm: "2026-10-05T11:00:00Z" }], agora)).toBe("falhou")
        expect(estadoRag("aprovado", [], agora)).toBe("falhou")
    })
})

describe("nível 1", () => {
    it("aponta categorias que faltam (AC2)", () => {
        const r = nivel1Unidade("rascunho", [{ categoria: "ESPORTES", status: "autorizada" }, { categoria: "CURSOS", status: "aguardando_autorizacao" }])
        expect(r.ok).toBe(false)
        expect(r.faltando).toEqual(["CURSOS (aguardando autorização)"])
    })
    it("sem programação ou sem atividades não passa; tudo autorizado passa", () => {
        expect(nivel1Unidade(null, []).faltando).toEqual(["sem programação"])
        expect(nivel1Unidade("rascunho", []).faltando).toEqual(["sem atividades"])
        expect(nivel1Unidade("autorizada", [{ categoria: "ESPORTES", status: "autorizada" }]).ok).toBe(true)
        expect(nivel1Unidade("aprovado", [{ categoria: "ESPORTES", status: "autorizada" }]).ok).toBe(true)
    })
})

describe("aprovar RAG e resumo dos níveis", () => {
    it("setembro migrado (aprovado e no ar) não precisa aprovar e libera os dois níveis", () => {
        const us = [unidade(), unidade({ unidade: "Cuca Pici" })]
        expect(us.map(unidadePrecisaAprovarRag)).toEqual([false, false])
        const r = resumoNiveis(us)
        expect(r).toMatchObject({ nivel1: true, nivel2: true, precisamAprovar: [], rotuloAprovar: "Atualizar RAG" })
    })

    it("outubro autorizado e ainda não aprovado: precisa aprovar, nível 2 pendente", () => {
        const us = [unidade({ statusCampanha: "autorizada", rag: "nao_aprovado" })]
        expect(resumoNiveis(us)).toMatchObject({ nivel1: true, nivel2: false, precisamAprovar: ["Cuca Barra"], rotuloAprovar: "Aprovar RAG" })
    })

    it("categoria reaberta e reautorizada num mês no ar: Atualizar RAG", () => {
        expect(unidadePrecisaAprovarRag(unidade({ statusCampanha: "autorizada", rag: "no_ar" }))).toBe(true)
    })

    it("indexando não reenvia; falhou oferece de novo; sem nível 1 não entra", () => {
        expect(unidadePrecisaAprovarRag(unidade({ rag: "indexando" }))).toBe(false)
        expect(unidadePrecisaAprovarRag(unidade({ rag: "falhou" }))).toBe(true)
        expect(unidadePrecisaAprovarRag(unidade({ nivel1: false, statusCampanha: "rascunho", rag: "nao_aprovado" }))).toBe(false)
    })
})

describe("bloqueio do disparo", () => {
    const base = { temPermissao: true, mesPermitido: true, temNumero: true, temTemplate: true }
    it("libera com tudo OK (AC7)", () => {
        expect(motivoBloqueioDisparo({ ...base, unidades: [unidade()] })).toBeNull()
    })
    it("diz exatamente o que falta (AC6)", () => {
        expect(motivoBloqueioDisparo({ ...base, temPermissao: false, unidades: [unidade()] })).toMatch(/permissão/)
        expect(motivoBloqueioDisparo({ ...base, mesPermitido: false, unidades: [unidade()] })).toMatch(/Mês fora/)
        expect(motivoBloqueioDisparo({ ...base, unidades: [unidade({ nivel1: false, faltando: ["CURSOS (rascunho)"] })] })).toMatch(/Nível 1.*Barra: CURSOS/)
        expect(motivoBloqueioDisparo({ ...base, unidades: [unidade({ rag: "indexando" })] })).toMatch(/Nível 2.*Barra: indexando/)
        expect(motivoBloqueioDisparo({ ...base, temTemplate: false, unidades: [unidade()] })).toMatch(/Template/)
    })
})

describe("bloqueio do Aprovar RAG", () => {
    const base = { temPermissao: true, mesPermitido: true }
    it("libera quando alguma unidade precisa aprovar", () => {
        expect(motivoBloqueioAprovarRag({ ...base, unidades: [unidade({ statusCampanha: "autorizada", rag: "nao_aprovado" })] })).toBeNull()
    })
    it("diz por que está desativado", () => {
        const pronta = unidade({ statusCampanha: "autorizada", rag: "nao_aprovado" })
        expect(motivoBloqueioAprovarRag({ ...base, temPermissao: false, unidades: [pronta] })).toMatch(/permissão/)
        expect(motivoBloqueioAprovarRag({ ...base, mesPermitido: false, unidades: [pronta] })).toMatch(/Mês fora/)
        expect(motivoBloqueioAprovarRag({ ...base, unidades: [unidade({ nivel1: false, faltando: ["sem programação"] })] })).toMatch(/Nível 1.*Barra: sem programação/)
        expect(motivoBloqueioAprovarRag({ ...base, unidades: [unidade()] })).toMatch(/já está no ar/)
        expect(motivoBloqueioAprovarRag({ ...base, unidades: [unidade({ rag: "indexando" })] })).toMatch(/Indexando — Barra/)
    })
})
