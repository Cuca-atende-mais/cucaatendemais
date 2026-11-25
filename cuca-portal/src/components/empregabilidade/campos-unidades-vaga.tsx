"use client"

// S-EMP-GES-13: Unidade de Tratamento + Unidade de Currículos, iguais nos formulários públicos (link do
// WhatsApp) e nos modais internos. A mensagem de erro aparece abaixo do campo (AC9).

import { useCallback, useRef, useState, type RefObject } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertCircle, Building, Info, Users } from "lucide-react"
import {
    UNIDADE_TODA_REDE,
    type CampoUnidade,
    type ErrosUnidades,
} from "@/lib/empregabilidade/unidades-vaga"
import { cn } from "@/lib/utils"

export type UnidadeOpcao = { id: string; nome: string }

/** Estado das mensagens de erro + foco no primeiro campo pendente. */
export function useErrosUnidades() {
    const [erros, setErros] = useState<ErrosUnidades>({})
    const refTratamento = useRef<HTMLButtonElement | null>(null)
    const refCurriculos = useRef<HTMLButtonElement | null>(null)

    const limpar = useCallback((campo: CampoUnidade) => {
        setErros(prev => {
            if (!prev[campo]) return prev
            const proximo = { ...prev }
            delete proximo[campo]
            return proximo
        })
    }, [])

    /** Mostra os erros e põe o foco no primeiro campo pendente. Devolve true se havia erro. */
    const mostrar = useCallback((novos: ErrosUnidades): boolean => {
        setErros(novos)
        const alvo = novos.tratamento ? refTratamento.current : novos.curriculos ? refCurriculos.current : null
        if (alvo) {
            alvo.focus()
            alvo.scrollIntoView?.({ block: "center", behavior: "smooth" })
        }
        return Boolean(novos.tratamento || novos.curriculos)
    }, [])

    const zerar = useCallback(() => setErros({}), [])

    return { erros, limpar, mostrar, zerar, refTratamento, refCurriculos }
}

type Props = {
    unidades: UnidadeOpcao[]
    tratamento: string
    curriculos: string
    onTratamentoChange: (valor: string) => void
    onCurriculosChange: (valor: string) => void
    erros: ErrosUnidades
    onLimparErro: (campo: CampoUnidade) => void
    refTratamento?: RefObject<HTMLButtonElement | null>
    refCurriculos?: RefObject<HTMLButtonElement | null>
    /** false na vaga antiga sem unidade de tratamento (D12): o campo fica opcional. */
    tratamentoObrigatorio?: boolean
    /** Aviso informativo da vaga antiga sem unidade (AC13). */
    avisoVagaAntiga?: boolean
    /** Prefixo dos ids, para dois formulários na mesma página não colidirem. */
    idPrefixo?: string
    /** Lado a lado a partir de `sm` (modais) ou empilhado (formulários públicos). */
    ladoALado?: boolean
    className?: string
}

export function CamposUnidadesVaga({
    unidades,
    tratamento,
    curriculos,
    onTratamentoChange,
    onCurriculosChange,
    erros,
    onLimparErro,
    refTratamento,
    refCurriculos,
    tratamentoObrigatorio = true,
    avisoVagaAntiga = false,
    idPrefixo = "unidades",
    ladoALado = false,
    className,
}: Props) {
    const idTrat = `${idPrefixo}-tratamento`
    const idCurr = `${idPrefixo}-curriculos`
    const erroTrat = erros.tratamento
    const erroCurr = erros.curriculos

    return (
        <div className={cn("grid gap-4", ladoALado && "sm:grid-cols-2", className)}>
            <div className="space-y-2 min-w-0">
                <Label htmlFor={idTrat} className="flex items-center gap-1.5">
                    <Building className="h-4 w-4 text-cuca-blue shrink-0" aria-hidden />
                    Unidade de Tratamento da Vaga {tratamentoObrigatorio && <span className="text-destructive">*</span>}
                </Label>
                <Select
                    value={tratamento || undefined}
                    onValueChange={v => { onTratamentoChange(v); onLimparErro("tratamento") }}
                >
                    <SelectTrigger
                        id={idTrat}
                        ref={refTratamento}
                        className="w-full max-md:h-11"
                        aria-invalid={erroTrat ? true : undefined}
                        aria-describedby={erroTrat ? `${idTrat}-erro` : `${idTrat}-ajuda`}
                        aria-required={tratamentoObrigatorio}
                    >
                        <SelectValue placeholder="Selecione a unidade que cuida da vaga" />
                    </SelectTrigger>
                    <SelectContent>
                        {unidades.map(u => (
                            <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {erroTrat ? (
                    <p id={`${idTrat}-erro`} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-destructive">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                        {erroTrat}
                    </p>
                ) : avisoVagaAntiga && !tratamento ? (
                    <p id={`${idTrat}-ajuda`} className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                        Esta vaga foi criada antes da unidade de tratamento. Você pode escolher uma agora, se quiser.
                    </p>
                ) : (
                    <p id={`${idTrat}-ajuda`} className="text-xs text-muted-foreground">
                        A unidade do CUCA responsável por acompanhar esta vaga. Sempre uma unidade específica.
                    </p>
                )}
            </div>

            <div className="space-y-2 min-w-0">
                <Label htmlFor={idCurr} className="flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-cuca-blue shrink-0" aria-hidden />
                    Unidade de Currículos <span className="text-destructive">*</span>
                </Label>
                <Select
                    value={curriculos || undefined}
                    onValueChange={v => { onCurriculosChange(v); onLimparErro("curriculos") }}
                >
                    <SelectTrigger
                        id={idCurr}
                        ref={refCurriculos}
                        className="w-full max-md:h-11"
                        aria-invalid={erroCurr ? true : undefined}
                        aria-describedby={erroCurr ? `${idCurr}-erro` : `${idCurr}-ajuda`}
                        aria-required
                    >
                        <SelectValue placeholder="Selecione para onde vão os currículos" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={UNIDADE_TODA_REDE}>Toda a Rede CUCA</SelectItem>
                        {unidades.map(u => (
                            <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {erroCurr ? (
                    <p id={`${idCurr}-erro`} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-destructive">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                        {erroCurr}
                    </p>
                ) : (
                    <p id={`${idCurr}-ajuda`} className="text-xs text-muted-foreground">
                        {curriculos === UNIDADE_TODA_REDE
                            ? "Os candidatos de qualquer unidade podem se inscrever; o bot pergunta a unidade mais próxima."
                            : curriculos
                                ? "Os candidatos são encaminhados direto para esta unidade."
                                : "Para qual unidade vão os currículos dos candidatos. Escolha Toda a Rede CUCA se qualquer unidade pode receber."}
                    </p>
                )}
            </div>
        </div>
    )
}
