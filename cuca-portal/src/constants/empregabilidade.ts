// S37B-02: Lista canônica de 11 níveis de escolaridade.
// A IA deve retornar SEMPRE o nível mais alto detectado, usando exatamente um destes valores.
export const NIVEIS_ESCOLARIDADE = [
    "Sem Escolaridade",
    "Fundamental Incompleto",
    "Fundamental Completo",
    "Médio Incompleto",
    "Médio Completo",
    "Técnico",
    "Superior Incompleto",
    "Superior Completo",
    "Pós-graduação Incompleta",
    "Pós-graduação Completa",
    "Mestrado ou superior",
] as const

export type NivelEscolaridade = (typeof NIVEIS_ESCOLARIDADE)[number]
