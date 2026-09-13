import { describe, expect, it } from "vitest"
import { PGP } from "@/lib/rbac/catalogo-programacao-pontual"
import { checadorDePermissoes, podeAcessarUnidade } from "./permissoes-categoria"
import {
    acaoDaTransicaoPontual, eventoEditavel, eventoExcluivel, lerDadosEventoPontual, opcaoDaAcaoPontual,
    podeTransicionarPontual, transicaoPontualExigeMotivo,
} from "./pontual"

const perfil = (...modulos: string[]) =>
    checadorDePermissoes(modulos.map(module => ({ module, can_read: true, can_create: false, can_update: false, can_delete: false })), false)

describe("transições da programação pontual", () => {
    it("aceita só autorizar, devolver, disparar e cancelar antes do envio", () => {
        expect(acaoDaTransicaoPontual("aguardando_aprovacao", "autorizado")).toBe("autorizar")
        expect(acaoDaTransicaoPontual("autorizado", "aguardando_aprovacao")).toBe("devolver")
        expect(acaoDaTransicaoPontual("autorizado", "aprovado")).toBe("disparar")
        for (const de of ["aguardando_aprovacao", "autorizado", "aprovado"]) {
            expect(acaoDaTransicaoPontual(de, "cancelado")).toBe("cancelar")
        }
    })

    it("recusa pular etapas e mexer no que o worker controla", () => {
        expect(acaoDaTransicaoPontual("aguardando_aprovacao", "aprovado")).toBeNull()
        expect(acaoDaTransicaoPontual("aprovado", "autorizado")).toBeNull()
        for (const de of ["em_andamento", "pausada", "pausada_limite_diario", "concluida", "cancelado"]) {
            expect(acaoDaTransicaoPontual(de, "cancelado")).toBeNull()
            expect(acaoDaTransicaoPontual(de, "aprovado")).toBeNull()
        }
        expect(acaoDaTransicaoPontual("autorizado", "em_andamento")).toBeNull()
        expect(acaoDaTransicaoPontual("autorizado", "concluida")).toBeNull()
    })

    it("cada ação exige a própria opção", () => {
        expect(opcaoDaAcaoPontual("autorizar")).toBe(PGP.autorizar)
        const soEditaEAutoriza = perfil(PGP.ver, PGP.editar, PGP.autorizar)
        expect(podeTransicionarPontual(soEditaEAutoriza, "aguardando_aprovacao", "autorizado")).toBe(true)
        expect(podeTransicionarPontual(soEditaEAutoriza, "autorizado", "aprovado")).toBe(false)
        expect(podeTransicionarPontual(soEditaEAutoriza, "autorizado", "aguardando_aprovacao")).toBe(false)
        expect(podeTransicionarPontual(soEditaEAutoriza, "autorizado", "cancelado")).toBe(false)

        const soDispara = perfil(PGP.disparar)
        expect(podeTransicionarPontual(soDispara, "autorizado", "aprovado")).toBe(true)
        expect(podeTransicionarPontual(soDispara, "aguardando_aprovacao", "aprovado")).toBe(false)

        expect(podeTransicionarPontual(checadorDePermissoes(null, true), "autorizado", "aprovado")).toBe(true)
        expect(podeTransicionarPontual(perfil(), "aguardando_aprovacao", "autorizado")).toBe(false)
    })

    it("a opção antiga programacao_pontual não libera nada", () => {
        const antigo = checadorDePermissoes([{ module: "programacao_pontual", can_read: true, can_create: true, can_update: true, can_delete: true }], false)
        expect(podeTransicionarPontual(antigo, "autorizado", "aprovado")).toBe(false)
    })

    it("só devolver exige motivo; editar só antes do disparo", () => {
        expect(transicaoPontualExigeMotivo("autorizado", "aguardando_aprovacao")).toBe(true)
        expect(transicaoPontualExigeMotivo("autorizado", "cancelado")).toBe(false)
        expect(eventoEditavel("aguardando_aprovacao")).toBe(true)
        expect(eventoEditavel("autorizado")).toBe(true)
        for (const s of ["aprovado", "em_andamento", "concluida", "cancelado", "pausada"]) expect(eventoEditavel(s)).toBe(false)
    })
})

describe("exclusão do evento pontual (achado @qa A3)", () => {
    it("bloqueia com envio na fila, em andamento ou pausado para retomada", () => {
        for (const s of ["aprovado", "em_andamento", "pausada_limite_diario"]) expect(eventoExcluivel(s)).toBe(false)
    })

    it("libera antes do disparo e depois do fim", () => {
        for (const s of ["aguardando_aprovacao", "autorizado", "concluida", "cancelado", "pausada"]) expect(eventoExcluivel(s)).toBe(true)
    })
})

describe("unidade do evento pontual", () => {
    it("perfil de unidade só alcança a própria unidade (e evento sem unidade, como a mensal)", () => {
        expect(podeAcessarUnidade("Cuca Barra", "Cuca Barra", false)).toBe(true)
        expect(podeAcessarUnidade("Cuca Barra", "Cuca Jangurussu", false)).toBe(false)
        expect(podeAcessarUnidade("Cuca Barra", null, false)).toBe(true)
        expect(podeAcessarUnidade(null, "Cuca Jangurussu", false)).toBe(true)
        expect(podeAcessarUnidade("Geral", "Cuca Jangurussu", false)).toBe(true)
    })
})

describe("dados do formulário do evento pontual", () => {
    const base = { titulo: " Festival ", data_inicio: "2026-10-01", data_fim: "2026-10-02", unidade_cuca: "Cuca Barra" }

    it("lê só os campos do formulário, sem status nem autor", () => {
        const r = lerDadosEventoPontual({ ...base, status: "aprovado", created_by: "x", disparo_id: "y", hora_inicio: "18:00" })
        expect("dados" in r).toBe(true)
        if (!("dados" in r)) return
        expect(r.dados.titulo).toBe("Festival")
        expect(r.dados.data_evento).toBe("2026-10-01")
        expect(r.dados.hora_inicio).toBe("18:00")
        expect(r.dados).not.toHaveProperty("status")
        expect(r.dados).not.toHaveProperty("created_by")
        expect(r.dados).not.toHaveProperty("disparo_id")
        expect(r.dados).not.toHaveProperty("flyer_url")
    })

    it("Toda a Rede grava unidade nula e expansiva", () => {
        const r = lerDadosEventoPontual({ ...base, expansiva: true })
        expect("dados" in r && r.dados.unidade_cuca === null && r.dados.expansiva).toBe(true)
    })

    it("recusa campo obrigatório vazio, data ou hora inválida e fim antes do início", () => {
        expect(lerDadosEventoPontual({ ...base, titulo: "  " })).toHaveProperty("erro")
        expect(lerDadosEventoPontual({ ...base, unidade_cuca: "" })).toHaveProperty("erro")
        expect(lerDadosEventoPontual({ ...base, data_inicio: "01/10/2026" })).toHaveProperty("erro")
        expect(lerDadosEventoPontual({ ...base, data_fim: "2026-09-30" })).toHaveProperty("erro")
        expect(lerDadosEventoPontual({ ...base, hora_fim: "25h" })).toHaveProperty("erro")
        expect(lerDadosEventoPontual(null)).toHaveProperty("erro")
    })
})
