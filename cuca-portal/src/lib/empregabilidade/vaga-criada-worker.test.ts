import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { avisarWorkerVagaCriada, TIMEOUT_WORKER_VAGA_CRIADA_MS } from "./vaga-criada-worker"

// S-EMP-GES-12 (AC8, AC9, AC13): aviso ao worker na criação da vaga, com a marcação antiga
// como rede de segurança quando a chamada falha.

const VAGA = { id: "v-172", numero_vaga: 172, titulo: "Auxiliar Administrativo" }

type Banco = {
    conversaEncontrada: { id: string; metadata: Record<string, unknown> } | null
    metadataAtual: Record<string, unknown>
    updates: { metadata: Record<string, unknown>; id: unknown }[]
    leituras: number
}

function fakeSupabase(banco: Banco) {
    return {
        from(tabela: string) {
            if (tabela !== "conversas") throw new Error(`tabela inesperada: ${tabela}`)
            let modo: "lista" | "uma" | "update" = "lista"
            let payload: Record<string, unknown> | null = null
            const q: Record<string, unknown> = {}
            q.select = (cols: string) => { modo = cols === "metadata" ? "uma" : "lista"; return q }
            q.filter = () => q
            q.in = () => q
            q.order = () => q
            q.limit = async () => ({ data: banco.conversaEncontrada ? [banco.conversaEncontrada] : [], error: null })
            q.update = (dados: Record<string, unknown>) => { modo = "update"; payload = dados; return q }
            q.eq = (_col: string, valor: unknown) => {
                if (modo === "update") {
                    banco.updates.push({ metadata: payload!.metadata as Record<string, unknown>, id: valor })
                    return Promise.resolve({ error: null })
                }
                return q
            }
            q.single = async () => {
                banco.leituras += 1
                return { data: { metadata: banco.metadataAtual }, error: null }
            }
            return q
        },
    }
}

function bancoPadrao(): Banco {
    return {
        conversaEncontrada: { id: "conv-1", metadata: { empreg_fluxo: { etapa: "aguardando_retorno_vaga" } } },
        metadataAtual: { outro: 1, empreg_fluxo: { etapa: "aguardando_retorno_vaga", empresa_id: "e1" } },
        updates: [],
        leituras: 0,
    }
}

describe("avisarWorkerVagaCriada", () => {
    const envOriginal = { ...process.env }

    beforeEach(() => {
        process.env.WEBHOOK_INTERNAL_TOKEN = "tok"
        process.env.WORKER_URL = "http://worker:8000/"
        vi.spyOn(console, "warn").mockImplementation(() => {})
        vi.spyOn(console, "error").mockImplementation(() => {})
    })

    afterEach(() => {
        process.env = { ...envOriginal }
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it("worker responde 2xx: chama com token, ids e não grava marcação", async () => {
        const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
        vi.stubGlobal("fetch", fetchMock)
        const banco = bancoPadrao()

        const r = await avisarWorkerVagaCriada(fakeSupabase(banco), "e1", VAGA, "vagas/route")

        expect(r).toBe("worker")
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe("http://worker:8000/empregabilidade/vaga-criada")
        expect((init.headers as Record<string, string>)["x-internal-token"]).toBe("tok")
        expect(JSON.parse(init.body as string)).toEqual({ vaga_id: "v-172", conversa_id: "conv-1" })
        expect(banco.updates).toHaveLength(0)
    })

    for (const status of [500, 502, 404, 403]) {
        it(`worker responde ${status}: grava a marcação relendo a conversa`, async () => {
            vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status })))
            const banco = bancoPadrao()

            const r = await avisarWorkerVagaCriada(fakeSupabase(banco), "e1", VAGA, "vagas/route")

            expect(r).toBe("marcacao")
            expect(banco.leituras).toBe(1)
            expect(banco.updates).toEqual([{
                id: "conv-1",
                metadata: {
                    outro: 1,
                    empreg_fluxo: {
                        etapa: "aguardando_retorno_vaga", empresa_id: "e1",
                        vaga_criada_id: "v-172", vaga_numero: 172, vaga_titulo: "Auxiliar Administrativo",
                    },
                },
            }])
        })
    }

    it("erro de rede: grava a marcação", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed") }))
        const banco = bancoPadrao()
        expect(await avisarWorkerVagaCriada(fakeSupabase(banco), "e1", VAGA, "vagas/route")).toBe("marcacao")
        expect(banco.updates).toHaveLength(1)
    })

    it("timeout de 10s: aborta e grava a marcação", async () => {
        vi.useFakeTimers()
        vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_res, rej) => {
            init.signal!.addEventListener("abort", () => {
                const e = new Error("aborted"); e.name = "AbortError"; rej(e)
            })
        })))
        const banco = bancoPadrao()

        const promessa = avisarWorkerVagaCriada(fakeSupabase(banco), "e1", VAGA, "vagas/route")
        await vi.advanceTimersByTimeAsync(TIMEOUT_WORKER_VAGA_CRIADA_MS)

        expect(await promessa).toBe("marcacao")
        expect(banco.updates).toHaveLength(1)
    })

    it("timeout depois de o worker trocar a etapa: a marcação não desfaz a etapa nova", async () => {
        // O worker trocou a etapa para menu_empresa_acoes enquanto a rota esperava. A rota relê
        // a conversa e junta só os 3 campos: a etapa nova fica.
        vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 504 })))
        const banco = bancoPadrao()
        banco.metadataAtual = { empreg_fluxo: { etapa: "menu_empresa_acoes", empresa_id: "e1" } }

        await avisarWorkerVagaCriada(fakeSupabase(banco), "e1", VAGA, "vagas/route")

        const fluxo = banco.updates[0].metadata.empreg_fluxo as Record<string, unknown>
        expect(fluxo.etapa).toBe("menu_empresa_acoes")
        expect(fluxo.vaga_criada_id).toBe("v-172")
    })

    it("sem WEBHOOK_INTERNAL_TOKEN: não chama o worker e grava a marcação", async () => {
        delete process.env.WEBHOOK_INTERNAL_TOKEN
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        const banco = bancoPadrao()

        expect(await avisarWorkerVagaCriada(fakeSupabase(banco), "e1", VAGA, "vagas/route")).toBe("marcacao")
        expect(fetchMock).not.toHaveBeenCalled()
        expect(banco.updates).toHaveLength(1)
    })

    it("sem WORKER_URL: não chama e grava a marcação", async () => {
        delete process.env.WORKER_URL
        delete process.env.NEXT_PUBLIC_WORKER_URL
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        const banco = bancoPadrao()

        expect(await avisarWorkerVagaCriada(fakeSupabase(banco), "e1", VAGA, "vagas/route")).toBe("marcacao")
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("sem conversa da empresa: não chama nem grava (D2)", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        const banco = bancoPadrao()
        banco.conversaEncontrada = null

        expect(await avisarWorkerVagaCriada(fakeSupabase(banco), "e1", VAGA, "vagas/route")).toBe("sem_conversa")
        expect(fetchMock).not.toHaveBeenCalled()
        expect(banco.updates).toHaveLength(0)
    })

    it("nunca lança, mesmo com o banco quebrado", async () => {
        const quebrado = { from() { throw new Error("banco fora") } }
        expect(await avisarWorkerVagaCriada(quebrado, "e1", VAGA, "vagas/route")).toBe("erro")
    })
})
