"use client"

import { useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload, AlertTriangle } from "lucide-react"
import toast from "react-hot-toast"
import * as XLSX from "xlsx"

interface ImportPlanilhaModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    unidadeCuca: string
    onSuccess: () => void
}

const MESES = [
    { value: "1", label: "Janeiro", strPesquisa: "JANEIRO" },
    { value: "2", label: "Fevereiro", strPesquisa: "FEVEREIRO" },
    { value: "3", label: "Março", strPesquisa: "MARÇO" },
    { value: "4", label: "Abril", strPesquisa: "ABRIL" },
    { value: "5", label: "Maio", strPesquisa: "MAIO" },
    { value: "6", label: "Junho", strPesquisa: "JUNHO" },
    { value: "7", label: "Julho", strPesquisa: "JULHO" },
    { value: "8", label: "Agosto", strPesquisa: "AGOSTO" },
    { value: "9", label: "Setembro", strPesquisa: "SETEMBRO" },
    { value: "10", label: "Outubro", strPesquisa: "OUTUBRO" },
    { value: "11", label: "Novembro", strPesquisa: "NOVEMBRO" },
    { value: "12", label: "Dezembro", strPesquisa: "DEZEMBRO" },
]

export function ImportPlanilhaModal({ open, onOpenChange, unidadeCuca, onSuccess }: ImportPlanilhaModalProps) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [mesSelecionado, setMesSelecionado] = useState<string>("")
    const [file, setFile] = useState<File | null>(null)

    // Estado do checklist visual
    const [isLoading, setIsLoading] = useState(false)
    const [stepLogs, setStepLogs] = useState<{ id: string, name: string, status: "success" | "warning" | "error" | "info", msg: string }[]>([])

    // Mostrando tela de alerta de deleção
    const [existingCampanha, setExistingCampanha] = useState<any>(null)
    const [confirmDeletePhase, setConfirmDeletePhase] = useState(false)

    const supabase = createClient()

    const appendLog = (status: "success" | "warning" | "error" | "info", name: string, msg: string) => {
        setStepLogs(prev => [...prev, { id: Math.random().toString(), status, name, msg }])
    }

    const resetState = () => {
        setFile(null)
        setStepLogs([])
        setExistingCampanha(null)
        setConfirmDeletePhase(false)
        if (fileInputRef.current) fileInputRef.current.value = ""
    }

    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen) resetState()
        onOpenChange(newOpen)
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0])
            setStepLogs([]) // limpa feedback ao trocar arquivo
        }
    }

    // Parte 1: Iniciar processamento
    const handleIniciarImportacao = async () => {
        if (!file || !mesSelecionado) {
            toast.error("Selecione um mês e uma planilha.")
            return
        }

        setIsLoading(true)
        setStepLogs([])
        setConfirmDeletePhase(false)
        appendLog("info", "Sistema", "Iniciando checagem de dados no banco...")

        const mesInt = parseInt(mesSelecionado)
        const anoAtual = new Date().getFullYear()

        try {
            // 1. Checa se já existe campanha neste mês e unidade
            const { data: extCamp } = await supabase
                .from("campanhas_mensais")
                .select("*")
                .eq("unidade_cuca", unidadeCuca)
                .eq("mes", mesInt)
                .eq("ano", anoAtual)
                .maybeSingle()

            if (extCamp) {
                setExistingCampanha(extCamp)
                setConfirmDeletePhase(true)
                setIsLoading(false)
                return // Sai e espera o usuário clicar em "Sim, Sobrescrever"
            }

            // Se não existe, roda direta a importação
            await performExtractionAndInsert(null)

        } catch (error: any) {
            appendLog("error", "Erro Critico", error.message)
            toast.error("Erro na importação.")
            setIsLoading(false)
        }
    }

    // Parte 2: O Usuário confirmou que deseja sobrescrever a campanha existente
    const handleConfirmOverwrite = async () => {
        setConfirmDeletePhase(false)
        setIsLoading(true)
        appendLog("info", "Deleção em Cascata", "Apagando a programação anterior e limpando o RAG...")

        try {
            // O Banco vai dar CASCADE em atividades_mensais. O Supabase Vector trigger apaga os embeddings lincados.
            const { error: delErr } = await supabase
                .from("campanhas_mensais")
                .delete()
                .eq("id", existingCampanha.id)

            if (delErr) throw new Error("Falha ao apagar campanha anterior: " + delErr.message)

            appendLog("success", "Banco Atualizado", "Programação antiga removida com sucesso.")

            await performExtractionAndInsert(null)

        } catch (error: any) {
            appendLog("error", "Ops", error.message)
            toast.error("Erro fatal ao substituir.")
            setIsLoading(false)
        }
    }


    // Parte 3: Extração do Arquivo Fisico, match das abas e insert no Supabase
    const performExtractionAndInsert = async (campanhaRecicladaId: string | null) => {
        const mesInt = parseInt(mesSelecionado)
        const anoAtual = new Date().getFullYear()
        const mesObj = MESES.find(m => m.value === mesSelecionado)!
        const strMesAlvo = mesObj.strPesquisa // "MARÇO"

        appendLog("info", "Processamento", "Lendo arquivo Excel e procurando abas...")

        const reader = new FileReader()
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target?.result
                const wb = XLSX.read(bstr, { type: 'binary' })

                const atividadesToInsert: any[] = []
                let abasImportadasSucesso = 0

                // Nova Engenharia Demandada: Loop em todas as abas procurando o array
                for (let sheetName of wb.SheetNames) {
                    const snUpper = sheetName.toUpperCase().trim()

                    // Regex para pegar tudo ANTES do ifen como Categoria
                    // Exemplo: "ESPORTES - MARÇO" -> Match Categoria = "ESPORTE"
                    const isMesAlvo = snUpper.includes(strMesAlvo)

                    // Tratamento Especial para erro de digitação reclamado pelo User (ex: MARCO sem cedilha)
                    // Vamos tentar avisar ao menos
                    const isMesQuaseAlvo = strMesAlvo === "MARÇO" && snUpper.includes("MARCO")
                    const isMesQuaseAlvoFev = strMesAlvo === "FEVEREIRO" && snUpper.includes("FEVERERO")

                    if (isMesQuaseAlvo || isMesQuaseAlvoFev) {
                        appendLog("warning", sheetName, "Não carregado - Atenção: aba com possível erro de digitação. Reveja a escrita sem abreviações ou arrume a acentuação e tente novamente.")
                        continue
                    }

                    if (!isMesAlvo) {
                        // Ignora calado as abas que explicitamente são de outros meses. Não há porque alertar sobre "JANEIRO" se importamos "MARÇO"
                        continue
                    }

                    // Encontrou a aba correta pro mês M. Extrai a categoria antes do traço.
                    let categoriaVal = "Diversos"
                    if (snUpper.includes("-")) {
                        categoriaVal = snUpper.split("-")[0].trim()
                    }

                    // Processa o conteúdo
                    const ws = wb.Sheets[sheetName]
                    const data: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 })

                    const rows = data.slice(6) // Header pull

                    let countNaAba = 0
                    const fallbackDate = new Date(anoAtual, mesInt - 1, 1).toISOString().split('T')[0]

                    rows.forEach(row => {
                        if (row[9] && typeof row[9] === 'string' && row[9].trim() !== "") {
                            atividadesToInsert.push({
                                unidade_cuca: unidadeCuca,
                                titulo: String(row[9]).substring(0, 100),
                                descricao: row[9],
                                local: row[8] ? String(row[8]).substring(0, 255) : "Não informado",
                                data_atividade: fallbackDate, // Por enqt sem parse da data da grid
                                categoria: categoriaVal
                            })
                            countNaAba++
                        }
                    })

                    if (countNaAba > 0) {
                        appendLog("success", sheetName, `Concluído (${countNaAba} tarefas encontradas e validadas). Categoria mapeada: ${categoriaVal}`)
                        abasImportadasSucesso++
                    } else {
                        appendLog("warning", sheetName, "Aba encontrada, porém vazia ou em formatação incompatível com a leitura.")
                    }
                }

                if (atividadesToInsert.length === 0) {
                    appendLog("error", "Arquivo Vazio", "Nenhuma linha válida convertida para inserir. Cheque formato da tabela e header.")
                    throw new Error("Tabela zerada.")
                }

                // 1. Criar a Campanha Mensal "Pai"
                appendLog("info", "Banco de Dados", "Registrando " + atividadesToInsert.length + " atividades validadas...")

                const { data: newCamp, error: insErr } = await supabase
                    .from("campanhas_mensais")
                    .insert({
                        titulo: `Programação Mensal - ${mesInt}/${anoAtual}`,
                        unidade_cuca: unidadeCuca,
                        mes: mesInt,
                        ano: anoAtual,
                        total_atividades: atividadesToInsert.length,
                        status: "aprovado" // Fluxo direto (wipe n replace)
                    })
                    .select("id")
                    .single()

                if (insErr) throw new Error("Erro insert pain pai: " + insErr.message)

                // 2. Vincular as fileiras à Campanha
                const finalBatch = atividadesToInsert.map(act => ({
                    ...act,
                    campanha_id: newCamp.id
                }))

                const { error: batchErr } = await supabase.from("atividades_mensais").insert(finalBatch)
                if (batchErr) throw new Error("Erro insert filhas: " + batchErr.message)

                appendLog("success", "Finalizado", "Programação de " + mesObj.label + " criada e enviada ativamente ao RAG.")
                toast.success("Importação concluída com sucesso!")

                // Dispara refresh pra grid na background pós delay
                setTimeout(() => {
                    handleOpenChange(false)
                    onSuccess()
                }, 4000)

            } catch (err: any) {
                appendLog("error", "Erro JS", err.message)
                setIsLoading(false)
            }
        }

        if (file) {
            reader.readAsBinaryString(file)
        } else {
            setIsLoading(false)
            toast.error("Arquivo perdido durante o processamento.")
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[550px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 text-cuca-blue" />
                        Atualizar Programação Excel
                    </DialogTitle>
                    <DialogDescription>
                        Importe a programação da unidade <strong>{unidadeCuca}</strong> através do Excel. O sistema validará abas com Mês demarcado no título (Ex: <em>CURSOS - {mesSelecionado ? MESES.find(m => m.value === mesSelecionado)?.strPesquisa : "MÊS"}</em>).
                    </DialogDescription>
                </DialogHeader>

                {!confirmDeletePhase && (
                    <div className="space-y-4 py-2">
                        <div className="flex flex-col gap-2">
                            <Label>1. Escolha o Mês Refência desta Planilha</Label>
                            <Select value={mesSelecionado} onValueChange={setMesSelecionado} disabled={isLoading}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione o mês desejado..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {MESES.map(m => (
                                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <span className="text-xs text-muted-foreground mt-1">Ao selecionar "Março", o sistema pulará todas as abas que tenham nomes referentes aos meses passados ou futuros lá dentro.</span>
                        </div>

                        <div className="flex flex-col gap-2 pt-2">
                            <Label>2. Selecione o Arquivo (.xlsx)</Label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept=".xlsx, .xls"
                                    onChange={handleFileChange}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isLoading}
                                    className="w-full h-12 border-dashed border-2"
                                >
                                    <Upload className="w-4 h-4 mr-2" />
                                    {file ? file.name : "Clique para buscar Excel..."}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* TELA DE HARD WARNING! OVERWRITE */}
                {confirmDeletePhase && existingCampanha && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-5 my-2 animate-in fade-in zoom-in">
                        <div className="flex gap-3 mb-3 text-red-700">
                            <AlertTriangle className="h-6 w-6 shrink-0" />
                            <div>
                                <h3 className="font-bold text-lg">Substituir Programação Existente?</h3>
                                <p className="text-sm mt-1">
                                    O <strong>CUCA {unidadeCuca}</strong> já está com a programação de <strong>{MESES.find(m => m.value === String(existingCampanha.mes))?.label}</strong> carregada e online para os Jovens (RAG Ativo).
                                </p>
                            </div>
                        </div>
                        <p className="text-sm text-red-900 mb-4 ml-9 font-medium">
                            Se você prosseguir, a <strong>planilha anterior será inteiramente APAGADA e sobreescrita</strong> com os novos dados desta planilha.
                        </p>
                        <div className="flex items-center gap-3 justify-end shrink-0">
                            <Button variant="outline" onClick={resetState} disabled={isLoading}>Cancelar</Button>
                            <Button variant="destructive" onClick={handleConfirmOverwrite} disabled={isLoading}>
                                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Sim, Sobrescrever Tudo
                            </Button>
                        </div>
                    </div>
                )}

                {/* CHECKLIST VISUAL DOS LOGS DE PROGRESSO */}
                {stepLogs.length > 0 && !confirmDeletePhase && (
                    <div className="mt-4 border rounded-lg overflow-hidden bg-slate-50">
                        <div className="bg-slate-100 px-4 py-2 border-b text-xs font-semibold text-slate-500 uppercase flex items-center justify-between">
                            Status da Validação Visual
                            {isLoading && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                        </div>
                        <ScrollArea className="h-[200px] w-full p-4">
                            <div className="space-y-3">
                                {stepLogs.map((log) => (
                                    <div key={log.id} className={`flex items-start gap-3 text-sm ${log.status === "error" ? "text-red-600" :
                                        log.status === "warning" ? "text-amber-600" :
                                            log.status === "success" ? "text-green-700" : "text-blue-700"
                                        }`}>
                                        {log.status === "success" && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
                                        {log.status === "warning" && <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
                                        {log.status === "error" && <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                                        {log.status === "info" && <Loader2 className="h-4 w-4 animate-spin mt-0.5 shrink-0 text-blue-400" />}
                                        <div>
                                            <span className="font-semibold block">{log.name}</span>
                                            <span className="opacity-90">{log.msg}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                )}

                {!confirmDeletePhase && (
                    <DialogFooter className="mt-4">
                        <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
                            Cancelar
                        </Button>
                        <Button
                            className="bg-cuca-blue text-white hover:bg-blue-600"
                            disabled={isLoading || !file || !mesSelecionado}
                            onClick={handleIniciarImportacao}
                        >
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : "Atualizar Programação (Importar)"}
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    )
} 
