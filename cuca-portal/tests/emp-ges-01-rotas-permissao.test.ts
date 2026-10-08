import { beforeEach, describe, expect, it, vi } from "vitest"

// S-EMP-GES-01 (AC13, AC16, AC17): as rotas tocadas exigem sessão e a permissão certa antes de gravar.
// O middleware libera /api/empregabilidade/* sem sessão, então a proteção tem de estar em cada rota.

const estado = {
    user: null as null | { id: string },
    permitidas: new Set<string>(),
    rpcsChamadas: [] as { recurso: string; acao: string }[],
}

vi.mock("@/lib/supabase/server", () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: estado.user } }) },
        rpc: async (_nome: string, args: { p_recurso: string; p_acao: string }) => {
            estado.rpcsChamadas.push({ recurso: args.p_recurso, acao: args.p_acao })
            return { data: estado.permitidas.has(`${args.p_recurso}:${args.p_acao}`), error: null }
        },
        from: () => ({
            select: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null }), in: async () => ({ data: [], error: null }) }),
            }),
        }),
    }),
}))

const adminUsado = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { adminUsado(); return {} } }))

function req(body: unknown = {}) {
    return new Request("http://local/api", { method: "POST", body: JSON.stringify(body) }) as never
}
const params = { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }) }

beforeEach(() => {
    estado.user = null
    estado.permitidas = new Set()
    estado.rpcsChamadas = []
    adminUsado.mockClear()
})

describe("rotas da S-EMP-GES-01 sem sessão → 401", () => {
    it("rejeitar, status do candidato, notificar, feedback/status, feedback/contato e empresa", async () => {
        const rejeitar = await import("@/app/api/empregabilidade/candidaturas/[id]/rejeitar/route")
        const status = await import("@/app/api/empregabilidade/candidaturas/[id]/status/route")
        const notificar = await import("@/app/api/empregabilidade/notificar-selecionado/route")
        const fbStatus = await import("@/app/api/empregabilidade/feedback/status/route")
        const fbContato = await import("@/app/api/empregabilidade/feedback/contato/route")
        const empresa = await import("@/app/api/empregabilidade/empresa/route")

        const respostas = [
            await rejeitar.POST(req(), params),
            await status.POST(req({ status: "selecionado" }), params),
            await notificar.POST(req({ candidatura_id: "x", titulo_vaga: "t", unidade_cuca: "u" })),
            await fbStatus.POST(req({ modo: "lote" })),
            await fbContato.PATCH(req({ vaga_id: "v" })),
            await empresa.POST(req({ nome: "X" })),
        ]
        expect(respostas.map(r => r.status)).toEqual([401, 401, 401, 401, 401, 401])
        expect(adminUsado).not.toHaveBeenCalled()
    })
})

describe("com sessão e sem permissão → 403, checando a permissão certa", () => {
    beforeEach(() => { estado.user = { id: "u1" } })

    it("rejeitar e status do candidato exigem empreg_banco_cv:update", async () => {
        const rejeitar = await import("@/app/api/empregabilidade/candidaturas/[id]/rejeitar/route")
        const status = await import("@/app/api/empregabilidade/candidaturas/[id]/status/route")
        expect((await rejeitar.POST(req(), params)).status).toBe(403)
        expect((await status.POST(req({ status: "rejeitado" }), params)).status).toBe(403)
        expect(estado.rpcsChamadas).toEqual([
            { recurso: "empreg_banco_cv", acao: "update" },
            { recurso: "empreg_banco_cv", acao: "update" },
        ])
    })

    it("feedback/status individual exige epm_feedback_status_individual; lote exige epm_feedback_status_lote", async () => {
        const fbStatus = await import("@/app/api/empregabilidade/feedback/status/route")
        expect((await fbStatus.POST(req({ modo: "individual" }))).status).toBe(403)
        expect((await fbStatus.POST(req({ modo: "lote" }))).status).toBe(403)
        expect(estado.rpcsChamadas.map(c => c.recurso)).toEqual(["epm_feedback_status_individual", "epm_feedback_status_lote"])
    })

    it("feedback/status: quem só tem a permissão individual não consegue mandar lote", async () => {
        estado.permitidas.add("epm_feedback_status_individual:read")
        const fbStatus = await import("@/app/api/empregabilidade/feedback/status/route")
        expect((await fbStatus.POST(req({ modo: "lote" }))).status).toBe(403)
    })

    it("feedback/contato exige epm_feedback_contato_editar; empresa nova exige empreg_empresas:create", async () => {
        const fbContato = await import("@/app/api/empregabilidade/feedback/contato/route")
        const empresa = await import("@/app/api/empregabilidade/empresa/route")
        expect((await fbContato.PATCH(req({ vaga_id: "v" }))).status).toBe(403)
        expect((await empresa.POST(req({ nome: "X" }))).status).toBe(403)
        expect(estado.rpcsChamadas).toEqual([
            { recurso: "epm_feedback_contato_editar", acao: "read" },
            { recurso: "empreg_empresas", acao: "create" },
        ])
    })
})

describe("com permissão", () => {
    beforeEach(() => { estado.user = { id: "u1" } })

    it("D3: notificar-selecionado responde pausado e não envia nada por padrão", async () => {
        estado.permitidas.add("empreg_banco_cv:update")
        delete process.env.EMPREG_NOTIFICAR_SELECIONADO_ATIVO
        const fetchSpy = vi.spyOn(globalThis, "fetch")
        const notificar = await import("@/app/api/empregabilidade/notificar-selecionado/route")
        const res = await notificar.POST(req({ candidatura_id: "x", titulo_vaga: "t", unidade_cuca: "u" }))
        expect(await res.json()).toEqual({ ok: true, enviado: false, pausado: true })
        expect(fetchSpy).not.toHaveBeenCalled()
        fetchSpy.mockRestore()
    })

    it("AC15: empresa nova sem contato completo é recusada com 400", async () => {
        estado.permitidas.add("empreg_empresas:create")
        const empresa = await import("@/app/api/empregabilidade/empresa/route")
        const res = await empresa.POST(req({ nome: "Empresa X", contato_responsavel: "", telefone: "85999999999", email: "" }))
        expect(res.status).toBe(400)
        const corpo = await res.json()
        expect(corpo.error).toContain("nome do contato")
        expect(corpo.error).toContain("e-mail")
    })

    it("feedback/status recusa status fora dos 4 editáveis", async () => {
        estado.permitidas.add("epm_feedback_status_lote:read")
        const fbStatus = await import("@/app/api/empregabilidade/feedback/status/route")
        const res = await fbStatus.POST(req({
            modo: "lote",
            vaga_id: "00000000-0000-0000-0000-000000000009",
            candidatura_ids: ["00000000-0000-0000-0000-000000000001"],
            status: "convite_enviado",
        }))
        expect(res.status).toBe(400)
    })
})
