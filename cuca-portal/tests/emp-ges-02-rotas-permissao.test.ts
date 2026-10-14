import { beforeEach, describe, expect, it, vi } from "vitest"

// S-EMP-GES-02 (AC11): o pedido de feedback exige epm_feedback_solicitar; o acompanhamento, epm_feedback_ver.
// Sem a permissão a rota responde antes de tocar no banco com o cliente admin ou de chamar o worker.

const estado = {
    user: null as null | { id: string },
    permitidas: new Set<string>(),
    rpcsChamadas: [] as string[],
}

vi.mock("@/lib/supabase/server", () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: estado.user } }) },
        rpc: async (_nome: string, args: { p_recurso: string; p_acao: string }) => {
            estado.rpcsChamadas.push(args.p_recurso)
            return { data: estado.permitidas.has(args.p_recurso), error: null }
        },
    }),
}))

const adminUsado = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { adminUsado(); return {} } }))

const VAGA = "00000000-0000-0000-0000-000000000009"
const CAND = "00000000-0000-0000-0000-000000000001"

function post(body: unknown) {
    return new Request("http://local/api", { method: "POST", body: JSON.stringify(body) }) as never
}
function get(qs: string) {
    const r = new Request(`http://local/api?${qs}`) as Request & { nextUrl: URL }
    r.nextUrl = new URL(r.url)
    return r as never
}

beforeEach(() => {
    estado.user = null
    estado.permitidas = new Set()
    estado.rpcsChamadas = []
    adminUsado.mockClear()
})

describe("feedback/solicitacoes", () => {
    it("sem sessão → 401 no envio e no acompanhamento", async () => {
        const rota = await import("@/app/api/empregabilidade/feedback/solicitacoes/route")
        expect((await rota.POST(post({ vaga_id: VAGA, candidatura_ids: [CAND] }))).status).toBe(401)
        expect((await rota.GET(get(`vaga=${VAGA}`))).status).toBe(401)
        expect(adminUsado).not.toHaveBeenCalled()
    })

    it("sem epm_feedback_solicitar → 403, sem chamar o worker", async () => {
        estado.user = { id: "u1" }
        estado.permitidas.add("epm_feedback_ver")
        const fetchSpy = vi.spyOn(globalThis, "fetch")
        const rota = await import("@/app/api/empregabilidade/feedback/solicitacoes/route")
        const res = await rota.POST(post({ vaga_id: VAGA, candidatura_ids: [CAND] }))
        expect(res.status).toBe(403)
        expect(estado.rpcsChamadas).toEqual(["epm_feedback_solicitar"])
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(adminUsado).not.toHaveBeenCalled()
        fetchSpy.mockRestore()
    })

    it("acompanhamento sem epm_feedback_ver → 403", async () => {
        estado.user = { id: "u1" }
        const rota = await import("@/app/api/empregabilidade/feedback/solicitacoes/route")
        expect((await rota.GET(get(`vaga=${VAGA}`))).status).toBe(403)
        expect(estado.rpcsChamadas).toEqual(["epm_feedback_ver"])
    })

    it("com permissão, pedido sem candidato marcado → 400", async () => {
        estado.user = { id: "u1" }
        estado.permitidas.add("epm_feedback_solicitar")
        const rota = await import("@/app/api/empregabilidade/feedback/solicitacoes/route")
        expect((await rota.POST(post({ vaga_id: VAGA, candidatura_ids: [] }))).status).toBe(400)
        expect(adminUsado).not.toHaveBeenCalled()
    })
})
