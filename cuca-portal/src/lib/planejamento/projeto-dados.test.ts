import { describe, expect, it } from "vitest"
import { mensagemDeErro } from "./projeto-dados"

describe("mensagemDeErro", () => {
    it("estouro de número no banco vira texto claro", () => {
        expect(mensagemDeErro('value "99999999999" is out of range for type integer')).toBe("Algum número está alto demais. Confira participantes, quantidades e valores.")
        expect(mensagemDeErro("numeric field overflow")).toBe("Algum número está alto demais. Confira participantes, quantidades e valores.")
    })

    it("restrições conhecidas e mensagens da função seguem como antes", () => {
        expect(mensagemDeErro('new row for relation "planejamento_projetos" violates check constraint "planejamento_projetos_datas_ano_ck"')).toBe("As datas precisam ser de 2027.")
        expect(mensagemDeErro("Sem permissão para editar projetos.")).toBe("Sem permissão para editar projetos.")
    })
})
