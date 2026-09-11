# S-PROG-11 — Fechar o editor: preencher abaixo, legenda e painel de RAG

**Status:** Ready for Review
**Epic:** Reestruturação da criação de programação
**Origem:** Itens do protótipo que a S-PROG-01 previa e não entregou, encontrados no levantamento de
2026-09-10. A S-PROG-01 está `Done` e **em produção** sem eles.
**Prioridade:** P1 | **Esforço:** S | **Risco:** BAIXO — componente isolado, sem efeito em gravação.
**Depende de:** nada. Pode andar em paralelo com S-PROG-08/09/10.

## Contexto

A S-PROG-01, item 1, define a barra de ferramentas da grade com **quatro** ações:

> "＋ nova linha, ⧉ duplicar linha, **↓ preencher abaixo** e 🗑 excluir linha"

Foram entregues três. "Preencher abaixo" não existe em nenhuma branch do projeto — verificado por
busca em todo `cuca-portal/src` e nas branches das stories. A story foi marcada `Done` com QA PASS,
mergeada e implantada assim.

É a ferramenta que mais reduz digitação: numa programação de 126 linhas de esportes, campos como
`sexo`, `dias da semana` e `faixa etária` se repetem em blocos longos. Sem ela, cada célula é
digitada uma vez.

## O que precisa ser implementado

### 1. ↓ Preencher abaixo

Com uma linha selecionada, propaga o valor de uma coluna para **todas as linhas abaixo dela, na aba
da categoria atual**.

Decisões de comportamento (não estavam na S-PROG-01, ficam definidas aqui):

- Propaga **só a coluna do campo em foco** — não a linha inteira. Preencher a linha inteira criaria
  atividades duplicadas, que o painel de revisão marcaria como erro na sequência.
- Sobrescreve valor já preenchido? **Não.** Preenche apenas células vazias abaixo. Sobrescrever
  destrói trabalho feito e não tem desfazer nesta tela.
- Nunca propaga os campos que a duplicação zera de propósito (`data`, `hora_inicio`, `hora_fim`,
  `vagas`) — são justamente os que variam linha a linha. Mesmo contrato da S-PROG-08.
- Confirmação: nenhuma, mas mostra em toast quantas linhas foram preenchidas ("preenchido em 14
  linhas"), para o efeito ser visível.

A lógica de decisão sai para `lib/programacao/` como função pura, testável, no mesmo padrão dos
outros módulos (`mascaras`, `revisao`, `duplicar`).

### 2. Legenda de cores da grade

O protótipo tem legenda fixa abaixo da tabela:

- amarelo (`--warnbg` / `--warnbr`) = **falta preencher**
- vermelho (`color-mix(in oklch, var(--danger) 22%, transparent)`) = **inválido**
- e a frase: *"Textos longos abrem em painel próprio — clique no campo"*

A grade já pinta as células nesses estados; falta o que explica o que a cor quer dizer. Precisa
funcionar nos dois temas — usar as variáveis do design system, nunca cor literal.

### 3. Painel "Texto enviado ao RAG" (modo desenvolvedor)

O protótipo tem um switch "modo desenvolvedor" que revela dois blocos monoespaçados: o texto que vai
para o RAG e o registro gravado (`metadata`).

Não é enfeite: é a única forma de conferir, sem abrir o banco, se a grade está produzindo o mesmo
texto que a planilha produzia — que é exatamente o que a S-PROG-10 depende. Serve de ferramenta de
verificação para as próximas stories.

Alimentado por `montarAtividadePayload` (`lib/programacao/payload.ts`), que já devolve `descricao` e
`metadata` prontos. Visível apenas com o switch ligado, desligado por padrão.

### 4. Dívida de rastro: toast apontando para botão que não existe

`criar-programacao-view.tsx` mostra, ao salvar: *"Programação salva como rascunho! Clique em 'Ver
Atividades' para abrir."* Esse botão foi renomeado e não existe mais com esse nome. **Está em
produção.** Corrigir para o rótulo real da tela de destino.

## Acceptance Criteria

1. Com uma linha selecionada e um campo em foco, "Preencher abaixo" preenche as células vazias
   daquela coluna nas linhas seguintes, só na aba atual.
2. Células já preenchidas abaixo não são sobrescritas.
3. Data, horários e vagas nunca são propagados, mesmo com o campo em foco sendo um deles.
4. O toast informa quantas linhas foram preenchidas.
5. A lógica está em função pura sob `lib/programacao/`, com testes cobrindo: coluna vazia, coluna
   parcialmente preenchida, última linha (nada abaixo), e campo bloqueado.
6. A legenda aparece abaixo da grade e é legível nos temas claro e escuro.
7. O painel de RAG aparece só com o modo desenvolvedor ligado e mostra `descricao` e `metadata` da
   linha selecionada.
8. Nenhum texto de interface cita rótulo de botão inexistente.

## Análise de impacto

| Item | Toca | Quem consome hoje | Impacto observável | De-risk |
|---|---|---|---|---|
| Preencher abaixo | `grade-atividades.tsx` + módulo novo em `lib/programacao/` | Só a própria grade | Nenhum caminho existente muda; é ação nova | Função pura testada isoladamente antes de ligar na UI |
| Legenda | `grade-atividades.tsx` | — | Só apresentação; ocupa altura no rodapé da grade, checar no mobile (≤820px, onde a tabela vira cartões) | Conferir nos dois temas e nos dois layouts |
| Painel de RAG | `criar-programacao-view.tsx` | `montarAtividadePayload` (leitura) | Expõe o texto que vai ao RAG na interface — sem dado pessoal envolvido, é conteúdo público de programação | Desligado por padrão |
| Toast | `criar-programacao-view.tsx` | Usuário final | Corrige instrução errada que já está em produção | Conferir contra o rótulo real depois da S-PROG-08 |

## Dev Agent Record

### Item 1 — ↓ Preencher abaixo (2026-09-11, @dev/Dex) — **concluído**

Autorizado pelo Junior ("seguir" a sequência, sequência de stories confirmada pelo @devops).
Implementado só o item 1. Itens 2 (legenda), 3 (painel de RAG) e 4 (toast com rótulo errado)
**não foram feitos** — aguardando autorização, mesmo padrão de item por item das stories
anteriores.

**Decisão de escopo, registrada explicitamente:** a story bloqueia só 4 campos
(`data_atividade`, `hora_inicio`, `hora_fim`, `vagas`) — não bloqueei `data_inicio_raw`/
`data_fim_raw` (datas de CURSOS) nem `dias_raw`/`dia_semana`/`data_real`, porque a story não os
cita e cursos do mesmo bloco costumam compartilhar data de início/fim. Se essa leitura estiver
errada, é ajuste de 1 linha na lista `CAMPOS_BLOQUEADOS`.

**O que foi implementado:**
- `lib/programacao/preencher-abaixo.ts` (novo) — `preencherColunaAbaixo(atividades, tempIdOrigem,
  colunaKey, colunaRoot)`, função pura: propaga o valor da célula de origem só pras células vazias
  abaixo, na mesma categoria, nunca sobrescreve, nunca propaga os 4 campos bloqueados. Caso
  especial: coluna "Dias" (`dias_raw`, array) copia junto o espelho em texto `dias_semana` — sem
  isso ficaria dessincronizado até o próximo toggle manual (mesmo padrão que `toggleDia` já usa).
  9 testes: coluna vazia, parcialmente preenchida, última linha, os 4 campos bloqueados, origem
  vazia (nada a propagar), categoria diferente não é tocada, linha acima da origem não é tocada,
  array `dias_raw` com espelho, `tempIdOrigem` inexistente.
- `grade-atividades.tsx` — novo estado `colunaFoco`, atualizado via `onFoco` em toda célula
  (input, Select, Popover de dias, botão de texto longo). Botão "Preencher abaixo" na toolbar,
  ao lado de Duplicar/Excluir — só aparece com linha selecionada **e** campo em foco válido (não
  bloqueado, pertence à categoria atual). Toast informa quantas linhas foram preenchidas (ou que
  não havia nenhuma vazia).

**Verificação executada:**
- `vitest run src/lib/programacao`: 160/160 (9 novos).
- `tsc --noEmit`: limpo.
- `eslint`: 0 erros, 0 avisos nos arquivos tocados.
- `npm run build`: verde.

**Não verificado:** navegador — regra do projeto (`qa-testes-sem-navegador-ao-vivo.md`) proíbe
sem autorização explícita.

### Item 2 — Legenda de cores da grade (2026-09-11, @dev/Dex) — **concluído**

Autorizado pelo Junior ("@dev segui para o item 2"). Item implementado com escopo reduzido, por
decisão explícita do Junior — ver achado abaixo.

**Achado de impacto, levantado antes de codar:** a story assume "a grade já pinta as células
nesses estados [amarelo/vermelho]; falta só a legenda". Não é bem assim — conferido no código:
amarelo "falta preencher" só existe hoje nos campos de texto longo (Ementa/Informações, quando
vazios); os outros tipos de campo (Input, Select, Popover de dias) não têm nenhuma pintura visual
quando vazios, mesmo marcados `obrigatorio: true`. Vermelho "inválido" não existe em nenhuma
célula da grade hoje — existe só como distinção de tipo (`"falta"` vs `"erro"`) dentro de
`calcularProblemas` (painel de revisão), nunca pintado célula a célula.

Levei isso ao Junior antes de codar (duas opções: só a legenda literal, ou legenda + pintar as
células de verdade usando `calcularProblemas`). **Decisão do Junior: só a legenda.** Implementado
exatamente isso — a pintura de célula por obrigatoriedade/validade, se vier a ser feita, é item
separado, fora desta story.

**O que foi implementado:**
- `grade-atividades.tsx` — legenda fixa abaixo da grade (só quando há pelo menos 1 linha na
  categoria atual): pílula amarela "Falta preencher" usando `amber-500/10` + `amber-500/40`
  (mesmos tons que o botão de texto longo já usa quando vazio — não é uma cor nova, é reaproveito
  do que já existe); pílula vermelha "Inválido" usando o token `destructive` do design system
  (`bg-destructive/22` + `border-destructive/40` — mesmo valor OKLCH do `--danger` do protótipo,
  já existe em `globals.css` pros dois temas, nenhuma cor literal); frase "Textos longos abrem em
  painel próprio — clique no campo", texto exato da story.

**Verificação executada:**
- Testei a compilação real do `bg-destructive/22` com o CLI do Tailwind (não assumi que o
  modificador de opacidade funciona) — confirmado que gera `color-mix(in oklab, var(--destructive)
  22%, transparent)`, exatamente o efeito do protótipo.
- `vitest run src/lib/programacao`: 160/160 (inalterado — item é só apresentação, sem lógica nova).
- `tsc --noEmit`: limpo. `eslint`: 0 erros, 0 avisos.
- `npm run build`: verde.

**Não verificado:** navegador (tema claro/escuro renderizado de verdade) — mesma restrição de
sempre. Os dois tokens (`amber-500`, `destructive`) já são usados em outros lugares do portal nos
dois temas, então o risco de quebra visual é baixo, mas não é o mesmo que ver renderizado.

### Item 3 — Painel "Texto enviado ao RAG" / modo desenvolvedor (2026-09-11, @dev/Dex) — **concluído**

Autorizado pelo Junior ("@dev segui para o item 3").

**O que foi implementado:**
- `grade-atividades.tsx` — nova prop opcional `onLinhaAtivaChange?: (atividade: AtividadeForm |
  null) => void`. Novo `useEffect` que dispara esse callback sempre que `linhaAtiva` ou o conteúdo
  de `atividades` muda, repassando a atividade correspondente (ou `null` se nada selecionado) —
  padrão de "levantar estado mínimo via callback" em vez de tornar o componente totalmente
  controlado (que exigiria um refactor maior, fora do escopo desta story). Não expõe estado novo
  pra fora além do necessário: a grade continua dona de `linhaAtiva`.
- `criar-programacao-view.tsx` — novo estado `modoDesenvolvedor` (switch, padrão desligado),
  `atividadeSelecionadaGrade` (alimentado por `onLinhaAtivaChange`) e `payloadRagSelecionado`
  (computado via `montarAtividadePayload(atividadeSelecionadaGrade, unidadeSel)`, já existente da
  S-PROG-03). Abaixo da grade: switch "Modo desenvolvedor — texto enviado ao RAG"; ligado, mostra
  painel com dois blocos monoespaçados (`descricao` e `JSON.stringify(metadata, null, 2)`) da
  linha selecionada, ou mensagem de placeholder quando nada está selecionado. Reusa o componente
  `Switch` já existente em `components/ui/switch.tsx` (shadcn, não modificado).

**Verificação executada:**
- `tsc --noEmit` em `grade-atividades.tsx` e `criar-programacao-view.tsx`: limpo.
- `eslint` nos dois arquivos: só o único erro `any` pré-existente na linha 92 de
  `criar-programacao-view.tsx` (confirmado pré-existente em revisões anteriores desta story, não
  introduzido por este item).
- `vitest run src/lib/programacao`: 160/160, inalterado (item não introduziu lógica pura nova —
  só encanamento de estado/UI, reaproveitando `montarAtividadePayload` já testado na S-PROG-03).
- `npm run build`: verde (exit 0), rotas geradas normalmente.

**Não verificado:** navegador (troca real do switch, atualização ao vivo do painel enquanto edita)
— mesma restrição de sempre (`qa-testes-sem-navegador-ao-vivo.md`), sem autorização explícita.

### Item 4 — Dívida de rastro: toast apontando para botão que não existe (2026-09-11, @dev/Dex) — **concluído**

Autorizado pelo Junior ("@dev segui para o item 4").

**O que foi implementado:**
- `criar-programacao-view.tsx` — o toast de sucesso ao salvar rascunho citava "Clique em 'Ver
  Atividades' para abrir", botão que não existe mais. Rastreei o destino real: depois de salvar,
  `onSuccess()` volta pra lista de programações (`programacao/page.tsx`), onde uma campanha com
  `status === "rascunho"` mostra o botão **"Continuar edição"** (`router.push` pra
  `/programacao/criar?campanhaId=...`). Corrigido o texto do toast para citar esse rótulo real.

**Achado adicional, fora do escopo desta story (não corrigido aqui):** existe uma segunda
referência ao mesmo botão inexistente, em outro arquivo —
`app/(dashboard)/programacao/mensal/[id]/page.tsx:130`, no toast de erro de
`executarTransicao`: *"Não é possível enviar: N ponto(s) a revisar. Abra 'Ver Atividades' e
corrija antes."* Essa página (`mensal/[id]`) também não tem nenhuma aba ou botão chamado "Ver
Atividades" hoje. A story S-PROG-11 cita só o toast de `criar-programacao-view.tsx` no item 4 —
não ampliei o escopo sem autorização. Fica registrado aqui para decisão do Junior (item novo ou
correção avulsa).

**Verificação executada:**
- `tsc --noEmit` em `criar-programacao-view.tsx`: limpo.
- `eslint`: só o `any` pré-existente na linha 92 (mesmo de sempre, não introduzido aqui).
- `vitest run src/lib/programacao`: 160/160, inalterado (mudança é só texto de string).
- `npm run build`: verde (exit 0).

**Não verificado:** navegador (fluxo real de salvar → voltar pra lista → ver o toast) — mesma
restrição de sempre, sem autorização explícita.

### Item 4 (ajuste pós-QA) — segunda referência ao botão "Ver Atividades" (2026-09-11, @dev/Dex) — **concluído**

Autorizado pelo Junior ("@dev ajustes... achados não bloqueantes do botão Ver atividades"),
depois do achado adicional registrado pelo @qa acima.

**O que foi implementado:**
- `app/(dashboard)/programacao/mensal/[id]/page.tsx:130` — o toast de erro de
  `executarTransicao` mandava "Abra 'Ver Atividades' e corrija antes". Investigando o call-site:
  `executarTransicao` só é chamado de dentro **desta própria página**
  (`handleFinalizarProgramacao`, `handleAprovarProgramacao`, `handleConfirmarDevolucao`,
  `handleConfirmarReabrir`) — ou seja, quando o toast aparece, o usuário já está na tela de
  atividades (a grade de cards logo abaixo), não existe uma tela separada "Ver Atividades" pra
  abrir. Diferente do item 4 original (onde havia um destino real e só o rótulo estava errado),
  aqui a instrução de navegação inteira deixou de fazer sentido — reescrevi pra apontar pro que
  já está na tela ("Corrija nas atividades abaixo") em vez de inventar/adivinhar um rótulo de
  botão.

**Verificação executada:**
- `tsc --noEmit`: limpo na linha tocada (erros de `any`/hook-deps no arquivo são pré-existentes,
  em linhas 55/75/108, não relacionados a esta mudança).
- `eslint`: mesmos 2 erros + 1 warning pré-existentes, nenhum novo.
- `vitest run src/lib/programacao`: 160/160, inalterado.
- `npm run build`: verde (exit 0).

**Não verificado:** navegador (ver o toast de verdade disparando ao tentar finalizar com
pendências) — mesma restrição de sempre, sem autorização explícita.

**Pendente de decisão do Junior — não é algo que eu possa resolver sozinho:** o veredito do @qa
marcou como CONCERNS (não bloqueante) a falta de verificação em navegador do AC6 (legenda
legível nos dois temas) e do fluxo completo do painel de RAG/toast. Isso não é um defeito de
código pra eu "consertar" — é uma checagem que só existe abrindo o navegador, e a regra do
projeto (`qa-testes-sem-navegador-ao-vivo.md`, NON-NEGOTIABLE) proíbe isso sem autorização
explícita do Junior a cada vez. Fica em aberto: se o Junior quiser essa verificação visual feita
agora, preciso que ele autorize explicitamente abrir o navegador; senão, os CONCERNS ficam
documentados como risco aceito (baixo, pelos motivos já registrados na revisão do @qa) e a story
segue pra @devops assim mesmo.

## Fora de escopo

Reescrever o painel de revisão (S-PROG-01, mantido). Undo/redo na grade. Preencher abaixo entre
categorias diferentes.

## Nota de processo

A S-PROG-01 volta de `Done` para `InProgress` nesta validação (achado @po: o campo Status dela
afirmava conclusão sem o item 1 — corrigido diretamente, não é uma opção condicional).

## File List

| Arquivo | Mudança |
|---|---|
| `cuca-portal/src/lib/programacao/preencher-abaixo.ts` | **novo** — função pura, item 1 |
| `cuca-portal/src/lib/programacao/preencher-abaixo.test.ts` | **novo** — 9 testes |
| `cuca-portal/src/components/programacao/grade-atividades.tsx` | item 1 — estado de foco de coluna, botão "Preencher abaixo", toast; item 2 — legenda de cores; item 3 — prop `onLinhaAtivaChange` + `useEffect` de notificação |
| `cuca-portal/src/components/programacao/criar-programacao-view.tsx` | item 3 — switch "modo desenvolvedor", painel de RAG (`descricao`/`metadata` via `montarAtividadePayload`); item 4 — texto do toast de rascunho corrigido |
| `cuca-portal/src/app/(dashboard)/programacao/mensal/[id]/page.tsx` | item 4 (ajuste pós-QA) — segunda referência ao botão "Ver Atividades" corrigida |

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-10 | @dev (Dex) | Story rascunhada a partir dos itens do protótipo ausentes na S-PROG-01 |
| 2026-09-10 | @po (Pax) | Validado GO (8/10). Seção "Fora de escopo" ausente, adicionada. Status Draft → Ready |
| 2026-09-11 | @dev (Dex) | Item 1 (Preencher abaixo) implementado. `vitest` 160/160, `tsc`/`eslint` limpos, `npm run build` verde. Status Ready → InProgress. Itens 2-4 pendentes, aguardando autorização |
| 2026-09-11 | @dev (Dex) | Item 2 (legenda) implementado com escopo reduzido — achado de impacto levado ao Junior (grade não pinta célula por obrigatoriedade/validade hoje, só o botão de texto longo); decisão: só a legenda, sem pintura de célula. `vitest` 160/160, `tsc`/`eslint` limpos, `npm run build` verde. Itens 3-4 pendentes |
| 2026-09-11 | @dev (Dex) | Item 3 (painel de RAG / modo desenvolvedor) implementado — callback `onLinhaAtivaChange` na grade + switch e painel em `criar-programacao-view.tsx`, reaproveitando `montarAtividadePayload` da S-PROG-03. `vitest` 160/160 (inalterado), `tsc`/`eslint` limpos (só `any` pré-existente), `npm run build` verde. Item 4 pendente |
| 2026-09-11 | @dev (Dex) | Item 4 (toast com rótulo errado) implementado — corrigido pra "Continuar edição" (rótulo real). Achado adicional fora de escopo registrado: mesma referência quebrada existe também em `mensal/[id]/page.tsx:130`, não corrigida (fora do que a story cita). `vitest` 160/160, `tsc`/`eslint` limpos, `npm run build` verde. Todos os 4 itens concluídos — Status InProgress → Ready for Review |
| 2026-09-11 | @qa (Quinn) | Revisão completa (itens 1-4 contra os 8 ACs). Veredito **PASS**. CONCERNS leve não bloqueante: legenda/painel/fluxo não verificados em navegador (restrição do projeto). Achado confirmado: segunda referência a "Ver Atividades" em `mensal/[id]/page.tsx:130`, fora do escopo original |
| 2026-09-11 | @dev (Dex) | Ajuste pós-QA, autorizado pelo Junior: corrigida a segunda referência a "Ver Atividades" em `mensal/[id]/page.tsx:130` — mensagem reescrita (não existe navegação a fazer, usuário já está na tela). `vitest` 160/160, `tsc`/`eslint` sem erros novos, `npm run build` verde. CONCERNS de verificação em navegador seguem em aberto — pendente de autorização explícita do Junior para abrir o navegador |

## QA Results

### Revisão de Quinn (@qa) — 2026-09-11 — Veredito: **PASS**

**Escopo revisado:** itens 1-4, código + testes, contra os 8 ACs e a análise de impacto da story.

**1. Code review:**
- `preencher-abaixo.ts` — lido linha a linha. Lógica confere com a descrição: bloqueia os 4 campos
  antes de qualquer leitura (`CAMPOS_BLOQUEADOS.has`), não propaga com origem vazia, nunca
  sobrescreve célula preenchida, respeita fronteira de categoria e de "abaixo" (usa uma flag
  `alcancouOrigem` pra nunca tocar linhas acima), e o caso especial `dias_raw`/`dias_semana` lê os
  dois da ORIGEM (o bug do relatório de dev — ler do destino em vez da origem — já não existe
  mais, testado).
- `grade-atividades.tsx` — botão "Preencher abaixo" só aparece dentro do bloco já gated por
  `linhaAtiva && daCategoria.some(...)`, **e** ainda checa `colunaFoco` válido (não bloqueado, e
  pertence à categoria atual via `colunas.some`) — cobre a troca de aba com foco de uma coluna que
  não existe na categoria nova, caso de borda que a story não citava explicitamente mas o código
  já trata.
- `criar-programacao-view.tsx` (item 3) — painel gated corretamente em `modoDesenvolvedor`,
  placeholder quando `atividadeSelecionadaGrade` é `null`, reaproveita `montarAtividadePayload` já
  testado na S-PROG-03 (não reimplementa serialização).
- Item 4 — toast corrigido para "Continuar edição", rastreado até o botão real em
  `programacao/page.tsx:578` (`m.status === "rascunho"`). Confirmado que é o rótulo certo.

**2. Testes:** `vitest run src/lib/programacao` → 160/160. Os 9 novos testes de
`preencher-abaixo.test.ts` cobrem exatamente os cenários do AC5 (coluna vazia, parcial, última
linha, os 4 campos bloqueados, origem vazia, categoria diferente, linha acima da origem,
`dias_raw` com espelho, `tempIdOrigem` inexistente) — nada faltando ali.

**3. Acceptance Criteria (1-8):** todos atendidos.
- AC1-5 (preencher abaixo): código + testes cobrem.
- AC6 (legenda, dois temas): tokens reaproveitados (`amber-500`, `destructive`) já usados em
  outras telas do portal nos dois temas — risco baixo, mas **não verificado em navegador**
  (restrição do projeto, sem autorização). Fica como CONCERNS leve, não bloqueia.
- AC7 (painel RAG só com switch ligado): confirmado no código.
- AC8 (nenhum texto cita botão inexistente): o toast citado na story foi corrigido. **Achado do
  próprio @dev, verificado por mim:** existe uma segunda ocorrência do mesmo problema em
  `mensal/[id]/page.tsx:130` ("Abra 'Ver Atividades'"), fora do escopo literal desta story (não
  citada nela) — @dev documentou corretamente em vez de expandir escopo por conta própria. Não
  bloqueia esta story, mas recomendo abrir item/story de rastro pra essa segunda ocorrência.

**4. Regressão:** nenhuma lógica existente foi alterada — item 1 é aditivo (função nova + botão
novo), item 3 usa uma função já testada, item 4 é troca de string. `tsc --noEmit` e `eslint` sem
erros novos nos arquivos tocados (o único erro de `eslint`, `any` na linha 92 de
`criar-programacao-view.tsx`, é pré-existente — confirmei contra o contexto do arquivo, não
introduzido por esta story). `npm run build` reexecutado por mim de forma independente: verde
(exit 0), 129/129 páginas geradas.

**5. Performance:** sem impacto — mudanças são O(n) sobre a lista de atividades já em memória, mesmo
padrão de `duplicar.ts`/`revisao.ts`.

**6. Segurança:** painel de RAG (item 3) expõe `descricao`/`metadata` da atividade — conteúdo
público de programação, sem dado pessoal, atrás de switch desligado por padrão. Sem preocupação.

**7. Documentação:** Dev Agent Record, File List e Change Log completos e claros para os 4 itens,
achados de impacto registrados antes de codar (item 2) e depois (item 4) — no padrão exigido pela
`impact-analysis-mandatory.md`.

**Não verificado (mesma restrição de todo o resto da story):** navegador — legibilidade real da
legenda nos dois temas, atualização ao vivo do painel de RAG ao editar, fluxo completo de salvar →
lista → toast. Nenhum desses achados de código sugere risco alto o bastante pra exigir essa
verificação antes do merge; fica registrado caso o Junior queira validar visualmente depois.

**Recomendação:** aprovar para @devops. Sugiro ao Junior avaliar separadamente o achado da segunda
referência a "Ver Atividades" em `mensal/[id]/page.tsx:130` (item novo ou correção avulsa, não
bloqueia esta story).

— Quinn, guardiã da qualidade 🛡️

### Revisão 2 de Quinn (@qa) — 2026-09-11 — Veredito: **PASS** (mantido)

**Escopo revisado:** só o ajuste pós-QA em `mensal/[id]/page.tsx:130` (o resto não mudou desde a
Revisão 1, não reavaliado de novo).

- **Rastreamento do call-site confirmado por mim, independente do relato do @dev:** busquei
  `executarTransicao` em todo `src/` — as 4 chamadas (`handleAprovarProgramacao`,
  `handleFinalizarProgramacao`, `handleConfirmarDevolucao`, `handleConfirmarReabrir`) estão todas
  dentro do mesmo arquivo/página. Confirmado: não existia navegação real a corrigir, só a
  instrução errada — a reescrita ("Corrija nas atividades abaixo") é a correção certa, não um
  chute.
- `eslint`: os 3 erros/1 warning no arquivo (`any` nas linhas 55/108, dependência de hook na 75)
  são pré-existentes — nenhum introduzido pela linha 130 tocada.
- `vitest run src/lib/programacao`: 160/160, inalterado (mudança é só texto).
- `npm run build`: reexecutei de forma independente — verde (exit 0).

**CONCERNS da Revisão 1 seguem em aberto, sem mudança:** verificação em navegador da legenda
(AC6) e do fluxo completo do painel de RAG/toast não foi feita — está corretamente registrada
pelo @dev como pendente de autorização explícita do Junior, não como algo resolvido às pressas.
Não é bloqueante; mantenho o mesmo veredito.

**Recomendação:** aprovar para @devops. Nenhum achado novo nesta segunda passada.

— Quinn, guardiã da qualidade 🛡️
