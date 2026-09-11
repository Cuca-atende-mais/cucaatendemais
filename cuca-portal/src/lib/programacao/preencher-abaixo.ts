/**
 * S-PROG-11 (item 1): "↓ Preencher abaixo" — propaga o valor de uma coluna, a partir de uma linha
 * selecionada, para as células VAZIAS abaixo dela, só dentro da mesma categoria (mesma aba da
 * grade). Regras de negócio (S-PROG-11, "Decisões de comportamento"):
 *  - só a coluna em foco, nunca a linha inteira (linha inteira geraria atividade duplicada);
 *  - nunca sobrescreve célula já preenchida — só entra onde está vazio;
 *  - nunca propaga `data_atividade`, `hora_inicio`, `hora_fim` ou `vagas` — são os campos que
 *    variam linha a linha por contrato (mesmo campos que `duplicar.ts` sempre zera, S-PROG-08).
 */
import { AtividadeForm } from "./tipos"

export interface ResultadoPreencherAbaixo {
  atividades: AtividadeForm[]
  linhasPreenchidas: number
}

/** Campos que nunca são propagados, independente de estarem vazios abaixo — mesmo contrato de
 * zeramento da S-PROG-08 (S-PROG-11 item 1). Lista literal da story: não expandir por conta
 * própria (ex.: `data_inicio_raw`/`data_fim_raw` de CURSOS NÃO estão nesta lista — a story não os
 * cita, então preencher abaixo é permitido neles). */
const CAMPOS_BLOQUEADOS = new Set(["data_atividade", "hora_inicio", "hora_fim", "vagas"])

/** Exportado pra UI decidir se mostra/habilita o botão "Preencher abaixo" sem duplicar a lista. */
export function campoBloqueadoParaPreencherAbaixo(colunaKey: string): boolean {
  return CAMPOS_BLOQUEADOS.has(colunaKey)
}

function ehVazio(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true
  if (typeof valor === "string") return valor.trim() === ""
  if (Array.isArray(valor)) return valor.length === 0
  return false
}

function lerCampo(a: AtividadeForm, colunaKey: string, colunaRoot: boolean): unknown {
  if (colunaRoot) return (a as unknown as Record<string, unknown>)[colunaKey]
  return a.metadata[colunaKey]
}

function escreverCampo(a: AtividadeForm, colunaKey: string, colunaRoot: boolean, valor: unknown, dadosExtra?: Record<string, unknown>): AtividadeForm {
  if (colunaRoot) return { ...a, [colunaKey]: valor }
  return { ...a, metadata: { ...a.metadata, [colunaKey]: valor, ...dadosExtra } }
}

/**
 * `atividades`: array completo (todas as categorias) — a ordem relativa dentro de uma mesma
 * categoria é a mesma ordem em que a grade renderiza (`daCategoria = atividades.filter(...)`
 * preserva ordem), então iterar o array inteiro pulando outras categorias já dá a ordem certa de
 * "abaixo", sem precisar pré-filtrar.
 * `colunaRoot`: true quando o campo é direto em `AtividadeForm` (ex.: `titulo`, `local`,
 * `data_atividade`); false quando é `AtividadeForm.metadata[colunaKey]`.
 */
export function preencherColunaAbaixo(
  atividades: AtividadeForm[],
  tempIdOrigem: string,
  colunaKey: string,
  colunaRoot: boolean,
): ResultadoPreencherAbaixo {
  if (CAMPOS_BLOQUEADOS.has(colunaKey)) {
    return { atividades, linhasPreenchidas: 0 }
  }

  const origem = atividades.find(a => a._tempId === tempIdOrigem)
  if (!origem) return { atividades, linhasPreenchidas: 0 }

  const valorOrigem = lerCampo(origem, colunaKey, colunaRoot)
  if (ehVazio(valorOrigem)) {
    // Nada pra propagar — a própria célula de origem está vazia.
    return { atividades, linhasPreenchidas: 0 }
  }

  // "Dias" (array `dias_raw`) tem um campo espelho em texto (`dias_semana`, "Ter e Qui") que o
  // resto da UI/o payload de gravação leem junto — copia os dois juntos, os dois vindos da
  // ORIGEM, pra não deixar o espelho dessincronizado até o próximo toggle manual (mesmo padrão
  // de `toggleDia` na grade).
  const dadosExtra = colunaKey === "dias_raw" ? { dias_semana: origem.metadata.dias_semana } : undefined

  let alcancouOrigem = false
  let linhasPreenchidas = 0

  const resultado = atividades.map(a => {
    if (a.categoria !== origem.categoria) return a

    if (a._tempId === tempIdOrigem) {
      alcancouOrigem = true
      return a
    }
    if (!alcancouOrigem) return a // mesma categoria, mas linha ACIMA da origem — não mexe

    const valorAtual = lerCampo(a, colunaKey, colunaRoot)
    if (!ehVazio(valorAtual)) return a // já preenchida — nunca sobrescreve

    linhasPreenchidas++
    return escreverCampo(a, colunaKey, colunaRoot, valorOrigem, dadosExtra)
  })

  return { atividades: resultado, linhasPreenchidas }
}
