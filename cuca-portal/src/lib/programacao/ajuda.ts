/**
 * S-PROG-01 (item 6): ajuda em camadas para a criação de programação.
 *
 * Todas as frases num único módulo, chaveadas por campo — inline em componente envelhece sem
 * ninguém revisar. Textos elaborados pelo @dev a partir do que a planilha real do Mondubim
 * mostra (decisão do Junior em 2026-09-08: não depende da junta técnica; se precisarem de
 * ajuste, eles elaboram e mandamos aqui).
 *
 * Camada 1 — só estes campos têm tooltip/popover (11 da S-PROG-01 + 2 da S-PROG-02, item 5:
 * seletor de origem e selo de qualidade). Camada 2 (Modalidade, Curso, Professor, Educador,
 * Turma, Local, Programa, Atividade, Sessão) não tem ajuda — ícone em campo óbvio treina a
 * pessoa a ignorar todos.
 */
export const AJUDA_CAMPOS = {
  ementa:
    "Explique o curso em uma frase completa, sem abreviar. É este texto que o assistente do WhatsApp lê para o cidadão quando ele pergunta sobre o curso.",
  informacoes:
    "O que a pessoa precisa saber para participar. É este texto que o assistente do WhatsApp envia quando perguntam sobre a atividade.",
  idade_min:
    "Só o número. Se não houver idade máxima, o sistema mostra 'a partir de 15 anos'.",
  idade_max:
    "Deixe em branco quando não houver limite de idade.",
  vagas:
    "Digite o número de vagas desta turma. Ele zera todo mês na duplicação, e o assistente do WhatsApp não informa a quantidade — orienta a pessoa a procurar a unidade.",
  dias_semana:
    "Marque os dias em que a atividade acontece. Antes cada pessoa escrevia de um jeito ('Ter a sex', 'qui e ter') e o assistente não entendia.",
  horario:
    "Digite só os números — os dois pontos entram sozinhos. Digitando 8 vira 08:00.",
  requisitos:
    "Só o que não é idade: 'saber nadar', 'ter noção de tocar o instrumento'. A faixa etária vai nos campos de idade.",
  carga_horaria:
    "Só o número de horas. Não escreva 'h' nem '17h30min'.",
  meta:
    "Código da meta usado na prestação de contas. Mesmo valor da planilha.",
  diretoria:
    "Diretoria responsável pela atividade. Mesmo valor da planilha.",
  duplicar_origem:
    "Escolha o mês que serve de base. Vem copiado tudo que se repete; data, horário e vagas voltam em branco para você preencher.",
  selo_qualidade:
    "Percentual de atividades daquele mês com sinal de problema (texto de exemplo não apagado, faixa etária sem número, título vazio) — calculado agora, não é um valor fixo salvo antes.",
} as const

export type CampoComAjuda = keyof typeof AJUDA_CAMPOS

/** Camada 3 — sempre visível, sem clique. Placeholders de formato dos campos com máscara. */
export const PLACEHOLDER_HORA = "--:--"
export const PLACEHOLDER_DATA = "--/--/----"
