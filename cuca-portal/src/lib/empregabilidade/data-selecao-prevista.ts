/**
 * S-EMP-AUD-042 — validação compartilhada de `data_selecao_prevista` (campo bloqueante no
 * cadastro de vaga, tanto no formulário público da empresa quanto no modal interno da equipe).
 *
 * Centralizado num único módulo, usado no cliente (page.tsx / vaga-modal.tsx) e no servidor
 * (api/empregabilidade/vagas/route.ts) para as duas mensagens de erro nunca divergirem entre
 * front e back, e para a comparação de "data no passado" ser feita do mesmo jeito nos dois
 * lados — sem isso, a checagem do cliente e a do servidor podem discordar sobre o que é "hoje".
 *
 * `hojeBrasilISO` usa `Intl.DateTimeFormat` com timeZone fixo (`America/Fortaleza`, -03:00 sem
 * DST desde 2019 — mesmo fuso já usado no worker, S-EMP-AUD-040) em vez de `new Date()` +
 * matemática de offset manual: funciona igual no navegador do usuário e no runtime do servidor
 * (Node, que normalmente roda em UTC no container), sem depender do relógio/fuso local de
 * nenhum dos dois ambientes.
 */

const FUSO_ATENDIMENTO = "America/Fortaleza"

/** Data de hoje, no fuso do atendimento, como string `YYYY-MM-DD` — comparável
 * lexicograficamente com o valor de um `<input type="date">` (mesmo formato). */
export function hojeBrasilISO(): string {
    // locale "en-CA" formata como YYYY-MM-DD nativamente — evita montar a string na mão.
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: FUSO_ATENDIMENTO,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date())
}

const FORMATO_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

export const MSG_DATA_SELECAO_AUSENTE =
    "Para prosseguir, informe uma data prevista para a seleção."
export const MSG_DATA_SELECAO_NO_PASSADO =
    "A data prevista para a seleção não pode ser no passado — confira o ano informado."
export const MSG_DATA_SELECAO_INVALIDA =
    "Data prevista para a seleção inválida."

export type ValidacaoDataSelecaoPrevista =
    | { ok: true; valor: string }
    | { ok: false; erro: string }

/** Valida `data_selecao_prevista`: obrigatória (AC1/AC2), formato `YYYY-MM-DD` e não anterior a
 * hoje (AC3) — as duas mensagens de erro são distintas de propósito (campo vazio vs. data
 * inválida), conforme a story pede. */
export function validarDataSelecaoPrevista(valor: unknown): ValidacaoDataSelecaoPrevista {
    if (typeof valor !== "string" || !valor.trim()) {
        return { ok: false, erro: MSG_DATA_SELECAO_AUSENTE }
    }
    const valorLimpo = valor.trim()
    if (!FORMATO_DATA_ISO.test(valorLimpo)) {
        return { ok: false, erro: MSG_DATA_SELECAO_INVALIDA }
    }
    if (valorLimpo < hojeBrasilISO()) {
        return { ok: false, erro: MSG_DATA_SELECAO_NO_PASSADO }
    }
    return { ok: true, valor: valorLimpo }
}
