"use client"

/**
 * S-EMP-GES-13 (AC18, AC19): grade de consulta com linhas de divisão visíveis e colunas que o usuário
 * estica ou encolhe arrastando a borda do cabeçalho (ou com as setas, com o foco na alça). A largura
 * que cada usuário deixar fica salva no navegador dele e volta ao reabrir a tela.
 *
 * Usa `@tanstack/react-table` só para o controle das larguras; a tabela em si é o componente padrão
 * do portal (`@/components/ui/table`), com cabeçalho e primeira coluna fixos (padrao-responsivo.md §5).
 * No celular, a tela usa cartões no lugar da grade (abaixo de `md`), então este componente é só para
 * a partir de `md`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import {
    getCoreRowModel,
    useReactTable,
    type ColumnDef,
    type ColumnSizingState,
    type Updater,
} from "@tanstack/react-table"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apagarLarguras, deveGravarLarguras, lerLarguras, salvarLarguras, type LimitesColuna } from "@/lib/ui/larguras-colunas"
import { cn } from "@/lib/utils"

export type ColunaGrade<T> = {
    id: string
    cabecalho: string
    /** Largura padrão, em px. */
    tamanho: number
    minimo?: number
    maximo?: number
    alinhar?: "esquerda" | "centro" | "direita"
    /** Conteúdo da célula. Texto longo deve vir truncado (a célula já corta o que passar da largura). */
    celula: (linha: T) => ReactNode
    /** Texto completo mostrado ao passar o mouse quando a célula corta o conteúdo. */
    titulo?: (linha: T) => string | undefined
    /** Clique dentro da célula não dispara o clique da linha (botões, selects). */
    interativa?: boolean
}

type Props<T> = {
    dados: T[]
    colunas: ColunaGrade<T>[]
    idLinha: (linha: T) => string
    /** Chave do navegador onde ficam as larguras, ex.: "cuca:grade:vagas:v1". */
    chaveArmazenamento: string
    rotulo: string
    carregando?: boolean
    vazio?: ReactNode
    onClickLinha?: (linha: T) => void
    rotuloLinha?: (linha: T) => string
    classeCaixa?: string
    className?: string
}

const PASSO_TECLADO = 16
const MINIMO_PADRAO = 60
const MAXIMO_PADRAO = 800

const ALINHAMENTO: Record<NonNullable<ColunaGrade<unknown>["alinhar"]>, string> = {
    esquerda: "text-left",
    centro: "text-center",
    direita: "text-right",
}

// Linhas de grade: com `border-separate` a borda acompanha a célula fixa (com `border-collapse` ela some).
const BORDA_CELULA = "border-b border-r border-border last:border-r-0"

export function DataGrid<T>({
    dados,
    colunas,
    idLinha,
    chaveArmazenamento,
    rotulo,
    carregando = false,
    vazio = "Nenhum registro encontrado.",
    onClickLinha,
    rotuloLinha,
    classeCaixa,
    className,
}: Props<T>) {
    // As telas recriam a lista de colunas a cada renderização (as células dependem dos dados). Limites e
    // definições ficam presos a esta assinatura, para não reler o navegador nem refazer a tabela à toa.
    const assinatura = colunas
        .map(c => `${c.id}:${c.tamanho}:${c.minimo ?? MINIMO_PADRAO}:${c.maximo ?? MAXIMO_PADRAO}`)
        .join("|")
    const limites = useMemo<Record<string, LimitesColuna>>(
        () => Object.fromEntries(colunas.map(c => [c.id, { minimo: c.minimo ?? MINIMO_PADRAO, maximo: c.maximo ?? MAXIMO_PADRAO }])),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [assinatura],
    )

    const [larguras, setLarguras] = useState<ColumnSizingState>({})
    // Só grava no navegador depois de uma mudança feita pelo usuário (arraste, teclado, duplo clique).
    // Gravar na montagem apagaria a chave antes de o valor lido entrar no estado; com a montagem dupla
    // do React em desenvolvimento (StrictMode), a segunda leitura já encontrava a chave apagada.
    const alteradoPeloUsuario = useRef(false)
    // Lido depois da montagem: a página é renderizada também no servidor, onde não há localStorage.
    useEffect(() => {
        alteradoPeloUsuario.current = false
        setLarguras(lerLarguras(chaveArmazenamento, limites))
    }, [chaveArmazenamento, limites])

    const definicoes = useMemo<ColumnDef<T>[]>(
        () => colunas.map(c => ({
            id: c.id,
            header: c.cabecalho,
            size: c.tamanho,
            minSize: c.minimo ?? MINIMO_PADRAO,
            maxSize: c.maximo ?? MAXIMO_PADRAO,
            enableResizing: true,
        })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [assinatura],
    )

    // Chamado pela tabela no arraste e no duplo clique (volta a coluna ao padrão).
    const aoMudarLarguras = useCallback((atualizar: Updater<ColumnSizingState>) => {
        alteradoPeloUsuario.current = true
        setLarguras(prev => (typeof atualizar === "function" ? atualizar(prev) : atualizar))
    }, [])

    const tabela = useReactTable({
        data: dados,
        columns: definicoes,
        getRowId: (linha) => idLinha(linha),
        getCoreRowModel: getCoreRowModel(),
        columnResizeMode: "onChange",
        state: { columnSizing: larguras },
        onColumnSizingChange: aoMudarLarguras,
    })

    const redimensionando = tabela.getState().columnSizingInfo.isResizingColumn
    // Grava quando o arraste termina (não a cada pixel), e depois de cada ajuste pelo teclado.
    useEffect(() => {
        if (!deveGravarLarguras({ alteradoPeloUsuario: alteradoPeloUsuario.current, redimensionando: Boolean(redimensionando) })) return
        salvarLarguras(chaveArmazenamento, larguras)
        alteradoPeloUsuario.current = false
    }, [larguras, redimensionando, chaveArmazenamento])

    const restaurar = () => {
        alteradoPeloUsuario.current = false
        setLarguras({})
        apagarLarguras(chaveArmazenamento)
    }

    const ajustarPeloTeclado = (id: string, atual: number, e: KeyboardEvent<HTMLDivElement>) => {
        const lim = limites[id]
        let nova: number | null = null
        if (e.key === "ArrowRight") nova = atual + PASSO_TECLADO
        else if (e.key === "ArrowLeft") nova = atual - PASSO_TECLADO
        else if (e.key === "Home") nova = lim.minimo
        else if (e.key === "End") nova = lim.maximo
        if (nova === null) return
        e.preventDefault()
        const limitada = Math.min(lim.maximo, Math.max(lim.minimo, nova))
        alteradoPeloUsuario.current = true
        setLarguras(prev => ({ ...prev, [id]: limitada }))
    }

    const colunaPorId = useMemo(() => new Map(colunas.map(c => [c.id, c])), [colunas])
    const temAjuste = Object.keys(larguras).length > 0
    const linhas = tabela.getRowModel().rows

    return (
        <div className={cn("space-y-2", className)}>
            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="hidden lg:inline">Arraste a borda do cabeçalho para ajustar a largura das colunas.</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={restaurar}
                    disabled={!temAjuste}
                >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restaurar colunas
                </Button>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden">
                <Table
                    cabecalhoFixo
                    primeiraColunaFixa
                    classeCaixa={cn("max-h-[70svh]", classeCaixa)}
                    aria-label={rotulo}
                    className="table-fixed border-separate border-spacing-0"
                    style={{ width: tabela.getTotalSize(), minWidth: "100%" }}
                >
                    <TableHeader className="bg-muted/40">
                        {tabela.getHeaderGroups().map(grupo => (
                            <TableRow key={grupo.id} className="hover:bg-transparent border-0">
                                {grupo.headers.map(header => {
                                    const col = colunaPorId.get(header.column.id)!
                                    const tamanho = header.getSize()
                                    const ativo = header.column.getIsResizing()
                                    return (
                                        <TableHead
                                            key={header.id}
                                            scope="col"
                                            style={{ width: tamanho }}
                                            className={cn(
                                                "relative select-none text-xs font-semibold text-muted-foreground",
                                                BORDA_CELULA,
                                                ALINHAMENTO[col.alinhar ?? "esquerda"],
                                            )}
                                        >
                                            <span className="block truncate pr-2" title={col.cabecalho}>{col.cabecalho}</span>
                                            <div
                                                role="separator"
                                                aria-orientation="vertical"
                                                aria-label={`Ajustar largura da coluna ${col.cabecalho}`}
                                                aria-valuenow={tamanho}
                                                aria-valuemin={limites[col.id].minimo}
                                                aria-valuemax={limites[col.id].maximo}
                                                tabIndex={0}
                                                title="Arraste para ajustar. Clique duas vezes para voltar ao padrão."
                                                onMouseDown={header.getResizeHandler()}
                                                onTouchStart={header.getResizeHandler()}
                                                onDoubleClick={() => header.column.resetSize()}
                                                onKeyDown={e => ajustarPeloTeclado(col.id, tamanho, e)}
                                                className={cn(
                                                    "absolute right-0 top-0 z-10 h-full w-3 -mr-1.5 cursor-col-resize touch-none",
                                                    "flex justify-center outline-none group",
                                                )}
                                            >
                                                <span
                                                    aria-hidden
                                                    className={cn(
                                                        "h-full w-0.5 rounded-full transition-colors",
                                                        ativo ? "bg-cuca-blue" : "bg-transparent group-hover:bg-cuca-blue/60 group-focus-visible:bg-cuca-blue",
                                                    )}
                                                />
                                            </div>
                                        </TableHead>
                                    )
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {carregando ? (
                            <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={colunas.length} className="py-12 text-center text-muted-foreground">
                                    Carregando...
                                </TableCell>
                            </TableRow>
                        ) : linhas.length === 0 ? (
                            <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={colunas.length} className="py-12 text-center text-muted-foreground whitespace-normal">
                                    {vazio}
                                </TableCell>
                            </TableRow>
                        ) : linhas.map(linha => {
                            const item = linha.original
                            const clicavel = Boolean(onClickLinha)
                            return (
                                <TableRow
                                    key={linha.id}
                                    className={cn("border-0", clicavel && "cursor-pointer focus-visible:outline-2 focus-visible:outline-cuca-blue")}
                                    onClick={clicavel ? () => onClickLinha!(item) : undefined}
                                    onKeyDown={clicavel ? (e) => {
                                        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                                            e.preventDefault()
                                            onClickLinha!(item)
                                        }
                                    } : undefined}
                                    tabIndex={clicavel ? 0 : undefined}
                                    aria-label={clicavel && rotuloLinha ? rotuloLinha(item) : undefined}
                                >
                                    {linha.getVisibleCells().map(celula => {
                                        const col = colunaPorId.get(celula.column.id)!
                                        return (
                                            <TableCell
                                                key={celula.id}
                                                style={{ width: celula.column.getSize() }}
                                                className={cn("max-w-0 overflow-hidden", BORDA_CELULA, ALINHAMENTO[col.alinhar ?? "esquerda"])}
                                                title={col.titulo?.(item)}
                                                onClick={col.interativa ? (e) => e.stopPropagation() : undefined}
                                            >
                                                {col.celula(item)}
                                            </TableCell>
                                        )
                                    })}
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
