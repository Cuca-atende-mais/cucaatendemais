import type { SupabaseClient } from "@supabase/supabase-js"
import {
    chaveTelefone,
    decidirAcaoTalento,
    novoTalento,
    preencherCamposVazios,
    temCurriculo,
    type AcaoTalento,
    type CandidaturaParaTalento,
    type StatusEditavel,
} from "./status-candidatura"

// S-EMP-GES-01: executa a regra de status no banco. Recebe o cliente admin (service_role) — quem
// chama já checou sessão, permissão e se o usuário enxerga a candidatura.

export interface ResultadoStatus {
    candidaturaId: string
    ok: boolean
    erro?: string
    talento?: AcaoTalento["tipo"]
    motivo?: string
}

const CAMPOS_CANDIDATURA =
    "id, vaga_id, nome, telefone, data_nascimento, arquivo_cv_url, dados_ocr_json, area_interesse, created_at, pcd_candidato, pcd_tipo_candidato"

export async function aplicarStatusCandidatura(
    admin: SupabaseClient,
    candidaturaId: string,
    novoStatus: StatusEditavel,
): Promise<ResultadoStatus> {
    try {
        const { data: cand, error: cErr } = await admin
            .from("candidaturas")
            .select(CAMPOS_CANDIDATURA)
            .eq("id", candidaturaId)
            .maybeSingle<CandidaturaParaTalento>()
        if (cErr) throw cErr
        if (!cand) return { candidaturaId, ok: false, erro: "Candidatura não encontrada." }

        const agora = new Date().toISOString()
        const { error: upErr } = await admin
            .from("candidaturas")
            .update({ status: novoStatus, updated_at: agora })
            .eq("id", candidaturaId)
        if (upErr) throw upErr

        const chave = chaveTelefone(cand.telefone)
        let talentos: Record<string, unknown>[] = []
        if (chave) {
            const { data, error } = await admin.rpc("emp_talent_bank_por_chave", { p_chave: chave })
            if (error) throw error
            talentos = (data as Record<string, unknown>[] | null) ?? []
        }

        let processoAtivo = false
        if (novoStatus === "rejeitado" && chave) {
            const { data, error } = await admin.rpc("emp_pessoa_tem_processo_ativo", {
                p_chave: chave,
                p_excluir_candidatura: candidaturaId,
            })
            if (error) throw error
            processoAtivo = data === true
        }

        const acao = decidirAcaoTalento({
            novoStatus,
            cadastrosExistentes: talentos.length,
            processoAtivoEmOutraVaga: processoAtivo,
            temCurriculo: temCurriculo(cand),
        })

        if (acao.tipo === "travar") {
            const ids = talentos.map(t => t.id as string)
            const { error } = await admin.from("talent_bank").update({ status: acao.status, updated_at: agora }).in("id", ids)
            if (error) throw error
        } else if (acao.tipo === "liberar") {
            for (const talento of talentos) {
                const { error } = await admin
                    .from("talent_bank")
                    .update({ ...preencherCamposVazios(talento, cand), status: "disponivel", updated_at: agora })
                    .eq("id", talento.id as string)
                if (error) throw error
            }
        } else if (acao.tipo === "criar") {
            const { error } = await admin.from("talent_bank").insert({ ...novoTalento(cand), updated_at: agora })
            if (error) throw error
        }

        return { candidaturaId, ok: true, talento: acao.tipo, ...(acao.tipo === "nenhuma" ? { motivo: acao.motivo } : {}) }
    } catch (err) {
        console.error("[aplicarStatusCandidatura] Erro:", candidaturaId, err)
        const mensagem = err instanceof Error ? err.message : (err as { message?: string })?.message
        return { candidaturaId, ok: false, erro: mensagem || "Erro ao atualizar o status." }
    }
}
