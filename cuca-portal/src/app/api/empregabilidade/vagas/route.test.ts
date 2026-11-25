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

// S-EMP-GES-13: unidades ativas do banco falso. `.in("id", ids)` devolve só as que existem.
const UNIDADE_A = "ecbc8153-a94f-4d9b-9e61-7b0e0cd68740"
const UNIDADE_B = "2a1f2bee-f89a-4d2b-b1bd-175c7c9e18d4"
const consultasUnidades: string[][] = []
function unidadesAtivas() {
    let ids: string[] = []
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.in = (_c: string, valores: string[]) => { ids = valores; consultasUnidades.push(valores); return q }
    q.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: ids.filter(id => id === UNIDADE_A || id === UNIDADE_B).map(id => ({ id })), error: null })
    return q
}

vi.mock("@supabase/supabase-js", () => ({
    createClient: () => ({
        from(tabela: string) {
            if (tabela === "unidades_cuca") return unidadesAtivas()
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
            unidade_destino: "global", unidade_tratamento: UNIDADE_A, setor: ["Administrativo"],
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

    // S-EMP-GES-13 (AC10)
    it("grava a Unidade de Tratamento e a de Currículos", async () => {
        const res = await POST(requisicao({ unidade_destino: UNIDADE_B }))
        expect(res.status).toBe(200)
        expect(inserts[0]).toMatchObject({ unidade_tratamento: UNIDADE_A, unidade_destino: UNIDADE_B })
    })

    for (const [caso, corpo, mensagem] of [
        ["sem Unidade de Tratamento", { unidade_tratamento: undefined }, "Preencha a unidade de tratamento."],
        ["sem Unidade de Currículos", { unidade_destino: "" }, "Preencha a unidade de currículos."],
        ["Toda a Rede na Unidade de Tratamento", { unidade_tratamento: "global" }, "Unidade de tratamento inválida. Escolha uma unidade da lista."],
        ["Unidade de Tratamento que não existe", { unidade_tratamento: "00000000-0000-4000-8000-000000000000" }, "Unidade de tratamento inválida. Escolha uma unidade da lista."],
    ] as const) {
        it(`${caso}: 400 com a mensagem da tela e nada gravado`, async () => {
            const res = await POST(requisicao(corpo as Record<string, unknown>))
            expect(res.status).toBe(400)
            expect(await res.json()).toEqual({ error: mensagem })
            expect(inserts).toHaveLength(0)
            expect(avisar).not.toHaveBeenCalled()
        })
    }
})
