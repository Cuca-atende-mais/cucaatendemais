import assert from "node:assert/strict"
import test from "node:test"
import {
    avaliarAcesso,
    validarFiltros,
} from "../src/app/api/configuracoes/acompanhamento-envios/logic.ts"

const DEV_EMAILS = ["dev@example.com"]

test("retorna 401 quando não há usuário autenticado", () => {
    assert.deepEqual(avaliarAcesso(null, [], "can_read", DEV_EMAILS), {
        autorizado: false,
        status: 401,
        error: "Não autenticado",
    })
})

test("retorna 403 para usuário sem o módulo config_acompanhamento_envios", () => {
    const acesso = avaliarAcesso(
        { id: "user-1", email: "sem-permissao@example.com" },
        [{ module: "divulgacao", can_read: true }],
        "can_read",
        DEV_EMAILS,
    )
    assert.equal(acesso.autorizado, false)
    if (!acesso.autorizado) assert.equal(acesso.status, 403)
})

test("retorna 403 quando o módulo existe mas can_read é false", () => {
    const acesso = avaliarAcesso(
        { id: "user-2" },
        [{ module: "config_acompanhamento_envios", can_read: false }],
        "can_read",
        DEV_EMAILS,
    )
    assert.equal(acesso.autorizado, false)
})

test("autoriza leitura via sys_permissions com o módulo correto", () => {
    assert.equal(avaliarAcesso(
        { id: "reader" },
        [{ module: "config_acompanhamento_envios", can_read: true }],
        "can_read",
        DEV_EMAILS,
    ).autorizado, true)
})

test("bypass de developer autoriza mesmo sem sys_permissions", () => {
    assert.equal(avaliarAcesso(
        { id: "dev", email: "dev@example.com" },
        [],
        "can_read",
        DEV_EMAILS,
    ).autorizado, true)
})

test("validarFiltros aceita motor válido e datas ISO", () => {
    const resultado = validarFiltros({ motor: "pontual", desde: "2026-07-01", ate: "2026-07-31" })
    assert.deepEqual(resultado, { motor: "pontual", desde: "2026-07-01", ate: "2026-07-31" })
})

test("validarFiltros aceita ausência de filtros (todos null)", () => {
    const resultado = validarFiltros({})
    assert.deepEqual(resultado, { motor: null, desde: null, ate: null })
})

test("validarFiltros rejeita motor desconhecido", () => {
    const resultado = validarFiltros({ motor: "academia-enem" })
    assert.ok("erro" in resultado)
    if ("erro" in resultado) assert.match(resultado.erro, /motor inválido/)
})

test("validarFiltros rejeita data inválida", () => {
    const resultado = validarFiltros({ desde: "não-é-uma-data" })
    assert.ok("erro" in resultado)
    if ("erro" in resultado) assert.match(resultado.erro, /desde inválido/)
})
