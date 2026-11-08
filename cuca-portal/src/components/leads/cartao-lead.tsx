"use client"

import { Lead } from "@/lib/types/database"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Phone } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Lead em forma de cartão, para telas abaixo de lg (celular e tablet), onde a tabela de 8 colunas
 * não cabe. Mostra os mesmos dados da tabela; o perfil e as ações chegam prontos da página, para
 * as duas versões ficarem iguais.
 */
export function CartaoLead({
    lead,
    selecionado,
    onAlternarSelecao,
    dataCadastro,
    perfil,
    acoes,
}: {
    lead: Lead
    selecionado: boolean
    onAlternarSelecao: () => void
    dataCadastro: string
    perfil: React.ReactNode
    acoes: React.ReactNode
}) {
    return (
        <div
            data-slot="cartao-lead"
            className={cn("rounded-lg border bg-card p-3", selecionado && "border-primary/40 bg-primary/5")}
        >
            <div className="flex items-start gap-3">
                <Checkbox
                    className="mt-1"
                    checked={selecionado}
                    onCheckedChange={onAlternarSelecao}
                    aria-label={`Selecionar ${lead.nome ?? lead.telefone}`}
                />
                <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">
                        {lead.nome ?? <span className="text-muted-foreground italic">Sem nome</span>}
                    </p>
                    <p className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" />
                        {lead.telefone}
                    </p>
                </div>
                {acoes}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-7 text-xs text-muted-foreground">
                <span>{lead.unidade_cuca ?? "Sem unidade"}</span>
                <span>Cadastro: {dataCadastro}</span>
                {lead.opt_in && <Badge variant="secondary">Opt-in</Badge>}
                {lead.bloqueado && <Badge variant="destructive">Bloqueado</Badge>}
            </div>

            <div className="mt-2 pl-7 empty:hidden">{perfil}</div>
        </div>
    )
}
