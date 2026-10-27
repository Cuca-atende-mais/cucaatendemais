import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ACAO_UNICA } from "./catalogo-programacao-mensal"
import { GRUPOS_PLANEJAMENTO, MODULOS_PLANEJAMENTO } from "./catalogo-planejamento"
import { casaPorLike } from "./casa-por-like"

function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap(nome => {
        const caminho = join(dir, nome)
        if (nome === "node_modules" || nome.startsWith(".")) return []
        return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho]
    })
}

function recursosChecados(): Set<string> {
    const raiz = join(__dirname, "..", "..", "..")
    const fontes = [...arquivos(join(raiz, "src")), ...arquivos(join(raiz, "supabase", "migrations"))]
        .filter(f => /\.(ts|tsx|sql)$/.test(f) && !f.endsWith(".test.ts"))
    const recursos = new Set<string>()
    const padroes = [/has_permission\(\s*['"]([a-z_]+)['"]/g, /p_recurso:\s*['"]([a-z_]+)['"]/g, /hasPermission\(\s*['"]([a-z_]+)['"]/g, /recurso:\s*['"]([a-z_]+)['"]/g]
    for (const f of fontes) {
        const texto = readFileSync(f, "utf8")
        for (const re of padroes) for (const m of texto.matchAll(re)) recursos.add(m[1])
    }
    return recursos
}

describe("casaPorLike", () => {
    it("segue o LIKE do banco, com `_` como curinga", () => {
        expect(casaPorLike("pla_validar_retirar", "pla_validar")).toBe(true)
        expect(casaPorLike("plaXvalid", "pla_valid")).toBe(true)
        expect(casaPorLike("pla_valid_dar", "pla_validar")).toBe(false)
        expect(casaPorLike("pla_proj_criar", "pla_proj_editar")).toBe(false)
    })
})

describe("catálogo Planejamento 2027", () => {
    it("todo id tem prefixo pla_, ação única e grupo \"Planejamento 2027 — ...\"", () => {
        // Na S-PLA-01 o catálogo fica vazio (escopo por setor vem do cadastro); as regras valem para as próximas.
        for (const grupo of GRUPOS_PLANEJAMENTO) {
            expect(grupo.category.startsWith("Planejamento 2027 — ")).toBe(true)
            for (const m of grupo.modules) {
                expect(m.id.startsWith("pla_")).toBe(true)
                expect(m.acoes).toEqual(ACAO_UNICA)
            }
        }
    })

    it("nenhum id do catálogo casa com outro id do catálogo pelo LIKE", () => {
        expect(new Set(MODULOS_PLANEJAMENTO).size).toBe(MODULOS_PLANEJAMENTO.length)
        for (const a of MODULOS_PLANEJAMENTO) {
            for (const b of MODULOS_PLANEJAMENTO) {
                if (a !== b) expect(casaPorLike(b, a), `${a} concederia ${b}`).toBe(false)
            }
        }
    })

    it("nenhum id do catálogo casa com um recurso checado hoje (fora os próprios ids)", () => {
        const proprios = new Set(MODULOS_PLANEJAMENTO)
        const checados = [...recursosChecados()].filter(r => !proprios.has(r))
        expect(checados.length).toBeGreaterThan(10)
        for (const id of MODULOS_PLANEJAMENTO) {
            const colisoes = checados.filter(r => casaPorLike(id, r) || casaPorLike(r, id))
            expect(colisoes, `${id} colide com ${colisoes.join(", ")}`).toEqual([])
        }
    })
})
