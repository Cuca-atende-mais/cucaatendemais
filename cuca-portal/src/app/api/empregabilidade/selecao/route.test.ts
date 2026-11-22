import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// S-EMP-GES-07 (AC2): seleção sempre grava coleta_curriculo = false, qualquer que seja o valor recebido.

const inserts: Record<string, unknown>[] = []

function consulta(resultado: unknown) {
    const q: Record<string, unknown> = {}
    for (const m of ["select", "eq", "filter", "in", "order", "limit", "update"]) q[m] = () => q
    q.single = async () => resultado
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return q
}

vi.mock("@supabase/supabase-js", () => ({
    createClient: () => ({
        from(tabela: string) {
            if (tabela === "empresas") return consulta({ data: { id: "e1", nome: "Empresa", nome_fantasia: null }, error: null })
            if (tabela === "vagas") {
                return {
                    insert(dados: Record<string, unknown>) {
                        inserts.push(dados)
                        return consulta({ data: { id: "v1", titulo: "Processo Seletivo — Empresa", numero_vaga: 10 }, error: null })
                    },
                }
            }
            return consulta({ data: null, error: null })
        },
        rpc: async () => ({ data: 10, error: null }),
    }),
}))

vi.mock("@/lib/supabase/server", () => ({
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}))

vi.mock("@/lib/empregabilidade/link-assinado", () => ({ verificarLinkParams: () => ({ valido: true }) }))

// S-EMP-GES-12: o aviso ao worker é testado no próprio helper; aqui só se confere quando a rota o chama.
const avisar = vi.fn(async () => "worker")
vi.mock("@/lib/empregabilidade/vaga-criada-worker", () => ({ avisarWorkerVagaCriada: (...a: unknown[]) => avisar(...(a as [])) }))

import { POST } from "./route"
import { dataMinimaSelecaoEvento, somarDiasISO } from "@/lib/empregabilidade/data-selecao-evento"

// Data calculada a partir de hoje, para o teste não vencer com a regra de antecedência mínima.
const DATA_VALIDA = somarDiasISO(dataMinimaSelecaoEvento(), 5)

function requisicao(corpo: Record<string, unknown>) {
    return new NextRequest("http://localhost/api/empregabilidade/selecao", {
        method: "POST",
        body: JSON.stringify({
            empresa_id: "e1",
            cargos_lista: [{ titulo: "Repositor", quantidade: 2, faixa_etaria: "A partir de 14 anos" }],
            datas_selecao: [{ data: DATA_VALIDA, hora: "08:00" }],
            ...corpo,
        }),
    })
}

describe("POST /api/empregabilidade/selecao", () => {
    beforeEach(() => { inserts.length = 0; avisar.mockClear() })

    for (const recebido of [true, false, undefined, "sim"]) {
        it(`grava coleta_curriculo = false quando recebe ${JSON.stringify(recebido)}`, async () => {
            const res = await POST(requisicao(recebido === undefined ? {} : { coleta_curriculo: recebido }))
            expect(res.status).toBe(200)
            expect(inserts).toHaveLength(1)
            expect(inserts[0]).toMatchObject({ tipo: "selecao_evento", coleta_curriculo: false })
        })
    }

    // S-EMP-GES-12 (AC8, AC10, AC11)
    it("com link: avisa o worker com empresa e vaga criadas", async () => {
        const res = await POST(requisicao({ link_params: { empresa_id: "e1", sig: "x", exp: "9999999999" } }))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ id: "v1", numero_vaga: 10 })
        expect(avisar).toHaveBeenCalledTimes(1)
        const args = avisar.mock.calls[0] as unknown as unknown[]
        expect(args[1]).toBe("e1")
        expect(args[2]).toEqual({ id: "v1", numero_vaga: 10, titulo: "Processo Seletivo — Empresa" })
        expect(args[3]).toBe("selecao/route")
    })

    it("sem link (modal do painel): não avisa o worker nem mexe na conversa da empresa", async () => {
        const res = await POST(requisicao({}))
        expect(res.status).toBe(200)
        expect(avisar).not.toHaveBeenCalled()
    })

    it("com link e aviso falhando: a resposta ao formulário não muda", async () => {
        avisar.mockResolvedValueOnce("erro")
        const res = await POST(requisicao({ link_params: { empresa_id: "e1", sig: "x", exp: "9999999999" } }))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ id: "v1", numero_vaga: 10 })
    })
})
