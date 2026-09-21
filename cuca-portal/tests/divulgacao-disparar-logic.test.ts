import assert from "node:assert/strict"
import { test } from "vitest"
import {
    erroConfiguracao,
    mensagemDuplicata,
    montarRegistroDisparo,
    periodoValido,
} from "../src/app/api/divulgacao/disparar/logic"

test("valida mês e ano e preserva mensagem de duplicata 409", () => {
    assert.equal(periodoValido(7, 2026), true)
    assert.equal(periodoValido(13, 2026), false)
    assert.match(mensagemDuplicata({ status: "pendente" }, 7, 2026) ?? "", /pendente.*7\/2026/)
})

test("diferencia ausência de número e template para resposta 422", () => {
    assert.match(erroConfiguracao(null, null) ?? "", /número Meta Institucional/)
    assert.match(erroConfiguracao({ phone_number_id: "123" }, null) ?? "", /template Meta Institucional/)
    assert.equal(erroConfiguracao(
        { phone_number_id: "123" },
        { nome: "template", corpo_texto: "Olá {{1}}" },
    ), null)
})

test("monta fila com snapshot do template e phone_number_id resolvidos no servidor", () => {
    const registro = montarRegistroDisparo({
        mes: 7,
        ano: 2026,
        titulo: " Aviso Julho ",
        corpoTemplate: "Olá, {{1}}! Programação de {{2}}.",
        phoneNumberId: "1233832826470497",
        totalLeads: 12,
        userId: "user-1",
    })

    assert.equal(registro.mensagem_template, "Olá, {{1}}! Programação de {{2}}.")
    assert.equal(registro.instancia_uazapi, "1233832826470497")
    assert.equal(registro.titulo, "Aviso Julho")
    assert.equal(registro.status, "pendente")
})
