import type { SupabaseClient } from "@supabase/supabase-js"
import { uploadToR2, deleteFromR2 } from "@/lib/r2"
import { gerarDocxCurriculo } from "./curriculo-docx"
import type { CvDados } from "./curriculo-tipos"

// SQS-63 — espelha curriculo-pdf-service.tsx (mesma orquestração: render,
// upload ao R2, atualiza talent_bank), mas pro .docx. Só usado pelo
// formulário público (SQS-58/63) — não pelo "Criar Currículo" interno.

const R2_FOLDER = "curriculos-estruturados-docx"

/**
 * Gera o .docx de um currículo estruturado e armazena no R2. Best-effort por
 * design — quem chama decide o que fazer com uma falha (ver rota pública:
 * AC5 da SQS-63, não pode derrubar o salvamento do currículo).
 */
export async function gerarEArmazenarDocxCurriculo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role client, mesmo padrão de curriculo-pdf-service.tsx
    supabase: SupabaseClient<any>,
    talentId: string,
    dados: CvDados
): Promise<{ url: string }> {
    if (!dados?.nome) {
        throw new Error("Currículo sem nome — não é possível gerar o DOCX.")
    }

    const { data: talentAtual } = await supabase
        .from("talent_bank")
        .select("arquivo_docx_url")
        .eq("id", talentId)
        .single()

    const urlAnterior: string | null = talentAtual?.arquivo_docx_url || null

    const buffer = await gerarDocxCurriculo(dados)

    const key = `${R2_FOLDER}/${talentId}_${Date.now()}_${crypto.randomUUID()}.docx`
    const url = await uploadToR2(key, buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")

    const { error: updErr } = await supabase
        .from("talent_bank")
        .update({ arquivo_docx_url: url })
        .eq("id", talentId)

    if (updErr) {
        await deleteFromR2(url).catch(() => {})
        throw updErr
    }

    if (urlAnterior && urlAnterior !== url) {
        await deleteFromR2(urlAnterior).catch(err =>
            console.warn("[curriculo-docx-service] Falha ao remover DOCX anterior, continuando:", err)
        )
    }

    return { url }
}
