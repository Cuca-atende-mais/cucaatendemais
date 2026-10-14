import type { SupabaseClient } from "@supabase/supabase-js"

// Banco em memória para os testes do feedback (GES-02/03): só o que os serviços usam —
// select/insert/upsert/update/delete com eq/in/is/gt, `.select()` depois de update/insert, e as chaves
// únicas reais (leads.telefone e conversas(lead_id, origem_id)).

export type Linha = Record<string, unknown>

export function bancoFalso(
    inicial: Record<string, Linha[]> = {},
    ganchos: { antesDeInserirLead?: (db: Record<string, Linha[]>) => void } = {},
) {
    const db: Record<string, Linha[]> = {
        leads: [], conversas: [], mensagens: [], feedback_solicitacoes: [], feedback_solicitacao_itens: [],
        meta_templates: [], candidaturas: [], vagas: [],
        ...inicial,
    }
    let seq = 0
    const novoId = () => `id-${++seq}`

    function consulta(tabela: string) {
        let op: "select" | "insert" | "upsert" | "update" | "delete" = "select"
        let dados: Linha | Linha[] = {}
        let opcoes: { onConflict?: string; ignoreDuplicates?: boolean } = {}
        let modo: "lista" | "um" | "talvez" = "lista"
        const filtros: ((l: Linha) => boolean)[] = []

        const executar = async () => {
            const linhas = db[tabela] ?? (db[tabela] = [])
            const casa = (l: Linha) => filtros.every(f => f(l))
            if (op === "select") {
                const achadas = linhas.filter(casa)
                if (modo === "lista") return { data: achadas, error: null }
                return { data: achadas[0] ?? null, error: modo === "um" && !achadas[0] ? { message: "nenhuma" } : null }
            }
            if (op === "update") {
                const alvo = linhas.filter(casa)
                for (const l of alvo) Object.assign(l, dados)
                return { data: alvo, error: null }
            }
            if (op === "delete") {
                db[tabela] = linhas.filter(l => !casa(l))
                return { data: null, error: null }
            }
            const novas: Linha[] = (Array.isArray(dados) ? dados : [dados]).map(d => ({ id: novoId(), ...d }))
            if (tabela === "leads") ganchos.antesDeInserirLead?.(db)
            for (const n of novas) {
                if (tabela === "leads" && db.leads.some(l => l.telefone === n.telefone)) {
                    return { data: null, error: { code: "23505", message: "duplicado" } }
                }
                if (tabela === "conversas" && db.conversas.some(c => c.lead_id === n.lead_id && c.origem_id === n.origem_id)) {
                    if (op === "upsert" && opcoes.ignoreDuplicates) continue
                    return { data: null, error: { code: "23505", message: "duplicado" } }
                }
                db[tabela].push(n)
            }
            return { data: modo === "lista" ? novas : novas[0], error: null }
        }

        const q = {
            select: () => q,
            insert: (d: Linha | Linha[]) => { op = "insert"; dados = d; return q },
            upsert: (d: Linha, o: typeof opcoes) => { op = "upsert"; dados = d; opcoes = o; return q },
            update: (d: Linha) => { op = "update"; dados = d; return q },
            delete: () => { op = "delete"; return q },
            eq: (c: string, v: unknown) => { filtros.push(l => l[c] === v); return q },
            in: (c: string, v: unknown[]) => { filtros.push(l => v.includes(l[c])); return q },
            is: (c: string, v: null) => { filtros.push(l => (l[c] ?? null) === v); return q },
            gt: (c: string, v: string) => { filtros.push(l => typeof l[c] === "string" && (l[c] as string) > v); return q },
            single: () => { modo = "um"; return executar() },
            maybeSingle: () => { modo = "talvez"; return executar() },
            then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => executar().then(ok, erro),
        }
        return q
    }
    return { db, cliente: { from: consulta } as unknown as SupabaseClient }
}
