import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ACAO_UNICA, MODULOS_PROGRAMACAO_MENSAL, PGM_DIVULGACAO } from "./catalogo-programacao-mensal"
import { MODULOS_PROGRAMACAO_PONTUAL } from "./catalogo-programacao-pontual"
import {
    GRUPOS_DIVULGACAO_RAG_GLOBAL, MODULOS_RAG_GLOBAL, ORIGEM_ESPELHAMENTO_RAG_GLOBAL, PGM_DIVULGACAO_VER, PGR,
    completarVerDivulgacao, espelharRagGlobal, espelharVerDivulgacao,
} from "./catalogo-divulgacao-rag-global"

const linha = (module: string, can_read: boolean) => ({ module, can_read, can_create: false, can_update: false, can_delete: false })
const nada = { can_read: false, can_create: false, can_update: false, can_delete: false }

describe("catálogo da Divulgação e da Base de Conhecimento Global", () => {
    it("Divulgação: Ver + as duas opções da S-PROG-15; base global: 7 opções", () => {
        const [divulgacao, ragGlobal] = GRUPOS_DIVULGACAO_RAG_GLOBAL
        expect(divulgacao.modules.map(m => m.id)).toEqual([PGM_DIVULGACAO_VER, PGM_DIVULGACAO.aprovarRag, PGM_DIVULGACAO.dispararGlobal])
        expect(ragGlobal.modules.map(m => m.id)).toEqual(Object.values(PGR))
        for (const g of GRUPOS_DIVULGACAO_RAG_GLOBAL) for (const m of g.modules) expect(m.acoes).toEqual(ACAO_UNICA)
    })

    it("ids novos não colidem com checagens por prefixo nem com outros catálogos", () => {
        const outros = [...MODULOS_PROGRAMACAO_MENSAL, ...MODULOS_PROGRAMACAO_PONTUAL].map(m => m.id)
        const novos = [PGM_DIVULGACAO_VER, ...MODULOS_RAG_GLOBAL.map(m => m.id)]
        for (const id of novos) {
            for (const prefixo of ["programacao", "divulgacao", "developer", "pgp_"]) expect(id.startsWith(prefixo)).toBe(false)
            expect(outros).not.toContain(id)
        }
        for (const id of MODULOS_RAG_GLOBAL.map(m => m.id)) expect(id.startsWith("pgr_")).toBe(true)
        const todos = [...outros, ...novos]
        for (const a of todos) for (const b of todos) if (a !== b) expect(b.startsWith(a)).toBe(false)
    })

    it("salvar perfil com Aprovar RAG ou Disparar marca Ver Divulgação junto", () => {
        const base = [linha(PGM_DIVULGACAO_VER, false), linha(PGM_DIVULGACAO.aprovarRag, false), linha(PGM_DIVULGACAO.dispararGlobal, true)]
        expect(completarVerDivulgacao(base).find(l => l.module === PGM_DIVULGACAO_VER)?.can_read).toBe(true)
        const semAcao = [linha(PGM_DIVULGACAO_VER, false), linha(PGM_DIVULGACAO.aprovarRag, false)]
        expect(completarVerDivulgacao(semAcao)).toBe(semAcao)
    })
})

describe("espelhamento (item 4)", () => {
    it("Ver Divulgação para quem via a página por qualquer caminho", () => {
        expect(espelharVerDivulgacao(true, false, false)).toBe(true)
        expect(espelharVerDivulgacao(false, true, false)).toBe(true)
        expect(espelharVerDivulgacao(false, false, true)).toBe(true)
        expect(espelharVerDivulgacao(false, false, false)).toBe(false)
    })

    it("base global: update libera editar, ativar, reindexar e gerar resumo; delete libera excluir", () => {
        const soUpdate = new Map(espelharRagGlobal({ ...nada, can_read: true, can_update: true }).map(l => [l.module, l.can_read]))
        expect(soUpdate.get(PGR.ver)).toBe(true)
        expect(soUpdate.get(PGR.cadastrar)).toBe(false)
        for (const id of [PGR.editar, PGR.ativar, PGR.reindexar, PGR.gerarResumo]) expect(soUpdate.get(id)).toBe(true)
        expect(soUpdate.get(PGR.excluir)).toBe(false)
        expect(espelharRagGlobal({ ...nada, can_delete: true }).find(l => l.module === PGR.excluir)?.can_read).toBe(true)
    })

    it("a migration SQL cobre as mesmas opções, com a mesma origem", () => {
        const dir = join(process.cwd(), "..", "supabase", "migrations")
        const arquivo = readdirSync(dir).find(f => f.endsWith("s_prog_16_expand_divulgacao_rag_global.sql"))
        expect(arquivo).toBeDefined()
        const sql = readFileSync(join(dir, arquivo!), "utf8")
        const pares = Object.fromEntries([...sql.matchAll(/\('(pgr_[a-z_]+)', '([a-z]+)'\)/g)].map(m => [m[1], m[2]]))
        const traduzido: Record<string, string> = { can_read: "read", can_create: "create", can_update: "update", can_delete: "delete" }
        expect(pares).toEqual(Object.fromEntries(Object.entries(ORIGEM_ESPELHAMENTO_RAG_GLOBAL).map(([id, o]) => [id, traduzido[o]])))
        expect(sql).toContain("'pgm_divulgacao_ver'")
    })
})
