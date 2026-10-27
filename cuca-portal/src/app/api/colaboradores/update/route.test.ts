import { beforeEach, describe, expect, it, vi } from "vitest"

// S-PLA-01 (AC3/AC9): mesmas regras da criação, na edição do colaborador.

const estado = {
    updates: 0,
    rpcs: [] as { nome: string; args: Record<string, unknown> }[],
}

vi.mock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
        auth: { admin: { updateUserById: async () => ({ error: null }) } },
        from(tabela: string) {
            if (tabela === "planejamento_setores") {
                return { select: async () => ({ data: [{ id: "cultura" }, { id: "esportes" }], error: null }) }
            }
            return {
                select: () => ({ eq: () => ({ single: async () => ({ data: { id: "c1", user_id: "u1", email: "fulano@cuca.com", role_id: "r1" }, error: null }) }) }),
                update: () => { estado.updates++; return { eq: async () => ({ error: null }) } },
            }
        },
        rpc: async (nome: string, args: Record<string, unknown>) => { estado.rpcs.push({ nome, args }); return { error: null } },
    }),
}))

vi.mock("@/lib/auth/colaboradores-acesso-server", () => ({
    autorizarOperacaoColaborador: async () => ({ ok: true, user: { id: "admin" }, developer: false }),
}))

import { POST } from "./route"

function requisicao(extra: Record<string, unknown>) {
    return new Request("http://localhost/api/colaboradores/update", {
        method: "POST",
        body: JSON.stringify({ id: "c1", nome_completo: "Fulano", telefone: "", role_id: "r1", unidade_cuca: "Geral", ativo: true, ...extra }),
    })
}

const vinculos = () => estado.rpcs.filter(r => r.nome === "pla_substituir_setores_colaborador")

describe("POST /api/colaboradores/update — setores do Planejamento", () => {
    beforeEach(() => {
        estado.updates = 0
        estado.rpcs.length = 0
    })

    it("sem o campo: atualiza o colaborador e não mexe no vínculo", async () => {
        const res = await POST(requisicao({}))
        expect(res.status).toBe(200)
        expect(estado.updates).toBe(1)
        expect(vinculos()).toHaveLength(0)
    })

    it("com o campo: substitui o conjunto (lista vazia limpa)", async () => {
        expect((await POST(requisicao({ setores_planejamento: ["esportes"] }))).status).toBe(200)
        expect((await POST(requisicao({ setores_planejamento: [] }))).status).toBe(200)
        expect(vinculos().map(v => v.args)).toEqual([
            { p_colaborador: "c1", p_setores: ["esportes"] },
            { p_colaborador: "c1", p_setores: [] },
        ])
    })

    it("setor desconhecido: 400 e nada é gravado", async () => {
        const res = await POST(requisicao({ setores_planejamento: ["DPDH"] }))
        expect(res.status).toBe(400)
        expect(estado.updates).toBe(0)
        expect(vinculos()).toHaveLength(0)
    })
})
