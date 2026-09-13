import { describe, expect, it } from "vitest"
import { avaliarAcessoColaborador } from "./colaboradores-acesso"
import { DEVELOPER_EMAILS, isDeveloperEmail } from "./developers"

describe("isDeveloperEmail", () => {
    it("reconhece só as duas contas", () => {
        expect(DEVELOPER_EMAILS).toEqual(["valmir@cucateste.com", "dev.cucaatendemais@gmail.com"])
        expect(isDeveloperEmail("valmir@cucateste.com")).toBe(true)
        expect(isDeveloperEmail(" DEV.cucaatendemais@gmail.com ")).toBe(true)
    })

    it("não reconhece contas que perderam o acesso", () => {
        expect(isDeveloperEmail("sec@cucateste.com")).toBe(false)
        expect(isDeveloperEmail("admin@cucadev.com.br")).toBe(false)
        expect(isDeveloperEmail("valmirmoreirajunior@gmail.com")).toBe(false)
        expect(isDeveloperEmail(null)).toBe(false)
        expect(isDeveloperEmail("")).toBe(false)
    })
})

describe("avaliarAcessoColaborador", () => {
    const comum = { emailQuemPede: "gerente@cuca.com", temPermissao: true, emailAlvo: "fulano@cuca.com" }

    it("Developer pode tudo, inclusive atribuir o perfil Developer", () => {
        const r = avaliarAcessoColaborador({
            operacao: "update", emailQuemPede: "valmir@cucateste.com", temPermissao: false,
            emailAlvo: "sec@cucateste.com", atribuiPerfilDeveloper: true,
        })
        expect(r).toEqual({ permitido: true, developer: true })
    })

    it("sem permissão do módulo, recusa todas as operações", () => {
        for (const operacao of ["create", "update", "delete", "resend-invite"] as const) {
            expect(avaliarAcessoColaborador({ ...comum, operacao, temPermissao: false }).permitido).toBe(false)
        }
    })

    it("recusa qualquer operação sobre conta Developer feita por outra conta", () => {
        for (const operacao of ["create", "update", "delete", "resend-invite"] as const) {
            const r = avaliarAcessoColaborador({ ...comum, operacao, emailAlvo: "dev.cucaatendemais@gmail.com" })
            expect(r).toMatchObject({ permitido: false, status: 403 })
        }
    })

    it("com permissão, atribui qualquer perfil da Rede Cuca", () => {
        expect(avaliarAcessoColaborador({ ...comum, operacao: "update" })).toEqual({ permitido: true, developer: false })
        expect(avaliarAcessoColaborador({ ...comum, operacao: "create", atribuiPerfilDeveloper: false }).permitido).toBe(true)
    })

    it("escalada: ninguém além das contas Developer atribui o perfil Developer", () => {
        for (const operacao of ["create", "update"] as const) {
            const r = avaliarAcessoColaborador({ ...comum, operacao, emailAlvo: "gerente@cuca.com", atribuiPerfilDeveloper: true })
            expect(r).toMatchObject({ permitido: false, status: 403 })
        }
    })
})
