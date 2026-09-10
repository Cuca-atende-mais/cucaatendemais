/**
 * S-PROG-03 (item 1): monta o payload gravado em `atividades_mensais` a partir do formulário da
 * grade (`AtividadeForm`). Extraído de `criar-programacao-view.tsx` (onde vivia como função local,
 * não testável) para cá — mesma lógica, sem mudança de comportamento, só testabilidade.
 *
 * Expand/contract: `formatarLinhaAtividadeDeterministica` (`motor-agente/index.ts:443`) lê
 * `meta.turma`, `meta.professor`, `meta.sexo`, `meta.dias_semana`, `meta.horario` e
 * `meta.faixa_etaria` DIRETO do jsonb gravado — são as únicas chaves "antigas" que qualquer
 * caminho do RAG de fato lê hoje (confirmado grepando `motor-agente/index.ts` por
 * `requisitos`/`periodo`/`carga_horaria`/`ementa`/`educador`: nenhum é lido, só aparecem dentro do
 * texto livre de `descricao`, que já é montado direto aqui, sem depender de recomposição). Por
 * isso este módulo recompõe essas chaves antigas SEMPRE, mesmo com o formulário usando os campos
 * novos da S-PROG-01 (`faixa_de`/`faixa_ate`, `hora_inicio`/`hora_fim`, `dias_raw`) — sem isso, o
 * assistente do WhatsApp responderia "nao informado" pra toda atividade criada pela grade nova.
 */
import { AVISO_VAGAS } from "@/lib/programacao/rag"
import { AtividadeForm, DIAS_SEMANA_ABREV } from "@/lib/programacao/tipos"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function montarAtividadePayload(a: Partial<AtividadeForm>, unidade: string): any {
    const meta = { ...a.metadata }
    // `hora_inicio`/`hora_fim` são coluna `time` no Postgres — `""` não é um `time` válido
    // (`invalid input syntax for type time: ""`, confirmado direto no banco). A grade permite
    // deixar o horário em branco de propósito (S-PROG-01/02: zerado na duplicação), então isso
    // quebrava o INSERT inteiro sempre que alguém salvava com horário vazio. `null` é o valor
    // seguro — mesmo padrão já usado por `parseTimeString` no import de planilha.
    const fmtTime = (t: string): string | null => {
        const s = t?.substring(0, 5)
        return s || null
    }
    const hi = fmtTime(a.hora_inicio || "")
    const hf = fmtTime(a.hora_fim || "")
    // Só para montar texto (descrição/RAG e metadata.horario) — nunca vai direto pra coluna `time`.
    const hiTxt = hi || ""
    const hfTxt = hf || ""

    if (a.categoria === "CURSOS") {
        const fmtDate = (iso: string) => {
            if (!iso) return ""
            const [y, m, d] = iso.split("-")
            return `${d}/${m}/${y}`
        }
        const diasStr = (meta.dias_raw || []).map((d: string) => DIAS_SEMANA_ABREV[d]).join(" e ")
        // S-PROG-03 (item 1): formato documentado na story — "dd/mm/aaaa a dd/mm/aaaa". `periodo`
        // não é lido por nenhum caminho do RAG (só pela exportação, S-PROG-05) — mesmo assim,
        // manter fiel ao formato antigo em vez de inventar um novo.
        const periodoStr = meta.data_inicio_raw && meta.data_fim_raw
            ? `${fmtDate(meta.data_inicio_raw)} a ${fmtDate(meta.data_fim_raw)}`
            : ""
        const horarioStr = `${hiTxt} às ${hfTxt}`
        // Descricao no mesmo formato que o trigger trigger_indexar_campanha_mensal usa para montar o RAG
        const descricao = `Curso: ${a.titulo}. Educador: ${meta.educador}. Carga Horária: ${meta.carga_horaria}h. Período: ${periodoStr} (${diasStr}). Horário: ${horarioStr}. Requisitos: ${meta.requisitos}. Ementa: ${meta.ementa}. ${AVISO_VAGAS}`
        return {
            titulo: a.titulo,
            categoria: "CURSOS",
            descricao: descricao.substring(0, 1500),
            local: null,
            data_atividade: meta.data_inicio_raw || null,
            hora_inicio: hi,
            hora_fim: hf,
            unidade_cuca: unidade,
            metadata: {
                ementa: meta.ementa,
                educador: meta.educador,
                vagas: String(meta.vagas),
                carga_horaria: String(meta.carga_horaria),
                requisitos: meta.requisitos,
                periodo: periodoStr,
                horario: horarioStr,
                dias_semana: diasStr,
                // S-PROG-01 (item 4): Meta e Diretoria — chaves aditivas, não vão ao RAG nem à
                // exportação nesta story (contrato de gravação não muda, isso é S-PROG-03/05).
                meta: meta.meta || null,
                diretoria: meta.diretoria || null,
            },
        }
    }

    if (a.categoria === "ESPORTES") {
        const diasStr = (meta.dias_raw || []).map((d: string) => DIAS_SEMANA_ABREV[d]).join(" e ")
        const turmaStr = meta.turma?.startsWith("Turma") ? meta.turma : `Turma ${meta.turma}`
        // S-PROG-01 (item 2): idade máxima é opcional — sem ela, "a partir de X anos".
        const faixaStr = meta.faixa_ate ? `${meta.faixa_de} a ${meta.faixa_ate} anos` : `a partir de ${meta.faixa_de} anos`
        const horarioStr = `${hiTxt} às ${hfTxt}`
        // Descricao no mesmo formato que o trigger usa para montar o RAG
        const descricao = `Esporte Modalidade: ${a.titulo} - ${turmaStr}. Professor: ${meta.professor}. Público: ${meta.sexo} (Idade: ${faixaStr}). Dias: ${diasStr}. Horário: ${horarioStr}. ${AVISO_VAGAS}`
        return {
            titulo: a.titulo,
            categoria: "ESPORTES",
            descricao: descricao.substring(0, 1500),
            local: null,
            data_atividade: null,
            hora_inicio: hi,
            hora_fim: hf,
            unidade_cuca: unidade,
            metadata: {
                // S-PROG-03 (item 1): `professor`, `turma`, `faixa_etaria`, `sexo`, `dias_semana`
                // e `horario` são as chaves "antigas" — as únicas que `formatarLinhaAtividadeDeterministica`
                // (motor-agente) lê direto do jsonb. Recompostas aqui a partir dos campos novos da
                // grade (`faixa_de`/`faixa_ate`, `hora_inicio`/`hora_fim`, `dias_raw`) pra manter o
                // agente respondendo igual, nunca "nao informado", pra atividade criada pela grade nova.
                professor: meta.professor,
                turma: turmaStr,
                faixa_etaria: faixaStr,
                sexo: meta.sexo,
                vagas: String(meta.vagas),
                dias_semana: diasStr,
                horario: horarioStr,
                meta: meta.meta || null,
                diretoria: meta.diretoria || null,
            },
        }
    }

    // DIA A DIA / ESPECIAIS
    const categoriaLabel = a.categoria as string
    // Descricao no mesmo formato que o trigger usa para montar o RAG
    const descricaoDiaDia = `Programa (${categoriaLabel}): ${a.titulo}. Atividade: ${meta.atividade}. Data: ${meta.data_real} (${meta.dia_semana}). Horário: ${hiTxt} às ${hfTxt}. Local: ${a.local}. Informações: ${meta.informacoes || ""}. Sessão: ${meta.sessao}.`
    return {
        titulo: a.titulo,
        categoria: a.categoria,
        descricao: descricaoDiaDia.substring(0, 1500),
        local: a.local || null,
        data_atividade: a.data_atividade || null,
        hora_inicio: hi,
        hora_fim: hf,
        unidade_cuca: unidade,
        metadata: {
            sessao: meta.sessao,
            data_real: meta.data_real,
            dia_semana: meta.dia_semana,
            atividade: meta.atividade,
            hora_inicio: hi,
            hora_fim: hf,
            local: a.local,
            informacoes: meta.informacoes || null,
            meta: meta.meta || null,
            diretoria: meta.diretoria || null,
        },
    }
}
