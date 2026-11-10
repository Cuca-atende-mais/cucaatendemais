import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { aplicarStatusCandidatura } from "./aplicar-status-candidatura"

// Cliente admin simulado: grava cada operação para conferir o que a regra faz no banco.
type Operacao = { tabela: string; tipo: "update" | "insert"; dados: Record<string, unknown>; filtro?: [string, unknown] }

function adminFalso(opts: {
    candidatura: Record<string, unknown> | null
    talentos?: Record<string, unknown>[]
    contratadoEmOutra?: boolean
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
            if (nome === "emp_pessoa_contratada_em_outra_vaga") return { data: opts.contratadoEmOutra ?? false, error: null }
            return { data: null, error: null }
        },
    }
    return { cliente: cliente as unknown as SupabaseClient, ops, rpcs }
}

const candidatura = {
    id: "c1", status: "pendente", vaga_id: "v1", nome: "Fulana", telefone: "5585987654321", data_nascimento: null,
    arquivo_cv_url: "https://x/cv.pdf", dados_ocr_json: {}, area_interesse: null, created_at: "2026-09-01T00:00:00Z",
    pcd_candidato: false, pcd_tipo_candidato: null,
}

describe("aplicarStatusCandidatura", () => {
    it("rejeitar com cadastro duplicado: só preenche campos vazios, sem mudar status nem criar outro", async () => {
        const { cliente, ops, rpcs } = adminFalso({
            candidatura,
            talentos: [
                { id: "t1", nome: "Fulana", skills_jsonb: { excel: true }, arquivo_cv_url: "https://x/antigo.pdf", status: "contratado" },
                { id: "t2", nome: "Fulana", skills_jsonb: null, arquivo_cv_url: null },
            ],
        })
        const r = await aplicarStatusCandidatura(cliente, "c1", "rejeitado")
        expect(r).toEqual({ candidaturaId: "c1", ok: true, talento: "preencher" })
        expect(ops[0]).toMatchObject({ tabela: "candidaturas", tipo: "update", dados: { status: "rejeitado" }, filtro: ["id", "c1"] })
        const tb = ops.filter(o => o.tabela === "talent_bank")
        expect(tb.every(o => !("status" in o.dados))).toBe(true)
        // t1 já tem tudo preenchido que a candidatura traria, menos data_curriculo
        expect(tb.find(o => o.filtro?.[1] === "t2")?.dados.arquivo_cv_url).toBe("https://x/cv.pdf")
        expect(tb.find(o => o.filtro?.[1] === "t1")?.dados).not.toHaveProperty("skills_jsonb")
        expect(rpcs).not.toContain("emp_pessoa_tem_processo_ativo")
        expect(rpcs).not.toContain("emp_pessoa_contratada_em_outra_vaga")
    })

    it("rejeitar sem nada a preencher não grava no Banco de Talentos", async () => {
        const completo = {
            id: "t1", nome: "Fulana", data_nascimento: "2000-01-01", arquivo_cv_url: "https://x/a.pdf", skills_jsonb: { a: 1 },
            area_interesse: ["x"], data_curriculo: "2026-01-01", pcd_tipo_candidato: "x",
        }
        const { cliente, ops } = adminFalso({ candidatura, talentos: [completo] })
        await aplicarStatusCandidatura(cliente, "c1", "rejeitado")
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

    it("selecionado pela empresa não trava nem consulta nada além dos cadastros", async () => {
        const { cliente, ops, rpcs } = adminFalso({ candidatura, talentos: [{ id: "t1" }, { id: "t2" }] })
        const r = await aplicarStatusCandidatura(cliente, "c1", "selecionado")
        expect(r.talento).toBe("nenhuma")
        expect(ops.filter(o => o.tabela === "talent_bank")).toEqual([])
        expect(rpcs).toEqual(["emp_talent_bank_por_chave"])
    })

    it("contratado trava todos os cadastros da pessoa", async () => {
        const { cliente, ops } = adminFalso({ candidatura, talentos: [{ id: "t1" }, { id: "t2" }] })
        await aplicarStatusCandidatura(cliente, "c1", "contratado")
        expect(ops[1]).toMatchObject({ tabela: "talent_bank", dados: { status: "contratado" }, filtro: ["id", ["t1", "t2"]] })
    })

    it("sair de contratado devolve os cadastros a disponível", async () => {
        const { cliente, ops, rpcs } = adminFalso({ candidatura: { ...candidatura, status: "contratado" }, talentos: [{ id: "t1", status: "contratado" }] })
        const r = await aplicarStatusCandidatura(cliente, "c1", "pendente")
        expect(r.talento).toBe("liberar")
        expect(rpcs).toContain("emp_pessoa_contratada_em_outra_vaga")
        const tb = ops.filter(o => o.tabela === "talent_bank")
        expect(tb).toHaveLength(1)
        expect(tb[0].dados.status).toBe("disponivel")
        expect(tb[0].dados).not.toHaveProperty("arquivo_cv_url")
    })

    it("sair de contratado para rejeitado: disponível e preenche campos vazios", async () => {
        const { cliente, ops } = adminFalso({ candidatura: { ...candidatura, status: "contratado" }, talentos: [{ id: "t1", status: "contratado" }] })
        await aplicarStatusCandidatura(cliente, "c1", "rejeitado")
        const tb = ops.filter(o => o.tabela === "talent_bank")
        expect(tb[0].dados).toMatchObject({ status: "disponivel", arquivo_cv_url: "https://x/cv.pdf" })
    })

    it("sair de contratado com outra contratação: continua travado", async () => {
        const { cliente, ops } = adminFalso({
            candidatura: { ...candidatura, status: "contratado" }, talentos: [{ id: "t1", status: "contratado" }], contratadoEmOutra: true,
        })
        const r = await aplicarStatusCandidatura(cliente, "c1", "selecionado")
        expect(r).toMatchObject({ talento: "nenhuma", motivo: "contratado_em_outra_vaga" })
        expect(ops.filter(o => o.tabela === "talent_bank")).toEqual([])
    })

    it("candidatura inexistente devolve falha sem gravar nada", async () => {
        const { cliente, ops } = adminFalso({ candidatura: null })
        const r = await aplicarStatusCandidatura(cliente, "c1", "rejeitado")
        expect(r.ok).toBe(false)
        expect(ops).toEqual([])
    })

    describe("S-EMP-GES-07: inscrito de seleção não tem Banco de Talentos", () => {
        const inscrito = { ...candidatura, vagas: { tipo: "selecao_evento" } }

        for (const status of ["selecionado", "contratado", "rejeitado"] as const) {
            it(`${status}: só muda o status, sem consultar nem gravar no Banco de Talentos`, async () => {
                const { cliente, ops, rpcs } = adminFalso({ candidatura: inscrito, talentos: [{ id: "t1" }] })
                const r = await aplicarStatusCandidatura(cliente, "c1", status)
                expect(r).toEqual({ candidaturaId: "c1", ok: true, talento: "nenhuma", motivo: "selecao" })
                expect(ops).toEqual([expect.objectContaining({ tabela: "candidaturas", tipo: "update", dados: expect.objectContaining({ status }) })])
                expect(rpcs).toEqual([])
            })
        }

        it("vaga normal continua com a regra do Banco de Talentos", async () => {
            const { cliente, ops } = adminFalso({ candidatura: { ...candidatura, vagas: { tipo: "vaga_normal" } }, talentos: [{ id: "t1" }] })
            const r = await aplicarStatusCandidatura(cliente, "c1", "contratado")
            expect(r.talento).toBe("travar")
            expect(ops.filter(o => o.tabela === "talent_bank")).toHaveLength(1)
        })
    })
})
