import { describe, expect, it } from "vitest"
import {
  atividadeFormDeLinhaExistente,
  calcularSeloQualidade,
  categoriaValida,
  linhaTemProblema,
  normalizarTextoCopiavel,
  parseCargaHoraria,
  parseDiasAbreviados,
  parseFaixaEtaria,
  parsePeriodoCursos,
} from "./duplicar"

// Todos os valores de exemplo abaixo são cópias literais de metadata real gravado em produção
// (svzkrkfzpiqcesloukgb, consulta em 2026-09-09) — não inventados, ver comentários do módulo.

describe("categoriaValida", () => {
  it("aceita as 4 categorias que a grade edita", () => {
    expect(categoriaValida("ESPORTES")).toBe(true)
    expect(categoriaValida("CURSOS")).toBe(true)
    expect(categoriaValida("DIA A DIA")).toBe(true)
    expect(categoriaValida("ESPECIAIS")).toBe(true)
  })

  it("rejeita 'ESPORTE' (singular) — achado real na campanha de junho/2026 do Jangurussu", () => {
    expect(categoriaValida("ESPORTE")).toBe(false)
  })

  it("rejeita vazio/null/undefined", () => {
    expect(categoriaValida("")).toBe(false)
    expect(categoriaValida(null)).toBe(false)
    expect(categoriaValida(undefined)).toBe(false)
  })
})

describe("normalizarTextoCopiavel", () => {
  it("trim + colapsa espaços duplos", () => {
    expect(normalizarTextoCopiavel("Edmundo Vitoriano           ")).toBe("Edmundo Vitoriano")
    expect(normalizarTextoCopiavel("Renato   Severo")).toBe("Renato Severo")
  })

  it("texto de exemplo vira vazio, não é copiado", () => {
    expect(normalizarTextoCopiavel("Nome Sobrenome")).toBe("")
    expect(normalizarTextoCopiavel("  IDADE  ")).toBe("")
  })

  it("vazio/null continua vazio", () => {
    expect(normalizarTextoCopiavel(null)).toBe("")
    expect(normalizarTextoCopiavel("")).toBe("")
  })
})

describe("parseFaixaEtaria — amostras reais de produção", () => {
  it("formato padrão 'N a M anos'", () => {
    expect(parseFaixaEtaria("15 a 29 anos")).toEqual({ faixa_de: "15", faixa_ate: "29" })
    expect(parseFaixaEtaria("07 a 10 anos")).toEqual({ faixa_de: "07", faixa_ate: "10" })
  })

  it("separador 'á'/'à' (typo real de produção)", () => {
    expect(parseFaixaEtaria("06 á 11  anos")).toEqual({ faixa_de: "06", faixa_ate: "11" })
    expect(parseFaixaEtaria("2 à 4 anos")).toEqual({ faixa_de: "2", faixa_ate: "4" })
  })

  it("sem a palavra 'anos'", () => {
    expect(parseFaixaEtaria("11 a 13")).toEqual({ faixa_de: "11", faixa_ate: "13" })
  })

  it("faixa aberta '12+ anos' / '12+anos' — só idade mínima", () => {
    expect(parseFaixaEtaria("12+ anos")).toEqual({ faixa_de: "12", faixa_ate: "" })
    expect(parseFaixaEtaria("12+anos")).toEqual({ faixa_de: "12", faixa_ate: "" })
  })

  it("lixo real ('15 a 29 e 29+') não é adivinhado — vem tudo vazio", () => {
    expect(parseFaixaEtaria("15 a 29 e 29+")).toEqual({ faixa_de: "", faixa_ate: "" })
  })

  it("texto de exemplo ('Idade') não é adivinhado", () => {
    expect(parseFaixaEtaria("Idade")).toEqual({ faixa_de: "", faixa_ate: "" })
  })

  it("vazio/null", () => {
    expect(parseFaixaEtaria(null)).toEqual({ faixa_de: "", faixa_ate: "" })
    expect(parseFaixaEtaria("")).toEqual({ faixa_de: "", faixa_ate: "" })
  })
})

describe("parsePeriodoCursos — blob real de produção", () => {
  it("extrai as duas datas do blob com quebras de linha", () => {
    expect(parsePeriodoCursos("09/09/2026\n\n30/09/2026\n\nQuarta e sexta-feira"))
      .toEqual({ data_inicio_raw: "09/09/2026", data_fim_raw: "30/09/2026" })
  })

  it("funciona com espaço extra antes da segunda data (achado real)", () => {
    expect(parsePeriodoCursos("09/09/2026\n\n 30/09/2026\n\nQuarta e Sexta-feira"))
      .toEqual({ data_inicio_raw: "09/09/2026", data_fim_raw: "30/09/2026" })
  })

  it("blob sem nenhuma data reconhecível", () => {
    expect(parsePeriodoCursos("período a definir")).toEqual({ data_inicio_raw: "", data_fim_raw: "" })
  })

  it("vazio/null", () => {
    expect(parsePeriodoCursos(null)).toEqual({ data_inicio_raw: "", data_fim_raw: "" })
  })
})

describe("parseCargaHoraria — amostras reais de produção", () => {
  it("'17h30min' -> '17' (perde a fração, nunca a hora inteira)", () => {
    expect(parseCargaHoraria("17h30min")).toBe("17")
  })

  it("'17h/aula' -> '17'", () => {
    expect(parseCargaHoraria("17h/aula")).toBe("17")
  })

  it("já numérico limpo", () => {
    expect(parseCargaHoraria("21")).toBe("21")
  })

  it("sem número nenhum vem vazio", () => {
    expect(parseCargaHoraria("a combinar")).toBe("")
  })
})

describe("linhaTemProblema / calcularSeloQualidade", () => {
  it("título vazio é problema", () => {
    expect(linhaTemProblema({ categoria: "ESPORTES", titulo: "", descricao: null, local: null, metadata: {} })).toBe(true)
  })

  it("texto de exemplo em professor é problema (linha real: 'Nome Sobrenome' + 'Idade')", () => {
    expect(linhaTemProblema({
      categoria: "ESPORTES", titulo: "Natação", descricao: null, local: null,
      metadata: { professor: "Nome Sobrenome", faixa_etaria: "Idade" },
    })).toBe(true)
  })

  it("ESPORTES com faixa_etaria sem nenhum dígito é problema", () => {
    expect(linhaTemProblema({
      categoria: "ESPORTES", titulo: "Jiu-Jitsu", descricao: null, local: null,
      metadata: { professor: "Cleber Soares", faixa_etaria: "não informado" },
    })).toBe(true)
  })

  it("linha limpa não é problema", () => {
    expect(linhaTemProblema({
      categoria: "ESPORTES", titulo: "Natação", descricao: null, local: null,
      metadata: { professor: "Ricardo Alves", faixa_etaria: "15 a 29 anos" },
    })).toBe(false)
  })

  it("calcularSeloQualidade soma corretamente e calcula percentual", () => {
    const linhas = [
      { categoria: "ESPORTES", titulo: "Natação", descricao: null, local: null, metadata: { faixa_etaria: "15 a 29 anos" } },
      { categoria: "ESPORTES", titulo: "Nome Sobrenome", descricao: null, local: null, metadata: {} },
      { categoria: "ESPORTES", titulo: "Vôlei", descricao: null, local: null, metadata: { faixa_etaria: "10 a 15 anos" } },
      { categoria: "ESPORTES", titulo: "Handebol", descricao: null, local: null, metadata: { faixa_etaria: "10 a 15 anos" } },
    ]
    expect(calcularSeloQualidade(linhas)).toEqual({ totalAtividades: 4, totalProblemas: 1, percentualProblemas: 25 })
  })

  it("lista vazia não divide por zero", () => {
    expect(calcularSeloQualidade([])).toEqual({ totalAtividades: 0, totalProblemas: 0, percentualProblemas: 0 })
  })
})

describe("atividadeFormDeLinhaExistente — zeramento e normalização por categoria", () => {
  it("categoria inválida devolve null", () => {
    expect(atividadeFormDeLinhaExistente({ categoria: "ESPORTE", titulo: "x", descricao: null, local: null, metadata: {} }, "t1")).toBeNull()
  })

  it("ESPORTES: zera data/hora/vagas, copia e normaliza o resto (linha real do Mondubim)", () => {
    const forma = atividadeFormDeLinhaExistente({
      categoria: "ESPORTES",
      titulo: "Natação",
      descricao: "Esporte Modalidade: Natação...",
      local: null,
      metadata: { sexo: "Misto", turma: "Turma 1", vagas: "15", professor: "Isabel Cristina", dias_semana: "Ter e Qui", faixa_etaria: "15 a 29 anos" },
    }, "temp-1")

    expect(forma).not.toBeNull()
    expect(forma!.data_atividade).toBeNull()
    expect(forma!.hora_inicio).toBeNull()
    expect(forma!.hora_fim).toBeNull()
    expect(forma!.metadata.vagas).toBe("")
    expect(forma!.metadata.dias_raw).toEqual([])
    expect(forma!.metadata.professor).toBe("Isabel Cristina")
    expect(forma!.metadata.turma).toBe("Turma 1")
    expect(forma!.metadata.faixa_de).toBe("15")
    expect(forma!.metadata.faixa_ate).toBe("29")
    expect(forma!.metadata.sexo).toBe("Misto")
  })

  it("ESPORTES: linha de placeholder real (professor/faixa) vem toda em branco, não copia lixo", () => {
    const forma = atividadeFormDeLinhaExistente({
      categoria: "ESPORTES", titulo: "Modalidade X", descricao: null, local: null,
      metadata: { sexo: "Masculino", turma: "Turma I", vagas: "20 por turma", professor: "Nome Sobrenome", dias_semana: "qui e ter", faixa_etaria: "Idade" },
    }, "temp-2")

    expect(forma!.metadata.professor).toBe("")
    expect(forma!.metadata.faixa_de).toBe("")
    expect(forma!.metadata.faixa_ate).toBe("")
    // turma "Turma I" é o próprio texto de exemplo (TEXTOS_DE_EXEMPLO tem "turma i")
    expect(forma!.metadata.turma).toBe("")
  })

  it("CURSOS: zera datas/vagas, extrai carga horária numérica, copia ementa/requisitos normalizados", () => {
    const forma = atividadeFormDeLinhaExistente({
      categoria: "CURSOS", titulo: "Violão para todos", descricao: null, local: null,
      metadata: {
        vagas: "10", ementa: "Estudo de violão popular.", educador: "Edmundo Vitoriano           ",
        requisitos: "Nenhum", carga_horaria: "17h30min",
        periodo: "09/09/2026\n\n30/09/2026\n\nQuarta e sexta-feira",
      },
    }, "temp-3")

    expect(forma!.metadata.data_inicio_raw).toBe("")
    expect(forma!.metadata.data_fim_raw).toBe("")
    expect(forma!.metadata.vagas).toBe("")
    expect(forma!.metadata.carga_horaria).toBe("17")
    expect(forma!.metadata.educador).toBe("Edmundo Vitoriano")
    expect(forma!.metadata.ementa).toBe("Estudo de violão popular.")
    expect(forma!.metadata.dias_raw).toEqual([])
  })

  it("DIA A DIA: copia sessão só se bater com a lista fechada, zera data", () => {
    const valida = atividadeFormDeLinhaExistente({
      categoria: "DIA A DIA", titulo: "Comunidade em Pauta", descricao: null, local: "Anfiteatro",
      metadata: { sessao: "DPDH", atividade: "Oficina de passinho", informacoes: "Texto aqui." },
    }, "temp-4")
    expect(valida!.metadata.sessao).toBe("DPDH")
    expect(valida!.data_atividade).toBeNull()
    expect(valida!.local).toBe("Anfiteatro")

    const invalida = atividadeFormDeLinhaExistente({
      categoria: "DIA A DIA", titulo: "Programa X", descricao: null, local: null,
      metadata: { sessao: "Sessão que não existe na lista", atividade: "Y", informacoes: "" },
    }, "temp-5")
    expect(invalida!.metadata.sessao).toBe("")
  })
})

describe("parseDiasAbreviados", () => {
  it("reverte o formato gravado por montarAtividadePayload ('Ter e Qui' -> dias por extenso)", () => {
    expect(parseDiasAbreviados("Ter e Qui")).toEqual(["Terça", "Quinta"])
    expect(parseDiasAbreviados("Seg e Qua e Sex")).toEqual(["Segunda", "Quarta", "Sexta"])
  })

  it("descarta abreviação que não bate com nenhum dia conhecido, nunca adivinha", () => {
    expect(parseDiasAbreviados("Ter e Xyz")).toEqual(["Terça"])
  })

  it("vazio/null devolve lista vazia", () => {
    expect(parseDiasAbreviados("")).toEqual([])
    expect(parseDiasAbreviados(null)).toEqual([])
  })
})

// S-PROG-09 (item 2): reabrir um rascunho já gravado pelo editor — `zerar: false` preserva os
// valores reais em vez de zerá-los. Os dados de exemplo abaixo espelham exatamente o formato que
// `montarAtividadePayload` grava (não um formato de planilha antigo) — é o próprio ciclo
// salvar → reabrir do editor, não uma duplicação de mês.
describe("atividadeFormDeLinhaExistente com zerar:false (reabrir rascunho, S-PROG-09 item 2)", () => {
  it("ESPORTES: preserva hora/vagas/dias/faixa, reconstituindo dias_raw e faixa_ate vazia ('a partir de')", () => {
    const forma = atividadeFormDeLinhaExistente({
      categoria: "ESPORTES", titulo: "Futsal", descricao: null, local: null,
      hora_inicio: "14:00:00", hora_fim: "15:30:00",
      metadata: {
        professor: "Renato Severo", turma: "Turma A", faixa_etaria: "a partir de 12 anos",
        sexo: "Misto", vagas: "20", dias_semana: "Ter e Qui",
      },
    }, "temp-6", { zerar: false })

    expect(forma!.hora_inicio).toBe("14:00")
    expect(forma!.hora_fim).toBe("15:30")
    expect(forma!.metadata.vagas).toBe("20")
    expect(forma!.metadata.dias_raw).toEqual(["Terça", "Quinta"])
    expect(forma!.metadata.dias_semana).toBe("Ter e Qui")
    expect(forma!.metadata.faixa_de).toBe("12")
    expect(forma!.metadata.faixa_ate).toBe("")
    expect(forma!.metadata.turma).toBe("Turma A")
  })

  it("CURSOS: preserva vagas e converte o período gravado ('dd/mm/aaaa a dd/mm/aaaa') de volta para ISO", () => {
    const forma = atividadeFormDeLinhaExistente({
      categoria: "CURSOS", titulo: "Violão para todos", descricao: null, local: null,
      metadata: {
        vagas: "10", ementa: "Estudo de violão popular.", educador: "Edmundo Vitoriano",
        requisitos: "Nenhum", carga_horaria: "17",
        periodo: "09/09/2026 a 30/09/2026 (Qua e Sex)",
        dias_semana: "Qua e Sex",
      },
    }, "temp-7", { zerar: false })

    expect(forma!.metadata.data_inicio_raw).toBe("2026-09-09")
    expect(forma!.metadata.data_fim_raw).toBe("2026-09-30")
    expect(forma!.metadata.vagas).toBe("10")
    expect(forma!.metadata.dias_raw).toEqual(["Quarta", "Sexta"])
  })

  it("DIA A DIA: preserva data_atividade (root) e dia_semana/data_real do metadata, sem recalcular", () => {
    const forma = atividadeFormDeLinhaExistente({
      categoria: "DIA A DIA", titulo: "Comunidade em Pauta", descricao: null, local: "Anfiteatro",
      data_atividade: "2026-09-15",
      metadata: { sessao: "DPDH", atividade: "Oficina de passinho", informacoes: "Texto aqui.", dia_semana: "Terça-feira", data_real: "15/09" },
    }, "temp-8", { zerar: false })

    expect(forma!.data_atividade).toBe("2026-09-15")
    expect(forma!.metadata.dia_semana).toBe("Terça-feira")
    expect(forma!.metadata.data_real).toBe("15/09")
  })

  it("campanha vazia em algum campo de metadata não quebra — vagas ausente vira string vazia, não 'undefined'", () => {
    const forma = atividadeFormDeLinhaExistente({
      categoria: "ESPORTES", titulo: "Judô", descricao: null, local: null,
      metadata: { professor: "X", turma: "A", sexo: "Misto" },
    }, "temp-9", { zerar: false })
    expect(forma!.metadata.vagas).toBe("")
  })
})
