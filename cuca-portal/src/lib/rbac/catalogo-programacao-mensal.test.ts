import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
    ACAO_UNICA,
    ACOES_CRUD,
    CATEGORIAS_PROGRAMACAO,
    GRUPOS_PROGRAMACAO_MENSAL,
    MODULOS_PROGRAMACAO_MENSAL,
    PGM_DIVULGACAO,
    PGM_GERAL,
    espelharPermissoes,
    pgmCategoria,
} from "./catalogo-programacao-mensal"
import { linhaCompleta, marcarCampo, marcarLinha } from "./matriz-permissoes"

const tudo = { can_read: true, can_create: true, can_update: true, can_delete: true }
const nada = { can_read: false, can_create: false, can_update: false, can_delete: false }

describe("catálogo de permissões da programação mensal", () => {
    it("tem 7 gerais, 5 por categoria nas 4 categorias e 2 da Divulgação", () => {
        expect(MODULOS_PROGRAMACAO_MENSAL).toHaveLength(7 + 4 * 5 + 2)
        expect(GRUPOS_PROGRAMACAO_MENSAL).toHaveLength(6)
    })

    it("ids únicos, com prefixo próprio que não colide com checagens por prefixo", () => {
        const ids = MODULOS_PROGRAMACAO_MENSAL.map(m => m.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const id of ids) {
            expect(id.startsWith("pgm_")).toBe(true)
            for (const prefixo of ["programacao", "divulgacao", "developer"]) expect(id.startsWith(prefixo)).toBe(false)
        }
        // Nenhum id é prefixo de outro (a checagem antiga por prefixo não confundiria opções)
        for (const a of ids) for (const b of ids) if (a !== b) expect(b.startsWith(a)).toBe(false)
    })

    it("atividades usam CRUD; ações do fluxo e opções gerais usam ação única", () => {
        for (const c of CATEGORIAS_PROGRAMACAO) {
            const ids = pgmCategoria(c.slug)
            const acoes = (id: string) => MODULOS_PROGRAMACAO_MENSAL.find(m => m.id === id)?.acoes
            expect(acoes(ids.atividades)).toEqual(ACOES_CRUD)
            for (const id of [ids.enviar, ids.autorizar, ids.devolver, ids.reabrir]) expect(acoes(id)).toEqual(ACAO_UNICA)
        }
    })
})

describe("espelharPermissoes (item 4)", () => {
    it("perfil com mensal completo recebe tudo, menos Aprovar RAG", () => {
        const linhas = espelharPermissoes(tudo, { ...nada, can_create: true })
        const porId = new Map(linhas.map(l => [l.module, l]))
        expect(linhas).toHaveLength(MODULOS_PROGRAMACAO_MENSAL.length)
        expect(porId.get(PGM_DIVULGACAO.aprovarRag)?.can_read).toBe(false)
        expect(porId.get(PGM_DIVULGACAO.dispararGlobal)?.can_read).toBe(true)
        expect(porId.get(pgmCategoria("cursos").atividades)).toMatchObject(tudo)
        expect(porId.get(pgmCategoria("especiais").autorizar)).toMatchObject({ can_read: true, can_update: false })
    })

    it("respeita cada flag de origem", () => {
        const porId = new Map(espelharPermissoes({ ...nada, can_read: true }).map(l => [l.module, l]))
        expect(porId.get(PGM_GERAL.lista)?.can_read).toBe(true)
        expect(porId.get(PGM_GERAL.criarZero)?.can_read).toBe(false)
        expect(porId.get(PGM_GERAL.excluirProgramacao)?.can_read).toBe(false)
        expect(porId.get(pgmCategoria("esportes").enviar)?.can_read).toBe(false)
        expect(porId.get(PGM_DIVULGACAO.dispararGlobal)?.can_read).toBe(false)
    })

    it("a migration SQL cobre exatamente os mesmos módulos, com a mesma origem", () => {
        const dir = join(process.cwd(), "..", "supabase", "migrations")
        const arquivo = readdirSync(dir).find(f => f.endsWith("s_prog_12_espelha_permissoes_programacao.sql"))
        expect(arquivo).toBeDefined()
        const sql = readFileSync(join(dir, arquivo!), "utf8")
        const pares = [...sql.matchAll(/\('(pgm_[a-z_]+)', '([a-z]+)'\)/g)].map(m => [m[1], m[2]] as const)
        const origemSql = new Map(pares)
        expect(new Set(origemSql.keys())).toEqual(new Set(MODULOS_PROGRAMACAO_MENSAL.map(m => m.id)))

        const esperado: Record<string, string> = {
            [PGM_GERAL.lista]: "read", [PGM_GERAL.historico]: "read", [PGM_GERAL.exportar]: "read",
            [PGM_GERAL.criarZero]: "create", [PGM_GERAL.duplicar]: "create", [PGM_GERAL.importarPlanilha]: "create",
            [PGM_GERAL.excluirProgramacao]: "delete",
            [PGM_DIVULGACAO.aprovarRag]: "nenhum", [PGM_DIVULGACAO.dispararGlobal]: "disparo",
        }
        for (const c of CATEGORIAS_PROGRAMACAO) {
            const ids = pgmCategoria(c.slug)
            esperado[ids.atividades] = "crud"
            for (const id of [ids.enviar, ids.autorizar, ids.devolver, ids.reabrir]) esperado[id] = "update"
        }
        expect(Object.fromEntries(origemSql)).toEqual(esperado)
    })
})

describe("matriz de permissões", () => {
    const linha = { module: "x", ...nada }

    it("ação única nunca marca campos escondidos", () => {
        expect(marcarCampo(linha, "can_update", true, ACAO_UNICA)).toMatchObject(nada)
        expect(marcarLinha(linha, true, ACAO_UNICA)).toMatchObject({ ...nada, can_read: true })
        expect(linhaCompleta({ ...linha, can_read: true }, ACAO_UNICA)).toBe(true)
    })

    it("CRUD mantém o comportamento atual: editar marca ver; desmarcar ver limpa tudo", () => {
        expect(marcarCampo(linha, "can_update", true)).toMatchObject({ can_read: true, can_update: true })
        expect(marcarCampo({ module: "x", ...tudo }, "can_read", false)).toMatchObject(nada)
        expect(marcarLinha(linha, true)).toMatchObject(tudo)
        expect(linhaCompleta({ module: "x", ...tudo })).toBe(true)
    })
})
