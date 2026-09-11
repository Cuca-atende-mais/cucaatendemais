# S-PROG-08 — Lista de programações e etapa Origem no formato do protótipo

**Status:** Ready
**Epic:** Reestruturação da criação de programação
**Origem:** Instrução do Junior (2026-09-10): *"a parte interna do protótipo onde se edita ou cria a
programação já está pronta; o que precisa ser feito e ajustado é a parte anterior a isso, onde se
cria uma programação, pega o card do mês anterior e duplica"*.
**Prioridade:** P0 | **Esforço:** M | **Risco:** BAIXO — camada de navegação e apresentação, não muda gravação.
**Depende de:** S-PROG-01 (grade e ficha, já em produção).
**Substitui:** S-PROG-02 (duplicar mês anterior) e o item 1 da S-PROG-04 (lista em cards), que foram
recortados de novo nesta story. O código já escrito na branch `feat/s-prog-02-duplicar-mes-anterior`
(`lib/programacao/duplicar.ts` + 32 testes, `selecionar-origem.tsx`) **é aproveitado, não descartado** —
foi conferido campo a campo contra o protótipo e está fiel.

## Contexto

O protótipo tem quatro telas (`vLista`, `vNova`, `vEditor`, `vAprov`). A `vEditor` está pronta
(S-PROG-01, em produção). Esta story entrega as duas que vêm antes dela.

Hoje, criar setembro significa preencher 178 atividades do zero. O dado de agosto está gravado em
`atividades_mensais` e é reaproveitável — modalidade, professor, turma, faixa etária, pré-requisitos,
dias, local e ementa não mudam de um mês para o outro. Só data, horário e vagas mudam.

## Design — fidelidade, não reinvenção

O protótipo e o portal **já compartilham os mesmos tokens**: `--radius: 0.625rem`,
`--background: oklch(0.97 0 0)`, `--foreground: oklch(0.20 0 0)`, `--muted: oklch(0.95 0 0)`,
`--muted-foreground: oklch(0.55 0 0)`, `--border: oklch(0.90 0 0)`, fonte `Plus Jakarta Sans`.
Não há decisão estética a tomar — o protótipo foi desenhado a partir do design system do portal.

**Divergência real a resolver:** o portal tem tema escuro (`--background: oklch(0.165 0.025 255)`),
o protótipo é só claro. Todo componente novo desta story precisa funcionar nos dois temas, usando
as variáveis do design system — **nunca cor literal**. Cor literal no protótipo (ex.: `#fff` no
`.pri`) vira `text-primary-foreground`.

## O que precisa ser implementado

### 1. Lista de programações — `vLista`

Substitui a tabela atual da aba Mensal por cards. Especificação vinda do protótipo (`.pc`):

| Elemento | Especificação |
|---|---|
| Grade | `repeat(auto-fill, minmax(268px, 1fr))`, `gap: 14px` |
| Card | `border-radius: 1rem`, borda `--border`, padding 16px, coluna com `gap: 11px` |
| Hover | borda vira `color-mix(in oklch, var(--primary) 45%, var(--border))` |
| Título | mês + ano, 15.5px, peso 700, `letter-spacing: -.01em` |
| Subtítulo | unidade, 12px, `--muted-foreground`, com ícone de local |
| Faixa de números | 3 blocos (Esportes · Cursos · Dia a dia), separados por borda em cima e embaixo (`padding: 11px 0`); número 17px/700, rótulo 10.5px maiúsculo com `letter-spacing: .04em` |
| Badge de status | pílula `border-radius: 99px`, 11px/700 — Rascunho (muted), Pendente (âmbar), Aprovada (verde) |

Ações por status, exatamente como o protótipo:

| Status | Ações |
|---|---|
| `rascunho` | **Continuar edição** (primária) · Ver · Excluir |
| `pendente` | **Analisar** (verde) · Ver · Excluir |
| `aprovado` | **Reabrir para editar** · Ver · Excluir |

> "Continuar edição" só entra quando a S-PROG-09 estiver pronta — é ela que dá destino ao botão.
> Enquanto isso, o card de rascunho mostra apenas Ver e Excluir. **Não rotular um botão com uma
> promessa que a tela de destino não cumpre.**

### 2. Nova programação — etapa Origem (`vNova`)

Uma tela só, como no protótipo — **não** duas etapas separadas. Contém:

- **Unidade** e **Mês de destino** (dois `select` no topo).
- **Grade de meses anteriores** (`.mo`, `repeat(auto-fit, minmax(210px, 1fr))`, `gap: 12px`): cada
  card traz nome do mês, contagem por categoria e um selo de qualidade.
- **Selo de qualidade:** "Dados conferidos" (verde) quando não há linha com problema; "N% precisam
  revisão" (âmbar) quando há; "Importação com falha — indisponível" e card desabilitado
  (`opacity: .5`, sem ponteiro) quando a campanha não tem atividade utilizável.
- **Seleção:** borda `--primary` + anel `box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 18%, transparent)`.
- **Legenda fixa abaixo da grade**, texto literal do protótipo: *"Vem copiado: modalidade,
  professor, turma, faixa etária, pré-requisitos, dias, local e ementa. **Vem em branco: data,
  horário e vagas.**"*
- **Rodapé:** "Começar do zero" (secundária, à esquerda) · "Duplicar e continuar →" (primária,
  à direita, desabilitada até escolher um mês).

### 3. Stepper de 3 etapas

`1 Origem · 2 Editar · 3 Enviar p/ aprovação` — o do protótipo. A etapa "Cabeçalho" atual deixa de
existir como passo próprio: unidade e mês de destino passam a viver dentro de Origem.

O stepper atual de `criar-programacao-view.tsx` é reaproveitado; muda o rótulo e a contagem.

### 4. Contrato de duplicação

`data_atividade`, `hora_inicio`, `hora_fim`, `data_inicio`, `data_fim` e `vagas` **sempre nascem
vazios**, mesmo quando o dado de origem é válido. Já implementado e testado em
`lib/programacao/duplicar.ts` (`atividadeFormDeLinhaExistente`) — reaproveitar sem alteração.

## Acceptance Criteria

1. A aba Mensal mostra cards com mês, unidade, contagem por categoria, badge de status e apenas as
   ações válidas para aquele status.
2. "＋ Nova programação" abre a tela de Origem com unidade, mês de destino e a grade de meses.
3. Mudar unidade ou mês de destino, dentro de Origem, refaz a checagem de campanha já existente
   para aquele par — não só ao avançar de etapa (achado @po: a story só descrevia isso na análise
   de impacto, não como critério verificável).
4. Cada card de mês mostra a contagem real por categoria e o selo de qualidade calculado sobre o
   dado gravado — não um valor fixo.
5. Mês sem atividade utilizável aparece desabilitado e não pode ser escolhido.
6. "Duplicar e continuar" só habilita com um mês escolhido; ao clicar, a grade abre já preenchida,
   com data, horário e vagas em branco em todas as linhas.
7. "Começar do zero" abre a grade vazia, sem exigir escolha de mês.
8. O stepper mostra 3 etapas com os rótulos do protótipo.
9. Lista e Origem renderizam corretamente em tema claro e escuro, e em ≤820px (cards em coluna).

## Análise de impacto

| Item | Toca | Quem consome hoje | Impacto observável | De-risk |
|---|---|---|---|---|
| Lista em cards | `programacao/page.tsx` (aba Mensal) | Único consumidor é a própria tela | Tabela some; quem usava as colunas "Importado em"/"Total atividades" perde a visão tabular — a contagem por categoria substitui com mais informação | Conferir que `total_atividades` continua exibido quando a contagem por categoria vem vazia (campanha sem atividade) |
| Origem + merge do Cabeçalho | `criar-programacao-view.tsx` | `/programacao/criar?unidade=` recebe unidade por query param | A checagem de duplicata (mês/unidade já existente) hoje roda ao sair do passo 1; precisa passar a rodar dentro de Origem, antes de duplicar | Rodar a checagem ao mudar unidade **ou** mês de destino, não só ao avançar |
| Consulta dos meses candidatos | `atividades_mensais` (leitura) | — | Consulta nova; volume ~150 linhas × 4 meses | Selecionar só as colunas necessárias para o selo, sem `descricao` |
| Contagem por categoria na lista | `atividades_mensais` (leitura) | — | Uma consulta a mais ao abrir a aba | Já implementado no recorte anterior sem RPC; manter |

## Fora de escopo

Reabrir rascunho para edição (S-PROG-09). Conversão para RAG (S-PROG-10). Exportação (S-PROG-05).

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-10 | @dev (Dex) | Story rascunhada a pedido do Junior, recortando S-PROG-02 + item 1 da S-PROG-04 contra o protótipo aprovado |
| 2026-09-10 | @po (Pax) | Validado GO (9/10). AC3 adicionado (checagem de duplicata dentro de Origem, achado na análise de impacto mas ausente do AC). Status Draft → Ready |
