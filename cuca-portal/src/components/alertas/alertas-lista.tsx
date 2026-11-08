"use client"

import { ChevronLeft, ChevronRight, CheckCheck, Check, Mail, MailWarning } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    type AlertaItem,
    formatarDataAlerta,
    severidadeInfo,
    situacaoEmail,
} from "@/lib/alertas/alertas"

type Props = {
    itens: AlertaItem[]
    pagina: number
    totalPaginas: number
    naoLidos: number
    carregando?: boolean
    erro?: string | null
    onPagina: (pagina: number) => void
    onMarcarLido: (id: string) => void
    onMarcarTodos: () => void
}

// S-INST-QUAL-12 — Lista paginada do modal de alertas (só apresentação, testável sem navegador).
export function AlertasLista({
    itens,
    pagina,
    totalPaginas,
    naoLidos,
    carregando = false,
    erro = null,
    onPagina,
    onMarcarLido,
    onMarcarTodos,
}: Props) {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground" data-testid="resumo-nao-lidos">
                    {naoLidos > 0 ? `${naoLidos} não lido${naoLidos > 1 ? "s" : ""}` : "Tudo lido"}
                </p>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={onMarcarTodos}
                    disabled={naoLidos === 0 || carregando}
                >
                    <CheckCheck className="h-3.5 w-3.5 mr-1" />
                    Marcar todos como lidos
                </Button>
            </div>

            {erro && <p className="text-sm text-rose-600" role="alert">{erro}</p>}

            {!erro && itens.length === 0 && !carregando && (
                <p className="text-sm text-muted-foreground py-8 text-center">Nenhum alerta até agora.</p>
            )}

            <ul className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1">
                {itens.map((a) => {
                    const sev = severidadeInfo(a.severidade)
                    const email = situacaoEmail(a)
                    return (
                        <li
                            key={a.id}
                            data-testid="alerta-item"
                            data-lido={a.lido ? "sim" : "nao"}
                            className={`rounded-lg border p-3 text-sm ${a.lido ? "border-border/50 opacity-75" : "border-border bg-muted/30"}`}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold ${sev.classe}`}>
                                            {sev.rotulo}
                                        </span>
                                        <span
                                            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${a.resolvido_em ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400" : "border-rose-500/30 text-rose-600 dark:text-rose-400"}`}
                                        >
                                            {a.resolvido_em ? "Resolvido" : "Aberto"}
                                        </span>
                                        {!a.lido && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-label="não lido" />}
                                    </div>
                                    <p className="font-semibold leading-snug break-words">{a.titulo}</p>
                                </div>
                                {!a.lido && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs shrink-0"
                                        onClick={() => onMarcarLido(a.id)}
                                        disabled={carregando}
                                    >
                                        <Check className="h-3.5 w-3.5 mr-1" />
                                        Marcar como lido
                                    </Button>
                                )}
                            </div>

                            {a.detalhe && <p className="mt-1.5 text-muted-foreground break-words">{a.detalhe}</p>}
                            {a.acao_sugerida && (
                                <p className="mt-1.5 break-words">
                                    <span className="font-medium">O que fazer: </span>
                                    {a.acao_sugerida}
                                </p>
                            )}

                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <span>Aberto em {formatarDataAlerta(a.criado_em)}</span>
                                {a.resolvido_em && <span>Resolvido em {formatarDataAlerta(a.resolvido_em)}</span>}
                                <span className={`inline-flex items-center gap-1 ${email.ok ? "" : "text-amber-700 dark:text-amber-400"}`}>
                                    {email.ok ? <Mail className="h-3 w-3" /> : <MailWarning className="h-3 w-3" />}
                                    {email.texto}
                                </span>
                            </div>
                        </li>
                    )
                })}
            </ul>

            <div className="flex items-center justify-between pt-1">
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => onPagina(pagina - 1)}
                    disabled={pagina <= 1 || carregando}
                    aria-label="Página anterior"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground" data-testid="paginacao">
                    Página {pagina} de {totalPaginas}
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => onPagina(pagina + 1)}
                    disabled={pagina >= totalPaginas || carregando}
                    aria-label="Próxima página"
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
