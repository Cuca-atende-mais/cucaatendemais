import { NIVEIS_ESCOLARIDADE } from "@/constants/empregabilidade"

// SQS-57: extraído de api/developer/batch-backfill/route.ts para ser reusado
// pela derivação determinística de skills_jsonb (currículo estruturado → triagem).
// Mesma lógica, mesmo resultado — nenhuma mudança de comportamento no backfill.

/** Tenta mapear uma string de escolaridade livre para o nível canônico mais próximo. */
export function normalizarEscolaridade(raw: string | undefined | null): string | null {
    if (!raw) return null
    const lower = raw.toLowerCase()
    if (lower.includes("doutor") || lower.includes("phd")) return "Mestrado ou superior"
    if (lower.includes("mestre") || lower.includes("mestrado")) return "Mestrado ou superior"
    if (lower.includes("pós") || lower.includes("pos-grad") || lower.includes("especializa")) {
        return lower.includes("incom") ? "Pós-graduação Incompleta" : "Pós-graduação Completa"
    }
    if (lower.includes("superior") || lower.includes("faculdade") || lower.includes("graduação") || lower.includes("universid")) {
        return lower.includes("incom") || lower.includes("cursando") ? "Superior Incompleto" : "Superior Completo"
    }
    if (lower.includes("técnico") || lower.includes("tecnico")) return "Técnico"
    if (lower.includes("médio") || lower.includes("medio") || lower.includes("2º grau") || lower.includes("ensino medio")) {
        return lower.includes("incom") || lower.includes("cursando") ? "Médio Incompleto" : "Médio Completo"
    }
    if (lower.includes("fundamental") || lower.includes("1º grau")) {
        return lower.includes("incom") || lower.includes("cursando") ? "Fundamental Incompleto" : "Fundamental Completo"
    }
    // Se a string já é um nível canônico, retorna direto
    if ((NIVEIS_ESCOLARIDADE as readonly string[]).includes(raw)) return raw
    return null
}

/** Índice do nível na escala canônica (maior = mais alto). -1 se não reconhecido. */
export function rankEscolaridade(nivel: string | null): number {
    if (!nivel) return -1
    return (NIVEIS_ESCOLARIDADE as readonly string[]).indexOf(nivel)
}
