import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// S-EMP-GES-09 (AC7, AC8, AC11): permissão, escopo de unidade decidido no servidor, só leitura e resposta
// só com contagens (nenhum dado de candidato).

const PICI = "2a1f2bee-f89a-4d2b-b1bd-175c7c9e18d4"
const JANGURUSSU = "e325a27a-c25b-4627-8ce4-b0eb5ae21d65"
const TALENTO = "292363eb-2b32-4b8a-a14e-f1aaf6199db5"

let autenticado = true
let permitido = true
let temRede = true
let temExportar = false
let unidadeColaborador: string | null = "CUCA Jangurussu"
const selects: Record<string, string[]> = {}
const metodosChamados = new Set<string>()

type Filtros = { eq: [string, unknown][]; in: [string, string[]][]; not: [string, string, unknown][] }

/** Consulta encadeável só de leitura: qualquer insert/update/delete/upsert estoura. */
function consulta(tabela: string, resolver: (f: Filtros) => unknown[]) {
    const f: Filtros = { eq: [], in: [], not: [] }
    const q: Record<string, unknown> = {}
    const registrar = (m: string) => metodosChamados.add(`${tabela}.${m}`)
    q.select = (cols: string) => { registrar("select"); (selects[tabela] ??= []).push(cols); return q }
    q.eq = (c: string, v: unknown) => { f.eq.push([c, v]); return q }
    q.in = (c: string, v: string[]) => { f.in.push([c, v]); return q }
    q.not = (c: string, op: string, v: unknown) => { f.not.push([c, op, v]); return q }
    q.order = () => q
    q.range = () => q
    q.maybeSingle = () => Promise.resolve({ data: resolver(f)[0] ?? null, error: null })
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: resolver(f), error: null })
    for (const proibido of ["insert", "update", "delete", "upsert"]) q[proibido] = () => { throw new Error(`escrita proibida: ${tabela}.${proibido}`) }
    return q
}

const VAGAS = [
    { id: "v1", tipo: "vaga_normal", titulo: "AUXILIAR DE LIMPEZA", empresa_id: "e1", created_at: "2026-10-29T12:00:00Z", liberada_em: "2026-10-29T16:05:52Z", liberada_por: "c1", data_selecao_prevista: "2026-11-06", datas_selecao: null, status: "aberta" },
    { id: "s1", tipo: "selecao_evento", titulo: "Processo Seletivo — SINGULAR", empresa_id: "e2", created_at: "2026-05-26T12:00:00Z", liberada_em: null, liberada_por: null, data_selecao_prevista: null, datas_selecao: [{ data: "2026-11-25", hora: "09:00" }, { data: "2026-11-11", hora: "09:00" }], status: "aberta" },
]
const UNIDADE_DA_VAGA = [{ vaga_id: "v1", unidade: JANGURUSSU, origem: "colaborador" }, { vaga_id: "s1", unidade: PICI, origem: "base" }]
const CANDIDATURAS = [
    { id: "a1", vaga_id: "v1", observacoes: `banco_talentos:${TALENTO}`, nome: "Fulano", telefone: "85999990000", email_enviado_em: "2026-11-01T10:00:00Z" },
    { id: "a2", vaga_id: "v1", observacoes: null, nome: "Beltrana", telefone: "85999990001", email_enviado_em: "2026-11-01T10:00:00Z" },
    { id: "a3", vaga_id: "v1", observacoes: null, nome: "Ciclano", telefone: "85999990002", email_enviado_em: null },
]

vi.mock("@/lib/rbac/exigir-permissao-servidor", () => ({
    exigirPermissao: async (recurso: string) => {
        if (!autenticado) return { ok: false, resposta: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) }
        if (!permitido || recurso !== "epm_vagas_abertas_ver") return { ok: false, resposta: NextResponse.json({ error: "Sem permissão para esta ação." }, { status: 403 }) }
        return {
            ok: true,
            user: { id: "u1" },
            supabase: { rpc: async (_fn: string, args: { p_recurso: string }) => ({ data: args.p_recurso === "epm_vagas_abertas_rede" ? temRede : args.p_recurso === "epm_vagas_abertas_exportar" ? temExportar : false, error: null }) },
        }
    },
}))

vi.mock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
        from(tabela: string) {
            if (tabela === "unidades_cuca") return consulta(tabela, () => [{ id: JANGURUSSU, nome: "CUCA Jangurussu" }, { id: PICI, nome: "CUCA Pici" }])
            if (tabela === "colaboradores") {
                return consulta(tabela, f => {
                    if (f.eq.some(([c]) => c === "user_id")) return [{ nome_completo: "Maria Silva", unidade_cuca: unidadeColaborador }]
                    return [{ id: "c1", email: "cucajangurussu.empregabilidade@gmail.com" }]
                })
            }
            if (tabela === "vagas") return consulta(tabela, f => VAGAS.filter(v => f.eq.every(([c, val]) => (v as Record<string, unknown>)[c] === val)))
            if (tabela === "empresas") return consulta(tabela, () => [{ id: "e1", nome: "IEP - INSTITUTO DE EDUCACAO PORTAL" }, { id: "e2", nome: "SINGULAR FACILITIES SERVICE S.A." }])
            if (tabela === "candidaturas") {
                return consulta(tabela, f => {
                    const ids = f.in.find(([c]) => c === "vaga_id")?.[1] ?? []
                    const soEnviadas = f.not.some(([c, op, v]) => c === "email_enviado_em" && op === "is" && v === null)
                    return CANDIDATURAS.filter(c => ids.includes(c.vaga_id) && (!soEnviadas || c.email_enviado_em))
                })
            }
            throw new Error(`tabela inesperada no admin: ${tabela}`)
        },
        rpc(fn: string) {
            if (fn !== "emp_relatorio_unidade_vagas") throw new Error(`rpc inesperada: ${fn}`)
            return consulta("rpc", f => {
                const ids = f.in.find(([c]) => c === "vaga_id")?.[1]
                return UNIDADE_DA_VAGA.filter(u => !ids || ids.includes(u.vaga_id))
            })
        },
    }),
}))

import { GET } from "./route"

function chamar(unidade?: string, exportar = false) {
    const url = new URL("http://localhost/api/empregabilidade/relatorio/situacao-vagas")
    if (unidade) url.searchParams.set("unidade", unidade)
    if (exportar) url.searchParams.set("exportar", "1")
    return GET(new NextRequest(url))
}

describe("GET /api/empregabilidade/relatorio/situacao-vagas", () => {
    beforeEach(() => {
        autenticado = true
        permitido = true
        temRede = true
        temExportar = false
        unidadeColaborador = "CUCA Jangurussu"
        for (const k of Object.keys(selects)) delete selects[k]
        metodosChamados.clear()
    })

    it("401 sem sessão e 403 sem epm_vagas_abertas_ver", async () => {
        autenticado = false
        expect((await chamar()).status).toBe(401)
        autenticado = true
        permitido = false
        expect((await chamar()).status).toBe(403)
    })

    it("com a rede: todas as abertas, enviados por origem e seleção sem colunas de currículo", async () => {
        const res = await chamar()
        expect(res.status).toBe(200)
        const corpo = await res.json()
        expect(corpo.escopo).toEqual({ rede: true, selecionada: "todas" })
        expect(corpo.linhas.map((l: { id: string }) => l.id)).toEqual(["v1", "s1"])
        const [vaga, selecao] = corpo.linhas
        expect(vaga).toMatchObject({
            rotuloTipo: "Vaga",
            empresa: "IEP - INSTITUTO DE EDUCACAO PORTAL",
            unidade: "CUCA Jangurussu",
            cadastradaEmTexto: "29/10/2026",
            liberadaEmTexto: "29/10/2026",
            enviados: { total: 2, banco_talentos: 1, automacao: 1 },
            dataEntrevistaSelecao: "06/11/2026",
            liberadaPor: "cucajangurussu.empregabilidade@gmail.com",
        })
        expect(selecao).toMatchObject({
            rotuloTipo: "Seleção",
            unidade: "CUCA Pici",
            liberadaEmTexto: null,
            diasEmAberto: null,
            enviados: null,
            dataEntrevistaSelecao: "11/11 09:00 · 25/11 09:00",
            liberadaPor: null,
        })
    })

    it("seleção não consulta candidaturas; vaga só conta as já enviadas à empresa", async () => {
        await chamar()
        expect(selects.candidaturas).toEqual(["id, vaga_id, observacoes"])
    })

    it("sem a rede: só a unidade do colaborador, mesmo pedindo outra", async () => {
        temRede = false
        const corpo = await (await chamar(PICI)).json()
        expect(corpo.escopo).toEqual({ rede: false, selecionada: JANGURUSSU })
        expect(corpo.linhas.map((l: { id: string }) => l.id)).toEqual(["v1"])
        expect(corpo.unidades).toEqual([{ id: JANGURUSSU, nome: "CUCA Jangurussu" }])
    })

    it("com a rede: filtro de unidade devolve só aquela unidade", async () => {
        const corpo = await (await chamar(PICI)).json()
        expect(corpo.linhas.map((l: { id: string }) => l.id)).toEqual(["s1"])
    })

    it("vaga em unidade inativa não some: conta como Rede no rótulo e no filtro", async () => {
        const original = UNIDADE_DA_VAGA[1].unidade
        UNIDADE_DA_VAGA[1].unidade = "unidade-inativa-uuid"
        try {
            const corpo = await (await chamar()).json()
            const selecao = corpo.linhas.find((l: { id: string }) => l.id === "s1")
            expect(selecao?.unidade).toBe("Sem unidade definida (Rede Cuca)")
            const soRede = await (await chamar("rede")).json()
            expect(soRede.linhas.map((l: { id: string }) => l.id)).toEqual(["s1"])
        } finally {
            UNIDADE_DA_VAGA[1].unidade = original
        }
    })

    it("baixar Excel (exportar=1) exige a permissão de baixar; a resposta diz se a pessoa pode baixar", async () => {
        const semBaixar = await chamar(undefined, true)
        expect(semBaixar.status).toBe(403)
        expect((await semBaixar.json()).error).toBe("Sem permissão para baixar o relatório.")

        const corpoTela = await (await chamar()).json()
        expect(corpoTela.permissoes).toEqual({ exportar: false, rede: true })
        expect(corpoTela.geradoPor).toBe("Maria Silva")

        temExportar = true
        const comBaixar = await chamar(undefined, true)
        expect(comBaixar.status).toBe(200)
        expect((await comBaixar.json()).permissoes).toEqual({ exportar: true, rede: true })
    })

    it("sem a rede e sem unidade no cadastro (ex.: Geral): 403 com a mensagem do Relatório mensal", async () => {
        temRede = false
        unidadeColaborador = "Geral"
        const res = await chamar()
        expect(res.status).toBe(403)
        expect((await res.json()).error).toMatch(/não tem uma unidade definida/)
    })

    it("resposta só com contagens: nenhum nome, telefone ou observação de candidato; nenhuma escrita", async () => {
        const res = await chamar()
        const texto = JSON.stringify(await res.json())
        for (const proibido of ["Fulano", "Beltrana", "Ciclano", "85999990000", "banco_talentos:"]) expect(texto).not.toContain(proibido)
        for (const m of metodosChamados) expect(m.endsWith(".select")).toBe(true)
    })
})
