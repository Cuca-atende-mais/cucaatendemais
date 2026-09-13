import { describe, expect, it } from "vitest"
import { mapearErroSalvarRascunho } from "./rascunho"

describe("mapearErroSalvarRascunho", () => {
    it("P0002 (campanha não encontrada) vira 404", () => {
        const r = mapearErroSalvarRascunho({ code: "P0002", message: "Programação não encontrada" })
        expect(r).toEqual({ status: 404, error: "Programação não encontrada" })
    })

    it("P0001 (status inválido) vira 409, repassando a mensagem da função (tem o status atual embutido)", () => {
        const r = mapearErroSalvarRascunho({ code: "P0001", message: "Só é possível salvar uma programação em rascunho (status atual: aprovado)" })
        expect(r).toEqual({ status: 409, error: "Só é possível salvar uma programação em rascunho (status atual: aprovado)" })
    })

    it("42501 (sem permissão, achado crítico do @qa 2026-09-10) vira 403 com mensagem própria, não a da exceção Postgres", () => {
        const r = mapearErroSalvarRascunho({ code: "42501", message: "permission denied for function programacao_salvar_rascunho" })
        expect(r).toEqual({ status: 403, error: "Sem permissão para editar programação" })
    })

    it("S-PROG-13: recusa por categoria repassa a mensagem com o nome da categoria", () => {
        const r = mapearErroSalvarRascunho({ code: "42501", message: "Sem permissão para alterar atividades da categoria CURSOS" })
        expect(r).toEqual({ status: 403, error: "Sem permissão para alterar atividades da categoria CURSOS" })
    })

    it("qualquer outro código vira 500", () => {
        const r = mapearErroSalvarRascunho({ code: "23505", message: "duplicate key" })
        expect(r).toEqual({ status: 500, error: "duplicate key" })
    })

    it("sem código nenhum (erro de rede, por exemplo) vira 500 com mensagem genérica", () => {
        const r = mapearErroSalvarRascunho(null)
        expect(r).toEqual({ status: 500, error: "Erro ao salvar rascunho" })
    })

    it("erro sem mensagem usa o texto genérico", () => {
        const r = mapearErroSalvarRascunho({ code: "23505" })
        expect(r).toEqual({ status: 500, error: "Erro ao salvar rascunho" })
    })
})
