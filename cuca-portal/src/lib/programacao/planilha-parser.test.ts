import { describe, expect, it } from "vitest"
import {
  CATEGORIAS_VALIDAS,
  COLUNAS_CURSOS,
  COLUNAS_DIA_A_DIA,
  COLUNAS_ESPORTES,
  detectarCategoria,
  detectarColunas,
  lerColuna,
} from "./planilha-parser"

// ── detectarCategoria: nunca "adivinha" um typo, aborta (null) em vez de virar "Diversos" ────

describe("detectarCategoria", () => {
  it("reconhece as 4 categorias válidas a partir do nome da aba", () => {
    expect(detectarCategoria("ESPORTES - JULHO")).toBe("ESPORTES")
    expect(detectarCategoria("CURSOS - JULHO")).toBe("CURSOS")
    expect(detectarCategoria("DIA A DIA - JULHO")).toBe("DIA A DIA")
    expect(detectarCategoria("ESPECIAIS - JULHO")).toBe("ESPECIAIS")
  })

  it("achado Jangurussu (S-WM-35): 'ESPORTE - JUNHO' (sem o S) retorna null, não 'Diversos'", () => {
    expect(detectarCategoria("ESPORTE - JUNHO")).toBeNull()
  })

  it("aba sem hífen retorna null (não tem como extrair categoria nenhuma)", () => {
    expect(detectarCategoria("Instruções")).toBeNull()
  })

  it("categoria desconhecida (mesmo com hífen) retorna null", () => {
    expect(detectarCategoria("EVENTOS ESPECIAIS RARISSIMOS - JULHO")).toBeNull()
  })

  it("é tolerante a espaço extra e caixa mista ao redor do hífen", () => {
    expect(detectarCategoria("  esportes   -   Julho  ")).toBe("ESPORTES")
  })

  it("CATEGORIAS_VALIDAS continua com as 4 categorias esperadas (trava a lista contra mudança silenciosa)", () => {
    expect(CATEGORIAS_VALIDAS).toEqual(["ESPORTES", "CURSOS", "DIA A DIA", "ESPECIAIS"])
  })
})

// ── detectarColunas: por nome, nunca por posição — genérico, testado com as 3 definições reais ──

describe("detectarColunas — ESPORTES", () => {
  const headerCanonico = ["Nº", "Modalidade", "Professor", "Turma", "Faixa Etária", "Sexo", "Vagas", "Dias", "Horário"]

  it("detecta todas as colunas no header na ordem canônica", () => {
    const r = detectarColunas(headerCanonico, COLUNAS_ESPORTES)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.indices.titulo).toBe(1)
      expect(r.indices.professor).toBe(2)
      expect(r.indices.horario).toBe(8)
    }
  })

  it("fixture 'coluna reordenada': mesmas colunas, ordem diferente — detecta pelo NOME, não pela posição", () => {
    const headerReordenado = ["Nº", "Turma", "Modalidade", "Horário", "Dias", "Vagas", "Sexo", "Faixa Etária", "Professor"]
    const r = detectarColunas(headerReordenado, COLUNAS_ESPORTES)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.indices.titulo).toBe(2) // Modalidade agora na posição 2, não 1 — prova que não é fallback fixo
      expect(r.indices.horario).toBe(3)
      expect(r.indices.professor).toBe(8)
    }
  })

  it("fixture 'header com nome parecido mas reconhecível': acentuação/variação de texto ainda casa", () => {
    const headerVariante = ["Nº", "MODALIDADE ESPORTIVA", "PROFESSOR(A)", "Nº TURMA", "FAIXA ETARIA (SEM ACENTO)", "SEXO/NAIPE", "VAGAS DISPONIVEIS", "DIAS DA SEMANA", "HORARIO"]
    const r = detectarColunas(headerVariante, COLUNAS_ESPORTES)
    expect(r.ok).toBe(true)
  })

  it("fixture 'coluna ausente' (achado real de José Walter): sem coluna de Faixa Etária, aborta com a chave faltando identificada — não cai num índice fixo que pegaria outra coisa", () => {
    const headerSemFaixa = ["Nº", "Modalidade", "Professor", "Turma", "Sexo", "Vagas", "Dias", "Horário"]
    const r = detectarColunas(headerSemFaixa, COLUNAS_ESPORTES)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.faltando).toEqual(["faixaEtaria"])
      // o header real encontrado vai na mensagem de erro pra quem for investigar/ajustar o regex
      expect(r.headerEncontrado).toContain("sexo")
    }
  })

  it("fixture 'coluna extra' (ex.: planilha com coluna 'Observações' a mais): não atrapalha a detecção das colunas esperadas", () => {
    const headerComExtra = ["Nº", "Modalidade", "Professor", "Turma", "Faixa Etária", "Sexo", "Vagas", "Dias", "Horário", "Observações"]
    const r = detectarColunas(headerComExtra, COLUNAS_ESPORTES)
    expect(r.ok).toBe(true)
  })

  it("header completamente vazio/em branco: todas as colunas faltando, nenhuma acerta por acidente", () => {
    const r = detectarColunas([], COLUNAS_ESPORTES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.faltando.length).toBe(COLUNAS_ESPORTES.length)
  })
})

describe("detectarColunas — CURSOS", () => {
  const headerCanonico = ["Nº", "Curso", "Carga Horária", "Vagas", "Período", "Horário", "Requisitos", "Ementa", "Educador"]

  it("detecta todas as colunas no header canônico", () => {
    const r = detectarColunas(headerCanonico, COLUNAS_CURSOS)
    expect(r.ok).toBe(true)
  })

  it("fixture 'coluna reordenada'", () => {
    const headerReordenado = ["Nº", "Educador", "Ementa", "Requisitos", "Horário", "Período", "Vagas", "Carga Horária", "Curso"]
    const r = detectarColunas(headerReordenado, COLUNAS_CURSOS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.indices.titulo).toBe(8)
      expect(r.indices.educador).toBe(1)
    }
  })

  it("fixture 'coluna ausente': sem 'Requisitos', aborta identificando a chave", () => {
    const headerSemRequisitos = ["Nº", "Curso", "Carga Horária", "Vagas", "Período", "Horário", "Ementa", "Educador"]
    const r = detectarColunas(headerSemRequisitos, COLUNAS_CURSOS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.faltando).toEqual(["requisitos"])
  })

  it("fixture 'coluna extra': coluna 'Sala' a mais não atrapalha", () => {
    const headerComExtra = [...headerCanonico, "Sala"]
    const r = detectarColunas(headerComExtra, COLUNAS_CURSOS)
    expect(r.ok).toBe(true)
  })
})

describe("detectarColunas — DIA A DIA / ESPECIAIS", () => {
  const headerCanonico = ["Nº", "Sessão", "Data", "Dia da Semana", "Programa", "Atividade", "Início", "Fim", "Local", "Informações"]

  it("detecta todas as colunas no header canônico", () => {
    const r = detectarColunas(headerCanonico, COLUNAS_DIA_A_DIA)
    expect(r.ok).toBe(true)
  })

  it("fixture 'coluna reordenada'", () => {
    const headerReordenado = ["Informações", "Local", "Fim", "Início", "Atividade", "Programa", "Dia da Semana", "Data", "Sessão"]
    const r = detectarColunas(headerReordenado, COLUNAS_DIA_A_DIA)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.indices.sessao).toBe(8)
      expect(r.indices.informacoes).toBe(0)
      expect(r.indices.titulo).toBe(5) // "Programa" — campo distinto de "Atividade" (índice 4)
    }
  })

  it("fixture 'coluna ausente': sem 'Local', aborta identificando a chave", () => {
    const headerSemLocal = ["Nº", "Sessão", "Data", "Dia da Semana", "Programa", "Atividade", "Início", "Fim", "Informações"]
    const r = detectarColunas(headerSemLocal, COLUNAS_DIA_A_DIA)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.faltando).toEqual(["local"])
  })

  it("'titulo' (Programa) e 'atividade' são detectados como colunas distintas, nunca a mesma", () => {
    const r = detectarColunas(headerCanonico, COLUNAS_DIA_A_DIA)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.indices.titulo).toBe(4) // "Programa"
      expect(r.indices.atividade).toBe(5) // "Atividade"
      expect(r.indices.titulo).not.toBe(r.indices.atividade)
    }
  })
})

// ── lerColuna: nunca cai em índice fixo quando a chave não foi detectada ─────────────────────

describe("lerColuna", () => {
  it("lê o valor da linha pelo índice já detectado", () => {
    const row = ["1", "Natação", "Cirillo"]
    expect(lerColuna(row, { professor: 2 }, "professor")).toBe("Cirillo")
  })

  it("retorna vazio (nunca um valor de outra coluna) quando a chave não foi detectada", () => {
    const row = ["1", "Natação", "Cirillo"]
    expect(lerColuna(row, {}, "professor")).toBe("")
  })
})
