# Auditoria — busca determinística de atividade não cobre cursos, só esportes

**Natureza:** achado novo, investigado ao vivo a partir de uma pergunta real de lead (disparo "Aviso Programação Ago/2026", 07-08/08/2026), não de uma varredura completa do repositório.
**Gatilho:** a lead "diva patyy1" perguntou sobre o curso de Fotografia no Cuca José Walter e recebeu "Infelizmente, não tenho os horários específicos aqui" — mesmo a informação existindo, completa, no RAG indexado.
**Método:** consulta direta ao banco de produção via MCP Supabase (`documentos_rag`, `chunks_documentos`), leitura de código (`supabase/functions/motor-agente/index.ts`), leitura dos testes existentes (`index.test.ts`).

---

## Resumo executivo

**A busca determinística de atividade (S-WM-34/VAL-09) só reconhece nomes do formato usado na seção `== ESPORTES ==` da programação mensal — nunca os da seção `== CURSOS ==`.** Isso significa que qualquer pergunta de acompanhamento sobre um *curso* (não um esporte) nunca é resolvida pelo caminho determinístico (feito exatamente pra esse tipo de caso) e cai direto na busca vetorial de 5 chunks — mais frágil, e que falhou neste caso real.

A informação em si está correta e indexada: o curso "FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS" no Cuca José Walter tem 2 turmas em agosto/2026 (09h-12h e 14h30-17h, quarta e sexta, professor Ulisses Narciso) — confirmado direto no `chunks_documentos`. O bot só não conseguiu achar.

Plano de correção em [`011-cobrir-cursos-busca-deterministica-atividade.md`](011-cobrir-cursos-busca-deterministica-atividade.md) — esforço pequeno, mesmo padrão já usado pra esportes.

---

## 1. A conversa real

Lead "diva patyy1" (`558586516055`), 08/08/2026 09:05-09:17 UTC:

```
Lead: Quais os cursos disponíveis
Bot:  [lista os 5 Cucas com cursos de cada um]
Lead: 3
Bot:  [lista os 4 cursos do Cuca José Walter: Fotografia, Design Gráfico/Photoshop, Introdução a K-POP, Produção Musical Básica]
Lead: Sim
Bot:  Qual curso você gostaria de saber mais detalhes?
Lead: Fotografia
Bot:  No Cuca José Walter, o curso de Fotografia está disponível para você se aprimorar nessa arte incrível!
      Infelizmente, não tenho os horários específicos aqui, mas você pode confirmar diretamente
      na unidade ou pelo Portal da Juventude. Se precisar de mais alguma coisa, é só me chamar! 😊
```

## 2. O dado existe — confirmado direto no banco

`documentos_rag` (id `8fb45f2b-c408-4a4e-b459-294e07ef1e10`, `titulo="Programação Mensal - 8/2026"`, `unidade_cuca="Cuca José Walter"`, `ativo=true`), chunk 0 de 53 (`chunks_documentos`, todos com embedding presente):

```
Programação Mensal - 8/2026 [...] == CURSOS ==
• FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS
Detalhes: Curso: FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS.
Educador: Ulisses Narciso. Vagas: 15. Carga Horária: 21h.
Período: 12/08/2026 28/08/2026 Quarta e Sexta. Horário: 09:00 às 12:00h.
Requisitos: 15 a 29 anos. Ementa: [...]
```
(chunk 4 tem a segunda turma do mesmo curso, 14:30 às 17:00.)

## 3. A causa raiz — `supabase/functions/motor-agente/index.ts`

Pra perguntas de acompanhamento (unidade já definida, sem seleção de menu), o Passo 6 do motor-agente tenta primeiro uma busca determinística por nome de atividade, e só cai pra busca vetorial (limitada a 5 chunks) se ela não achar nada:

```ts
// index.ts:1245-1261
} else if (temUnidadeDefinida && isAgenteProgramacao) {
  // S-WM-34 (VAL-09) - primeiro tenta busca deterministica por nome de atividade (evita o
  // limite de 5 chunks da busca vetorial quando a atividade esta dispersa em muitos chunks
  // nao-contiguos). So cai pra busca vetorial quando a mensagem nao cita nenhuma modalidade
  // conhecida do monthly_program ativo.
  const conteudoAtividade = await buscarAtividadeEspecifica(supabase, unidadeEfetiva as string, textoFinal);
  if (conteudoAtividade) {
    contextRAG = "\n\n--- CONTEXTO (atividade especifica) ---\n" + conteudoAtividade;
  } else {
    const embedding = await gerarEmbedding(textoFinal, openaiKey);
    const { data: chunksPrograma } = await supabase.rpc("buscar_chunks_similares", {
      query_embedding: "[" + embedding.join(",") + "]",
      p_tipos: ["monthly_program", "eventos_pontuais", "FAQ"],
      p_unidade_cuca: unidadeEfetiva,
      p_limite: 5,
    });
    // ...
  }
```

`buscarAtividadeEspecifica` decide se "conhece" uma atividade extraindo os nomes já presentes no texto indexado (`index.ts:842-860`), via `extrairModalidades`:

```ts
// index.ts:289-299
export function extrairModalidades(chunks: string[]): string[] {
  const nomes = new Set<string>();
  const regex = /Modalidade:\s*([^-]+?)\s*-\s*Turma/g;
  for (const conteudo of chunks) {
    for (const match of conteudo.matchAll(regex)) {
      const nome = match[1].trim();
      if (nome) nomes.add(nome);
    }
  }
  return [...nomes];
}
```

O padrão `Modalidade:\s*([^-]+?)\s*-\s*Turma` bate com o formato usado **só** na seção `== ESPORTES ==` (ex.: `"Esporte Modalidade: Natação - Turma 11"`). A seção `== CURSOS ==` usa um formato diferente (`"Curso: <nome>. Educador: <nome>."`, sem a palavra "Modalidade" nem "Turma") — **nunca bate com essa regex**. Resultado: nenhum curso jamais entra na lista de nomes conhecidos, `detectarAtividadeMencionada("Fotografia", modalidades)` nunca encontra nada pra cursos, e a busca cai sempre pra busca vetorial pra qualquer pergunta de acompanhamento sobre curso — precisamente o cenário que a S-WM-34/VAL-09 foi escrita pra evitar (a doc-comment do próprio código, linha 830-834, cita como motivação original um caso de **Natação** — um esporte — espalhada em 14 chunks; nunca foi testado/pensado pro caso equivalente em cursos).

## 4. Por que a busca vetorial (rede de segurança) falhou aqui

Não investigado a fundo neste achado — só confirmado que ela FALHOU no caso real (o bot não usou os dados corretos mesmo com o chunk certo existindo e indexado). Hipótese mais provável: o documento inteiro tem 53 chunks cobrindo cursos + "dia a dia" + esportes, todos com estrutura textual parecida (`Detalhes: ... Vagas: ... Horário: ...`) — num `p_limite: 5`, a similaridade semântica de "Fotografia" sozinho pode perder pro volume de chunks de esportes/outras atividades com estrutura textual repetitiva. Não é o achado principal desta auditoria (a correção da busca determinística já resolve o caso, tornando irrelevante se a busca vetorial teria acertado ou não) — registrado só como contexto, não como algo a investigar separadamente.

## 5. Escopo do impacto

Qualquer pergunta de acompanhamento citando um **curso** por nome (não um esporte) numa unidade específica está sujeita a esse mesmo problema — não é exclusivo de "Fotografia" no José Walter. Não medido quantas vezes isso já aconteceu em produção (não há log específico que isole esse caminho de "busca determinística retornou null pra um curso real"); o Plano 011 sugere adicionar esse log como parte da correção, pra medir daqui pra frente.

## 6. Recomendação

Ver [`011-cobrir-cursos-busca-deterministica-atividade.md`](011-cobrir-cursos-busca-deterministica-atividade.md): estender `extrairModalidades` com um segundo padrão de regex pro formato `Curso: X. Educador:`, reaproveitando toda a lógica de `detectarAtividadeMencionada`/`buscarAtividadeEspecifica` já existente e testada — mesmo espírito da correção original da S-WM-34, só fechando a lacuna que ela deixou.
