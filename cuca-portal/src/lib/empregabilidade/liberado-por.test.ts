import { describe, expect, it, vi } from "vitest"
import { buscarLiberadoPor, textoLiberadaEm } from "./liberado-por"

describe("buscarLiberadoPor (S-EMP-GES-13)", () => {
    it("consulta só as vagas com autor e devolve o mapa vaga → nome", async () => {
        const rpc = vi.fn(async () => ({ data: [{ vaga_id: "v1", nome: "Maria Souza" }, { vaga_id: "v2", nome: "socio@exemplo.com" }], error: null }))
        const mapa = await buscarLiberadoPor({ rpc }, [
            { id: "v1", liberada_por: "c1" },
            { id: "v2", liberada_por_usuario: "u2" },
            { id: "v3" },
        ])
        expect(rpc).toHaveBeenCalledWith("emp_vagas_liberado_por", { p_vaga_ids: ["v1", "v2"] })
        expect(mapa.get("v1")).toBe("Maria Souza")
        expect(mapa.get("v2")).toBe("socio@exemplo.com")
        expect(mapa.has("v3")).toBe(false)
    })

    it("nenhuma vaga com autor: não chama o banco", async () => {
        const rpc = vi.fn()
        expect((await buscarLiberadoPor({ rpc }, [{ id: "v1" }])).size).toBe(0)
        expect(rpc).not.toHaveBeenCalled()
    })

    it("erro do banco: mapa vazio (a coluna mostra —) sem derrubar a tela", async () => {
        const erro = vi.spyOn(console, "error").mockImplementation(() => {})
        const rpc = vi.fn(async () => ({ data: null, error: { message: "falhou" } }))
        expect((await buscarLiberadoPor({ rpc }, [{ id: "v1", liberada_por: "c1" }])).size).toBe(0)
        erro.mockRestore()
    })

    it("ignora linha sem nome", async () => {
        const rpc = vi.fn(async () => ({ data: [{ vaga_id: "v1", nome: null }], error: null }))
        expect((await buscarLiberadoPor({ rpc }, [{ id: "v1", liberada_por: "c1" }])).size).toBe(0)
    })
})

describe("textoLiberadaEm", () => {
    it("formata data e hora", () => {
        expect(textoLiberadaEm("2026-11-24T17:32:00")).toMatch(/^Liberada em 24\/11\/2026 às \d{2}:32$/)
    })
    it("vazio ou inválido → undefined", () => {
        expect(textoLiberadaEm(null)).toBeUndefined()
        expect(textoLiberadaEm("lixo")).toBeUndefined()
    })
})
