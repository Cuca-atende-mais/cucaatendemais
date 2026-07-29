import assert from "node:assert/strict"
import test from "node:test"
import {
    mapMotorParaOrigem,
    validarCorpoReenvio,
} from "../src/app/api/configuracoes/acompanhamento-envios/reenviar/logic.ts"

test("mapMotorParaOrigem mapeia pontual para eventos_pontuais", () => {
    assert.equal(mapMotorParaOrigem("pontual"), "eventos_pontuais")
})

test("mapMotorParaOrigem mapeia ouvidoria para ouvidoria_eventos", () => {
    assert.equal(mapMotorParaOrigem("ouvidoria"), "ouvidoria_eventos")
})

test("mapMotorParaOrigem mapeia divulgacao para divulgacao (sem tradução)", () => {
    assert.equal(mapMotorParaOrigem("divulgacao"), "divulgacao")
})

test("mapMotorParaOrigem retorna null para motor desconhecido", () => {
    assert.equal(mapMotorParaOrigem("academia-enem"), null)
})

test("validarCorpoReenvio aceita corpo válido e traduz o motor pra origem", () => {
    const resultado = validarCorpoReenvio({ motor: "pontual", item_id: "evento-1" })
    assert.deepEqual(resultado, { motor: "pontual", origem: "eventos_pontuais", item_id: "evento-1" })
})

test("validarCorpoReenvio rejeita corpo nulo", () => {
    const resultado = validarCorpoReenvio(null)
    assert.ok("erro" in resultado)
})

test("validarCorpoReenvio rejeita motor ausente", () => {
    const resultado = validarCorpoReenvio({ item_id: "x" })
    assert.ok("erro" in resultado)
    if ("erro" in resultado) assert.match(resultado.erro, /motor/)
})

test("validarCorpoReenvio rejeita motor inválido", () => {
    const resultado = validarCorpoReenvio({ motor: "inexistente", item_id: "x" })
    assert.ok("erro" in resultado)
    if ("erro" in resultado) assert.match(resultado.erro, /motor inválido/)
})

test("validarCorpoReenvio rejeita item_id ausente", () => {
    const resultado = validarCorpoReenvio({ motor: "pontual" })
    assert.ok("erro" in resultado)
    if ("erro" in resultado) assert.match(resultado.erro, /item_id/)
})

test("validarCorpoReenvio rejeita item_id vazio", () => {
    const resultado = validarCorpoReenvio({ motor: "pontual", item_id: "   " })
    assert.ok("erro" in resultado)
})
