"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Opções de tabela fixa (S-RESP-02). Desligadas por padrão: quem não usa continua igual.
 *
 * - `cabecalhoFixo`: o cabeçalho fica visível ao rolar. Para isso a caixa da tabela ganha altura
 *   máxima e rola por dentro (sticky gruda na caixa que rola, não na página). A altura padrão é
 *   70svh; `classeCaixa` troca (ex.: "max-h-[60svh]").
 * - `primeiraColunaFixa`: a primeira coluna fica parada ao rolar para o lado (tabela com mais de
 *   5 colunas, pela regra de cuca-portal/docs/padrao-responsivo.md).
 *
 * O fundo das células fixas é `bg-card`; numa tabela sobre outro fundo, passar `className` na
 * célula para trocar.
 */
type OpcoesTabela = { cabecalhoFixo: boolean; primeiraColunaFixa: boolean }

const OpcoesTabelaContext = React.createContext<OpcoesTabela>({ cabecalhoFixo: false, primeiraColunaFixa: false })
const DentroDoCabecalhoContext = React.createContext(false)

function Table({
  className,
  cabecalhoFixo = false,
  primeiraColunaFixa = false,
  classeCaixa,
  ...props
}: React.ComponentProps<"table"> & {
  cabecalhoFixo?: boolean
  primeiraColunaFixa?: boolean
  classeCaixa?: string
}) {
  const opcoes = React.useMemo(() => ({ cabecalhoFixo, primeiraColunaFixa }), [cabecalhoFixo, primeiraColunaFixa])
  return (
    <OpcoesTabelaContext.Provider value={opcoes}>
      <div
        data-slot="table-container"
        className={cn(
          "relative w-full overflow-x-auto",
          cabecalhoFixo && "overflow-auto max-h-[70svh]",
          classeCaixa
        )}
      >
        <table
          data-slot="table"
          className={cn("w-full caption-bottom text-sm", className)}
          {...props}
        />
      </div>
    </OpcoesTabelaContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <DentroDoCabecalhoContext.Provider value={true}>
      <thead
        data-slot="table-header"
        className={cn("[&_tr]:border-b", className)}
        {...props}
      />
    </DentroDoCabecalhoContext.Provider>
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className
      )}
      {...props}
    />
  )
}

// Com border-collapse a borda de baixo do cabeçalho não acompanha o sticky: a linha vem por sombra.
const CABECALHO_FIXO = "sticky top-0 z-20 bg-card shadow-[inset_0_-1px_0_var(--border)]"
const PRIMEIRA_COLUNA_FIXA = "first:sticky first:left-0 first:z-10 first:bg-card first:shadow-[inset_-1px_0_0_var(--border)]"

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  const { cabecalhoFixo, primeiraColunaFixa } = React.useContext(OpcoesTabelaContext)
  const dentroDoCabecalho = React.useContext(DentroDoCabecalhoContext)
  const fixoNoTopo = cabecalhoFixo && dentroDoCabecalho
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        fixoNoTopo && CABECALHO_FIXO,
        primeiraColunaFixa && PRIMEIRA_COLUNA_FIXA,
        // canto: fixo nos dois sentidos, por cima das duas faixas, com as duas linhas
        fixoNoTopo && primeiraColunaFixa && "first:z-30 first:shadow-[inset_-1px_-1px_0_var(--border)]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  const { primeiraColunaFixa } = React.useContext(OpcoesTabelaContext)
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        primeiraColunaFixa && PRIMEIRA_COLUNA_FIXA,
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
