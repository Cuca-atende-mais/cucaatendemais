# Padrão responsivo do portal

Regra única de tamanho de tela, texto, tabela e modal do `cuca-portal`. Cada tela nova ou revisada segue esta regra. Criada na S-RESP-02 (07/11/2026), com os valores confirmados pelo Junior.

## 1. Larguras de referência

Toda tela é conferida em **360** (celular), **768** (tablet), **1024** (notebook pequeno), **1366** (notebook comum) e **1920** (monitor). Em 1024 e 1366, conferir também com altura baixa (600 e 768).

- **Exceção:** o módulo Developer não tem versão de celular. Ele é conferido a partir de 1024.

## 2. Texto

O tamanho é ajustado num lugar só: `src/app/globals.css`, no bloco `@theme inline`. Os valores atuais são:

| Classe | Tamanho / altura de linha | Padrão do Tailwind | Uso |
|---|---|---|---|
| `text-xs` | **13px** / 18px | 12px / 16px | Menor texto legível: horários, etiquetas, contadores, legendas |
| `text-sm` | **15px** / 22px | 14px / 20px | Texto comum de tela, tabela, botão e campo |
| `text-base` | 16px / 24px | igual | Campos no celular (abaixo de 16px o iPhone dá zoom ao tocar) |

- **Nada abaixo de `text-xs`** em texto que a pessoa precise ler. Proibido usar `text-[8px]` a `text-[12px]`.
- Exceções só para itens decorativos (sem informação), justificadas em comentário no código.
- Para subir ou descer o texto do portal inteiro, mudar as 4 linhas `--text-xs*` e `--text-sm*` do `globals.css`. Não mudar o tamanho de fonte da raiz (`html`): isso também aumenta espaçamentos, alturas e larguras de tudo.
- O corpo do texto não usa `tracking-tight`, porque letra apertada piora a leitura nesses tamanhos.

## 3. Larguras fixas

- Nada de largura fixa em px acima de 320px, fora modal e coluna de tabela.
- Coluna e cartão usam largura mínima pequena e quebram linha (`min-w-0`, `break-words`, `[overflow-wrap:anywhere]` para link longo).
- Item de flex que contém texto longo precisa de `min-w-0`, senão estica o pai.

## 4. Grades

Toda grade de 3 ou mais colunas quebra em telas menores:

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
```

## 5. Tabelas

Use o componente `@/components/ui/table`, não `<table>` cru.

- **Cabeçalho fixo ao rolar:** `cabecalhoFixo`. A caixa da tabela ganha altura máxima (70svh por padrão) e rola por dentro.
- **Mais de 5 colunas:** a primeira coluna também fica fixa, com `primeiraColunaFixa`.
- **Abaixo de 768px (`md`):** tabela de consulta vira lista de cartões. Tabela de edição em massa (ex.: matriz de Perfis) pode manter a rolagem lateral.

```tsx
<Table cabecalhoFixo primeiraColunaFixa classeCaixa="max-h-[60svh]">
  <TableHeader>…</TableHeader>
  <TableBody>…</TableBody>
</Table>

{/* consulta no celular: cartões abaixo de md, tabela a partir de md */}
<div className="space-y-2 md:hidden">{itens.map(i => <CartaoItem key={i.id} item={i} />)}</div>
<div className="hidden md:block"><Table cabecalhoFixo>…</Table></div>
```

As células fixas usam fundo `bg-card`. Numa tabela sobre outro fundo, passe `className` na célula.

## 6. Modais

O `DialogContent` já vem com altura máxima da tela (`100svh − 2rem`) e rolagem por dentro. `DialogHeader` e `DialogFooter` grudam no topo e embaixo quando o modal rola, então o botão de salvar fica sempre visível.

- Montar o modal com `DialogHeader`, campos e `DialogFooter` como filhos diretos do `DialogContent`.
- Não passar `max-h-[90vh] overflow-y-auto`: isso já é o padrão.
- Modal que precisa de uma área própria rolando (ex.: lista dentro do modal) passa `overflow-hidden flex flex-col` no `DialogContent` e `flex-1 overflow-y-auto` na área.

## 7. Bordas e contraste

- Borda de campo (input, select, textarea) usa `border-input-border`. O token `--input-border` tem pelo menos 3:1 contra fundo, card e modal, nos dois temas (WCAG 1.4.11).
- Caixinha de marcar: `border-primary` (componente `ui/checkbox`) ou `border-muted-foreground`.
- Linhas divisórias e bordas de card (`--border`) são decorativas e não precisam de 3:1.
- Campo feito à mão (fora de `ui/`) usa `border-input-border`, não `border-input`. O `--input` é o fundo do campo no tema escuro.

## 8. Toque no celular

Abaixo de 768px (`md`), botão e link de ação têm pelo menos **44px de altura** (`h-11`). A partir de `md`, voltam ao tamanho normal. O módulo Developer fica de fora (não tem versão de celular).

```tsx
<Button className="h-11 md:h-9">Salvar</Button>
```
