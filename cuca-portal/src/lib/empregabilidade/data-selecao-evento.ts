/**
 * S-EMP-GES-05 — antecedência mínima da seleção por evento (`vagas.tipo = 'selecao_evento'`).
 *
 * Toda data de `datas_selecao` informada na CRIAÇÃO precisa ser no mínimo hoje + 5 dias corridos,
 * no fuso do atendimento. Usado no formulário público, no modal interno (só no ramo de criação) e
 * em `POST /api/empregabilidade/selecao`, para cliente e servidor darem a mesma mensagem. O trigger
 * `trg_vagas_selecao_evento_data_minima` repete a regra no banco como defesa final.
 *
 * Vaga normal (`data_selecao_prevista`) não muda: segue em `data-selecao-prevista.ts`.
 */
import { hojeBrasilISO } from "./data-selecao-prevista"

export const DIAS_ANTECEDENCIA_SELECAO_EVENTO = 5

const FORMATO_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

/** Soma `dias` a uma data `YYYY-MM-DD`, em UTC puro (sem fuso), devolvendo `YYYY-MM-DD`.
 * A data de entrada já é "do dia" no fuso do atendimento; aqui só se anda no calendário. */
export function somarDiasISO(dataISO: string, dias: number): string {
    const [ano, mes, dia] = dataISO.split("-").map(Number)
    return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10)
}

/** Data mínima permitida para a seleção (`YYYY-MM-DD`): hoje + 5, no fuso de Fortaleza. Serve
 * também como `min` do `<input type="date">`. */
export function dataMinimaSelecaoEvento(hojeISO: string = hojeBrasilISO()): string {
    return somarDiasISO(hojeISO, DIAS_ANTECEDENCIA_SELECAO_EVENTO)
}

/** `YYYY-MM-DD` → `dd/mm/aaaa`. */
export function formatarDataBR(dataISO: string): string {
    const [ano, mes, dia] = dataISO.split("-")
    return `${dia}/${mes}/${ano}`
}

export function mensagemDataMinimaSelecaoEvento(dataMinimaISO: string): string {
    return `A data da seleção precisa ser a partir de ${formatarDataBR(dataMinimaISO)} (${DIAS_ANTECEDENCIA_SELECAO_EVENTO} dias a partir de hoje).`
}

export const MSG_DATA_SELECAO_EVENTO_INVALIDA = "Data da seleção inválida."

export type ValidacaoDatasSelecaoEvento = { ok: true } | { ok: false; erro: string }

/** Valida as datas de uma seleção nova. Linhas sem data são ignoradas (os formulários já mandam
 * só as preenchidas, e "ao menos uma data" continua sendo checado por quem chama). */
export function validarDatasSelecaoEvento(
    datas: unknown,
    hojeISO: string = hojeBrasilISO(),
): ValidacaoDatasSelecaoEvento {
    if (!Array.isArray(datas)) return { ok: false, erro: MSG_DATA_SELECAO_EVENTO_INVALIDA }
    const minimo = dataMinimaSelecaoEvento(hojeISO)
    for (const item of datas) {
        const valor = item && typeof item === "object" ? (item as { data?: unknown }).data : undefined
        if (valor === undefined || valor === null || valor === "") continue
        if (typeof valor !== "string" || !FORMATO_DATA_ISO.test(valor.trim())) {
            return { ok: false, erro: MSG_DATA_SELECAO_EVENTO_INVALIDA }
        }
        if (valor.trim() < minimo) {
            return { ok: false, erro: mensagemDataMinimaSelecaoEvento(minimo) }
        }
    }
    return { ok: true }
}
