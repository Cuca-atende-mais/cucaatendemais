import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"

export async function GET() {
    // SEC-08: analytics de negócio exige usuário autenticado
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        // SQS-51 (A3): Promise.allSettled para uma falha pontual não derrubar
        // o painel inteiro; vagas.empresa_nome não existe — usar join via empresas(nome).
        const settled = await Promise.allSettled([
            supabase.from("talent_bank").select("status"),
            supabase.from("talent_bank").select("primeiro_emprego").not("skills_jsonb", "is", null),
            supabase.from("talent_bank").select("area_interesse").eq("status", "disponivel"),
            supabase.from("talent_bank").select("escolaridade_normalizada"),
            supabase.from("vagas").select("status"),
            supabase.from("candidaturas").select("status"),
            supabase.from("candidaturas")
                .select("vaga_id, vagas(titulo, empresa_id, empresas(nome))")
                .not("vaga_id", "is", null),
        ])
        const dataOf = <T = any[]>(idx: number): T | null => {
            const r = settled[idx]
            if (r.status !== "fulfilled") {
                console.error(`[analytics] query ${idx} falhou:`, r.reason)
                return null
            }
            const { data, error } = r.value as { data: T | null; error: any }
            if (error) {
                console.error(`[analytics] query ${idx} erro Supabase:`, error)
                return null
            }
            return data
        }
        const tbStatus = dataOf<any[]>(0)
        const tbPrimeiroEmprego = dataOf<any[]>(1)
        const tbAreas = dataOf<any[]>(2)
        const tbEscolaridade = dataOf<any[]>(3)
        const vagasStatus = dataOf<any[]>(4)
        const candidaturasStatus = dataOf<any[]>(5)
        const vagasDisputadas = dataOf<any[]>(6)

        // Talent bank por status
        const tbStatusMap: Record<string, number> = {}
        for (const r of tbStatus ?? []) {
            const s = r.status || "desconhecido"
            tbStatusMap[s] = (tbStatusMap[s] || 0) + 1
        }

        // Primeiro emprego
        const totalComSkills = tbPrimeiroEmprego?.length ?? 0
        const totalPrimeiroEmprego = tbPrimeiroEmprego?.filter(r => r.primeiro_emprego === true).length ?? 0
        const totalComExp = totalComSkills - totalPrimeiroEmprego

        // Distribuição por área (expandir arrays)
        const areaMap: Record<string, number> = {}
        for (const r of tbAreas ?? []) {
            const areas: string[] = r.area_interesse || []
            for (const a of areas) {
                areaMap[a] = (areaMap[a] || 0) + 1
            }
        }
        const topAreas = Object.entries(areaMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([name, value]) => ({ name: name.split("(")[0].trim(), value }))

        // Distribuição por escolaridade (HF37-04: agrupa pelos 11 níveis canônicos normalizados)
        const escMap: Record<string, number> = {}
        for (const r of tbEscolaridade ?? []) {
            const esc = (r as any).escolaridade_normalizada || "Não informado"
            escMap[esc] = (escMap[esc] || 0) + 1
        }
        const escolaridade = Object.entries(escMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 11)
            .map(([name, value]) => ({ name, value }))

        // Vagas por status
        const vagasMap: Record<string, number> = {}
        for (const r of vagasStatus ?? []) {
            const s = r.status || "desconhecido"
            vagasMap[s] = (vagasMap[s] || 0) + 1
        }

        // Candidaturas por status
        const candMap: Record<string, number> = {}
        for (const r of candidaturasStatus ?? []) {
            const s = r.status || "desconhecido"
            candMap[s] = (candMap[s] || 0) + 1
        }

        // Vagas mais disputadas (top 5)
        const vagasCountMap: Record<string, { titulo: string; empresa: string; total: number }> = {}
        for (const r of vagasDisputadas ?? []) {
            const id = r.vaga_id as string
            if (!id) continue
            const vaga = r.vagas as any
            if (!vagasCountMap[id]) {
                // SQS-51 (A3): empresa vem do join vagas → empresas(nome)
                const empresaNome = vaga?.empresas?.nome ?? "Empresa não informada"
                vagasCountMap[id] = {
                    titulo: vaga?.titulo ?? "Vaga sem título",
                    empresa: empresaNome,
                    total: 0,
                }
            }
            vagasCountMap[id].total++
        }
        const vagasMaisDisputadas = Object.values(vagasCountMap)
            .sort((a, b) => b.total - a.total)
            .slice(0, 5)

        return NextResponse.json({
            talent_bank: {
                total: tbStatus?.length ?? 0,
                por_status: tbStatusMap,
                primeiro_emprego: totalPrimeiroEmprego,
                com_experiencia: totalComExp,
                total_com_skills: totalComSkills,
            },
            areas: topAreas,
            escolaridade,
            vagas: {
                total: vagasStatus?.length ?? 0,
                por_status: vagasMap,
            },
            candidaturas: {
                total: candidaturasStatus?.length ?? 0,
                por_status: candMap,
            },
            vagas_mais_disputadas: vagasMaisDisputadas,
        })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
