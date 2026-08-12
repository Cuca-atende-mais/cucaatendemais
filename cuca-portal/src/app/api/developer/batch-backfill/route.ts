import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { normalizarEscolaridade } from "@/lib/empregabilidade/escolaridade"

const DEVELOPER_EMAILS = ["valmir@cucateste.com", "dev.cucaatendemais@gmail.com"]

export async function POST(req: NextRequest) {
    try {
        // Autenticação
        const supabaseServer = createServerClient()
        const { data: { user }, error: authError } = await (await supabaseServer).auth.getUser()
        if (authError || !user?.email || !DEVELOPER_EMAILS.includes(user.email)) {
            return NextResponse.json({ error: "Acesso negado." }, { status: 403 })
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        const { table = "talent_bank", limit = 200 } = await req.json().catch(() => ({}))

        if (table !== "talent_bank" && table !== "candidaturas") {
            return NextResponse.json({ error: "table deve ser 'talent_bank' ou 'candidaturas'." }, { status: 400 })
        }

        let updated = 0
        let skipped = 0

        if (table === "talent_bank") {
            // Busca registros sem escolaridade_normalizada mas com skills_jsonb
            const { data: rows, error } = await supabase
                .from("talent_bank")
                .select("id, skills_jsonb, primeiro_emprego")
                .is("escolaridade_normalizada", null)
                .not("skills_jsonb", "is", null)
                .limit(limit)

            if (error) throw new Error(error.message)

            for (const row of rows ?? []) {
                const skills = row.skills_jsonb as any
                const escolaridade = normalizarEscolaridade(skills?.escolaridade)
                const expMeses = typeof skills?.experiencia_meses === "number" ? skills.experiencia_meses : null
                const primEmprego = row.primeiro_emprego ?? (expMeses === 0 ? true : null)

                const payload: Record<string, any> = {}
                if (escolaridade) payload.escolaridade_normalizada = escolaridade
                if (expMeses !== null) payload.experiencia_meses = expMeses
                if (primEmprego !== null) payload.primeiro_emprego = primEmprego

                if (Object.keys(payload).length === 0) { skipped++; continue }

                const { error: updErr } = await supabase
                    .from("talent_bank")
                    .update(payload)
                    .eq("id", row.id)

                if (updErr) { skipped++; continue }
                updated++
            }
        } else {
            // candidaturas
            const { data: rows, error } = await supabase
                .from("candidaturas")
                .select("id, dados_ocr_json")
                .is("escolaridade_normalizada", null)
                .not("dados_ocr_json", "is", null)
                .limit(limit)

            if (error) throw new Error(error.message)

            for (const row of rows ?? []) {
                const ocr = row.dados_ocr_json as any
                const escolaridade = normalizarEscolaridade(ocr?.escolaridade ?? ocr?.escolaridade_normalizada)
                const expMeses = typeof ocr?.experiencia_meses === "number" ? ocr.experiencia_meses : null

                const payload: Record<string, any> = {}
                if (escolaridade) payload.escolaridade_normalizada = escolaridade
                if (expMeses !== null) payload.experiencia_meses = expMeses
                if (typeof ocr?.primeiro_emprego === "boolean") payload.primeiro_emprego = ocr.primeiro_emprego
                if (ocr?.genero) payload.genero = ocr.genero
                if (ocr?.bairro) payload.bairro = ocr.bairro
                if (typeof ocr?.pcd === "boolean") payload.pcd = ocr.pcd
                if (ocr?.pcd_tipo) payload.pcd_tipo = ocr.pcd_tipo

                if (Object.keys(payload).length === 0) { skipped++; continue }

                const { error: updErr } = await supabase
                    .from("candidaturas")
                    .update(payload)
                    .eq("id", row.id)

                if (updErr) { skipped++; continue }
                updated++
            }
        }

        return NextResponse.json({ ok: true, table, updated, skipped })
    } catch (err: any) {
        console.error("[batch-backfill]", err)
        return NextResponse.json({ error: err.message || "Erro interno." }, { status: 500 })
    }
}
