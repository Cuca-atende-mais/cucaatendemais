/**
 * S-PROG-01: tipos compartilhados entre a grade, a ficha da atividade e o painel de revisão.
 * Espelha exatamente o contrato de `metadata` que `criar-programacao-view.tsx` já grava hoje —
 * esta story muda a superfície de edição, não o formato gravado (isso é escopo da S-PROG-03).
 */

export type Categoria = "CURSOS" | "ESPORTES" | "DIA A DIA" | "ESPECIAIS"

export interface AtividadeForm {
  _tempId: string
  categoria: Categoria
  titulo: string
  descricao: string | null
  local: string | null
  data_atividade: string | null
  hora_inicio: string | null
  hora_fim: string | null
  // `metadata` é a coluna jsonb de `atividades_mensais` — formato solto de propósito (mesmo
  // padrão já usado pelo `AtividadeInterna` original que esta story substituiu): cada categoria
  // usa um subconjunto diferente de chaves, e tipar como `unknown` obrigaria cast em toda leitura
  // (meta.professor, meta.dias_raw etc.) sem ganho real de segurança — o contrato de verdade é
  // gravado em `montarAtividadePayload`, não neste tipo de edição.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>
}

export const DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"] as const

export const DIAS_SEMANA_ABREV: Record<string, string> = {
  Segunda: "Seg", Terça: "Ter", Quarta: "Qua",
  Quinta: "Qui", Sexta: "Sex", Sábado: "Sáb", Domingo: "Dom",
}

/**
 * S-PROG-01 (item 2): lista fechada de Sessão/Eixo (Dia a Dia), derivada de valores REAIS
 * gravados em produção (`atividades_mensais.metadata->>'sessao'`, consulta em 2026-09-09) —
 * nunca inventada (Constitution Art. IV). Excluídos da consulta original: linhas onde "sessao"
 * continha uma data ("03/07/2026") — dado corrompido, não uma sessão real; é exatamente o tipo
 * de erro que esta lista fechada existe para impedir de se repetir.
 * Se a junta técnica precisar de um valor novo, é um item nesta lista, não uma decisão de
 * arquitetura — pedir ao Junior antes de adicionar.
 */
export const SESSOES_DIA_A_DIA = [
  "DPDH",
  "Biblioteca",
  "Matrícula",
  "Empregabilidade",
  "Cultura",
  "Artes e Bibliotecas",
  "Esportes",
] as const

export const SEXOS = ["Misto", "Masculino", "Feminino"] as const

/** Limites de caracteres dos campos de texto longo (item 3). */
export const LIMITE_CARACTERES = {
  ementa: 600,
  informacoes: 600,
  requisitos: 200,
} as const

/** Textos de exemplo/placeholder que a planilha real deixou como dado real (linha nunca apagada
 * pela junta técnica) — usados pelo painel de revisão para detectar o mesmo erro se repetindo. */
export const TEXTOS_DE_EXEMPLO = [
  "nome sobrenome",
  "idade",
  "00:00",
  "00h00",
  "turma i",
  "exemplo",
  "preencher",
]
