# Plan 011: Estender a busca determinística de atividade para cobrir cursos, não só esportes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts supabase/functions/motor-agente/index.test.ts`
> Se qualquer um dos dois arquivos mudou desde que este plano foi escrito, compare
> os trechos da seção "Current state" abaixo contra o código ao vivo antes de
> prosseguir; se não bater, trate como STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — estende uma função pura já testada (`extrairModalidades`) com um segundo padrão de regex, sem tocar no formato de retorno nem nos chamadores. Não muda comportamento pra esportes (padrão existente intacto), só adiciona cobertura nova pra cursos.
- **Depends on**: none
- **Category**: bug (lacuna de cobertura — feature já existente que não cobre um caso real)
- **Planned at**: commit `bf8b152`, 2026-08-08

## Why this matters

A busca determinística de atividade (S-WM-34/VAL-09, `buscarAtividadeEspecifica` em `supabase/functions/motor-agente/index.ts`) foi criada especificamente para que perguntas de acompanhamento sobre uma atividade específica (ex.: "Fotografia", depois de já estar numa unidade) encontrem a informação certa mesmo quando ela está espalhada em muitos chunks não-contíguos do `monthly_program` — evitando o limite de 5 chunks da busca vetorial (rede de segurança mais fraca).

Ela funciona extraindo, do próprio texto indexado, os nomes de atividade já conhecidos (`extrairModalidades`) e checando se a mensagem do lead cita algum deles (`detectarAtividadeMencionada`). O problema: `extrairModalidades` só reconhece o padrão de texto usado na seção `== ESPORTES ==` da programação mensal (`"Modalidade: X - Turma"`) — a seção `== CURSOS ==` usa um formato diferente (`"Curso: X. Educador: Y."`), que a regex atual nunca casa. Resultado: **nenhum curso jamais é reconhecido pela busca determinística** — toda pergunta de acompanhamento sobre curso cai na busca vetorial fraca, que pode falhar (e falhou, num caso real confirmado: ver `AUDITORIA-busca-atividade-cursos-nao-cobertos-2026-08-08.md`).

Impacto confirmado em produção (08/08/2026): a lead "diva patyy1" perguntou sobre o curso de Fotografia no Cuca José Walter e o bot respondeu "não tenho os horários específicos aqui" — mesmo a informação completa (2 turmas, horários, professor) estando indexada e correta no RAG. Este plano fecha essa lacuna reaproveitando a mesma lógica já testada, só ensinando `extrairModalidades` a também reconhecer o formato de curso.

## Current state

**Nota de drift (2026-08-09):** o código mudou desde que este plano foi escrito. `extrairModalidades` está hoje na linha 325 (não 289), e `buscarAtividadeEspecifica` (hoje ~linha 1066) passou a chamar `resolverAtividadeMencionadaComHistorico(mensagem, modalidades, historico)` em vez de `detectarAtividadeMencionada` direto — usa histórico de conversa agora. A correção proposta (estender só `extrairModalidades`) continua válida em princípio, mas antes de aplicar, confirme que `resolverAtividadeMencionadaComHistorico` delega para `detectarAtividadeMencionada` por baixo (senão o STOP condition de drift deste plano se aplica).

### A função a ser estendida — `supabase/functions/motor-agente/index.ts:325-335` (era 289-299 quando o plano foi escrito)

```ts
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

### O formato de texto real que precisa passar a ser coberto (seção `== CURSOS ==`)

Confirmado direto em produção (`chunks_documentos`, documento "Programação Mensal - 8/2026", `unidade_cuca="Cuca José Walter"`):
```
== CURSOS ==
• FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS
Detalhes: Curso: FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS.
Educador: Ulisses Narciso. Vagas: 15. Carga Horária: 21h. [...]
• Informática Básica - Módulo 5
Detalhes: Curso: Informática Básica - Módulo 5. Educador: Gleison Oliveira. [...]
• Vem pro ritmos
Detalhes: Curso: Vem pro ritmos . Educador: Diego Alexandre . [...]
```
O nome do curso aparece sempre entre `"Curso:"` e o próximo `". Educador:"` — inclusive quando o próprio nome do curso contém dois-pontos (`"FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO..."`), porque o único `"."` antes de `"Educador:"` é o que fecha o nome do curso.

### `detectarAtividadeMencionada` (`index.ts:307-314`) — NÃO precisa mudar

```ts
export function detectarAtividadeMencionada(mensagem: string, modalidades: string[]): string | null {
  const msgNorm = normalizarTexto(mensagem);
  const ordenadas = [...modalidades].sort((a, b) => b.length - a.length);
  for (const modalidade of ordenadas) {
    if (msgNorm.includes(normalizarTexto(modalidade))) return modalidade;
  }
  return null;
}
```
Já funciona genericamente sobre qualquer lista de nomes — uma vez que `extrairModalidades` passe a incluir os nomes de curso na lista, esta função já detecta "Fotografia" contra "FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS" normalmente (substring, case/acento-insensível). Não precisa de nenhuma mudança.

### `buscarAtividadeEspecifica` (`index.ts:~1066`, era 842-860) — NÃO precisa mudar, mas hoje recebe `historico` e delega via `resolverAtividadeMencionadaComHistorico`

Já filtra os chunks pelo nome detectado via `normalizarTexto(c).includes(atividadeNorm)` — genérico o suficiente pra cursos também, uma vez que `atividade` seja um nome de curso real em vez de esporte.

### Repo conventions to match

- Comentário de story/achado no estilo já usado no arquivo (ex.: `// S-WM-34 (VAL-09): ...`) — use uma referência neutra tipo `// Achado 2026-08-08 (AUDITORIA-busca-atividade-cursos-nao-cobertos): ...` já que isto não tem número de story formal ainda.
- Testes: `Deno.test(...)` com `assertEquals`, mesmo padrão de `supabase/functions/motor-agente/index.test.ts:14-28`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rodar os testes do motor-agente | `cd supabase/functions/motor-agente && deno test index.test.ts` | all pass, incluindo os novos |
| Typecheck (se configurado) | `cd supabase/functions/motor-agente && deno check index.ts` | exit 0, sem erros |

(Confirme os comandos exatos de teste/typecheck deste projeto Deno antes de rodar — `deno.json`/`deno.jsonc` na pasta da function, se existir, pode ter scripts próprios; use-os em vez de adivinhar flags.)

## Scope

**In scope**:
- `supabase/functions/motor-agente/index.ts` — só a função `extrairModalidades` (Step 1).
- `supabase/functions/motor-agente/index.test.ts` — novos testes cobrindo o formato de curso (Step 2).

**Out of scope** (não mexer, mesmo que pareça relacionado):
- `detectarAtividadeMencionada`, `buscarAtividadeEspecifica`, `carregarProgramacaoMensal` — já funcionam corretamente uma vez que `extrairModalidades` devolva os nomes certos, não precisam de mudança (ver "Current state" acima).
- A busca vetorial (`buscar_chunks_similares`, `p_limite: 5`) — pode continuar sendo investigada separadamente (ver seção 4 da auditoria) se o achado 2 (por que ela falhou neste caso) for priorizado no futuro; não é escopo deste plano, que resolve o caminho determinístico.
- Qualquer mudança no formato de indexação do `monthly_program` em si (como o texto é gerado/chunkado na importação) — este plano só lê o formato existente, não o altera.

## Git workflow

- Branch: `fix/busca-atividade-cursos`
- Commit único ou por step, conventional-commits style, ex.: `fix(motor-agente): extrairModalidades passa a reconhecer cursos, não só esportes`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Estender `extrairModalidades` com o padrão de curso

Em `supabase/functions/motor-agente/index.ts`, altere a função (linhas 289-299) para reconhecer os dois formatos:

```ts
export function extrairModalidades(chunks: string[]): string[] {
  const nomes = new Set<string>();
  const regexEsporte = /Modalidade:\s*([^-]+?)\s*-\s*Turma/g;
  const regexCurso = /Curso:\s*([^.]+?)\.\s*Educador:/g;
  for (const conteudo of chunks) {
    for (const match of conteudo.matchAll(regexEsporte)) {
      const nome = match[1].trim();
      if (nome) nomes.add(nome);
    }
    for (const match of conteudo.matchAll(regexCurso)) {
      const nome = match[1].trim();
      if (nome) nomes.add(nome);
    }
  }
  return [...nomes];
}
```

Nenhum outro trecho do arquivo muda — `detectarAtividadeMencionada`/`buscarAtividadeEspecifica` consomem a lista devolvida sem saber (nem precisar saber) de qual seção cada nome veio.

**Verify**: `cd supabase/functions/motor-agente && deno check index.ts` → exit 0.

### Step 2: Testes de regressão

Em `supabase/functions/motor-agente/index.test.ts`, adicione (logo após o teste existente de `extrairModalidades`, linha 24-28):

```ts
Deno.test("extrairModalidades: extrai nomes únicos do padrão 'Curso: X. Educador:' (seção CURSOS)", () => {
  const chunks = [
    "• FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS Detalhes: Curso: FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS. Educador: Ulisses Narciso. Vagas: 15.",
    "• Informática Básica - Módulo 5 Detalhes: Curso: Informática Básica - Módulo 5. Educador: Gleison Oliveira. Vagas: 20.",
    "continuação sem match Curso nenhuma aqui",
  ];
  const modalidades = extrairModalidades(chunks);
  assertEquals(
    modalidades.sort(),
    ["FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS", "Informática Básica - Módulo 5"].sort(),
  );
});

Deno.test("extrairModalidades: reconhece cursos e esportes juntos, sem duplicar", () => {
  const chunks = [
    "• Natação Detalhes: Esporte Modalidade: Natação - Turma Turma 11 . Professor: Daniel Reis.",
    "• FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS Detalhes: Curso: FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS. Educador: Ulisses Narciso.",
  ];
  const modalidades = extrairModalidades(chunks);
  assertEquals(
    modalidades.sort(),
    ["FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS", "Natação"].sort(),
  );
});

Deno.test("detectarAtividadeMencionada: detecta curso citado parcialmente (Fotografia) contra o nome completo do curso", () => {
  assertEquals(
    detectarAtividadeMencionada("Fotografia", ["FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS", "Natação"]),
    "FUNDAMENTOS DA FOTOGRAFIA: ILUMINAÇÃO PROFISSIONAL PARA FOTOS INCRÍVEIS",
  );
});
```

O 3º teste usa o caso real da auditoria (mensagem "Fotografia" isolada, exatamente como a lead "diva patyy1" mandou) — é o teste que prova que o bug relatado está corrigido.

**Verify**: `cd supabase/functions/motor-agente && deno test index.test.ts` → all pass, incluindo os 3 testes novos.

### Step 3 (opcional, recomendado): log de diagnóstico quando a busca determinística não encontra nada

Em `buscarAtividadeEspecifica` (`index.ts:842-860`), o `return null` da linha 852 (`if (!atividade) return null;`) hoje é silencioso — não há como medir, depois deste plano, se ainda sobra algum formato de atividade não coberto (ex.: se um futuro tipo de conteúdo além de `CURSOS`/`ESPORTES` aparecer no `monthly_program`). Adicione um log informativo antes do retorno:

```ts
  const atividade = detectarAtividadeMencionada(mensagem, modalidades);
  if (!atividade) {
    console.log("[motor-agente v18] Busca deterministica de atividade: nenhuma modalidade/curso conhecido citado em \"" + mensagem + "\" (unidade=" + unidade + ") - cai pra busca vetorial");
    return null;
  }
```
Isso é só visibilidade (Sentry/logs), não muda comportamento. Se preferir não fazer esse passo agora, pule — não é bloqueante pro Step 1/2, que já fecham o bug relatado.

**Verify**: `cd supabase/functions/motor-agente && deno check index.ts` → exit 0.

## Test plan

- `extrairModalidades: extrai nomes únicos do padrão 'Curso: X. Educador:'` — caso principal (Step 2).
- `extrairModalidades: reconhece cursos e esportes juntos, sem duplicar` — garante que a extensão não quebra o comportamento existente pra esportes.
- `detectarAtividadeMencionada: detecta curso citado parcialmente (Fotografia)...` — reproduz o caso real da auditoria como teste de regressão.
- Suíte completa do arquivo (`deno test index.test.ts`) sem nenhum teste existente mudando de resultado.
- Mutation check: reverta o Step 1 temporariamente (regex de curso removida), confirme que os 3 testes novos falham; restaure, confirme que voltam a passar.

**Verify**: `cd supabase/functions/motor-agente && deno test index.test.ts` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "regexCurso" supabase/functions/motor-agente/index.ts` — 1+ match (Step 1)
- [ ] `cd supabase/functions/motor-agente && deno test index.test.ts` — all pass, incluindo os 3 testes novos
- [ ] Testes existentes de `extrairModalidades`/`detectarAtividadeMencionada` continuam passando sem alteração no próprio teste
- [ ] Nenhum arquivo fora do Scope foi modificado (`git status`)
- [ ] `plans/README.md` — linha de status do Plano 011 atualizada

## STOP conditions

Stop and report back (do not improvise) if:

- O código em `index.ts:289-299`/`index.ts:842-860` não bater com os trechos citados em "Current state" — drift desde que este plano foi escrito.
- Algum nome de curso real em produção tiver mais de um `"."` antes de `"Educador:"` (quebraria a regex `[^.]+?`) — confirme rodando a nova regex contra uma amostra maior de `chunks_documentos` (`select conteudo from chunks_documentos where conteudo ilike '%Curso:%'`) antes de assumir que o padrão cobre 100% dos casos reais; se achar contra-exemplo, ajuste a regex e documente o caso encontrado.
- `deno test`/`deno check` não estiverem disponíveis no ambiente do executor — reporte em vez de pular a verificação.
- Um passo de verificação falhar duas vezes após uma tentativa razoável de correção.

## Maintenance notes

- Se o `monthly_program` ganhar uma terceira seção estruturada além de `== CURSOS ==`/`== ESPORTES ==` no futuro (ex.: `== OFICINAS ==` com formato próprio), ela vai ter o mesmo problema até alguém adicionar um terceiro padrão de regex aqui — não há proteção genérica, é uma lista de padrões conhecidos, não um parser genérico.
- O achado 2 da auditoria (por que a busca vetorial de 5 chunks não achou o conteúdo certo como rede de segurança) continua em aberto — não investigado a fundo, não bloqueia este plano, mas vale revisitar se o mesmo sintoma aparecer em algo que nem a busca determinística cobre (nome de atividade digitado errado, por exemplo).
