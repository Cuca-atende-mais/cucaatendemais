import { describe, expect, it } from "vitest"
import { calcularProblemas } from "./revisao"
import { AtividadeForm } from "./tipos"

function esporteCompleto(overrides: Partial<AtividadeForm> = {}): AtividadeForm {
  return {
    _tempId: "1",
    categoria: "ESPORTES",
    titulo: "Natação",
    descricao: null,
    local: null,
    data_atividade: null,
    hora_inicio: "08:00",
    hora_fim: "09:00",
    metadata: {
      professor: "Ricardo Alves",
      turma: "Turma 01",
      vagas: "25",
      sexo: "Misto",
      faixa_de: "7",
      faixa_ate: "10",
      dias_raw: ["Segunda", "Quarta"],
      dias_semana: "Seg e Qua",
    },
    ...overrides,
  }
}

function cursoCompleto(overrides: Partial<AtividadeForm> = {}): AtividadeForm {
  return {
    _tempId: "2",
    categoria: "CURSOS",
    titulo: "Violão para todos",
    descricao: null,
    local: null,
    data_atividade: null,
    hora_inicio: "09:00",
    hora_fim: "12:00",
    metadata: {
      educador: "Edmundo Vitoriano",
      vagas: "10",
      carga_horaria: "21",
      requisitos: "Nenhum",
      data_inicio_raw: "2026-08-08",
      data_fim_raw: "2026-08-29",
      ementa: "Estudo de violão popular.",
      dias_raw: ["Quarta", "Sexta"],
      dias_semana: "Qua e Sex",
    },
    ...overrides,
  }
}

function diaADiaCompleto(overrides: Partial<AtividadeForm> = {}): AtividadeForm {
  return {
    _tempId: "3",
    categoria: "DIA A DIA",
    titulo: "Comunidade em Pauta",
    descricao: null,
    local: "Anfiteatro",
    data_atividade: "2026-08-11",
    hora_inicio: "19:00",
    hora_fim: "21:00",
    metadata: { sessao: "DPDH", atividade: "Oficina de passinho", informacoes: "", data_fim_raw: "2026-08-11" },
    ...overrides,
  }
}

describe("calcularProblemas — obrigatoriedade", () => {
  it("nenhum problema quando tudo está preenchido", () => {
    expect(calcularProblemas([esporteCompleto(), cursoCompleto(), diaADiaCompleto()])).toEqual([])
  })

  it("detecta título em branco", () => {
    const problemas = calcularProblemas([esporteCompleto({ titulo: "" })])
    expect(problemas.some(p => p.mensagem.includes("título em branco"))).toBe(true)
  })

  it("ESPORTES: idade máxima em branco NÃO é problema — item 2: 'sem máxima = a partir de X anos'", () => {
    const problemas = calcularProblemas([esporteCompleto({ metadata: { ...esporteCompleto().metadata, faixa_ate: "" } })])
    expect(problemas.some(p => p.mensagem.includes("idade"))).toBe(false)
  })

  it("ESPORTES: idade mínima em branco É problema", () => {
    const problemas = calcularProblemas([esporteCompleto({ metadata: { ...esporteCompleto().metadata, faixa_de: "" } })])
    expect(problemas.some(p => p.mensagem.includes("idade mínima em branco"))).toBe(true)
  })

  it("CURSOS: detecta todos os campos obrigatórios em branco, não só o primeiro", () => {
    const vazio = cursoCompleto({
      titulo: "",
      metadata: { educador: "", vagas: "", carga_horaria: "", requisitos: "", ementa: "", dias_raw: [] },
    })
    const problemas = calcularProblemas([vazio])
    expect(problemas.length).toBeGreaterThanOrEqual(6)
  })

  it("DIA A DIA: exige data, local, sessão e descrição da atividade", () => {
    const vazio = diaADiaCompleto({ data_atividade: null, local: "", metadata: { sessao: "", atividade: "" } })
    const problemas = calcularProblemas([vazio])
    expect(problemas.some(p => p.mensagem.includes("data de início em branco"))).toBe(true)
    expect(problemas.some(p => p.mensagem.includes("data de fim em branco"))).toBe(true)
    expect(problemas.some(p => p.mensagem.includes("local em branco"))).toBe(true)
    expect(problemas.some(p => p.mensagem.includes("sessão/eixo"))).toBe(true)
  })
})

describe("calcularProblemas — data incompleta (guardada como texto bruto, não ISO)", () => {
  // Regressão @qa: a correção do bug de digitação (campo de data resetando a cada tecla) passou
  // a guardar o texto mascarado bruto (ex.: "07/08/20") enquanto a data não fecha, em vez de
  // sempre "". Um check de truthiness (`!meta.data_fim_raw`) não pega mais esse caso — precisa
  // reconhecer explicitamente "presente mas não é ISO" como problema.

  it("CURSOS: data de início incompleta é detectada mesmo com o campo 'preenchido'", () => {
    const problemas = calcularProblemas([cursoCompleto({ metadata: { ...cursoCompleto().metadata, data_inicio_raw: "07/08/20" } })])
    expect(problemas.some(p => p.tipo === "erro" && p.mensagem.includes("data de início incompleta"))).toBe(true)
  })

  it("CURSOS: data de término incompleta é detectada mesmo com o campo 'preenchido'", () => {
    const problemas = calcularProblemas([cursoCompleto({ metadata: { ...cursoCompleto().metadata, data_fim_raw: "07/08/20" } })])
    expect(problemas.some(p => p.tipo === "erro" && p.mensagem.includes("data de término incompleta"))).toBe(true)
  })

  it("CURSOS: datas completas (ISO) não disparam falso positivo", () => {
    expect(calcularProblemas([cursoCompleto()]).some(p => p.mensagem.includes("incompleta"))).toBe(false)
  })

  it("DIA A DIA/ESPECIAIS: data de início incompleta é detectada mesmo com o campo 'preenchido'", () => {
    const problemas = calcularProblemas([diaADiaCompleto({ data_atividade: "07/08/20" })])
    expect(problemas.some(p => p.tipo === "erro" && p.mensagem.includes("data de início incompleta"))).toBe(true)
  })

  it("DIA A DIA/ESPECIAIS: data completa (ISO) não dispara falso positivo", () => {
    expect(calcularProblemas([diaADiaCompleto()]).some(p => p.mensagem.includes("incompleta"))).toBe(false)
  })
})

describe("calcularProblemas — texto de exemplo não apagado", () => {
  it("detecta 'Nome Sobrenome' como professor (achado real da planilha do Mondubim)", () => {
    const problemas = calcularProblemas([esporteCompleto({ metadata: { ...esporteCompleto().metadata, professor: "Nome Sobrenome" } })])
    expect(problemas.some(p => p.mensagem.includes("texto de exemplo"))).toBe(true)
  })

  it("é case-insensitive e ignora espaços nas pontas", () => {
    const problemas = calcularProblemas([esporteCompleto({ metadata: { ...esporteCompleto().metadata, professor: "  NOME SOBRENOME  " } })])
    expect(problemas.some(p => p.mensagem.includes("texto de exemplo"))).toBe(true)
  })

  it("nome de professor real não dispara falso positivo", () => {
    expect(calcularProblemas([esporteCompleto()])).toEqual([])
  })
})

describe("calcularProblemas — horário", () => {
  it("detecta hora fim não posterior à hora início", () => {
    const problemas = calcularProblemas([esporteCompleto({ hora_inicio: "09:00", hora_fim: "08:00" })])
    expect(problemas.some(p => p.mensagem.includes("não é depois"))).toBe(true)
  })
})

describe("calcularProblemas — idade máxima menor que a mínima", () => {
  it("detecta quando preenchida errada", () => {
    const problemas = calcularProblemas([esporteCompleto({ metadata: { ...esporteCompleto().metadata, faixa_de: "29", faixa_ate: "15" } })])
    expect(problemas.some(p => p.mensagem.includes("idade máxima menor"))).toBe(true)
  })
})

describe("calcularProblemas — texto longo acima do limite", () => {
  it("ementa acima de 600 caracteres é detectada", () => {
    const problemas = calcularProblemas([cursoCompleto({ metadata: { ...cursoCompleto().metadata, ementa: "a".repeat(601) } })])
    expect(problemas.some(p => p.mensagem.includes('"ementa"'))).toBe(true)
  })

  it("exatamente no limite não dispara", () => {
    const problemas = calcularProblemas([cursoCompleto({ metadata: { ...cursoCompleto().metadata, ementa: "a".repeat(600) } })])
    expect(problemas.some(p => p.mensagem.includes('"ementa"'))).toBe(false)
  })
})

describe("calcularProblemas — linha duplicada", () => {
  it("detecta mesma modalidade + turma + horário + dias repetidos", () => {
    const problemas = calcularProblemas([esporteCompleto({ _tempId: "1" }), esporteCompleto({ _tempId: "2" })])
    expect(problemas.some(p => p.mensagem.includes("linha repetida"))).toBe(true)
  })

  it("turmas diferentes da mesma modalidade não são duplicadas", () => {
    const a = esporteCompleto({ _tempId: "1" })
    const b = esporteCompleto({ _tempId: "2", metadata: { ...esporteCompleto().metadata, turma: "Turma 02" } })
    const problemas = calcularProblemas([a, b])
    expect(problemas.some(p => p.mensagem.includes("linha repetida"))).toBe(false)
  })
})

describe("S-PROG-19 — datas e horas de início e fim", () => {
  const mensagens = (a: AtividadeForm[]) => calcularProblemas(a).map(p => `${p.tipo}: ${p.mensagem}`)

  it("DIA A DIA/ESPECIAIS: fim igual ao início (data e hora) é válido — 'de hoje a hoje, de agora a agora'", () => {
    const um = diaADiaCompleto({ hora_inicio: "19:00", hora_fim: "19:00" })
    const esp = diaADiaCompleto({ _tempId: "9", categoria: "ESPECIAIS", titulo: "Feira", hora_inicio: "08:00", hora_fim: "08:00" })
    expect(mensagens([um, esp])).toEqual([])
  })

  it("DIA A DIA: data de fim antes do início é erro", () => {
    const a = diaADiaCompleto({ metadata: { ...diaADiaCompleto().metadata, data_fim_raw: "2026-08-10" } })
    expect(mensagens([a])).toContain(`erro: "Comunidade em Pauta": data de fim antes da data de início`)
  })

  it("DIA A DIA: hora de fim antes do início só é erro quando começa e termina no mesmo dia", () => {
    const mesmoDia = diaADiaCompleto({ hora_inicio: "19:00", hora_fim: "08:00" })
    const variosDias = diaADiaCompleto({ _tempId: "4", titulo: "Feira", hora_inicio: "19:00", hora_fim: "08:00", metadata: { ...diaADiaCompleto().metadata, data_fim_raw: "2026-08-12" } })
    expect(mensagens([mesmoDia])).toContain(`erro: "Comunidade em Pauta": horário de fim antes do de início`)
    expect(mensagens([variosDias])).toEqual([])
  })

  it("CURSOS: término antes do início é erro; hora fim antes do início é erro mesmo com período de vários dias", () => {
    const c = cursoCompleto({ hora_inicio: "12:00", hora_fim: "09:00", metadata: { ...cursoCompleto().metadata, data_inicio_raw: "2026-10-10", data_fim_raw: "2026-10-01" } })
    const m = mensagens([c])
    expect(m.some(x => x.includes("data de término antes da data de início"))).toBe(true)
    expect(m.some(x => x.includes("horário de fim antes do de início"))).toBe(true)
  })

  it("CURSOS: hora fim igual à de início é válida", () => {
    expect(mensagens([cursoCompleto({ hora_inicio: "09:00", hora_fim: "09:00" })])).toEqual([])
  })

  it("ESPORTES mantém a regra antiga (fim tem que ser depois do início)", () => {
    expect(mensagens([esporteCompleto({ hora_inicio: "08:00", hora_fim: "08:00" })]).some(x => x.includes("não é depois do de início"))).toBe(true)
  })

  it("repetição liberada: mesma atividade em outro dia, outro horário ou outro local não é 'linha repetida'", () => {
    const base = diaADiaCompleto({ _tempId: "a" })
    const outroDia = diaADiaCompleto({ _tempId: "b", data_atividade: "2026-08-13", metadata: { ...diaADiaCompleto().metadata, data_fim_raw: "2026-08-13" } })
    const outroHorario = diaADiaCompleto({ _tempId: "c", hora_fim: "22:00" })
    const outroLocal = diaADiaCompleto({ _tempId: "d", local: "Quadra" })
    const outroFim = diaADiaCompleto({ _tempId: "e", metadata: { ...diaADiaCompleto().metadata, data_fim_raw: "2026-08-12" } })
    expect(mensagens([base, outroDia, outroHorario, outroLocal, outroFim]).some(x => x.includes("linha repetida"))).toBe(false)
  })

  it("tudo igual continua sendo 'linha repetida'", () => {
    expect(mensagens([diaADiaCompleto({ _tempId: "a" }), diaADiaCompleto({ _tempId: "b" })]).some(x => x.includes("linha repetida"))).toBe(true)
  })
})
