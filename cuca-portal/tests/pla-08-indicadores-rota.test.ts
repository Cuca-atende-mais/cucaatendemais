import { beforeEach, describe, expect, it, vi } from "vitest"

// S-PLA-08 (AC1, AC9, AC10, AC12): a rota dos indicadores exige `pla_indic_ver`; a planilha (exportar=1) exige
// `pla_indic_exportar`; o escopo de setor vem da função da S-PLA-01 chamada no cliente do usuário, e o
// `setor=` do endereço só estreita. A função de agregação só é chamada pelo cliente de serviço, já com o escopo.

const SETORES = [
    { id: "direitos_humanos", nome: "Direitos Humanos", cor: "#111111", ordem: 1 },
    { id: "empregabilidade", nome: "Empregabilidade", cor: "#222222", ordem: 2 },
    { id: "cultura", nome: "Cultura", cor: "#333333", ordem: 3 },
    { id: "artes_biblioteca", nome: "Artes e Biblioteca", cor: "#444444", ordem: 4 },
    { id: "educacao_tecnologia", nome: "Educação e Tecnologia", cor: "#555555", ordem: 5 },
    { id: "esportes", nome: "Esportes", cor: "#666666", ordem: 6 },
]

const estado = {
    user: null as null | { id: string; email?: string },
    permitidas: new Set<string>(),
    // setores em que o usuário pode atuar (o que `pla_pode_atuar_setor` responderia)
    escopo: [] as string[],
    chamadasAdmin: [] as { nome: string; args: Record<string, unknown> }[],
}

vi.mock("@/lib/supabase/server", () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: estado.user } }) },
        rpc: async (nome: string, args: Record<string, string>) => {
            if (nome === "has_permission") return { data: estado.permitidas.has(args.p_recurso), error: null }
            if (nome === "pla_pode_atuar_setor") return { data: estado.escopo.includes(args.p_setor), error: null }
            return { data: null, error: { message: `rpc inesperada ${nome}` } }
        },
        from: (tabela: string) => ({
            select: () => ({
                order: async () => (tabela === "planejamento_setores" ? { data: SETORES, error: null } : { data: [], error: null }),
            }),
        }),
    }),
}))

const PROJETOS = [
    { id: "a", nome: "Cine", setor_id: "cultura", tipo: "projeto", status: "aprovado", situacao_2026: "novo", periodo_ano_todo: false,
        data_inicio: "2027-03-01", data_fim: "2027-03-30", participantes_estimados: 10, responsavel_nome: "Ana",
        orcamento_total: 100, orcamento_categorias: { material: 100 }, correcoes_abertas: 1, validado: false },
    { id: "b", nome: "Corrida", setor_id: "esportes", tipo: "evento_pontual", status: "em_construcao", situacao_2026: "mantem", periodo_ano_todo: true,
        data_inicio: null, data_fim: null, participantes_estimados: 200, responsavel_nome: null,
        orcamento_total: 50, orcamento_categorias: { outros: 50 }, correcoes_abertas: 0, validado: true },
]

const adminUsado = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
    createAdminClient: () => {
        adminUsado()
        return {
            rpc: async (nome: string, args: { p_setores: string[] }) => {
                estado.chamadasAdmin.push({ nome, args })
                // como a função do banco: só os setores pedidos
                return { data: PROJETOS.filter(p => args.p_setores.includes(p.setor_id)), error: null }
            },
        }
    },
}))

function get(qs = "") {
    const r = new Request(`http://local/api/planejamento/indicadores${qs ? `?${qs}` : ""}`) as Request & { nextUrl: URL }
    r.nextUrl = new URL(r.url)
    return r as never
}

beforeEach(() => {
    estado.user = { id: "u1" }
    estado.permitidas = new Set()
    estado.escopo = SETORES.map(s => s.id)
    estado.chamadasAdmin = []
    adminUsado.mockClear()
})

describe("GET /api/planejamento/indicadores", () => {
    it("sem sessão → 401; sem pla_indic_ver → 403, sem tocar no banco pelo cliente de serviço", async () => {
        const rota = await import("@/app/api/planejamento/indicadores/route")
        estado.user = null
        expect((await rota.GET(get())).status).toBe(401)
        estado.user = { id: "u1" }
        estado.permitidas = new Set(["pla_proj_ver", "pla_indic_exportar"])
        expect((await rota.GET(get())).status).toBe(403)
        expect(adminUsado).not.toHaveBeenCalled()
    })

    it("exportar=1 bloqueado sem pla_indic_exportar", async () => {
        estado.permitidas = new Set(["pla_indic_ver"])
        const rota = await import("@/app/api/planejamento/indicadores/route")
        const res = await rota.GET(get("exportar=1"))
        expect(res.status).toBe(403)
        expect(adminUsado).not.toHaveBeenCalled()
    })

    it("sem setor marcado no cadastro: todos os setores; sem a lista de projetos quando não exporta", async () => {
        estado.permitidas = new Set(["pla_indic_ver"])
        const rota = await import("@/app/api/planejamento/indicadores/route")
        const res = await rota.GET(get())
        expect(res.status).toBe(200)
        const corpo = await res.json()
        expect(corpo.setores.map((s: { id: string }) => s.id)).toEqual(SETORES.map(s => s.id))
        expect(estado.chamadasAdmin).toEqual([{ nome: "pla_indicadores_projetos", args: { p_ano: 2027, p_setores: SETORES.map(s => s.id) } }])
        expect(corpo.indicadores.cartoes.projetos).toBe(2)
        expect(corpo.indicadores.cartoes.orcamento).toBe(150)
        expect(corpo.indicadores.setores).toHaveLength(6)
        expect(corpo.permissoes).toEqual({ exportar: false })
        expect(corpo.projetos).toBeUndefined()
    })

    it("com setores marcados: só eles, mesmo pedindo outro setor no endereço", async () => {
        estado.permitidas = new Set(["pla_indic_ver"])
        estado.escopo = ["cultura"]
        const rota = await import("@/app/api/planejamento/indicadores/route")
        const res = await rota.GET(get("setor=esportes"))
        expect(res.status).toBe(200)
        const corpo = await res.json()
        expect(estado.chamadasAdmin[0].args.p_setores).toEqual(["cultura"])
        expect(corpo.filtros.setor).toBe("")
        expect(corpo.setores.map((s: { id: string }) => s.id)).toEqual(["cultura"])
        expect(corpo.indicadores.setores.map((l: { setor_id: string }) => l.setor_id)).toEqual(["cultura"])
        expect(corpo.indicadores.cartoes.projetos).toBe(1)
    })

    it("setor= dentro do escopo estreita o painel", async () => {
        estado.permitidas = new Set(["pla_indic_ver"])
        const rota = await import("@/app/api/planejamento/indicadores/route")
        const corpo = await (await rota.GET(get("setor=esportes&status=em_construcao"))).json()
        expect(corpo.filtros).toEqual({ setor: "esportes", status: "em_construcao", situacao: "", tipo: "" })
        expect(corpo.indicadores.setores.map((l: { setor_id: string }) => l.setor_id)).toEqual(["esportes"])
        expect(corpo.indicadores.cartoes.projetos).toBe(1)
    })

    it("usuário sem nenhum setor (sem cadastro de colaborador) → 403 com mensagem clara, sem chamar a agregação", async () => {
        estado.permitidas = new Set(["pla_indic_ver"])
        estado.escopo = []
        const rota = await import("@/app/api/planejamento/indicadores/route")
        const res = await rota.GET(get())
        expect(res.status).toBe(403)
        expect((await res.json()).error).toMatch(/cadastro de colaborador/)
        expect(estado.chamadasAdmin).toEqual([])
    })

    it("com pla_indic_exportar e exportar=1: devolve a lista de projetos filtrada", async () => {
        estado.permitidas = new Set(["pla_indic_ver", "pla_indic_exportar"])
        const rota = await import("@/app/api/planejamento/indicadores/route")
        const corpo = await (await rota.GET(get("exportar=1&tipo=projeto"))).json()
        expect(corpo.permissoes).toEqual({ exportar: true })
        expect(corpo.projetos.map((p: { id: string }) => p.id)).toEqual(["a"])
    })
})
