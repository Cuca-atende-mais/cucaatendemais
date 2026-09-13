import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ACAO_UNICA, MODULOS_PROGRAMACAO_MENSAL } from "./catalogo-programacao-mensal"
import {
    GRUPOS_PROGRAMACAO_PONTUAL,
    MODULOS_PROGRAMACAO_PONTUAL,
    ORIGEM_ESPELHAMENTO_PONTUAL,
    PGP,
    espelharPermissoesPontual,
} from "./catalogo-programacao-pontual"

const tudo = { can_read: true, can_create: true, can_update: true, can_delete: true }
const nada = { can_read: false, can_create: false, can_update: false, can_delete: false }

describe("catálogo de permissões da programação pontual", () => {
    it("tem as 8 opções num grupo próprio, todas de ação única", () => {
        expect(GRUPOS_PROGRAMACAO_PONTUAL).toHaveLength(1)
        expect(MODULOS_PROGRAMACAO_PONTUAL.map(m => m.id)).toEqual(Object.values(PGP))
        for (const m of MODULOS_PROGRAMACAO_PONTUAL) expect(m.acoes).toEqual(ACAO_UNICA)
    })

    it("ids com prefixo próprio, sem colidir com checagens por prefixo nem com a mensal", () => {
        const ids = MODULOS_PROGRAMACAO_PONTUAL.map(m => m.id)
        const mensal = MODULOS_PROGRAMACAO_MENSAL.map(m => m.id)
        for (const id of ids) {
            expect(id.startsWith("pgp_")).toBe(true)
            for (const prefixo of ["programacao", "divulgacao", "developer", "pgm_"]) expect(id.startsWith(prefixo)).toBe(false)
            expect(mensal).not.toContain(id)
        }
        for (const a of ids) for (const b of ids) if (a !== b) expect(b.startsWith(a)).toBe(false)
    })

    it("espelhamento: update libera o fluxo; excluir nunca é espelhado", () => {
        const porId = new Map(espelharPermissoesPontual(tudo).map(l => [l.module, l]))
        for (const id of Object.values(PGP)) expect(porId.get(id)?.can_read).toBe(id !== PGP.excluir)
        for (const l of porId.values()) expect([l.can_create, l.can_update, l.can_delete]).toEqual([false, false, false])

        const soEditar = new Map(espelharPermissoesPontual({ ...nada, can_read: true, can_update: true }).map(l => [l.module, l.can_read]))
        expect(soEditar.get(PGP.ver)).toBe(true)
        expect(soEditar.get(PGP.criar)).toBe(false)
        expect(soEditar.get(PGP.disparar)).toBe(true)
        expect(espelharPermissoesPontual(nada).every(l => !l.can_read)).toBe(true)
    })

    it("a migration SQL cobre exatamente os mesmos módulos, com a mesma origem", () => {
        const dir = join(process.cwd(), "..", "supabase", "migrations")
        const arquivo = readdirSync(dir).find(f => f.endsWith("s_prog_17_expand_programacao_pontual.sql"))
        expect(arquivo).toBeDefined()
        const sql = readFileSync(join(dir, arquivo!), "utf8")
        const pares = new Map([...sql.matchAll(/\('(pgp_[a-z_]+)', '([a-z]+)'\)/g)].map(m => [m[1], m[2]]))
        const traduzido: Record<string, string> = { can_read: "read", can_create: "create", can_update: "update", nenhum: "nenhum" }
        expect(Object.fromEntries(pares)).toEqual(
            Object.fromEntries(Object.entries(ORIGEM_ESPELHAMENTO_PONTUAL).map(([id, origem]) => [id, traduzido[origem]])),
        )
    })
})
