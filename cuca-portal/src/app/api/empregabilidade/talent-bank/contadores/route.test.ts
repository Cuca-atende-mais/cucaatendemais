import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// S-EMP-GES-10 (AC10): sessão e permissão do Banco de Talentos, limite de 100 ids, só leitura e
// resposta só com os dois números por talento.

const T1 = "00000000-0000-4000-8000-000000000001"
const T2 = "00000000-0000-4000-8000-000000000002"

let autenticado = true
let permitido = true
let recursoPedido = ""
let erroRpc: { message: string } | null = null
const chamadas: { fn: string; args: unknown }[] = []

vi.mock("@/lib/rbac/exigir-permissao-servidor", () => ({
    exigirPermissao: async (recurso: string, acao: string) => {
        recursoPedido = `${recurso}:${acao}`
        if (!autenticado) return { ok: false, resposta: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) }
        if (!permitido) return { ok: false, resposta: NextResponse.json({ error: "Sem permissão para esta ação." }, { status: 403 }) }
        return { ok: true, user: { id: "u1" }, supabase: {} }
    },
}))

vi.mock("@/lib/supabase/admin", () => ({
    createAdminClient: () => {
        const proibido = () => { throw new Error("acesso a tabela proibido nesta rota") }
        return {
            from: proibido,
            async rpc(fn: string, args: unknown) {
                chamadas.push({ fn, args })
                if (erroRpc) return { data: null, error: erroRpc }
                return {
                    data: [
                        { talent_id: T1, selecoes_ativas: 2, selecoes_participou: 5, nome: "Não deveria sair", telefone: "85999990000" },
                        { talent_id: T2, selecoes_ativas: 0, selecoes_participou: 1 },
                    ],
                    error: null,
                }
            },
        }
    },
}))

const { POST } = await import("./route")

function pedido(corpo: unknown) {
    return new NextRequest("http://localhost/api/empregabilidade/talent-bank/contadores", {
        method: "POST",
        body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
        headers: { "Content-Type": "application/json" },
    })
}

beforeEach(() => {
    autenticado = true
    permitido = true
    recursoPedido = ""
    erroRpc = null
    chamadas.length = 0
})

describe("POST /api/empregabilidade/talent-bank/contadores", () => {
    it("401 sem sessão e 403 sem permissão, sem consultar o banco", async () => {
        autenticado = false
        expect((await POST(pedido({ ids: [T1] }))).status).toBe(401)
        autenticado = true
        permitido = false
        expect((await POST(pedido({ ids: [T1] }))).status).toBe(403)
        expect(chamadas).toEqual([])
    })

    it("usa a permissão do Banco de Talentos (D8)", async () => {
        await POST(pedido({ ids: [T1] }))
        expect(recursoPedido).toBe("empreg_banco_cv:read")
    })

    it("400 para corpo inválido e para mais de 100 talentos", async () => {
        expect((await POST(pedido("não é json"))).status).toBe(400)
        expect((await POST(pedido({ ids: ["x"] }))).status).toBe(400)
        const muitos = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
        expect((await POST(pedido({ ids: muitos }))).status).toBe(400)
        expect(chamadas).toEqual([])
    })

    it("lista vazia responde vazio sem consultar o banco", async () => {
        const r = await POST(pedido({ ids: [] }))
        expect(await r.json()).toEqual({ contadores: {} })
        expect(chamadas).toEqual([])
    })

    it("devolve só os dois números por talento, pela função do banco", async () => {
        const r = await POST(pedido({ ids: [T1, T2] }))
        expect(r.status).toBe(200)
        expect(chamadas).toEqual([{ fn: "emp_contadores_selecoes", args: { p_talent_ids: [T1, T2] } }])
        expect(await r.json()).toEqual({
            contadores: { [T1]: { ativas: 2, participou: 5 }, [T2]: { ativas: 0, participou: 1 } },
        })
    })

    it("erro do banco vira 500 sem vazar detalhe", async () => {
        erroRpc = { message: "statement timeout" }
        const r = await POST(pedido({ ids: [T1] }))
        expect(r.status).toBe(500)
        expect(JSON.stringify(await r.json())).not.toContain("timeout")
    })
})
