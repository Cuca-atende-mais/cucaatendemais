// Types do banco de dados Supabase

export type Lead = {
    id: string
    telefone: string
    nome: string | null
    email: string | null
    unidade_cuca: string | null
    origem: string | null
    tags: string[] | null
    opt_in: boolean
    bloqueado: boolean
    motivo_bloqueio: string | null
    created_at: string
    updated_at: string
}

export type Conversa = {
    id: string
    lead_id: string
    instancia_uazapi: string
    agente_tipo: string
    status: string
    ultima_mensagem_em: string | null
    created_at: string
    updated_at: string
}

export type Mensagem = {
    id: string
    conversa_id: string
    lead_id: string
    tipo: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location'
    conteudo: string | null
    midia_url: string | null
    transcricao: string | null
    sentimento: string | null
    sentimento_score: number | null
    remetente: 'lead' | 'agente'
    created_at: string
}

export type EventoPontual = {
    id: string
    titulo: string
    descricao: string | null
    unidade_cuca: string
    data_evento: string
    data_inicio: string
    data_fim: string | null
    hora_inicio: string | null
    hora_fim: string | null
    local: string | null
    capacidade: number | null
    flyer_url: string | null
    segmentacao_id: string | null
    disparo_id: string | null
    status: string
    created_by: string | null
    created_at: string
    updated_at: string
}

export type CampanhaMensal = {
    id: string
    mes: number
    ano: number
    titulo: string
    descricao: string | null
    unidade_cuca_id: string | null
    unidade_cuca: string | null
    arquivo_excel_url: string | null
    total_atividades: number
    disparo_id: string | null
    status: string
    created_by: string | null
    created_at: string
    updated_at: string
}

export type Vaga = {
    id: string
    empresa_id: string
    titulo: string
    descricao: string
    requisitos: string | null
    salario: string | null
    beneficios: string | null
    tipo_contrato: string | null
    carga_horaria: string | null
    local: string | null
    unidade_cuca: string | null
    total_vagas: number
    status: string
    faixa_etaria: string | null
    local_entrevista: string | null
    tipo_selecao: string | null
    expansiva: boolean
    data_abertura: string
    data_fechamento: string | null
    disparo_id: string | null
    created_by: string | null
    created_at: string
    updated_at: string
}

export type Empresa = {
    id: string
    nome: string
    cnpj: string | null
    telefone: string | null
    email: string | null
    endereco: string | null
    setor: string | null
    porte: string | null
    contato_responsavel: string | null
    ativa: boolean
    created_by: string | null
    created_at: string
    updated_at: string
}

export type Feedback = {
    id: string
    lead_id: string | null
    tipo: 'critica' | 'sugestao' | 'elogio'
    categoria: string | null
    unidade_cuca: string | null
    mensagem: string
    anonimo: boolean
    sentimento: string | null
    sentimento_score: number | null
    status: string
    resposta: string | null
    respondido_por: string | null
    respondido_em: string | null
    created_at: string
}

export type Candidatura = {
    id: string
    vaga_id: string
    nome: string
    data_nascimento: string
    telefone: string
    arquivo_cv_url: string | null
    dados_ocr_json: any
    requisitos_atendidos: string
    status: string
    created_at: string
    updated_at: string
}

export type Campanha = {
    id: string
    unidade_cuca_id: string
    titulo: string
    template_texto: string
    midia_url: string | null
    publico_alvo: Record<string, any>
    agendamento: string | null
    status: 'rascunho' | 'aguardando_aprovacao' | 'aprovada' | 'em_andamento' | 'concluida' | 'cancelada' | 'pausada'
    created_by: string
    created_at: string
    updated_at: string
}
