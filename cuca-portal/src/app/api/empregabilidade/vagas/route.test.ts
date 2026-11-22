import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// S-EMP-GES-12 (AC8, AC11): a rota de vaga (sempre com link) avisa o worker depois de gravar a
// vaga, e a resposta ao formulário não depende do resultado do aviso.

const inserts: Record<string, unknown>[] = []

function consulta(resultado: unknown) {
    const q: Record<string, unknown> = {}
    for (const m of ["select", "eq", "filter", "in", "order", "limit", "update"]) q[m] = () => q
    q.single = async () => resultado
    return q
}

vi.mock("@supabase/supabase-js", () => ({
    createClient: () => ({
        from(tabela: string) {
            if (tabela === "empresas") return consulta({ data: { id: "e1" }, error: null })
            if (tabela === "vagas") {
                return {
                    insert(dados: Record<string, unknown>) {
                        inserts.push(dados)
                        return consulta({ data: { id: "v1", titulo: "Auxiliar", numero_vaga: 20 }, error: null })
                    },
                }
            }
            return consulta({ data: null, error: null })
        },
        rpc: async () => ({ data: 20, error: null }),
    }),
}))

let linkValido = true
vi.mock("@/lib/empregabilidade/link-assinado", () => ({ verificarLinkParams: () => ({ valido: linkValido }) }))
vi.mock("@/lib/empregabilidade/data-selecao-prevista", () => ({
    validarDataSelecaoPrevista: () => ({ ok: true, valor: null }),
}))

const avisar = vi.fn(async () => "worker")
vi.mock("@/lib/empregabilidade/vaga-criada-worker", () => ({ avisarWorkerVagaCriada: (...a: unknown[]) => avisar(...(a as [])) }))

import { POST } from "./route"

function requisicao(corpo: Record<string, unknown> = {}) {
    return new NextRequest("http://localhost/api/empregabilidade/vagas", {
        method: "POST",
        body: JSON.stringify({
            empresa_id: "e1", titulo: "Auxiliar", descricao: "Desc", tipo_contrato: "clt",
            unidade_destino: "global", setor: ["Administrativo"],
            link_params: { empresa_id: "e1", sig: "x", exp: "9999999999" },
            ...corpo,
        }),
    })
}

describe("POST /api/empregabilidade/vagas — aviso ao worker", () => {
    beforeEach(() => { inserts.length = 0; avisar.mockClear(); linkValido = true })

    it("grava a vaga e avisa o worker com empresa e vaga", async () => {
        const res = await POST(requisicao())
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ id: "v1", numero_vaga: 20 })
        expect(inserts).toHaveLength(1)
        expect(avisar).toHaveBeenCalledTimes(1)
        const args = avisar.mock.calls[0] as unknown as unknown[]
        expect(args[1]).toBe("e1")
        expect(args[2]).toEqual({ id: "v1", numero_vaga: 20, titulo: "Auxiliar" })
        expect(args[3]).toBe("vagas/route")
    })

    for (const resultado of ["marcacao", "sem_conversa", "erro"]) {
        it(`aviso com resultado "${resultado}": a resposta ao formulário não muda`, async () => {
            avisar.mockResolvedValueOnce(resultado)
            const res = await POST(requisicao())
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({ id: "v1", numero_vaga: 20 })
        })
    }

    it("link inválido: 403, não grava vaga e não avisa", async () => {
        linkValido = false
        const res = await POST(requisicao())
        expect(res.status).toBe(403)
        expect(inserts).toHaveLength(0)
        expect(avisar).not.toHaveBeenCalled()
    })
})
