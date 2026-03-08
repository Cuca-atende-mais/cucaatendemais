import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * S13-05: Máscara de telefone +55 (XX) XXXXX-XXXX
 * Aceita entrada livre e formata progressivamente enquanto o usuário digita.
 */
export function mascaraTelefone(valor: string): string {
  const digits = valor.replace(/\D/g, "")
  // Remove o prefixo 55 se já digitado pelo usuário (evita duplicar)
  const numeros = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits

  if (numeros.length === 0) return ""
  if (numeros.length <= 2) return `+55 (${numeros}`
  if (numeros.length <= 7) return `+55 (${numeros.slice(0, 2)}) ${numeros.slice(2)}`
  if (numeros.length <= 11) return `+55 (${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7)}`
  return `+55 (${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7, 11)}`
}

/**
 * Extrai apenas os dígitos do número para salvar no banco (sem formatação).
 */
export function limparTelefone(valor: string): string {
  return valor.replace(/\D/g, "")
}
