import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { aplicarStatusCandidatura } from "./aplicar-status-candidatura"

// Cliente admin simulado: grava cada operação para conferir o que a regra faz no banco.
type Operacao = { tabela: string; tipo: "update" | "insert"; dados: Record<string, unknown>; filtro?: [string, unknown] }

function adminFalso(opts: {
    candidatura: Record<string, unknown> | null
    talentos?: Record<string, unknown>[]
    processoAtivo?: boolean
}) {
    const ops: Operacao[] = []
    const rpcs: string[] = []
    const cliente = {
        from(tabela: string) {
            return {
                select: () => ({
                    eq: () => ({ maybeSingle: async () => ({ data: opts.candidatura, error: null }) }),
                }),
                update: (dados: Record<string, unknown>) => ({
                    eq: async (col: string, val: unknown) => { ops.push({ tabela, tipo: "update", dados, filtro: [col, val] }); return { error: null } },
                    in: async (col: string, val: unknown) => { ops.push({ tabela, tipo: "update", dados, filtro: [col, val] }); return { error: null } },
                }),
                insert: async (dados: Record<string, unknown>) => { ops.push({ tabela, tipo: "insert", dados }); return { error: null } },
            }
        },
        async rpc(nome: string) {
            rpcs.push(nome)
            if (nome === "emp_talent_bank_por_chave") return { data: opts.talentos ?? [], error: null }
            if (nome === "emp_pessoa_tem_processo_ativo") return { data: opts.processoAtivo ?? false, error: null }
            return { data: null, error: null }
        },
    }
    return { cliente: cliente as unknown as SupabaseClient, ops, rpcs }
}

const candidatura = {
    id: "c1", vaga_id: "v1", nome: "Fulana", telefone: "5585987654321", data_nascimento: null,
    arquivo_cv_url: "https://x/cv.pdf", dados_ocr_json: {}, area_interesse: null, created_at: "2026-09-01T00:00:00Z",
    pcd_candidato: false, pcd_tipo_candidato: null,
}

describe("aplicarStatusCandidatura", () => {
    it("rejeitar com cadastro duplicado: libera todos, não cria outro e não apaga habilidades", async () => {
        const { cliente, ops } = adminFalso({
            candidatura,
            talentos: [
                { id: "t1", nome: "Fulana", skills_jsonb: { excel: true }, arquivo_cv_url: "https://x/antigo.pdf" },
                { id: "t2", nome: "Fulana", skills_jsonb: null, arquivo_cv_url: null },
            ],
        })
        const r = await aplicarStatusCandidatura(cliente, "c1", "rejeitado")
        expect(r).toEqual({ candidaturaId: "c1", ok: true, talento: "liberar" })
        expect(ops[0]).toMatchObject({ tabela: "candidaturas", tipo: "update", dados: { status: "rejeitado" }, filtro: ["id", "c1"] })
        const tb = ops.filter(o => o.tabela === "talent_bank")
        expect(tb.map(o => o.filtro)).toEqual([["id", "t1"], ["id", "t2"]])
        expect(tb.every(o => o.tipo === "update" && o.dados.status === "disponivel")).toBe(true)
        expect(tb[0].dados).not.toHaveProperty("skills_jsonb")
        expect(tb[0].dados).not.toHaveProperty("arquivo_cv_url")
        expect(tb[1].dados.arquivo_cv_url).toBe("https://x/cv.pdf")
    })

    it("D4: rejeitar quem está em processo em outra vaga não mexe no Banco de Talentos", async () => {
        const { cliente, ops } = adminFalso({ candidatura, talentos: [{ id: "t1" }], processoAtivo: true })
        const r = await aplicarStatusCandidatura(cliente, "c1", "rejeitado")
        expect(r.talento).toBe("nenhuma")
        expect(r.motivo).toBe("processo_ativo")
        expect(ops.filter(o => o.tabela === "talent_bank")).toEqual([])
    })

    it("D5: rejeitar sem cadastro e sem currículo não cria cadastro", async () => {
        const { cliente, ops } = adminFalso({ candidatura: { ...candidatura, arquivo_cv_url: null }, talentos: [] })
        await aplicarStatusCandidatura(cliente, "c1", "rejeitado")
        expect(ops.filter(o => o.tabela === "talent_bank")).toEqual([])
    })

    it("rejeitar sem cadastro e com currículo cria um cadastro disponível", async () => {
        const { cliente, ops } = adminFalso({ candidatura, talentos: [] })
        await aplicarStatusCandidatura(cliente, "c1", "rejeitado")
        const ins = ops.filter(o => o.tabela === "talent_bank")
        expect(ins).toHaveLength(1)
        expect(ins[0]).toMatchObject({ tipo: "insert", dados: { status: "disponivel", candidatura_origem_id: "c1" } })
    })

    it("D2: selecionado trava todos os cadastros da pessoa e não consulta processo ativo", async () => {
        const { cliente, ops, rpcs } = adminFalso({ candidatura, talentos: [{ id: "t1" }, { id: "t2" }] })
        await aplicarStatusCandidatura(cliente, "c1", "selecionado")
        expect(ops[1]).toMatchObject({ tabela: "talent_bank", dados: { status: "selecionado" }, filtro: ["id", ["t1", "t2"]] })
        expect(rpcs).not.toContain("emp_pessoa_tem_processo_ativo")
    })

    it("candidatura inexistente devolve falha sem gravar nada", async () => {
        const { cliente, ops } = adminFalso({ candidatura: null })
        const r = await aplicarStatusCandidatura(cliente, "c1", "rejeitado")
        expect(r.ok).toBe(false)
        expect(ops).toEqual([])
    })
})
