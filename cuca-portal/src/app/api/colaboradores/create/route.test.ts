import { beforeEach, describe, expect, it, vi } from "vitest"

// S-PLA-01 (AC3/AC9): o campo de setores do Planejamento é gravado com a mesma autorização do cadastro;
// sem o campo nada muda; campo inválido dá 400 antes de criar qualquer coisa.

const estado = {
    createUser: 0,
    insertsColaborador: 0,
    rpcs: [] as { nome: string; args: Record<string, unknown> }[],
}

function consulta(resultado: unknown) {
    const q: Record<string, unknown> = {}
    for (const m of ["select", "eq"]) q[m] = () => q
    q.maybeSingle = async () => resultado
    q.single = async () => resultado
    return q
}

vi.mock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
        auth: {
            admin: {
                createUser: async () => { estado.createUser++; return { data: { user: { id: "u-novo" } }, error: null } },
                deleteUser: async () => ({ error: null }),
                listUsers: async () => ({ data: { users: [] } }),
            },
        },
        from(tabela: string) {
            if (tabela === "planejamento_setores") {
                return { select: async () => ({ data: [{ id: "cultura" }, { id: "esportes" }], error: null }) }
            }
            if (tabela === "colaboradores") {
                return {
                    ...consulta({ data: null, error: null }),
                    insert() { estado.insertsColaborador++; return consulta({ data: { id: "c-novo" }, error: null }) },
                }
            }
            return consulta({ data: null, error: null })
        },
        rpc: async (nome: string, args: Record<string, unknown>) => { estado.rpcs.push({ nome, args }); return { error: null } },
    }),
}))

vi.mock("@/lib/auth/colaboradores-acesso-server", () => ({
    autorizarOperacaoColaborador: async () => ({ ok: true, user: { id: "admin" }, developer: false }),
}))

vi.mock("resend", () => ({ Resend: class { emails = { send: async () => ({ error: null }) } } }))
vi.mock("@/emails/SetupPasswordEmail", () => ({ default: () => null }))

import { POST } from "./route"

function requisicao(extra: Record<string, unknown>) {
    return new Request("http://localhost/api/colaboradores/create", {
        method: "POST",
        body: JSON.stringify({ email: "nova@cuca.com", nome: "Nova Pessoa", unidadeCuca: "Geral", roleId: "r1", ...extra }),
    })
}

const vinculos = () => estado.rpcs.filter(r => r.nome === "pla_substituir_setores_colaborador")

describe("POST /api/colaboradores/create — setores do Planejamento", () => {
    beforeEach(() => {
        estado.createUser = 0
        estado.insertsColaborador = 0
        estado.rpcs.length = 0
    })

    it("sem o campo: cria o colaborador e não mexe no vínculo", async () => {
        const res = await POST(requisicao({}))
        expect(res.status).toBe(201)
        expect(estado.insertsColaborador).toBe(1)
        expect(vinculos()).toHaveLength(0)
    })

    it("com o campo: grava o vínculo do colaborador criado", async () => {
        const res = await POST(requisicao({ setores_planejamento: ["cultura", "esportes"] }))
        expect(res.status).toBe(201)
        expect(vinculos()).toEqual([{ nome: "pla_substituir_setores_colaborador", args: { p_colaborador: "c-novo", p_setores: ["cultura", "esportes"] } }])
    })

    it("lista vazia: cria sem setor (atua em todos) e grava o conjunto vazio", async () => {
        const res = await POST(requisicao({ setores_planejamento: [] }))
        expect(res.status).toBe(201)
        expect(vinculos()).toEqual([{ nome: "pla_substituir_setores_colaborador", args: { p_colaborador: "c-novo", p_setores: [] } }])
    })

    it("setor desconhecido: 400 e nada é criado", async () => {
        const res = await POST(requisicao({ setores_planejamento: ["DPDH"] }))
        expect(res.status).toBe(400)
        expect(estado.createUser).toBe(0)
        expect(estado.insertsColaborador).toBe(0)
        expect(vinculos()).toHaveLength(0)
    })
})
