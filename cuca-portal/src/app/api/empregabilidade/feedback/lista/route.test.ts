import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

// S-EMP-GES-08 (AC11, AC14): permissão, recorte de visibilidade pelas vagas do usuário e sem token.

let permitido = true
let pedidosBanco: Record<string, unknown>[] = []
let vagasVisiveis: Record<string, unknown>[] = []
const selectsPedidos: string[] = []

/** Consulta encadeável que resolve com o resultado dado. */
function consulta(resolver: (filtros: { in?: string[] }) => { data: unknown; error: unknown }, aoSelecionar?: (cols: string) => void) {
    const filtros: { in?: string[] } = {}
    const q: Record<string, unknown> = {}
    q.select = (cols: string) => { aoSelecionar?.(cols); return q }
    q.order = () => q
    q.range = () => q
    q.in = (_col: string, ids: string[]) => { filtros.in = ids; return q }
    q.then = (resolve: (v: unknown) => unknown) => resolve(resolver(filtros))
    return q
}

vi.mock("@/lib/rbac/exigir-permissao-servidor", () => ({
    exigirPermissao: async () => {
        if (!permitido) return { ok: false, resposta: NextResponse.json({ error: "Sem permissão para esta ação." }, { status: 403 }) }
        return {
            ok: true,
            user: { id: "u1" },
            supabase: {
                from(tabela: string) {
                    if (tabela !== "vagas") throw new Error(`tabela inesperada no cliente do usuário: ${tabela}`)
                    return consulta(f => ({ data: vagasVisiveis.filter(v => f.in?.includes(v.id as string)), error: null }))
                },
            },
        }
    },
}))

vi.mock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
        from(tabela: string) {
            if (tabela === "feedback_solicitacoes") return consulta(() => ({ data: pedidosBanco, error: null }), cols => selectsPedidos.push(cols))
            if (tabela === "colaboradores") return consulta(() => ({ data: [{ user_id: "autor1", nome_completo: "Maria Silva" }], error: null }))
            throw new Error(`tabela inesperada no admin: ${tabela}`)
        },
    }),
}))

import { GET } from "./route"

function pedido(id: string, vagaId: string, createdAt: string, extra: Record<string, unknown> = {}) {
    return {
        id,
        vaga_id: vagaId,
        created_at: createdAt,
        criado_por: "autor1",
        status_envio: "entregue",
        erro_envio: null,
        expires_at: "2026-10-30T00:00:00Z",
        respondido_em: null,
        situacao: null,
        token: "segredo-que-nao-pode-vazar",
        feedback_solicitacao_itens: [{ count: 3 }],
        ...extra,
    }
}

describe("GET /api/empregabilidade/feedback/lista", () => {
    beforeEach(() => {
        permitido = true
        selectsPedidos.length = 0
        pedidosBanco = [
            pedido("p2", "vA", "2026-10-25T10:00:00Z"),
            pedido("p1", "vA", "2026-10-20T10:00:00Z"),
            pedido("p3", "vOutraUnidade", "2026-10-26T10:00:00Z"),
            pedido("p4", "vB", "2026-10-22T10:00:00Z", { status_envio: "falhou", erro_envio: "número inválido", criado_por: null }),
        ]
        vagasVisiveis = [
            { id: "vA", numero_vaga: 10, titulo: "Atendente", tipo: "vaga_normal", empresa_id: "e1", empresas: { nome: "Padaria LTDA", nome_fantasia: "Padaria São João" } },
            { id: "vB", numero_vaga: 11, titulo: "Caixa", tipo: "vaga_normal", empresa_id: "e2", empresas: [{ nome: "Mercadinho", nome_fantasia: null }] },
        ]
    })

    it("sem permissão devolve 403", async () => {
        permitido = false
        const res = await GET()
        expect(res.status).toBe(403)
    })

    it("uma linha por vaga, com o pedido mais recente, o total e o autor", async () => {
        const res = await GET()
        expect(res.status).toBe(200)
        const { linhas } = await res.json()
        expect(linhas.map((l: { vaga_id: string }) => l.vaga_id)).toEqual(["vA", "vB"])
        expect(linhas[0]).toMatchObject({
            empresa_id: "e1",
            empresa_nome: "Padaria São João",
            numero_vaga: 10,
            pedidos: 2,
            ultimo: { id: "p2", candidatos: 3, enviado_por: "Maria Silva" },
        })
        expect(linhas[1]).toMatchObject({
            empresa_nome: "Mercadinho",
            pedidos: 1,
            ultimo: { id: "p4", status_envio: "falhou", erro_envio: "número inválido", enviado_por: null },
        })
    })

    it("pedido de vaga que o usuário não enxerga não é devolvido", async () => {
        const res = await GET()
        const corpo = JSON.stringify(await res.json())
        expect(corpo).not.toContain("vOutraUnidade")
        expect(corpo).not.toContain("p3")
    })

    it("nunca devolve nem seleciona o token", async () => {
        const res = await GET()
        const corpo = JSON.stringify(await res.json())
        expect(corpo).not.toContain("segredo-que-nao-pode-vazar")
        expect(corpo).not.toContain("token")
        expect(selectsPedidos.every(c => !c.includes("token"))).toBe(true)
    })

    it("sem pedido nenhum devolve lista vazia", async () => {
        pedidosBanco = []
        const res = await GET()
        expect(await res.json()).toEqual({ linhas: [] })
    })
})
