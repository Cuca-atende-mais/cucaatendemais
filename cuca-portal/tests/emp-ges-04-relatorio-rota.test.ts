import { beforeEach, describe, expect, it, vi } from "vitest"

// S-EMP-GES-04 (AC4, AC13): a rota do relatório exige epm_relatorio_ver; o Excel (exportar=1) exige
// epm_relatorio_exportar; sem epm_relatorio_rede o escopo é sempre a unidade do colaborador, mesmo com
// outro `unidade=` na URL, e currículos/empresas (sem unidade) não aparecem.

const PICI = "2a1f2bee-f89a-4d2b-b1bd-175c7c9e18d4"
const BARRA = "ecbc8153-a94f-4d9b-9e61-7b0e0cd68740"

const estado = {
    user: null as null | { id: string; email?: string },
    permitidas: new Set<string>(),
    unidadeColaborador: "Cuca Pici" as string | null,
    rpcsAdmin: [] as string[],
}

vi.mock("@/lib/supabase/server", () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: estado.user } }) },
        rpc: async (_nome: string, args: { p_recurso: string }) => ({ data: estado.permitidas.has(args.p_recurso), error: null }),
    }),
}))

const LINHAS = [
    { mes: "2026-09", unidade: PICI, indicador: "encaminhamentos", valor: 10 },
    { mes: "2026-09", unidade: BARRA, indicador: "encaminhamentos", valor: 7 },
    { mes: "2026-09", unidade: "rede", indicador: "vagas_normais", valor: 2 },
    { mes: "2026-09", unidade: "sem_unidade", indicador: "curriculos", valor: 64 },
]

const adminUsado = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
    createAdminClient: () => {
        adminUsado()
        const consulta = (tabela: string) => {
            const q = {
                select: () => q, eq: () => q, order: () => q,
                maybeSingle: async () => ({ data: { nome_completo: "Ana", unidade_cuca: estado.unidadeColaborador }, error: null }),
                then: (ok: (r: unknown) => unknown) => Promise.resolve({
                    data: tabela === "unidades_cuca" ? [{ id: BARRA, nome: "CUCA Barra" }, { id: PICI, nome: "CUCA Pici" }] : [],
                    error: null,
                }).then(ok),
            }
            return q
        }
        return {
            from: consulta,
            rpc: async (nome: string) => {
                estado.rpcsAdmin.push(nome)
                if (nome === "relatorio_emprega_mais_detalhe") return { data: [], error: null }
                return { data: LINHAS, error: null }
            },
        }
    },
}))

function get(qs: string) {
    const r = new Request(`http://local/api/empregabilidade/relatorio?${qs}`) as Request & { nextUrl: URL }
    r.nextUrl = new URL(r.url)
    return r as never
}

beforeEach(() => {
    estado.user = { id: "u1" }
    estado.permitidas = new Set()
    estado.unidadeColaborador = "Cuca Pici"
    estado.rpcsAdmin = []
    adminUsado.mockClear()
})

describe("GET /api/empregabilidade/relatorio", () => {
    it("sem sessão → 401; sem epm_relatorio_ver → 403, sem tocar no banco", async () => {
        const rota = await import("@/app/api/empregabilidade/relatorio/route")
        estado.user = null
        expect((await rota.GET(get("inicio=2026-09&fim=2026-09"))).status).toBe(401)
        estado.user = { id: "u1" }
        expect((await rota.GET(get("inicio=2026-09&fim=2026-09"))).status).toBe(403)
        expect(adminUsado).not.toHaveBeenCalled()
    })

    it("download (exportar=1) bloqueado sem epm_relatorio_exportar", async () => {
        estado.permitidas = new Set(["epm_relatorio_ver", "epm_relatorio_rede"])
        const rota = await import("@/app/api/empregabilidade/relatorio/route")
        const res = await rota.GET(get("inicio=2026-09&fim=2026-09&exportar=1"))
        expect(res.status).toBe(403)
        expect(adminUsado).not.toHaveBeenCalled()
    })

    it("sem epm_relatorio_rede: só a unidade do colaborador, mesmo pedindo outra; sem currículos", async () => {
        estado.permitidas = new Set(["epm_relatorio_ver"])
        const rota = await import("@/app/api/empregabilidade/relatorio/route")
        const res = await rota.GET(get(`inicio=2026-09&fim=2026-09&unidade=${BARRA}`))
        expect(res.status).toBe(200)
        const corpo = await res.json()
        expect(corpo.escopo).toEqual({ rede: false, selecionada: PICI, chaves: [PICI] })
        expect(Object.keys(corpo.serie)).toEqual([PICI])
        expect(corpo.unidades).toEqual([{ id: PICI, nome: "CUCA Pici" }])
        expect(corpo.permissoes).toEqual({ exportar: false, rede: false })
    })

    it("sem rede e sem unidade no cadastro → mensagem clara", async () => {
        estado.permitidas = new Set(["epm_relatorio_ver"])
        estado.unidadeColaborador = "Geral"
        const rota = await import("@/app/api/empregabilidade/relatorio/route")
        const res = await rota.GET(get("inicio=2026-09&fim=2026-09"))
        expect(res.status).toBe(403)
        expect((await res.json()).error).toMatch(/não tem uma unidade/)
    })

    it("com a rede e exportar: todas as unidades, currículos no consolidado e detalhe", async () => {
        estado.permitidas = new Set(["epm_relatorio_ver", "epm_relatorio_rede", "epm_relatorio_exportar"])
        const rota = await import("@/app/api/empregabilidade/relatorio/route")
        const res = await rota.GET(get("inicio=2026-09&fim=2026-09&exportar=1"))
        expect(res.status).toBe(200)
        const corpo = await res.json()
        expect(corpo.escopo.selecionada).toBe("todas")
        expect(corpo.serie.sem_unidade.curriculos["2026-09"]).toBe(64)
        expect(corpo.detalhe).toEqual([])
        expect(estado.rpcsAdmin).toEqual(["relatorio_emprega_mais", "relatorio_emprega_mais", "relatorio_emprega_mais_detalhe"])
    })

    it("período inválido → 400", async () => {
        estado.permitidas = new Set(["epm_relatorio_ver"])
        const rota = await import("@/app/api/empregabilidade/relatorio/route")
        expect((await rota.GET(get("inicio=2026-10&fim=2026-09"))).status).toBe(400)
        expect((await rota.GET(get("inicio=2026-13&fim=2026-09"))).status).toBe(400)
    })
})
