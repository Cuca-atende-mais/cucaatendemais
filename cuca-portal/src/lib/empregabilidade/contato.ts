// S-EMP-GES-01: validação do contato da empresa/vaga (cartão de contato da tela Feedback — AC3 — e
// cadastro manual de empresa nova — AC15). Telefone guardado só com dígitos.

export interface ContatoEntrada {
    nome?: string | null
    telefone?: string | null
    email?: string | null
}

export interface ContatoNormalizado {
    nome: string | null
    telefone: string | null
    email: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Telefone brasileiro com DDD (10 ou 11 dígitos), com ou sem o 55 na frente. */
export function telefoneValido(telefone: string): boolean {
    const d = telefone.replace(/\D/g, "")
    const semDdi = (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d
    return semDdi.length === 10 || semDdi.length === 11
}

export function validarContato(
    entrada: ContatoEntrada,
    { obrigatorio }: { obrigatorio: boolean },
): { ok: true; contato: ContatoNormalizado } | { ok: false; erros: string[] } {
    const nome = (entrada.nome ?? "").trim()
    const telefone = (entrada.telefone ?? "").replace(/\D/g, "")
    const email = (entrada.email ?? "").trim().toLowerCase()
    const erros: string[] = []

    if (obrigatorio) {
        if (!nome) erros.push("Informe o nome do contato.")
        if (!telefone) erros.push("Informe o telefone do contato.")
        if (!email) erros.push("Informe o e-mail do contato.")
    }
    if (telefone && !telefoneValido(telefone)) erros.push("Telefone inválido: use DDD + número (ex.: 85 99999-9999).")
    if (email && !EMAIL_RE.test(email)) erros.push("E-mail inválido.")

    if (erros.length > 0) return { ok: false, erros }
    return { ok: true, contato: { nome: nome || null, telefone: telefone || null, email: email || null } }
}
