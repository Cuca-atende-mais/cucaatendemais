import assert from "node:assert/strict"
import test from "node:test"
import {
    validarCorpoAtualizacaoLimite,
    validarNovoDailyLimit,
} from "../src/app/api/configuracoes/acompanhamento-envios/limite-diario/logic.ts"

test("validarNovoDailyLimit aceita valor dentro da camada confirmada", () => {
    assert.deepEqual(validarNovoDailyLimit(1500, 2000), { valido: true, valor: 1500 })
})

test("validarNovoDailyLimit aceita valor igual à camada confirmada (limite, não estritamente menor)", () => {
    assert.deepEqual(validarNovoDailyLimit(2000, 2000), { valido: true, valor: 2000 })
})

// S-WM-59 (item 3, regra do Junior): "nunca permitir configurar valor acima de
// messaging_limit_tier — bloquear no frontend E validar de novo no backend".
test("validarNovoDailyLimit rejeita valor acima da camada confirmada", () => {
    const resultado = validarNovoDailyLimit(2001, 2000)
    assert.equal(resultado.valido, false)
    if (!resultado.valido) assert.match(resultado.erro, /não pode passar/)
})

// messaging_limit_tier NULL = "não sei" (Meta ainda não confirmou a camada pra este
// número) — mesmo tratamento do worker (_warn_if_daily_limit_above_tier_sync): não bloqueia.
test("validarNovoDailyLimit permite qualquer valor positivo quando a camada ainda não foi confirmada (NULL)", () => {
    assert.deepEqual(validarNovoDailyLimit(50000, null), { valido: true, valor: 50000 })
})

test("validarNovoDailyLimit rejeita valor não-inteiro", () => {
    const resultado = validarNovoDailyLimit(100.5, 2000)
    assert.equal(resultado.valido, false)
})

test("validarNovoDailyLimit rejeita string", () => {
    const resultado = validarNovoDailyLimit("2000", 2000)
    assert.equal(resultado.valido, false)
})

test("validarNovoDailyLimit rejeita zero", () => {
    const resultado = validarNovoDailyLimit(0, 2000)
    assert.equal(resultado.valido, false)
})

test("validarNovoDailyLimit rejeita negativo", () => {
    const resultado = validarNovoDailyLimit(-100, 2000)
    assert.equal(resultado.valido, false)
})

test("validarCorpoAtualizacaoLimite aceita corpo válido", () => {
    const resultado = validarCorpoAtualizacaoLimite({ phone_number_id: "123", daily_limit: 500 })
    assert.deepEqual(resultado, { phone_number_id: "123", daily_limit: 500 })
})

test("validarCorpoAtualizacaoLimite rejeita phone_number_id ausente", () => {
    const resultado = validarCorpoAtualizacaoLimite({ daily_limit: 500 })
    assert.ok("erro" in resultado)
})

test("validarCorpoAtualizacaoLimite rejeita daily_limit ausente", () => {
    const resultado = validarCorpoAtualizacaoLimite({ phone_number_id: "123" })
    assert.ok("erro" in resultado)
})

test("validarCorpoAtualizacaoLimite rejeita corpo nulo", () => {
    const resultado = validarCorpoAtualizacaoLimite(null)
    assert.ok("erro" in resultado)
})
