import { describe, expect, it } from "vitest"
import {
  aplicarMascaraDataDigitando,
  aplicarMascaraHoraDigitando,
  dataBrParaISO,
  dataISOParaBr,
  exibirData,
  horaFimDepoisDoInicio,
  normalizarData,
  normalizarHora,
} from "./mascaras"

// ── AC2 da S-PROG-01: digitar "8" em hora início e sair do campo vira "08:00" ────────────────

describe("aplicarMascaraHoraDigitando", () => {
  it("mantém 1-2 dígitos sem separador — o usuário ainda está digitando", () => {
    expect(aplicarMascaraHoraDigitando("8")).toBe("8")
    expect(aplicarMascaraHoraDigitando("08")).toBe("08")
  })

  it("insere ':' sozinho a partir do 3º dígito", () => {
    expect(aplicarMascaraHoraDigitando("083")).toBe("08:3")
    expect(aplicarMascaraHoraDigitando("0830")).toBe("08:30")
  })

  it("ignora qualquer caractere que não seja dígito — 'h', letras, símbolos nunca entram", () => {
    // Extrai só os dígitos e reposiciona — não sabe (nem precisa saber) que "8" devia virar
    // "08": esse padding é responsabilidade de normalizarHora, chamada no blur, não aqui.
    expect(aplicarMascaraHoraDigitando("8h30")).toBe("83:0")
    expect(aplicarMascaraHoraDigitando("08:30")).toBe("08:30")
  })

  it("trunca em 4 dígitos", () => {
    expect(aplicarMascaraHoraDigitando("083099")).toBe("08:30")
  })
})

describe("normalizarHora", () => {
  it("completa 1 dígito para hora cheia — AC2: '8' vira '08:00'", () => {
    expect(normalizarHora("8")).toEqual({ ok: true, valor: "08:00" })
  })

  it("completa 2 dígitos para hora cheia", () => {
    expect(normalizarHora("14")).toEqual({ ok: true, valor: "14:00" })
  })

  it("completa 3 dígitos preenchendo a hora com zero à esquerda", () => {
    expect(normalizarHora("830")).toEqual({ ok: true, valor: "08:30" })
  })

  it("aceita 4 dígitos já completos", () => {
    expect(normalizarHora("1830")).toEqual({ ok: true, valor: "18:30" })
  })

  it("string vazia é válida (campo opcional/zerado) — obrigatoriedade não é desta função", () => {
    expect(normalizarHora("")).toEqual({ ok: true, valor: "" })
  })

  it("AC2: rejeita hora > 23", () => {
    const r = normalizarHora("2500")
    expect(r.ok).toBe(false)
  })

  it("rejeita minuto > 59", () => {
    const r = normalizarHora("0875")
    expect(r.ok).toBe(false)
  })

  it("aceita a borda 23:59", () => {
    expect(normalizarHora("2359")).toEqual({ ok: true, valor: "23:59" })
  })
})

describe("horaFimDepoisDoInicio", () => {
  it("true quando fim é depois do início", () => {
    expect(horaFimDepoisDoInicio("08:00", "09:00")).toBe(true)
  })

  it("false quando fim é igual ao início", () => {
    expect(horaFimDepoisDoInicio("08:00", "08:00")).toBe(false)
  })

  it("false quando fim é antes do início", () => {
    expect(horaFimDepoisDoInicio("09:00", "08:00")).toBe(false)
  })

  it("campos vazios nunca são inválidos aqui — obrigatoriedade é do painel de revisão", () => {
    expect(horaFimDepoisDoInicio("", "09:00")).toBe(true)
    expect(horaFimDepoisDoInicio("08:00", "")).toBe(true)
  })
})

describe("aplicarMascaraDataDigitando", () => {
  it("insere '/' nas posições 2 e 4", () => {
    expect(aplicarMascaraDataDigitando("07")).toBe("07")
    expect(aplicarMascaraDataDigitando("078")).toBe("07/8")
    expect(aplicarMascaraDataDigitando("07082026")).toBe("07/08/2026")
  })

  it("ignora caracteres não numéricos", () => {
    expect(aplicarMascaraDataDigitando("07/08/2026")).toBe("07/08/2026")
  })

  it("trunca em 8 dígitos", () => {
    expect(aplicarMascaraDataDigitando("070820269999")).toBe("07/08/2026")
  })
})

describe("normalizarData", () => {
  it("aceita data completa e válida", () => {
    expect(normalizarData("07082026")).toEqual({ ok: true, valor: "07/08/2026" })
  })

  it("string vazia é válida", () => {
    expect(normalizarData("")).toEqual({ ok: true, valor: "" })
  })

  it("rejeita data incompleta", () => {
    expect(normalizarData("0708").ok).toBe(false)
  })

  it("rejeita dia inválido", () => {
    expect(normalizarData("32082026").ok).toBe(false)
  })

  it("rejeita mês inválido", () => {
    expect(normalizarData("07132026").ok).toBe(false)
  })
})

describe("dataBrParaISO / dataISOParaBr", () => {
  it("converte dd/mm/aaaa para ISO — data_atividade é coluna 'date' no Postgres", () => {
    expect(dataBrParaISO("07/08/2026")).toBe("2026-08-07")
  })

  it("converte ISO de volta para dd/mm/aaaa", () => {
    expect(dataISOParaBr("2026-08-07")).toBe("07/08/2026")
  })

  it("são inversas uma da outra", () => {
    expect(dataISOParaBr(dataBrParaISO("07/08/2026")!)).toBe("07/08/2026")
  })

  it("retorna null para string incompleta ou mal formada, nunca lança", () => {
    expect(dataBrParaISO("07/08")).toBeNull()
    expect(dataBrParaISO("")).toBeNull()
    expect(dataISOParaBr("2026-08")).toBeNull()
  })

  it("aceita timestamp ISO completo (com hora), não só a data pura", () => {
    expect(dataISOParaBr("2026-08-07T00:00:00.000Z")).toBe("07/08/2026")
  })
})

// ── Regressão @qa: campo de data resetando pra vazio a cada tecla digitada ──────────────────
// (grade-atividades.tsx / ficha-atividade.tsx guardam texto bruto dd/mm/aaaa enquanto a data
// está incompleta, e só convertem pra ISO quando ela fecha — `exibirData` precisa exibir os
// dois formatos corretamente, senão o bug volta.)

describe("exibirData", () => {
  it("vazio/null/undefined vira string vazia", () => {
    expect(exibirData(null)).toBe("")
    expect(exibirData(undefined)).toBe("")
    expect(exibirData("")).toBe("")
  })

  it("converte um valor já commitado em ISO para dd/mm/aaaa", () => {
    expect(exibirData("2026-08-07")).toBe("07/08/2026")
  })

  it("texto bruto ainda sendo digitado (não é ISO) é exibido tal como está — não vira vazio", () => {
    expect(exibirData("0")).toBe("0")
    expect(exibirData("07")).toBe("07")
    expect(exibirData("07/08")).toBe("07/08")
    expect(exibirData("07/08/20")).toBe("07/08/20")
  })
})
