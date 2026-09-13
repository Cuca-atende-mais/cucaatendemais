import { describe, expect, it } from "vitest"
import { preencherColunaAbaixo } from "./preencher-abaixo"
import { AtividadeForm } from "./tipos"

function linha(tempId: string, categoria: AtividadeForm["categoria"], overrides: Partial<AtividadeForm> = {}): AtividadeForm {
  return {
    _tempId: tempId,
    categoria,
    titulo: "",
    descricao: null,
    local: null,
    data_atividade: null,
    hora_inicio: null,
    hora_fim: null,
    metadata: {},
    ...overrides,
  }
}

describe("preencherColunaAbaixo", () => {
  it("S-PROG-13: linha que a pessoa não pode editar fica como está", () => {
    const atividades = [
      linha("a", "ESPORTES", { metadata: { professor: "Renato Severo" } }),
      linha("b", "ESPORTES", {}),
      linha("c", "ESPORTES", {}),
    ]
    const r = preencherColunaAbaixo(atividades, "a", "professor", false, a => a._tempId !== "b")
    expect(r.linhasPreenchidas).toBe(1)
    expect(r.atividades.find(a => a._tempId === "b")?.metadata.professor).toBeUndefined()
    expect(r.atividades.find(a => a._tempId === "c")?.metadata.professor).toBe("Renato Severo")
  })

  it("coluna vazia abaixo: preenche todas as linhas da mesma categoria abaixo da origem", () => {
    const atividades = [
      linha("a", "ESPORTES", { metadata: { professor: "Renato Severo" } }),
      linha("b", "ESPORTES", {}),
      linha("c", "ESPORTES", {}),
    ]
    const r = preencherColunaAbaixo(atividades, "a", "professor", false)
    expect(r.linhasPreenchidas).toBe(2)
    expect(r.atividades.find(a => a._tempId === "b")?.metadata.professor).toBe("Renato Severo")
    expect(r.atividades.find(a => a._tempId === "c")?.metadata.professor).toBe("Renato Severo")
  })

  it("coluna parcialmente preenchida: só entra nas células vazias, nunca sobrescreve as já preenchidas", () => {
    const atividades = [
      linha("a", "ESPORTES", { metadata: { professor: "Renato Severo" } }),
      linha("b", "ESPORTES", { metadata: { professor: "Edmundo Vitoriano" } }), // já preenchida
      linha("c", "ESPORTES", {}), // vazia
    ]
    const r = preencherColunaAbaixo(atividades, "a", "professor", false)
    expect(r.linhasPreenchidas).toBe(1)
    expect(r.atividades.find(a => a._tempId === "b")?.metadata.professor).toBe("Edmundo Vitoriano") // não sobrescreve
    expect(r.atividades.find(a => a._tempId === "c")?.metadata.professor).toBe("Renato Severo")
  })

  it("última linha: origem é a última da categoria, nada abaixo — 0 preenchidas, array inalterado", () => {
    const atividades = [
      linha("a", "ESPORTES", {}),
      linha("b", "ESPORTES", { metadata: { professor: "Renato Severo" } }),
    ]
    const r = preencherColunaAbaixo(atividades, "b", "professor", false)
    expect(r.linhasPreenchidas).toBe(0)
    expect(r.atividades).toEqual(atividades)
  })

  it("campo bloqueado (data_atividade, hora_inicio, hora_fim, vagas): nunca propaga, mesmo com origem preenchida e linhas vazias abaixo", () => {
    const casos: Array<[string, boolean]> = [
      ["data_atividade", true],
      ["hora_inicio", true],
      ["hora_fim", true],
      ["vagas", false],
    ]
    for (const [campo, root] of casos) {
      const origemPatch: Partial<AtividadeForm> = root
        ? { [campo]: "10:00" } as Partial<AtividadeForm>
        : { metadata: { [campo]: "20" } }
      const atividades = [
        linha("a", "ESPORTES", origemPatch),
        linha("b", "ESPORTES", {}),
      ]
      const r = preencherColunaAbaixo(atividades, "a", campo, root)
      expect(r.linhasPreenchidas).toBe(0)
      expect(r.atividades).toEqual(atividades)
    }
  })

  it("origem vazia: não propaga nada, mesmo com linhas vazias abaixo (não há o que copiar)", () => {
    const atividades = [
      linha("a", "ESPORTES", {}),
      linha("b", "ESPORTES", {}),
    ]
    const r = preencherColunaAbaixo(atividades, "a", "professor", false)
    expect(r.linhasPreenchidas).toBe(0)
  })

  it("não mexe em linhas de OUTRA categoria, mesmo que estejam depois no array", () => {
    const atividades = [
      linha("a", "ESPORTES", { metadata: { professor: "Renato Severo" } }),
      linha("b", "CURSOS", {}), // outra categoria — nunca toca
      linha("c", "ESPORTES", {}),
    ]
    const r = preencherColunaAbaixo(atividades, "a", "professor", false)
    expect(r.linhasPreenchidas).toBe(1)
    expect(r.atividades.find(a => a._tempId === "b")?.metadata.professor).toBeUndefined()
    expect(r.atividades.find(a => a._tempId === "c")?.metadata.professor).toBe("Renato Severo")
  })

  it("não mexe em linha da mesma categoria que vem ANTES da origem no array", () => {
    const atividades = [
      linha("a", "ESPORTES", {}), // antes da origem, mesma categoria — nunca toca
      linha("b", "ESPORTES", { metadata: { professor: "Renato Severo" } }), // origem
      linha("c", "ESPORTES", {}),
    ]
    const r = preencherColunaAbaixo(atividades, "b", "professor", false)
    expect(r.linhasPreenchidas).toBe(1)
    expect(r.atividades.find(a => a._tempId === "a")?.metadata.professor).toBeUndefined()
    expect(r.atividades.find(a => a._tempId === "c")?.metadata.professor).toBe("Renato Severo")
  })

  it("coluna 'dias' (array dias_raw): copia o array e o espelho dias_semana junto, só em linha vazia", () => {
    const atividades = [
      linha("a", "ESPORTES", { metadata: { dias_raw: ["Terça", "Quinta"], dias_semana: "Ter e Qui" } }),
      linha("b", "ESPORTES", {}), // dias_raw ausente = vazio
      linha("c", "ESPORTES", { metadata: { dias_raw: ["Segunda"], dias_semana: "Seg" } }), // já preenchida
    ]
    const r = preencherColunaAbaixo(atividades, "a", "dias_raw", false)
    expect(r.linhasPreenchidas).toBe(1)
    expect(r.atividades.find(a => a._tempId === "b")?.metadata.dias_raw).toEqual(["Terça", "Quinta"])
    expect(r.atividades.find(a => a._tempId === "b")?.metadata.dias_semana).toBe("Ter e Qui")
    expect(r.atividades.find(a => a._tempId === "c")?.metadata.dias_raw).toEqual(["Segunda"]) // não sobrescreve array já preenchido
  })

  it("tempIdOrigem inexistente: devolve o array original, sem lançar", () => {
    const atividades = [linha("a", "ESPORTES", {})]
    const r = preencherColunaAbaixo(atividades, "inexistente", "professor", false)
    expect(r.linhasPreenchidas).toBe(0)
    expect(r.atividades).toEqual(atividades)
  })
})
