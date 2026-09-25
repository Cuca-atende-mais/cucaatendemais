/**
 * S-PROG-19: data início, data fim, hora início e hora fim de CURSOS, DIA A DIA e ESPECIAIS.
 * Regras num lugar só, usadas pela grade, pela ficha, pela gravação (`payload.ts`) e pela revisão.
 *
 * No formulário (`AtividadeForm`) as datas continuam onde já estavam, para não mexer no resto do
 * editor: CURSOS usa `metadata.data_inicio_raw`/`data_fim_raw`; DIA A DIA/ESPECIAIS usam
 * `data_atividade` (início) e `metadata.data_fim_raw` (fim). Na gravação viram as colunas
 * `data_inicio`/`data_fim` de `atividades_mensais` (`data_atividade` continua = início).
 */
import type { AtividadeForm, Categoria } from "./tipos"
import { dataBrParaISO } from "./mascaras"

const NOMES_DIA_SEMANA = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"]

/** Só uma data ISO completa (`aaaa-mm-dd`) vai para coluna `date`; texto ainda sendo digitado vira `null`. */
export function isoOuNulo(valor: unknown): string | null {
    const s = typeof valor === "string" ? valor.trim() : ""
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** "2026-10-07" → "07/10". */
export function diaMes(iso: string): string {
    const [, m, d] = iso.split("-")
    return `${d}/${m}`
}

export const categoriaComPeriodo = (categoria: Categoria | string | null | undefined): boolean =>
    categoria === "CURSOS" || categoria === "DIA A DIA" || categoria === "ESPECIAIS"

/** Datas da atividade como vão para as colunas `data_inicio`/`data_fim` (ESPORTES: sempre vazias). */
export function datasDaAtividade(a: Pick<AtividadeForm, "categoria" | "data_atividade" | "metadata">): { data_inicio: string | null; data_fim: string | null } {
    const meta = a.metadata || {}
    if (a.categoria === "CURSOS") return { data_inicio: isoOuNulo(meta.data_inicio_raw), data_fim: isoOuNulo(meta.data_fim_raw) }
    if (a.categoria === "DIA A DIA" || a.categoria === "ESPECIAIS") {
        return { data_inicio: isoOuNulo(a.data_atividade), data_fim: isoOuNulo(meta.data_fim_raw) }
    }
    return { data_inicio: null, data_fim: null }
}

/**
 * DIA A DIA/ESPECIAIS: aplica a data de início digitada. Enquanto a data não fecha, guarda o texto
 * bruto (mesmo comportamento de antes); quando fecha, deriva dia da semana e `data_real`.
 * Decisão do Junior (2026-09-25): a data fim NÃO é preenchida a partir do início — fica vazia
 * esperando alguém digitar (o envio para autorização cobra).
 */
export function aplicarDataInicioEvento(a: AtividadeForm, valorDigitado: string): AtividadeForm {
    const iso = dataBrParaISO(valorDigitado)
    if (!iso) return { ...a, data_atividade: valorDigitado }
    const [ano, mes, dia] = iso.split("-").map(Number)
    const dt = new Date(ano, mes - 1, dia)
    return {
        ...a,
        data_atividade: iso,
        metadata: {
            ...a.metadata,
            dia_semana: NOMES_DIA_SEMANA[dt.getDay()],
            data_real: `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`,
        },
    }
}

/** DIA A DIA/ESPECIAIS: data fim digitada. Texto parcial fica bruto; data completa vira ISO. */
export function aplicarDataFimEvento(a: AtividadeForm, valorDigitado: string): AtividadeForm {
    const iso = dataBrParaISO(valorDigitado)
    return { ...a, metadata: { ...a.metadata, data_fim_raw: iso ?? valorDigitado } }
}

/**
 * Hora fim antes da hora início é erro? Decisão do Junior (2026-09-25): fim igual ao início é
 * válido. CURSOS: o horário é o de cada aula, então vale sempre. DIA A DIA/ESPECIAIS: só quando
 * começa e termina no mesmo dia (evento de vários dias pode acabar mais cedo no último dia).
 * ESPORTES mantém a regra antiga (fim depois do início), fora desta função.
 */
export function horaFimAntesDoInicio(
    categoria: Categoria | string,
    horaInicio: string | null | undefined,
    horaFim: string | null | undefined,
    dataInicio: string | null,
    dataFim: string | null,
): boolean {
    if (!horaInicio || !horaFim) return false
    const antes = horaFim.substring(0, 5) < horaInicio.substring(0, 5)
    if (!antes) return false
    if (categoria === "CURSOS") return true
    return !dataInicio || !dataFim || dataInicio === dataFim
}
