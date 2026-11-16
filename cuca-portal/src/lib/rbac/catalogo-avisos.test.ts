import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ACAO_UNICA } from "./catalogo-programacao-mensal"
import { AVS, GRUPOS_AVISOS, MODULOS_AVISOS } from "./catalogo-avisos"
import { casaPorLike } from "./casa-por-like"

function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap(nome => {
        const caminho = join(dir, nome)
        if (nome === "node_modules" || nome.startsWith(".")) return []
        return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho]
    })
}

// Recursos checados no código e nas migrations (mesma varredura do teste do Planejamento).
function recursosNoCodigo(): Set<string> {
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

// Recursos passados a has_permission nas políticas (pg_policies) e funções do banco `cuca`, lidos em
// 16/11/2026 (só leitura). Congelados aqui porque o banco não é lido no teste.
const RECURSOS_NO_BANCO_16_11_2026 = [
    "ae_disparo", "ae_instancia", "ae_kpis", "ae_presenca", "ae_rag", "atendimentos", "atendimentos_academia_enem",
    "campanhas", "config_perfis", "developer", "empreg_banco_cv", "empreg_curriculos", "empreg_vagas", "epm_feedback_ver",
    "leads", "meta_templates", "pla_acomp_ver", "pla_apresent_ordem", "pla_apresent_ver", "pla_proj_criar",
    "pla_proj_duplicar", "pla_proj_editar", "pla_proj_excluir", "pla_proj_ver", "programacao",
]

describe("catálogo Avisos da Rede (S-INST-QUAL-08, AC5)", () => {
    it("três permissões avs_, de ação única, num grupo próprio", () => {
        expect(MODULOS_AVISOS.map(m => m.id)).toEqual(Object.values(AVS))
        expect(GRUPOS_AVISOS).toHaveLength(1)
        for (const m of MODULOS_AVISOS) {
            expect(m.id.startsWith("avs_")).toBe(true)
            expect(m.acoes).toEqual(ACAO_UNICA)
        }
    })

    it("nenhum id do catálogo casa com outro pelo LIKE", () => {
        const ids = MODULOS_AVISOS.map(m => m.id)
        for (const a of ids) for (const b of ids) if (a !== b) expect(casaPorLike(b, a), `${a} concederia ${b}`).toBe(false)
    })

    it("nenhum id casa com um recurso checado hoje, no código ou no banco", () => {
        const proprios = new Set<string>(Object.values(AVS))
        const checados = [...new Set([...recursosNoCodigo(), ...RECURSOS_NO_BANCO_16_11_2026])].filter(r => !proprios.has(r))
        expect(checados.length).toBeGreaterThan(20)
        for (const id of proprios) {
            const colisoes = checados.filter(r => casaPorLike(id, r) || casaPorLike(r, id))
            expect(colisoes, `${id} colide com ${colisoes.join(", ")}`).toEqual([])
        }
    })
})
