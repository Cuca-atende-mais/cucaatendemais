import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Máscara de telefone com DDI variável — não assume Brasil.
 * Se o número digitado começa com 55 (único DDI que começa com "55" —
 * Peru/México/Cuba/Argentina/Chile/Colômbia/Venezuela usam 51-58, todos
 * distintos), formata no padrão nacional +55 (XX) XXXXX-XXXX enquanto
 * digita. Para qualquer outro DDI, não impõe agrupamento nenhum — só
 * antepõe o "+" aos dígitos, sem nunca travar ou sobrescrever o que o
 * usuário está digitando.
 */
export function mascaraTelefone(valor: string): string {
  const digits = valor.replace(/\D/g, "")
  if (digits.length === 0) return ""

  if (digits.startsWith("55")) {
    const numeros = digits.slice(2)
    if (numeros.length === 0) return "+55"
    if (numeros.length <= 2) return `+55 (${numeros}`
    if (numeros.length <= 7) return `+55 (${numeros.slice(0, 2)}) ${numeros.slice(2)}`
    if (numeros.length <= 11) return `+55 (${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7)}`
    return `+55 (${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7, 11)}`
  }

  return `+${digits}`
}

/**
 * Extrai apenas os dígitos do número para salvar no banco (sem formatação).
 */
export function limparTelefone(valor: string): string {
  return valor.replace(/\D/g, "")
}
