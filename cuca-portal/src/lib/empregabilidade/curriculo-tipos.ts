// SQS-57: tipos compartilhados entre a geração de PDF e a derivação de skills.
// Espelha (sem importar de) os tipos locais já existentes em print/[id]/page.tsx
// e criar-curriculo/[id]/page.tsx — mantidos separados de propósito: essas duas
// páginas não mudam de comportamento nesta story (AC9), então não criamos
// acoplamento novo com elas.

export interface Atividade {
    descricao: string
}

export interface Experiencia {
    empresa: string
    cargo: string
    data_inicio: string
    data_fim: string
    atual: boolean
    atividades: Atividade[]
}

export interface Formacao {
    escolaridade: string
    instituicao: string
    curso?: string
    status: "concluido" | "cursando"
    ano: string
}

export interface Curso {
    instituicao: string
    titulo: string
    ano: string
    descricao: string
}

export interface Habilidade {
    titulo: string
    descricao: string
}

export interface CvDados {
    nome: string
    endereco: string
    telefone: string
    email: string
    linkedin: string
    portfolio: string
    apresentacao: string
    objetivo: string
    experiencias: Experiencia[]
    formacoes: Formacao[]
    cursos: Curso[]
    habilidades: Habilidade[]
}
