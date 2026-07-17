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
import { useRouter } from "next/navigation"
import toast from "react-hot-toast"
import * as XLSX from "xlsx"
import {
    CATEGORIAS_VALIDAS,
    COLUNAS_CURSOS,
    COLUNAS_DIA_A_DIA,
    COLUNAS_ESPORTES,
    detectarCategoria,
    detectarColunas,
    lerColuna,
} from "@/lib/programacao/planilha-parser"

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
    const router = useRouter()

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

                    // Encontrou a aba correta pro mês M. Categoria por NOME (nunca "Diversos"
                    // tratado como válido) — nome não reconhecido aborta a importação inteira
                    // logo abaixo, depois de confirmar que a aba não está simplesmente vazia.
                    // Achado Jangurussu (S-WM-35): "ESPORTE - JUNHO" (sem o S) virava "Diversos"
                    // e caía num parser genérico que gravou nome de professor como título.
                    const categoriaVal = detectarCategoria(sheetName)

                    // Processa o conteúdo
                    const ws = wb.Sheets[sheetName]
                    // raw: false força o conversor a mastigar as células numéricas devolvendo textos formatados como aparecem no Excel
                    const data: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: "dd/mm/yyyy" })

                    // FIX2: dados começam na linha 3 (índice 2), header na linha 2 (índice 1)
                    const rows: any[][] = data.slice(2)
                    const headerRow: any[] = data[1] || []

                    // Aba genuinamente vazia (sem nenhuma célula preenchida em nenhuma linha de
                    // dado) continua só um aviso, não aborta o arquivo inteiro — comportamento
                    // preservado. Diferente de "tem dado mas a estrutura não bate", queABORTA
                    // logo abaixo (essa é a distinção que importa: nada pra ler vs. algo pra ler
                    // que não dá pra confiar).
                    const sheetTemDados = rows.some((row) => (row || []).some((cel) => String(cel ?? "").trim() !== ""))
                    if (!sheetTemDados) {
                        appendLog("warning", sheetName, "Aba encontrada, porém vazia ou em formatação incompatível com a leitura.")
                        continue
                    }

                    if (!categoriaVal) {
                        throw new Error(
                            `Aba "${sheetName}": categoria não reconhecida (esperado uma das: ${CATEGORIAS_VALIDAS.join(", ")}, no formato "CATEGORIA - MÊS"). ` +
                            `Corrija o nome da aba na planilha e tente novamente — nenhuma atividade foi importada deste arquivo.`
                        )
                    }

                    const colunasEsperadas =
                        categoriaVal === "ESPORTES" ? COLUNAS_ESPORTES :
                        categoriaVal === "CURSOS" ? COLUNAS_CURSOS :
                        COLUNAS_DIA_A_DIA // única opção restante (DIA A DIA | ESPECIAIS) — categoriaVal já validado acima

                    // Detecção de colunas por NOME, nunca por posição fixa assumida — quando uma
                    // coluna esperada não é encontrada com confiança, ABORTA a importação
                    // inteira (nunca cai num índice fixo de fallback). Foi exatamente o fallback
                    // silencioso por posição que embaralhou os campos de José Walter (S-WM-35).
                    const deteccao = detectarColunas(headerRow, colunasEsperadas)
                    if (!deteccao.ok) {
                        const detalhes = [
                            deteccao.faltando.length > 0
                                ? `coluna(s) ausente(s) [${deteccao.faltando.join(", ")}]`
                                : null,
                            deteccao.colisoes.length > 0
                                ? `coluna(s) ambígua(s) [${deteccao.colisoes.map((c) => `${c.chaves.join(" + ")} -> "${c.header}" (índice ${c.indice})`).join("; ")}]`
                                : null,
                        ].filter(Boolean).join("; ")

                        throw new Error(
                            `Aba "${sheetName}" (categoria ${categoriaVal}): não foi possível identificar as colunas com segurança pelo nome do header: ${detalhes}. ` +
                            `Header lido na linha 2: [${deteccao.headerEncontrado.join(" | ")}]. ` +
                            `Corrija o nome da(s) coluna(s) na planilha (ou ajuste o reconhecimento em planilha-parser.ts) e tente novamente — nenhuma atividade foi importada deste arquivo.`
                        )
                    }
                    const idx = deteccao.indices

                    let countNaAba = 0
                    const fallbackDate = new Date(anoAtual, mesInt - 1, 1).toISOString().split('T')[0]

                    const parseTimeString = (timeStr: string | null | undefined): string | null => {
                        if (!timeStr) return null;
                        // FIX4: normaliza maiúsculos e variações de acentuação antes de processar
                        let s = String(timeStr).trim().toLowerCase().replace(/\bás\b/g, 'às').replace(/\bàs\b/g, 'às');

                        // Se contém "às", é um campo de horário composto — retorna apenas a parte antes de "às"
                        if (s.includes('às')) {
                            s = s.split('às')[0].trim();
                        }

                        s = s.replace(/h$/g, ':').replace(/h(\d)/g, ':$1');
                        if (s.endsWith(':')) s = s + '00';

                        const parts = s.split(':');
                        if (parts.length >= 1) {
                            const hInt = parseInt(parts[0]);
                            if (isNaN(hInt)) return null;
                            let h = hInt.toString().padStart(2, '0');
                            let m = parts.length >= 2 ? parseInt(parts[1]) : 0;
                            if (isNaN(m)) m = 0;
                            let mStr = m.toString().padStart(2, '0');
                            return `${h}:${mStr}:00`;
                        }
                        return null;
                    }

                    rows.forEach(row => {
                        let titulo = ""
                        let descricao = ""
                        let local = "Não informado"
                        let horaInicioStr = ""
                        let horaFimStr = ""
                        let meta: any = {}

                        if (categoriaVal === "CURSOS") {
                            titulo = lerColuna(row, idx, "titulo")
                            meta = {
                                ementa: lerColuna(row, idx, "ementa"),
                                requisitos: lerColuna(row, idx, "requisitos"),
                                periodo: lerColuna(row, idx, "periodo"),
                                horario: lerColuna(row, idx, "horario"),
                                carga_horaria: lerColuna(row, idx, "carga_horaria"),
                                vagas: lerColuna(row, idx, "vagas"),
                                educador: lerColuna(row, idx, "educador"),
                            }

                            descricao = `Curso: ${titulo}. Educador: ${meta.educador}. Vagas: ${meta.vagas}. Carga Horária: ${meta.carga_horaria}h. Período: ${meta.periodo}. Horário: ${meta.horario}. Requisitos: ${meta.requisitos}. Ementa: ${meta.ementa}`
                            local = "Não informado"

                            if (meta.horario) {
                                // FIX4: normaliza maiúsculos antes do split
                                const rawH = meta.horario.toLowerCase().replace(/\bás\b/g, 'às')
                                const parts = rawH.split("às")
                                if (parts.length === 2) {
                                    horaInicioStr = parts[0].trim()
                                    horaFimStr = parts[1].trim()
                                }
                            }
                        } else if (categoriaVal === "ESPORTES") {
                            titulo = lerColuna(row, idx, "titulo")
                            const horarioRaw = lerColuna(row, idx, "horario")
                            meta = {
                                professor: lerColuna(row, idx, "professor"),
                                turma: lerColuna(row, idx, "turma"),
                                faixa_etaria: lerColuna(row, idx, "faixaEtaria"),
                                sexo: lerColuna(row, idx, "sexo"),
                                vagas: lerColuna(row, idx, "vagas"),
                                dias_semana: lerColuna(row, idx, "dias"),
                                horario: horarioRaw
                            }

                            descricao = `Esporte Modalidade: ${titulo} - Turma ${meta.turma}. Professor: ${meta.professor}. Vagas: ${meta.vagas}. Público: ${meta.sexo} (Idade: ${meta.faixa_etaria}). Dias: ${meta.dias_semana}. Horário: ${meta.horario}.`
                            local = "Não informado"

                            if (horarioRaw) {
                                // FIX4: normaliza variações de acentuação e maiúsculos
                                const rawH = horarioRaw.toLowerCase().replace(/\bás\b/g, 'às').replace(/\bàs\b/g, 'às')
                                const parts = rawH.split("às")
                                if (parts.length === 2) {
                                    horaInicioStr = parts[0].trim()
                                    horaFimStr = parts[1].trim()
                                }
                            }
                        } else {
                            // DIA A DIA / ESPECIAIS — única categoria restante (categoriaVal já
                            // validado contra CATEGORIAS_VALIDAS por detectarCategoria acima).
                            titulo = lerColuna(row, idx, "titulo")
                            const horaInicioRaw = lerColuna(row, idx, "hora_inicio")
                            const horaFimRaw = lerColuna(row, idx, "hora_fim")

                            // FIX4: detecta se hora_inicio contém horário composto (ex: "19:00 ÀS 20:30")
                            const horaInicioNorm = horaInicioRaw.toLowerCase().replace(/\bás\b/g, 'às').replace(/\bàs\b/g, 'às')
                            if (horaInicioNorm.includes('às')) {
                                const parts = horaInicioNorm.split('às')
                                horaInicioStr = parts[0].trim()
                                horaFimStr = parts[1].trim()
                            } else {
                                horaInicioStr = horaInicioNorm.trim()
                                horaFimStr = horaFimRaw.toLowerCase().trim()
                            }

                            // FIX5: usa a data real do evento em vez do fallback de 1º do mês
                            const dataRealRaw = lerColuna(row, idx, "data")
                            let dataAtividade = fallbackDate
                            if (dataRealRaw) {
                                if (/\d{2}\/\d{2}\/\d{4}/.test(dataRealRaw)) {
                                    const parts = dataRealRaw.split('/')
                                    const d = parts[0].replace(/\D/g, '').padStart(2, '0')
                                    const m = parts[1].replace(/\D/g, '').padStart(2, '0')
                                    const y = (parts[2] || '').match(/\d{4}/)?.[0] || String(anoAtual)
                                    const candidate = `${y}-${m}-${d}`
                                    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) dataAtividade = candidate
                                } else if (/\d{4}-\d{2}-\d{2}/.test(dataRealRaw)) {
                                    dataAtividade = dataRealRaw.match(/\d{4}-\d{2}-\d{2}/)![0]
                                }
                            }

                            meta = {
                                sessao: lerColuna(row, idx, "sessao"),
                                data_real: dataRealRaw,
                                dia_semana: lerColuna(row, idx, "dia_semana"),
                                atividade: lerColuna(row, idx, "atividade"),
                                local: lerColuna(row, idx, "local"),
                                informacoes: lerColuna(row, idx, "informacoes"),
                                hora_inicio: horaInicioStr,
                                hora_fim: horaFimStr
                            }

                            descricao = `Programa (${categoriaVal}): ${titulo}. Atividade: ${meta.atividade}. Data: ${meta.data_real} (${meta.dia_semana}). Horário: ${horaInicioStr} às ${horaFimStr}. Local: ${meta.local}. Informações: ${meta.informacoes}. Sessão: ${meta.sessao}.`
                            local = meta.local || "Não informado"

                            // Usa dataAtividade calculada acima
                            if (titulo && titulo.trim() !== "") {
                                atividadesToInsert.push({
                                    unidade_cuca: unidadeCuca,
                                    titulo: titulo.substring(0, 100),
                                    descricao: String(descricao).substring(0, 1500),
                                    local: String(local).substring(0, 255),
                                    data_atividade: dataAtividade,
                                    hora_inicio: parseTimeString(horaInicioStr),
                                    hora_fim: parseTimeString(horaFimStr),
                                    categoria: categoriaVal,
                                    metadata: meta
                                })
                                countNaAba++
                            }
                            return // Evita o push duplicado abaixo
                        }

                        // Validação: Atividade só é válida se tiver um título válido escrito
                        if (titulo && titulo.trim() !== "") {
                            atividadesToInsert.push({
                                unidade_cuca: unidadeCuca,
                                titulo: titulo.substring(0, 100),
                                descricao: String(descricao).substring(0, 1500),
                                local: String(local).substring(0, 255),
                                data_atividade: fallbackDate,
                                hora_inicio: parseTimeString(horaInicioStr),
                                hora_fim: parseTimeString(horaFimStr),
                                categoria: categoriaVal,
                                metadata: meta
                            })
                            countNaAba++
                        }
                    })

                    if (countNaAba > 0) {
                        appendLog("success", sheetName, `Concluído (${countNaAba} tarefas encontradas e validadas). Categoria mapeada: ${categoriaVal}`)
                        abasImportadasSucesso++
                    } else {
                        appendLog("warning", sheetName, "Aba encontrada, porém nenhuma linha com título válido.")
                    }
                }

                if (atividadesToInsert.length === 0) {
                    appendLog("error", "Arquivo Vazio", "Nenhuma linha válida convertida para inserir. Cheque formato da tabela e header.")
                    throw new Error("Tabela zerada.")
                }

                // 1. Criar a Campanha Mensal "Pai"
                appendLog("info", "Banco de Dados", "Registrando " + atividadesToInsert.length + " atividades validadas...")

                // Usa API route server-side para bypassar problema de JWT expirado no client
                const importRes = await fetch("/api/programacao/importar", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        campanha: {
                            titulo: `Programação Mensal - ${mesInt}/${anoAtual}`,
                            unidade_cuca: unidadeCuca,
                            mes: mesInt,
                            ano: anoAtual,
                            total_atividades: atividadesToInsert.length,
                            status: "pendente"
                        },
                        atividades: atividadesToInsert
                    }),
                    signal: AbortSignal.timeout(60000)
                })

                if (!importRes.ok) {
                    const errData = await importRes.json().catch(() => ({ error: importRes.statusText }))
                    throw new Error("Erro ao salvar no banco: " + (errData.error || importRes.statusText))
                }

                const { campanha_id } = await importRes.json()
                const newCamp = { id: campanha_id }

                appendLog("success", "Finalizado", "Programação de " + mesObj.label + " importada com sucesso para o banco.")
                appendLog("info", "Classificação de Inteligência", "Iniciando estruturação automática de Eixos e Modalidades (Categorias) no Worker...")

                // S19-02: Dispara a normalização de categorias no Worker via LLM em background
                try {
                    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "https://uazapi.cucaatendemais.com.br"
                    // FIX1: timeout de 15s para não travar o spinner se o worker não responder
                    await fetch(`${workerUrl}/extract-categories`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ campanha_id: newCamp.id }),
                        signal: AbortSignal.timeout(15000)
                    })
                    appendLog("success", "Categorização Iniciada", "Taxonomia em processo de normalização no servidor.")
                } catch (e) {
                    // Falha não bloqueante
                    console.error("Erro ao solicitar extração de categorias:", e)
                    appendLog("warning", "Categorização", "Falha ao acionar a normalização, mas os dados principais foram salvos.")
                }

                toast.success("Importação concluída com sucesso!")

                // FIX1: garante que o loading para antes de fechar o modal
                setIsLoading(false)

                // Dispara refresh pra grid na background pós delay e redireciona pra Tabela Rica
                setTimeout(() => {
                    handleOpenChange(false)
                    onSuccess()
                    router.push(`/programacao/mensal/${newCamp.id}`)
                }, 3000)

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
