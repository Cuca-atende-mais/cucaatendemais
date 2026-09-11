# S-PROG-11 — Fechar o editor: preencher abaixo, legenda e painel de RAG

**Status:** Ready
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

## Fora de escopo

Reescrever o painel de revisão (S-PROG-01, mantido). Undo/redo na grade. Preencher abaixo entre
categorias diferentes.

## Nota de processo

A S-PROG-01 volta de `Done` para `InProgress` nesta validação (achado @po: o campo Status dela
afirmava conclusão sem o item 1 — corrigido diretamente, não é uma opção condicional).

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-10 | @dev (Dex) | Story rascunhada a partir dos itens do protótipo ausentes na S-PROG-01 |
| 2026-09-10 | @po (Pax) | Validado GO (8/10). Seção "Fora de escopo" ausente, adicionada. Status Draft → Ready |
