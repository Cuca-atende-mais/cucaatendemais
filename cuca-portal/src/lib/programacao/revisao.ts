/**
 * S-PROG-01 (item 5): painel de revisão — varre TODAS as atividades e devolve a lista de
 * pontos a corrigir, em linguagem comum (não código de erro). Pura e testável: recebe o array
 * de atividades, devolve a lista de problemas — não decide se isso bloqueia o envio (essa
 * decisão é da S-PROG-04, fora de escopo aqui).
 */
import { AtividadeForm, TEXTOS_DE_EXEMPLO } from "./tipos"
import { horaFimDepoisDoInicio } from "./mascaras"

export type TipoProblema = "falta" | "erro"

export interface Problema {
  tipo: TipoProblema
  atividadeId: string
  mensagem: string
}

function ehTextoDeExemplo(valor: string | null | undefined): boolean {
  if (!valor) return false
  return TEXTOS_DE_EXEMPLO.includes(valor.trim().toLowerCase())
}

/** Um campo de data guarda ISO (`aaaa-mm-dd`) quando fechado, ou o texto mascarado bruto
 * (`dd/mm/aa...`) enquanto ainda incompleto (ver `mascaras.ts` / `exibirData`). Presente mas
 * não-ISO = data incompleta que passaria despercebida por um check de truthiness. */
function ehDataIncompleta(valor: string | null | undefined): boolean {
  if (!valor) return false
  return !/^\d{4}-\d{2}-\d{2}/.test(valor)
}

/** Rótulo amigável da linha, para a mensagem do painel — usa o título quando existe, senão a
 * categoria + posição (a linha pode ainda não ter título preenchido). */
function rotuloLinha(a: AtividadeForm, indice: number): string {
  return a.titulo?.trim() ? `"${a.titulo.trim()}"` : `${a.categoria}, linha ${indice + 1}`
}

/**
 * Campos obrigatórios por categoria — mesma regra que `validarAtividade` já aplicava, mas aqui
 * devolvendo TODOS os problemas de uma vez, não só o primeiro (a grade permite editar várias
 * linhas incompletas ao mesmo tempo; travar na primeira falta escondia as outras).
 */
function problemasDeObrigatoriedade(a: AtividadeForm, indice: number): Problema[] {
  const problemas: Problema[] = []
  const meta = a.metadata || {}
  const rotulo = rotuloLinha(a, indice)
  const falta = (msg: string) => problemas.push({ tipo: "falta", atividadeId: a._tempId, mensagem: `${rotulo}: ${msg}` })
  const erro = (msg: string) => problemas.push({ tipo: "erro", atividadeId: a._tempId, mensagem: `${rotulo}: ${msg}` })

  if (!a.titulo?.trim()) falta("título em branco")
  if (!a.hora_inicio) falta("horário de início em branco")
  if (!a.hora_fim) falta("horário de fim em branco")

  if (a.categoria === "CURSOS") {
    if (!meta.educador?.trim()) falta("educador em branco")
    if (!meta.vagas) falta("vagas em branco")
    if (!meta.carga_horaria) falta("carga horária em branco")
    if (!meta.data_inicio_raw || !meta.data_fim_raw) falta("período (início e fim) em branco")
    else {
      if (ehDataIncompleta(meta.data_inicio_raw)) erro("data de início incompleta")
      if (ehDataIncompleta(meta.data_fim_raw)) erro("data de término incompleta")
    }
    if (!meta.ementa?.trim()) falta("ementa em branco")
    if (!meta.dias_raw?.length) falta("nenhum dia da semana selecionado")
    // CURSOS não tem faixa_de/faixa_ate no contrato atual (só ESPORTES tem) — requisitos de
    // idade ficam dentro do campo livre `requisitos`. Adicionar idade estruturada aqui seria
    // chave nova em metadata, fora do escopo desta story (S-PROG-03).
  }

  if (a.categoria === "ESPORTES") {
    if (!meta.professor?.trim()) falta("professor em branco")
    if (!meta.turma?.trim()) falta("turma em branco")
    if (!meta.vagas) falta("vagas em branco")
    if (!meta.sexo) falta("sexo em branco")
    if (!meta.faixa_de) falta("idade mínima em branco")
    if (!meta.dias_raw?.length) falta("nenhum dia da semana selecionado")
  }

  if (a.categoria === "DIA A DIA" || a.categoria === "ESPECIAIS") {
    if (!a.data_atividade) falta("data do evento em branco")
    else if (ehDataIncompleta(a.data_atividade)) erro("data do evento incompleta")
    if (!a.local?.trim()) falta("local em branco")
    if (!meta.sessao?.trim()) falta("sessão/eixo em branco")
    if (!meta.atividade?.trim()) falta("descrição da atividade em branco")
  }

  return problemas
}

function problemasDeTextoDeExemplo(a: AtividadeForm, indice: number): Problema[] {
  const meta = a.metadata || {}
  const rotulo = rotuloLinha(a, indice)
  const candidatos: Array<[string, string | undefined]> = [
    ["professor", meta.professor], ["educador", meta.educador], ["turma", meta.turma],
  ]
  return candidatos
    .filter(([, valor]) => ehTextoDeExemplo(valor))
    .map(([campo, valor]) => ({
      tipo: "erro" as const,
      atividadeId: a._tempId,
      mensagem: `${rotulo}: campo "${campo}" está com texto de exemplo ("${valor}")`,
    }))
}

function problemasDeHorario(a: AtividadeForm, indice: number): Problema[] {
  if (!a.hora_inicio || !a.hora_fim) return []
  if (horaFimDepoisDoInicio(a.hora_inicio, a.hora_fim)) return []
  return [{ tipo: "erro", atividadeId: a._tempId, mensagem: `${rotuloLinha(a, indice)}: horário de fim não é depois do de início` }]
}

function problemasDeIdade(a: AtividadeForm, indice: number): Problema[] {
  const meta = a.metadata || {}
  if (!meta.faixa_de || !meta.faixa_ate) return [] // máxima em branco é válido (sem limite)
  if (Number(meta.faixa_ate) >= Number(meta.faixa_de)) return []
  return [{ tipo: "erro", atividadeId: a._tempId, mensagem: `${rotuloLinha(a, indice)}: idade máxima menor que a mínima` }]
}

function problemasDeTextoLongo(a: AtividadeForm, indice: number): Problema[] {
  const meta = a.metadata || {}
  const rotulo = rotuloLinha(a, indice)
  const problemas: Problema[] = []
  const checar = (campo: string, valor: string | undefined, limite: number) => {
    if (valor && valor.length > limite) {
      problemas.push({ tipo: "erro", atividadeId: a._tempId, mensagem: `${rotulo}: "${campo}" tem ${valor.length} caracteres (limite ${limite})` })
    }
  }
  checar("ementa", meta.ementa, 600)
  checar("informações", meta.informacoes, 600)
  checar("requisitos", meta.requisitos, 200)
  return problemas
}

/** Chave de duplicidade: mesma modalidade/curso/atividade + turma (quando existir) + horário +
 * dias — igual ao critério do item 5 ("mesma modalidade + turma + horário + dias"). */
function chaveDuplicidade(a: AtividadeForm): string | null {
  if (!a.titulo?.trim() || !a.hora_inicio) return null
  const meta = a.metadata || {}
  const turma = meta.turma || ""
  const dias = meta.dias_semana || ""
  return [a.categoria, a.titulo.trim().toLowerCase(), turma.toLowerCase(), a.hora_inicio, dias].join("|")
}

function problemasDeDuplicidade(atividades: AtividadeForm[]): Problema[] {
  const vistos = new Map<string, { atividade: AtividadeForm; indice: number }>()
  const problemas: Problema[] = []
  atividades.forEach((a, indice) => {
    const chave = chaveDuplicidade(a)
    if (!chave) return
    const anterior = vistos.get(chave)
    if (anterior) {
      problemas.push({
        tipo: "erro",
        atividadeId: a._tempId,
        mensagem: `${rotuloLinha(a, indice)}: linha repetida (igual à linha ${anterior.indice + 1})`,
      })
    } else {
      vistos.set(chave, { atividade: a, indice })
    }
  })
  return problemas
}

/** Ponto de entrada do painel de revisão — recebe TODAS as atividades da programação (de
 * todas as categorias) e devolve a lista completa de problemas, na ordem em que as atividades
 * aparecem. */
export function calcularProblemas(atividades: AtividadeForm[]): Problema[] {
  const porLinha = atividades.flatMap((a, i) => [
    ...problemasDeObrigatoriedade(a, i),
    ...problemasDeTextoDeExemplo(a, i),
    ...problemasDeHorario(a, i),
    ...problemasDeIdade(a, i),
    ...problemasDeTextoLongo(a, i),
  ])
  return [...porLinha, ...problemasDeDuplicidade(atividades)]
}
