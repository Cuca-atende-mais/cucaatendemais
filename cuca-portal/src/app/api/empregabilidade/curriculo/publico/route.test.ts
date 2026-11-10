import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// S-EMP-GES-10 (AC6): salvar o currículo público não pode destravar um talento "contratado".
// O update do talento não leva mais `status`.

process.env.EMPREGABILIDADE_LINK_SECRET = "segredo-teste"

const updatesTalento: Record<string, unknown>[] = []

function consulta(tabela: string) {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.is = () => q
    q.order = () => q
    q.limit = () => q
    q.maybeSingle = async () => ({ data: tabela === "talent_bank" ? { id: "t1", email_enviado_em: "2026-01-01" } : null, error: null })
    q.single = async () => ({ data: tabela === "curriculos" ? { id: "cv1" } : { id: "t1", email_enviado_em: "2026-01-01", metadata: {} }, error: null })
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: tabela === "talent_bank" ? [{ id: "t1", email_enviado_em: "2026-01-01" }] : [], error: null })
    q.update = (dados: Record<string, unknown>) => {
        if (tabela === "talent_bank") updatesTalento.push(dados)
        return q
    }
    q.insert = () => q
    return q
}

vi.mock("@supabase/supabase-js", () => ({
    createClient: () => ({
        from: (tabela: string) => consulta(tabela),
        rpc: async () => ({ data: true, error: null }),
    }),
}))

vi.mock("@/lib/empregabilidade/link-assinado", () => ({
    parseLinkParams: () => new Map([["talent_id", "t1"], ["conversa_id", ""], ["origem_tel", "85987654321"], ["nome", "Fulana"]]),
    verificarLinkParams: () => ({ valido: true }),
}))

vi.mock("@/lib/empregabilidade/curriculo-pdf-service", () => ({
    gerarEArmazenarPdfCurriculo: async () => ({ url: "https://x/cv.pdf" }),
}))

vi.mock("@/lib/empregabilidade/curriculo-docx-service", () => ({
    gerarEArmazenarDocxCurriculo: async () => ({ url: "https://x/cv.docx" }),
}))

vi.mock("@/lib/empregabilidade/curriculo-publico", () => ({
    criarRespostaCurriculoPublico: (dados: unknown) => ({ ok: true, ...(dados as object) }),
    criarDownloadToken: () => ({ tokenHash: "h", expiresAt: "2026-12-01", url: "https://x/d" }),
    hashTelefone: () => "hash",
    normalizarCvDados: () => ({ nome: "Fulana", telefone: "85987654321", email: "" }),
}))

const { POST } = await import("./route")

describe("POST /api/empregabilidade/curriculo/publico (S-EMP-GES-10)", () => {
    it("atualiza nome, telefone e currículo do talento sem mexer no status", async () => {
        const req = new NextRequest("http://localhost/api/empregabilidade/curriculo/publico", {
            method: "POST",
            body: JSON.stringify({ link_params: "x", dados: {} }),
            headers: { "Content-Type": "application/json" },
        })
        await POST(req)
        const principal = updatesTalento.find(u => "curriculo_estruturado" in u)
        expect(principal).toBeDefined()
        expect(principal).toMatchObject({ nome: "Fulana", telefone: "85987654321" })
        expect(updatesTalento.every(u => !("status" in u))).toBe(true)
    })
})
