import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        const [
            { data: tbStatus },
            { data: tbPrimeiroEmprego },
            { data: tbAreas },
            { data: tbEscolaridade },
            { data: vagasStatus },
            { data: candidaturasStatus },
        ] = await Promise.all([
            // Talent bank por status
            supabase.from("talent_bank").select("status"),
            // Primeiro emprego
            supabase.from("talent_bank").select("primeiro_emprego").not("skills_jsonb", "is", null),
            // Área de interesse (top áreas)
            supabase.from("talent_bank").select("area_interesse").eq("status", "disponivel"),
            // Escolaridade
            supabase.from("talent_bank").select("skills_jsonb->escolaridade"),
            // Vagas por status
            supabase.from("vagas").select("status"),
            // Candidaturas por status
            supabase.from("candidaturas").select("status"),
        ])

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

        // Distribuição por escolaridade
        const escMap: Record<string, number> = {}
        for (const r of tbEscolaridade ?? []) {
            const esc = (r as any).escolaridade || "Não informado"
            const key = esc.length > 30 ? esc.substring(0, 30) + "…" : esc
            escMap[key] = (escMap[key] || 0) + 1
        }
        const escolaridade = Object.entries(escMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
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
        })
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
