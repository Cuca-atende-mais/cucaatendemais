# SQS-61 — Dicas de preenchimento por campo (formulário público)

## Status

InReview

**Prioridade:** Média-Alta (afeta diretamente a qualidade dos currículos que entram na triagem da IA)
**Tipo:** Melhoria / Conteúdo
**Módulo:** Empregabilidade
**Estimativa:** P (baixo risco técnico — é redação de conteúdo estático, não lógica nova)
**Depende de:** SQS-58 (currículo público)
**Épico:** EPIC-EMP-VOL — Empregabilidade em Alto Volume

## Story

**Como** candidato do grande público, sem experiência prévia em montar currículo,
**quero** entender o que escrever em cada campo do formulário,
**para que** eu não fique travado ou preencha errado por falta de orientação.

## Objetivo

Adicionar um texto de ajuda curto sob cada campo do formulário público, em linguagem simples e
direta (não coloquial, não rebuscada) — mesmo padrão visual das 2 dicas que já existem no
formulário interno (`Apresentação`/`Objetivo`), estendido pra todos os campos vazios.

## Contexto

O formulário interno (usado pela equipe treinada do CUCA) só tem 2 dicas curtas hoje
(`Apresentação`, `Objetivo`) — confirmado por leitura de código, não é um padrão já pronto pra
copiar em massa. O público geral que usa o formulário da SQS-58 nunca teve nenhuma orientação —
por isso a prioridade Média-Alta: afeta a qualidade do dado que alimenta o matching da IA
(SQS-57/58 AC8).

## Acceptance Criteria

- [x] AC1 — Cada campo do formulário público (nome, endereço, telefone, email, linkedin,
      portfólio, apresentação, objetivo, e cada campo dentro de experiência/formação/
      curso/habilidade) ganha uma linha de ajuda curta abaixo do campo, mesmo estilo visual
      (`text-xs text-muted-foreground`) já usado no formulário interno
- [x] AC2 — Linguagem simples, direta, respeitosa — sem gíria, sem jargão técnico de RH, frases
      curtas. Sem prometer nada que a CUCA não garanta (ex: não dizer "isso garante a vaga")
- [x] AC3 — Textos **não** aparecem no formulário interno do dashboard — é aditivo só pro público
      (o interno mantém as 2 dicas que já tem, sem mudança)
- [x] AC4 — Antes de aplicar em produção, os textos passam por uma revisão do Junior (rascunho
      completo entregue antes do PR, não só no PR) — **rascunho aprovado pelo Junior em 2026-08-13**

## ⚠️ Análise de impacto — por item

### Item único — conteúdo estático, sem lógica nova

- **Toca:** só `cuca-portal/src/app/empregabilidade/curriculo/page.tsx` — adiciona `<p>` de ajuda
  sob cada `<Label>`/`<Input>`/`<Textarea>` já existente.
- **Depende de:** nada técnico.
- **Impacto real:** zero sobre o formulário interno, zero sobre a lógica de salvamento/validação —
  é só texto visível a mais na tela.
- **De-risk:** nenhum de código. O risco real aqui é de **conteúdo** (texto mal calibrado pode
  confundir mais do que ajudar, ou soar condescendente) — por isso o AC4 exige revisão humana antes
  de ir pro ar, não é uma checagem técnica que resolve isso sozinha.

## Fora de escopo (explícito)

| Item | Motivo |
|---|---|
| Vídeo/áudio explicativo | Não pedido — é texto |
| Traduzir pra outro idioma | Não pedido |
| Dicas no formulário interno do dashboard | Time já treinado — não é o público-alvo desta story |

## Riscos

1. **Fadiga de formulário.** O form público já é longo (Dados Pessoais, Apresentação, Objetivo,
   Experiência, Formação, Cursos, Habilidades). Adicionar uma linha de ajuda **sob cada campo**
   (~15+ linhas de texto novo) deixa a página visualmente mais pesada e pode aumentar abandono em
   vez de ajudar — o oposto do objetivo da story. Mitigação: nenhuma prevista no AC1 tal como
   escrito (texto sempre visível). **Pergunta em aberto pro Junior:** tudo bem manter as dicas
   sempre visíveis (mais simples de implementar e mais acessível — não depende de interação extra
   como hover/tooltip, importante pro público-alvo com pouca familiaridade digital), ou prefere
   algo mais discreto (ex: ícone de ajuda que expande ao tocar)? Recomendo manter sempre visível
   — é mais robusto pro público-alvo — mas fica registrado como decisão de produto, não técnica.
2. **Qualidade do texto em si** — já coberto pelo AC4 (revisão humana obrigatória antes do PR).

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-08-13 | @sm | Criação a partir de pedido do Junior pós-demo com sócio/gestores |
| 2026-08-13 | @po | **Validação: GO (8/10)** — Riscos adicionado nesta validação; achado de fadiga de formulário (dicas sempre visíveis vs. discretas) registrado como decisão de produto em aberto, não bloqueante — @dev confirma com o Junior antes do merge, não antes de começar. Status `Draft` → `Ready` |
| 2026-08-13 | @dev | Rascunho das 23 dicas aprovado pelo Junior (mantidas sempre visíveis, sem tooltip/hover). Implementado: componente `Dica` reutilizável, inserido sob os 23 campos do formulário público (`curriculo/page.tsx`). Formulário interno do dashboard não tocado. `eslint`/`tsc` limpos (mesmos 4 erros pré-existentes do projeto, não relacionados). Status `Ready` → `InReview` |

## File List

- `cuca-portal/src/app/empregabilidade/curriculo/page.tsx` (só este arquivo — aditivo, componente `Dica` local)

## QA Results

### Review em 2026-08-13 — @qa Quinn

**Gate:** PASS

Revisão feita em conjunto com o bugfix real do "ao encerrar não volta" (loop proativo
`_empregabilidade_notify_tick`), a pedido do Junior — mesmo lote, mesma análise. Veredito completo
(7 checks) registrado em [SQS-58, seção "Revalidação em 2026-08-13 (bugfix real do 'não volta' +
SQS-61 juntos)"](SQS-58-Curriculo-Publico-Autoatendimento.md). Resumo aplicado a esta story:

- AC1-AC4 confirmados atendidos por leitura de código (23 `<Dica>` no formulário público,
  formulário interno intacto — grep confirma).
- `eslint` limpo; `tsc --noEmit` sem erro novo.
- Conteúdo estático não tem teste automatizado aplicável — coberto pela revisão humana do texto
  já feita antes da implementação (AC4).
- Sem regressão: único arquivo tocado é `curriculo/page.tsx`.

**Decisão:** PASS, segue pro @devops junto com o bugfix.
