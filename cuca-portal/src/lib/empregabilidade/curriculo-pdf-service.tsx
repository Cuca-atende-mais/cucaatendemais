import type { SupabaseClient } from "@supabase/supabase-js"
import { renderToBuffer } from "@react-pdf/renderer"
import { uploadToR2, deleteFromR2 } from "@/lib/r2"
import { CurriculoPdfDocument } from "./curriculo-pdf"
import { derivarSkillsDeCurriculo } from "./curriculo-skills"
import type { CvDados } from "./curriculo-tipos"

// SQS-57 (T3) — orquestra: render do PDF, upload ao R2, derivação de skills e
// atualização de talent_bank. Usado tanto no salvamento do "Criar Currículo"
// (T5) quanto pelo botão manual dos 57 currículos legados (T6).

const R2_FOLDER = "curriculos-estruturados"

export interface GerarPdfResultado {
    url: string
    skills_jsonb: ReturnType<typeof derivarSkillsDeCurriculo>["skills_jsonb"]
}

/**
 * Gera o PDF de um currículo estruturado, armazena no R2, popula skills_jsonb
 * e atualiza talent_bank. Não falha a operação de salvar o currículo em si —
 * quem chama decide como tratar um erro aqui (ver rota gerar-pdf).
 */
export async function gerarEArmazenarPdfCurriculo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role client, schema não tipado ponta a ponta neste módulo
    supabase: SupabaseClient<any>,
    talentId: string,
    dados: CvDados
): Promise<GerarPdfResultado> {
    if (!dados?.nome) {
        throw new Error("Currículo sem nome — não é possível gerar o PDF.")
    }

    const { data: talentAtual } = await supabase
        .from("talent_bank")
        .select("arquivo_cv_url")
        .eq("id", talentId)
        .single()

    const urlAnterior: string | null = talentAtual?.arquivo_cv_url || null

    const buffer = await renderToBuffer(<CurriculoPdfDocument dados={dados} />)

    const key = `${R2_FOLDER}/${talentId}_${Date.now()}_${crypto.randomUUID()}.pdf`
    const url = await uploadToR2(key, buffer, "application/pdf")

    const derivadas = derivarSkillsDeCurriculo(dados)

    const { error: updErr } = await supabase
        .from("talent_bank")
        .update({
            arquivo_cv_url: url,
            skills_jsonb: derivadas.skills_jsonb,
            escolaridade_normalizada: derivadas.escolaridade_normalizada,
            experiencia_meses: derivadas.experiencia_meses,
            primeiro_emprego: derivadas.primeiro_emprego,
            updated_at: new Date().toISOString(),
        })
        .eq("id", talentId)

    if (updErr) {
        // Não deixa o PDF novo órfão no bucket se o banco não aceitou o update.
        await deleteFromR2(url).catch(() => {})
        throw updErr
    }

    // AC3 — substitui o PDF anterior, sem acumular órfão. Só remove se o
    // arquivo anterior também era um PDF gerado por nós (nunca apaga um
    // currículo que o próprio candidato enviou como arquivo).
    if (urlAnterior && urlAnterior !== url && urlAnterior.includes(`/${R2_FOLDER}/`)) {
        await deleteFromR2(urlAnterior).catch(err =>
            console.warn("[curriculo-pdf-service] Falha ao remover PDF anterior, continuando:", err)
        )
    }

    return { url, skills_jsonb: derivadas.skills_jsonb }
}
