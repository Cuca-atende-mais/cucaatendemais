# S-PROG-08 — Lista de programações e etapa Origem no formato do protótipo

**Status:** InReview
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

## Dev Agent Record

### Itens 1, 2 e 3 — Lista em cards, etapa Origem e stepper de 3 (2026-09-11, @dev/Dex) — **concluídos**

Autorizado pelo Junior item a item ("Segue com a S-PROG-08" → "segue com o item 2" → "continua
com o item 3"). Implementados os 3 juntos porque item 3 (stepper) é consequência direta e
inseparável do item 2 (fundir Cabeçalho em Origem elimina uma etapa, o stepper reflete isso —
não há como fazer um sem o outro). Item 4 (contrato de duplicação) já estava pronto desde a
S-PROG-02, reaproveitado sem alteração, como a story já previa.

**Item 1 — Lista em cards (`programacao/page.tsx`):**
- Grid `repeat(auto-fill, minmax(268px, 1fr))` gap 14px, card com hover
  `color-mix(in oklch, var(--primary) 45%, var(--border))`, título 15.5px/700, faixa de números
  (3 blocos: Esportes · Cursos · Dia a dia, com borda superior/inferior) e pílula de status
  (rascunho/pendente/aprovado) — tudo fiel ao protótipo (`.cards`/`.pc`/`.stats`/`.bdg`).
  **Decisão de escopo:** só as 3 categorias citadas literalmente na story aparecem na faixa de
  números — ESPECIAIS não vira um 4º bloco (o protótipo não previu isso; evita inventar).
- "Continuar edição" (rascunho) agora tem destino real: `/programacao/criar?campanhaId=${id}`
  — antes dizia "Abrir rascunho" e ia pra tela só-leitura, porque a S-PROG-09 (que dá esse
  destino) ainda não existia; ela foi mergeada antes desta story, então o rótulo e a rota podem
  virar os definitivos do protótipo.
- Pílula de status é uma função nova (`getStatusPillMensal`), separada do `getStatusBadge`
  genérico (compartilhado com evento pontual, que usa `bg-amber-50` fixo — quebraria no tema
  escuro); a nova usa só tokens do design system.

**Item 2 — Etapa Origem (`criar-programacao-view.tsx` + `selecionar-origem.tsx`):**
- Cabeçalho (unidade/mês/ano) fundido na tela de Origem, num único passo — não é mais uma etapa
  própria. A checagem de campanha já existente (AC3) passou de "só ao clicar Próximo" pra um
  `useEffect` que refaz a cada mudança de unidade **ou** mês/ano, em tempo real.
- `selecionar-origem.tsx`: grid `repeat(auto-fit, minmax(210px, 1fr))` gap 12px; card com estado
  selecionado (`box-shadow color-mix(...) 18%`), hover, e um 3º estado **novo**: `indisponivel`
  (AC5) — antes, campanha sem atividade utilizável era simplesmente omitida da grade (o mês
  "sumia" sem explicação); agora aparece desabilitada (`opacity-50 pointer-events-none`), com o
  selo "Importação com falha — indisponível", sem `role`/`tabIndex`/`onClick` (não é alvo de
  clique nem de navegação por teclado).
- Legenda fixa abaixo da grade com o texto literal da story: "Vem copiado: modalidade, professor,
  turma, faixa etária, pré-requisitos, dias, local e ementa. Vem em branco: data, horário e
  vagas." — mantive também a frase sobre texto de exemplo não copiado (não estava no texto
  literal exigido, mas é informação real e útil; não contradiz o AC, só complementa).
- Rodapé reestruturado: "Começar do zero" virou botão secundário ao lado de "Duplicar e
  continuar" (antes era uma caixa tracejada grande acima da grade, fora do padrão do protótipo).

**Item 3 — Stepper de 3 etapas:** rótulos trocados para "Origem · Editar · Enviar p/ aprovação",
contagem de 4 pra 3 (Cabeçalho deixou de existir como passo). Mesmo componente de stepper
reaproveitado, só o array de labels mudou — exatamente como a story previa.

### Correção do achado do @qa — seleção de origem sobrevivia à troca de unidade (2026-09-11, @dev/Dex)

`selecionar-origem.tsx`: `setSelecionada(null)` adicionado no início de `carregar()` (mesmo
`useEffect` que já depende de `[unidade]`) — a cada troca de unidade, a seleção anterior é
descartada junto com a lista antiga de campanhas candidatas. Fecha o cenário em que "Duplicar e
continuar" ficava habilitado apontando pra um id de outra unidade, sem efeito nenhum ao clicar.

**Verificação:** `tsc --noEmit` limpo, `eslint` sem erro novo, `vitest run src/lib/programacao`
151/151 (reconfirmado), `npm run build` verde.

**Achado de ambiente, não de código:** `npm run build` falhou duas vezes por motivos alheios ao
código — um `node_modules/lucide-react` corrompido (fora sanado com reinstalação limpa via
`npm ci`, resolveu esse E outros pacotes truncados) e uma falha transitória de rede ao buscar
a fonte do Google Fonts (`next/font/google`) durante o build — resolvida numa nova tentativa.
Nenhum dos dois tinha relação com as mudanças desta story; documentado aqui porque consumiu
tempo real de verificação.

**Verificação executada:**
- `vitest run src/lib/programacao`: 151/151 (sem teste novo — mudança é de apresentação/UI,
  sem lógica pura nova extraível pra `lib/`; a lógica de duplicação/selo já testada em
  `duplicar.test.ts` não mudou).
- `tsc --noEmit`: limpo nos arquivos tocados.
- `eslint`: sem erro novo (mesmo único erro pré-existente, `criar-programacao-view.tsx` linha 91,
  `campanhaExistente: any`, não tocado).
- `npm run build`: verde, 129 rotas geradas, depois do `npm ci` (reinstalação limpa).

**Não verificado:** navegador — regra do projeto (`qa-testes-sem-navegador-ao-vivo.md`) proíbe
sem autorização explícita. Fidelidade visual ao protótipo foi conferida por leitura direta do
CSS do protótipo (`docs/programacao-manual/prototipo-programacao.html`) linha a linha, convertido
pra utilitário Tailwind — não por captura de tela comparada lado a lado.

## Fora de escopo

Reabrir rascunho para edição (S-PROG-09, já pronta e integrada aqui via "Continuar edição").
Conversão para RAG (S-PROG-10). Exportação (S-PROG-05).

## File List

| Arquivo | Mudança |
|---|---|
| `cuca-portal/src/app/(dashboard)/programacao/page.tsx` | item 1 — cards da aba Mensal, pílula de status nova, "Continuar edição" com destino real |
| `cuca-portal/src/components/programacao/criar-programacao-view.tsx` | itens 2/3 — Cabeçalho fundido em Origem, checagem de duplicata em tempo real, stepper de 3 etapas |
| `cuca-portal/src/components/programacao/selecionar-origem.tsx` | item 2 — grid/card fiéis ao protótipo, estado indisponível, legenda, rodapé reestruturado; correção do achado @qa (reset de `selecionada` ao trocar unidade) |

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-10 | @dev (Dex) | Story rascunhada a pedido do Junior, recortando S-PROG-02 + item 1 da S-PROG-04 contra o protótipo aprovado |
| 2026-09-10 | @po (Pax) | Validado GO (9/10). AC3 adicionado (checagem de duplicata dentro de Origem, achado na análise de impacto mas ausente do AC). Status Draft → Ready |
| 2026-09-11 | @dev (Dex) | Itens 1, 2 e 3 implementados (item 4 já pronto desde a S-PROG-02, reaproveitado). `vitest` 151/151, `tsc`/`eslint` limpos, `npm run build` verde. Status Ready → InProgress |
| 2026-09-11 | @qa (Quinn) | Revisão completa (`*review`). Veredito **CONCERNS** — achado de UI em `selecionar-origem.tsx` (seleção de origem não reseta ao trocar unidade, ver QA Results). Status permanece InProgress |
| 2026-09-11 | @dev (Dex) | Achado do @qa corrigido: `selecionada` resetada ao trocar unidade em `selecionar-origem.tsx`. `vitest` 151/151, `tsc`/`eslint` limpos, `npm run build` verde. Pronto para nova revisão do @qa |
| 2026-09-11 | @qa (Quinn) | Nova revisão (`*review`). Achado **CONFIRMADO CORRIGIDO** — `setSelecionada(null)` roda antes de qualquer `await`, elimina a janela de estado inconsistente. Reproduzi 151/151 testes, `tsc`/`eslint` de forma independente. Veredito **PASS**. Status InProgress → InReview |

## QA Results

### Rodada 2 — @qa (Quinn) · 2026-09-11 · Veredito: **PASS**

Achado da Rodada 1 **confirmado corrigido**: `setSelecionada(null)` roda como primeira instrução
de `carregar()`, antes de qualquer `await` — a seleção antiga é descartada no mesmo instante em
que `unidade` muda, sem janela de estado inconsistente entre o reset e a chegada da lista nova.

Reproduzi de forma independente: `tsc --noEmit` limpo, `eslint` sem erro novo (os 4 erros restantes
são os mesmos pré-existentes de sempre, em linhas não tocadas), `vitest run src/lib/programacao`
151/151.

**Decisão:** story pronta para seguir ao @devops quando o Junior autorizar. Status InProgress →
InReview.

---

### Rodada 1 — @qa (Quinn) · 2026-09-11 · Veredito: CONCERNS (aprovável, com correção recomendada antes do push)

### Achado — seleção de origem sobrevive à troca de unidade (`selecionar-origem.tsx`)

**O quê:** `selecionada` (id da campanha de origem escolhida) nunca é resetada quando a prop
`unidade` muda. O `useEffect` que recarrega `campanhas` depende só de `[unidade]` e nunca chama
`setSelecionada(null)`.

**Cenário concreto:** usuário está em Origem, escolhe Cuca Mondubim, seleciona o card "Agosto
2026" (`selecionada = id-de-agosto-mondubim`). Sem sair da tela, troca a Unidade pra Cuca Barra.
A grade recarrega com os meses de Barra — mas `selecionada` continua apontando pro id de
Mondubim, que não existe mais na lista atual. O botão "Duplicar e continuar" (linha 214,
`disabled={!selecionada}`) **continua habilitado**, porque só checa se `selecionada` é truthy, não
se ainda existe na lista corrente. Ao clicar, `handleDuplicar` (linha 115) faz
`campanhas.find(c => c.id === selecionada)`, não encontra nada, e retorna sem fazer nada — clique
silenciosamente sem efeito, sem nenhum feedback pro usuário.

**Por que não é FAIL:** não duplica dado da unidade errada (o `find` falha e para — comportamento
seguro por acidente, não por design) nem corrompe nada gravado. É um bug de interação: o botão
mente sobre estar pronto pra agir. Toca o espírito do AC6 ("'Duplicar e continuar' só habilita com
um mês escolhido") — tecnicamente um mês FOI escolhido, só que não é mais válido pro contexto
atual.

**Correção recomendada (1 linha):** resetar `selecionada` pra `null` junto com `setCampanhas` toda
vez que `unidade` mudar, dentro do mesmo `useEffect` (`carregar()`, início ou fim da função).

### Demais checks

1. **Code review** — código limpo, fiel ao protótipo linha a linha (conferi o CSS de
   `docs/programacao-manual/prototipo-programacao.html` contra as classes Tailwind arbitrárias
   usadas — `color-mix`, `grid-template-columns`, `border-radius: var(--radius)` — e testei a
   compilação real com `@tailwindcss/cli` pra confirmar que nenhuma delas é descartada
   silenciosamente pelo parser de arbitrary value; todas geram o CSS esperado).
2. **Testes** — `vitest run src/lib/programacao`: 151/151, reproduzido de forma independente.
   Sem teste novo pro achado acima nem pro resto da mudança (é UI de componente, sem suíte de
   componente no projeto — mesmo padrão aceito na S-PROG-09).
3. **Acceptance Criteria** — AC1, AC2, AC4, AC5, AC7, AC8 verificados por leitura de código.
   **AC3** verificado: `useEffect` novo em `criar-programacao-view.tsx` refaz a checagem a cada
   mudança de unidade/mês/ano, não só ao avançar — correto. **AC6** parcialmente comprometido pelo
   achado acima (habilita com mês escolhido, mas não invalida a escolha ao trocar de unidade).
   AC9 (tema/mobile) verificado por leitura — grids `auto-fill`/`auto-fit` colapsam pra 1 coluna
   sem precisar de breakpoint manual; sem cor literal em nenhum componente novo.
4. **Regressão** — `/api/programacao/importar`, `/api/programacao/status` não tocados;
   `duplicar.ts`/`duplicar.test.ts` inalterados (32 testes originais continuam intocados).
5. **Performance** — sem mudança de padrão de consulta (mesmas queries de antes, só apresentação).
6. **Segurança** — sem superfície nova (camada de apresentação, nenhuma rota/função nova).
7. **Documentação** — Dev Agent Record, File List e Change Log completos e precisos.

### Concerns não-bloqueantes

- "Excluir" só aparece pra `DEVELOPER_EMAILS` (pré-existente, não desta story) — a tabela de
  ações da story lista Excluir como ação padrão pra todo status; usuário comum nunca vê essa
  opção. Não é regressão, só uma divergência entre o texto da story e o comportamento real de
  permissão, que já existia antes.
