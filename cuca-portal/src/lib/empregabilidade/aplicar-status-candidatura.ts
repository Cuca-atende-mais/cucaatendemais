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

// S-EMP-GES-01: executa a regra de status no banco (regra atual: S-EMP-GES-10, ver status-candidatura.ts). Recebe o cliente admin (service_role) — quem
// chama já checou sessão, permissão e se o usuário enxerga a candidatura.

export interface ResultadoStatus {
    candidaturaId: string
    ok: boolean
    erro?: string
    talento?: AcaoTalento["tipo"]
    motivo?: string
}

const CAMPOS_CANDIDATURA =
    "id, status, vaga_id, nome, telefone, data_nascimento, arquivo_cv_url, dados_ocr_json, area_interesse, created_at, pcd_candidato, pcd_tipo_candidato, vagas(tipo)"

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

        // S-EMP-GES-07: inscrito de seleção não tem Banco de Talentos — nem consulta, nem reflexo.
        if (cand.vagas?.tipo === "selecao_evento") {
            return { candidaturaId, ok: true, talento: "nenhuma", motivo: "selecao" }
        }

        const chave = chaveTelefone(cand.telefone)
        let talentos: Record<string, unknown>[] = []
        if (chave) {
            const { data, error } = await admin.rpc("emp_talent_bank_por_chave", { p_chave: chave })
            if (error) throw error
            talentos = (data as Record<string, unknown>[] | null) ?? []
        }

        // Só consulta "contratado em outra vaga" quando a candidatura está saindo de contratado.
        const saindoDeContratado = cand.status === "contratado" && novoStatus !== "contratado"
        let contratadoEmOutraVaga = false
        if (saindoDeContratado && chave && talentos.length > 0) {
            const { data, error } = await admin.rpc("emp_pessoa_contratada_em_outra_vaga", {
                p_chave: chave,
                p_excluir_candidatura: candidaturaId,
            })
            if (error) throw error
            contratadoEmOutraVaga = data === true
        }

        const acao = decidirAcaoTalento({
            statusAnterior: cand.status,
            novoStatus,
            cadastrosExistentes: talentos.length,
            contratadoEmOutraVaga,
            temCurriculo: temCurriculo(cand),
        })

        if (acao.tipo === "travar") {
            const ids = talentos.map(t => t.id as string)
            const { error } = await admin.from("talent_bank").update({ status: "contratado", updated_at: agora }).in("id", ids)
            if (error) throw error
        } else if (acao.tipo === "liberar" || acao.tipo === "preencher") {
            for (const talento of talentos) {
                const patch: Record<string, unknown> = {
                    ...(acao.tipo === "preencher" || acao.preencher ? preencherCamposVazios(talento, cand) : {}),
                    ...(acao.tipo === "liberar" ? { status: "disponivel" } : {}),
                }
                if (Object.keys(patch).length === 0) continue
                const { error } = await admin
                    .from("talent_bank")
                    .update({ ...patch, updated_at: agora })
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
