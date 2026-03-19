import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST(request: NextRequest) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        const formData = await request.formData()
        const nome = formData.get("nome") as string
        const telefone = formData.get("telefone") as string
        const data_nascimento = formData.get("data_nascimento") as string | null
        const area_interesse = formData.get("area_interesse") as string | null
        const arquivo = formData.get("arquivo") as File | null

        if (!nome?.trim() || !telefone?.trim()) {
            return NextResponse.json({ error: "Nome e telefone são obrigatórios." }, { status: 400 })
        }

        let arquivo_cv_url: string | null = null

        // Upload do currículo se enviado
        if (arquivo && arquivo.size > 0) {
            const ext = arquivo.name.split(".").pop() || "pdf"
            const filename = `talent_bank/${Date.now()}_${nome.replace(/\s+/g, "_")}.${ext}`
            const arrayBuffer = await arquivo.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)

            const { error: uploadErr } = await supabase.storage
                .from("curriculos")
                .upload(filename, buffer, {
                    contentType: arquivo.type || "application/pdf",
                    upsert: false,
                })

            if (uploadErr) throw uploadErr

            const { data: urlData } = supabase.storage
                .from("curriculos")
                .getPublicUrl(filename)

            arquivo_cv_url = urlData?.publicUrl || null
        }

        // Upsert por telefone
        const telefoneNormalizado = telefone.replace(/\D/g, "")
        const { data: existing } = await supabase
            .from("talent_bank")
            .select("id")
            .eq("telefone", telefoneNormalizado)
            .maybeSingle()

        const payload = {
            nome: nome.trim(),
            telefone: telefoneNormalizado,
            data_nascimento: data_nascimento || null,
            area_interesse: area_interesse ? [area_interesse] : null,
            arquivo_cv_url,
            status: "disponivel",
            skills_jsonb: null,
            updated_at: new Date().toISOString(),
        }

        if (existing) {
            await supabase.from("talent_bank").update(payload).eq("id", existing.id)
        } else {
            await supabase.from("talent_bank").insert(payload)
        }

        // Disparar OCR em background se tiver arquivo
        if (arquivo_cv_url) {
            const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"
            fetch(`${workerUrl}/process-cv-espontaneo`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nome: nome.trim(), telefone: telefoneNormalizado, cv_url: arquivo_cv_url }),
            }).catch(() => null) // fire-and-forget
        }

        return NextResponse.json({ ok: true })
    } catch (err: any) {
        console.error("[talent-bank/cadastrar] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno." }, { status: 500 })
    }
}
