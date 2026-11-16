import type { Catalogo } from "./mock_supabase.ts";

/** FAQs institucionais que a S-INST-QUAL-07 desativa junto com a publicação da base nova. */
export const FAQS_DESATIVADAS_NA_07 = [
  "74a99302-b098-4df2-87be-fe4fad438db1", // O que é a Rede CUCA?
  "69520872-887e-47e2-85d6-5c95a46cbecc", // Como se inscrever em cursos e atividades
  "ff197b71-9259-48fd-a990-a10c548dc85e", // Horários de Funcionamento das Unidades CUCA
] as const;

/**
 * S-INST-QUAL-07: aplica, só na memória, o que a migration da 07 faz no banco: troca o texto do
 * `servicos_rede` e tira as 3 FAQs (documentos e trechos). Muda o objeto recebido.
 */
export function aplicarBase07(catalogo: Catalogo, texto: string): void {
  const fora = new Set<string>(FAQS_DESATIVADAS_NA_07);
  const docs = catalogo.comum.documentos;
  if (!docs.some((d) => d.tipo === "servicos_rede")) throw new Error("catálogo sem servicos_rede");
  catalogo.comum.documentos = docs
    .filter((d) => !fora.has(String(d.id)))
    .map((d) => (d.tipo === "servicos_rede" ? { ...d, conteudo: texto } : d));
  catalogo.comum.trechos = catalogo.comum.trechos.filter((t) => !fora.has(String(t.documento_id)));
}

/**
 * S-INST-QUAL-07 (15/11, decisão do Junior): sem as FAQs, o guardrail de escopo do `prompt_sistema`
 * passou a recusar perguntas sobre a unidade que a base não responde (AT-05 "estacionamento", CF-13).
 * A troca deixa claro que essas perguntas são do CUCA e vão para a regra de falta de informação.
 * O mesmo par de textos está na migration `20261116000000_inst_qual_07_base_institucional.sql`
 * (o teste confere que os dois batem).
 */
export const TROCA_GUARDRAIL_07 = {
  antigo: `    Se a pergunta não tiver relação com o CUCA, recuse educadamente e redirecione:`,
  novo: `    Pergunta sobre uma unidade ou sobre a Rede CUCA (estrutura, estacionamento, acessibilidade, dias e horários de funcionamento, serviços) É assunto do CUCA, mesmo quando a base não tiver a resposta. Nesse caso, NUNCA use a recusa abaixo: siga a regra de falta de informação das REGRAS OBRIGATÓRIAS — diga que não encontrou e passe o telefone da unidade.
    Se a pergunta não tiver relação com o CUCA, recuse educadamente e redirecione:`,
} as const;

/** Aplica, só na memória, a troca do guardrail no `prompt_sistema` do Institucional. Muda o objeto. */
export function aplicarPrompt07(catalogo: Catalogo): void {
  const p = catalogo.comum.prompts_agentes.find((x) => x.agente_tipo === "Institucional");
  if (!p) throw new Error("catálogo sem prompt do Institucional");
  const atual = String(p.prompt_sistema);
  if (atual.includes(TROCA_GUARDRAIL_07.novo)) return;
  if (!atual.includes(TROCA_GUARDRAIL_07.antigo)) throw new Error("guardrail de escopo não encontrado no prompt_sistema");
  p.prompt_sistema = atual.replace(TROCA_GUARDRAIL_07.antigo, TROCA_GUARDRAIL_07.novo);
}
