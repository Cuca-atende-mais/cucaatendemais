import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ACAO_UNICA } from "./catalogo-programacao-mensal"
import { EPM_FEEDBACK, GRUPOS_EMPREGABILIDADE_GESTAO, MODULOS_EMPREGABILIDADE_GESTAO } from "./catalogo-empregabilidade-gestao"

// has_permission casa `sys_permissions.module LIKE recurso || '%'`: um id novo que comece com um recurso
// já checado concederia esse recurso por engano. Varre o código e as migrations atrás dos recursos checados.
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

describe("catálogo Emprega+ (EMP-GES)", () => {
    it("GES-01: 4 permissões de ação única, num grupo próprio", () => {
        expect(MODULOS_EMPREGABILIDADE_GESTAO).toEqual(Object.values(EPM_FEEDBACK))
        for (const grupo of GRUPOS_EMPREGABILIDADE_GESTAO) {
            for (const m of grupo.modules) expect(m.acoes).toEqual(ACAO_UNICA)
        }
    })

    it("nenhum id novo é prefixo de outro id do catálogo", () => {
        for (const a of MODULOS_EMPREGABILIDADE_GESTAO) {
            for (const b of MODULOS_EMPREGABILIDADE_GESTAO) {
                if (a !== b) expect(b.startsWith(a)).toBe(false)
            }
        }
    })

    it("nenhum id novo começa com um recurso checado hoje por has_permission (fora os próprios ids)", () => {
        const proprios = new Set(MODULOS_EMPREGABILIDADE_GESTAO)
        const checados = [...recursosChecados()].filter(r => !proprios.has(r))
        expect(checados.length).toBeGreaterThan(10)
        for (const id of MODULOS_EMPREGABILIDADE_GESTAO) {
            const colisoes = checados.filter(r => id.startsWith(r))
            expect(colisoes, `${id} colide com ${colisoes.join(", ")}`).toEqual([])
        }
    })
})
