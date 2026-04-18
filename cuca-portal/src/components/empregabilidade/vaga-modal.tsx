"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Empresa } from "@/lib/types/database"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, Save, AlertCircle, Trash2 } from "lucide-react"
import { useUser } from "@/lib/auth/user-provider"

interface VagaModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess: () => void
    vaga?: Vaga | null
}

// Monta string de carga horária a partir dos campos estruturados
function buildCargaHoraria(tipo: string, horas: string, escalaT: string, escalaF: string, diasSemana: string, trabSabado: boolean, sabadoAte: string): string {
    if (tipo === "escala") {
        return escalaT && escalaF ? `${escalaT}x${escalaF}` : ""
    }
    if (tipo === "jornada_corrida") {
        return horas ? `Jornada Corrida ${horas}h/dia` : "Jornada Corrida"
    }
    // horario_comercial
    let str = horas ? `${horas}h/dia` : ""
    if (diasSemana) str += ` | ${diasSemana}`
    if (trabSabado) str += ` | Sábados até ${sabadoAte || "12:00"}`
    return str
}

// Tenta parsear string existente nos campos estruturados
function parseCargaHoraria(raw: string) {
    if (!raw) return { tipo: "horario_comercial", horas: "", escalaT: "", escalaF: "", diasSemana: "Seg à Sex", trabSabado: false, sabadoAte: "12:00" }
    if (/^\d+x\d+$/i.test(raw.trim())) {
        const [t, f] = raw.trim().split("x")
        return { tipo: "escala", horas: "", escalaT: t, escalaF: f, diasSemana: "Seg à Sex", trabSabado: false, sabadoAte: "12:00" }
    }
    if (raw.toLowerCase().includes("jornada corrida")) {
        const m = raw.match(/(\d+)h/)
        return { tipo: "jornada_corrida", horas: m ? m[1] : "", escalaT: "", escalaF: "", diasSemana: "Seg à Sex", trabSabado: false, sabadoAte: "12:00" }
    }
    const horasM = raw.match(/(\d+)h/)
    const sabM = raw.match(/Sábados até (\d{2}:\d{2})/)
    return {
        tipo: "horario_comercial",
        horas: horasM ? horasM[1] : "",
        escalaT: "", escalaF: "",
        diasSemana: "Seg à Sex",
        trabSabado: sabM !== null,
        sabadoAte: sabM ? sabM[1] : "12:00"
    }
}

export function VagaModal({ open, onOpenChange, onSuccess, vaga }: VagaModalProps) {
    const { hasPermission } = useUser()
    const [loading, setLoading] = useState(false)
    const [fetching, setFetching] = useState(false)
    const [erro, setErro] = useState("")
    const [empresas, setEmpresas] = useState<Empresa[]>([])
    const [unidadesMap, setUnidadesMap] = useState<Record<string, string>>({})

    const [empresaId, setEmpresaId] = useState("")
    const [titulo, setTitulo] = useState("")
    const [descricao, setDescricao] = useState("")
    const [requisitos, setRequisitos] = useState("")
    const [salario, setSalario] = useState("")
    const [beneficios, setBeneficios] = useState("")
    const [tipoContrato, setTipoContrato] = useState("clt")
    const [local, setLocal] = useState("")
    const [unidadeCucaId, setUnidadeCucaId] = useState("")
    const [totalVagas, setTotalVagas] = useState("1")
    const [status, setStatus] = useState("pre_cadastro")
    const [faixaEtaria, setFaixaEtaria] = useState("")
    const [localEntrevista, setLocalEntrevista] = useState("na_empresa")
    const [enderecoEntrevista, setEnderecoEntrevista] = useState("")
    const [tipoSelecao, setTipoSelecao] = useState("presencial")
    const [expansiva, setExpansiva] = useState(false)
    const [emailContatoEmpresa, setEmailContatoEmpresa] = useState("")
    const [telefoneResponsavel, setTelefoneResponsavel] = useState("")
    const [escolaridadeMinima, setEscolaridadeMinima] = useState("")

    // Carga horária estruturada
    const [cargaTipo, setCargaTipo] = useState("horario_comercial")
    const [cargaHoras, setCargaHoras] = useState("")
    const [cargaEscalaT, setCargaEscalaT] = useState("")
    const [cargaEscalaF, setCargaEscalaF] = useState("")
    const [cargaDias, setCargaDias] = useState("Seg à Sex")
    const [cargaTrabSabado, setCargaTrabSabado] = useState(false)
    const [cargaSabadoAte, setCargaSabadoAte] = useState("12:00")

    // Roteamento Multi-Tenant (SQS-41)
    const [unidadeDestino, setUnidadeDestino] = useState("")

    // Setor / Área da vaga
    const [setoresMarcados, setSetoresMarcados] = useState<string[]>([])

    // PCD
    const [pcdVaga, setPcdVaga] = useState(false)
    const [pcdTipo, setPcdTipo] = useState("")
    const [pcdHomologado, setPcdHomologado] = useState(false)

    const supabase = createClient()

    useEffect(() => {
        if (open) carregarDadosPreAbertura()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const carregarDadosPreAbertura = async () => {
        setFetching(true)
        setErro("")
        try {
            const { data: empData } = await supabase.from('empresas').select('*').eq('ativa', true)
            if (empData) setEmpresas(empData)

            const { data: udData } = await supabase.from('unidades_cuca').select('id, nome')
            if (udData) {
                const map: Record<string, string> = {}
                udData.forEach(u => map[u.id] = u.nome)
                setUnidadesMap(map)
            }

            if (vaga) {
                setEmpresaId(vaga.empresa_id)
                setTitulo(vaga.titulo)
                setDescricao(vaga.descricao)
                setRequisitos(vaga.requisitos || "")
                setSalario(vaga.salario || "")
                setBeneficios(vaga.beneficios || "")
                setTipoContrato(vaga.tipo_contrato || "clt")
                setLocal(vaga.local || "")
                setUnidadeCucaId(vaga.unidade_cuca || "")
                setTotalVagas(vaga.total_vagas.toString())
                setStatus(vaga.status)
                setFaixaEtaria(vaga.faixa_etaria || "")
                setLocalEntrevista(vaga.local_entrevista || "na_empresa")
                setEnderecoEntrevista((vaga as any).endereco_entrevista || "")
                setTipoSelecao(vaga.tipo_selecao || "presencial")
                setExpansiva(vaga.expansiva || false)
                setEmailContatoEmpresa(vaga.email_contato_empresa || "")
                setTelefoneResponsavel(vaga.telefone_responsavel || "")
                setEscolaridadeMinima(vaga.escolaridade_minima || "")
                setUnidadeDestino((vaga as any).unidade_destino || "")
                setSetoresMarcados((vaga as any).setor || [])
                setPcdVaga(vaga.pcd_vaga || false)
                setPcdTipo(vaga.pcd_tipo || "")
                setPcdHomologado(vaga.pcd_homologado || false)
                const p = parseCargaHoraria(vaga.carga_horaria || "")
                setCargaTipo(p.tipo)
                setCargaHoras(p.horas)
                setCargaEscalaT(p.escalaT)
                setCargaEscalaF(p.escalaF)
                setCargaDias(p.diasSemana)
                setCargaTrabSabado(p.trabSabado)
                setCargaSabadoAte(p.sabadoAte)
            } else {
                resetForm()
            }
        } catch (error) {
            console.error("Erro ao carregar dados pro modal:", error)
        } finally {
            setFetching(false)
        }
    }

    const resetForm = () => {
        setEmpresaId(""); setTitulo(""); setDescricao(""); setRequisitos("")
        setSalario(""); setBeneficios(""); setTipoContrato("clt"); setLocal("")
        setUnidadeCucaId(""); setTotalVagas("1"); setStatus("pre_cadastro")
        setFaixaEtaria(""); setLocalEntrevista("na_empresa"); setEnderecoEntrevista("")
        setTipoSelecao("presencial"); setExpansiva(false); setEmailContatoEmpresa("")
        setTelefoneResponsavel(""); setEscolaridadeMinima(""); setUnidadeDestino(""); setSetoresMarcados([])
        setPcdVaga(false); setPcdTipo(""); setPcdHomologado(false)
        setCargaTipo("horario_comercial"); setCargaHoras(""); setCargaEscalaT("")
        setCargaEscalaF(""); setCargaDias("Seg à Sex"); setCargaTrabSabado(false); setCargaSabadoAte("12:00")
        setErro("")
    }

    const handleSave = async () => {
        if (!empresaId || !titulo || !descricao || !unidadeCucaId) return
        if (!unidadeDestino) {
            setErro("Selecione a unidade de destino da vaga. Este campo é obrigatório.")
            return
        }
        if (setoresMarcados.length === 0) {
            setErro("Selecione pelo menos uma área da vaga. Este campo é obrigatório.")
            return
        }
        setErro("")
        setLoading(true)
        try {
            const cargaHoraria = buildCargaHoraria(cargaTipo, cargaHoras, cargaEscalaT, cargaEscalaF, cargaDias, cargaTrabSabado, cargaSabadoAte)

            // Número sequencial atômico via RPC (evita race condition)
            let numero_vaga: number | undefined
            if (!vaga) {
                const { data: seqData, error: seqError } = await supabase.rpc("next_numero_vaga")
                if (seqError) throw new Error("Erro ao gerar número de vaga: " + seqError.message)
                numero_vaga = seqData as number
            }

            const payload = {
                empresa_id: empresaId,
                titulo,
                descricao,
                requisitos: requisitos || null,
                salario: salario || null,
                beneficios: beneficios || null,
                tipo_contrato: tipoContrato,
                carga_horaria: cargaHoraria || null,
                local: local || null,
                unidade_cuca: unidadesMap[unidadeCucaId] || unidadeCucaId,
                unidade_destino: unidadeDestino,
                setor: setoresMarcados,
                total_vagas: parseInt(totalVagas) || 1,
                status,
                faixa_etaria: faixaEtaria,
                local_entrevista: localEntrevista,
                endereco_entrevista: enderecoEntrevista || null,
                tipo_selecao: tipoSelecao,
                expansiva,
                email_contato_empresa: emailContatoEmpresa || null,
                telefone_responsavel: telefoneResponsavel || null,
                escolaridade_minima: escolaridadeMinima || null,
                data_abertura: status === 'aberta' ? new Date().toISOString() : null,
                pcd_vaga: pcdVaga,
                pcd_tipo: pcdVaga ? (pcdTipo || null) : null,
                pcd_homologado: pcdVaga ? pcdHomologado : false,
                ...(numero_vaga !== undefined && { numero_vaga }),
            }

            if (vaga) {
                const { error } = await supabase.from('vagas').update(payload).eq('id', vaga.id)
                if (error) throw error
            } else {
                const { error } = await supabase.from('vagas').insert(payload)
                if (error) throw error
            }

            onSuccess()
            onOpenChange(false)
            resetForm()
        } catch (error: unknown) {
            console.error("Erro ao salvar vaga:", error)
            const msg = error instanceof Error ? error.message : String(error)
            setErro(msg || "Erro ao salvar vaga. Verifique suas permissões.")
        } finally {
            setLoading(false)
        }
    }

    const canEdit = hasPermission("empreg_vagas", "update") || hasPermission("empreg_vagas", "create")
    // Campos preenchidos pela empresa — CUCA não edita
    const camposEmpresaReadOnly = !!vaga

    const handleSaveStatus = async () => {
        if (!vaga) return
        if (!unidadeDestino) {
            setErro("Selecione a unidade de destino da vaga. Este campo é obrigatório.")
            return
        }
        if (setoresMarcados.length === 0) {
            setErro("Selecione pelo menos uma área da vaga. Este campo é obrigatório.")
            return
        }
        setErro("")
        setLoading(true)
        try {
            // Salvar nome da unidade (não o UUID) para compatibilidade com o worker
            const unidadeNome = unidadesMap[unidadeCucaId] || unidadeCucaId
            const { error } = await supabase.from('vagas').update({
                status,
                unidade_cuca: unidadeNome,
                unidade_destino: unidadeDestino,
                setor: setoresMarcados,
                expansiva,
                email_contato_empresa: emailContatoEmpresa || null,
                telefone_responsavel: telefoneResponsavel || null,
                data_abertura: status === 'aberta' ? new Date().toISOString() : undefined,
            }).eq('id', vaga.id)
            if (error) throw error
            onSuccess()
            onOpenChange(false)
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error)
            setErro(msg || "Erro ao salvar.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{vaga ? `Vaga: ${titulo || "—"}` : "Cadastrar Nova Vaga"}</DialogTitle>
                    <DialogDescription>
                        {vaga
                            ? "As informações da vaga foram preenchidas pela empresa. O CUCA pode alterar status, unidade e divulgação."
                            : "Preencha os detalhes da oportunidade de emprego ou estágio."}
                    </DialogDescription>
                </DialogHeader>

                {fetching ? (
                    <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
                ) : (
                    <div className="grid gap-6 py-4">

                        {/* Aviso quando visualizando vaga existente */}
                        {camposEmpresaReadOnly && (
                            <div className="flex items-start gap-2 text-sm text-amber-600 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                <span>Os dados abaixo foram preenchidos pela empresa e são de responsabilidade dela. O CUCA não pode alterá-los.</span>
                            </div>
                        )}

                        {/* Empresa + Unidade */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Empresa Parceira {!camposEmpresaReadOnly && "*"}</Label>
                                {camposEmpresaReadOnly ? (
                                    <p className="text-sm font-medium px-3 py-2 bg-muted rounded-md">{empresas.find(e => e.id === empresaId)?.nome || empresaId}</p>
                                ) : (
                                    <Select value={empresaId} onValueChange={setEmpresaId}>
                                        <SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
                                        <SelectContent>
                                            {empresas.map(e => <SelectItem key={e.id} value={e.id}>{e.nome} - {e.cnpj}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label>Unidade Rede CUCA (Ancoragem) *</Label>
                                <Select value={unidadeCucaId} onValueChange={setUnidadeCucaId}>
                                    <SelectTrigger><SelectValue placeholder="Selecione o equipamento" /></SelectTrigger>
                                    <SelectContent>
                                        {Object.keys(unidadesMap).map(id => <SelectItem key={id} value={id}>{unidadesMap[id]}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Dados da vaga — somente leitura quando editando */}
                        <div className={`grid gap-4 ${camposEmpresaReadOnly ? "opacity-70 pointer-events-none" : ""}`}>
                            <div className="space-y-2">
                                <Label>Título da Vaga *</Label>
                                <Input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Jovem Aprendiz Administrativo" readOnly={camposEmpresaReadOnly} />
                            </div>
                            <div className="space-y-2">
                                <Label>Descrição da Vaga *</Label>
                                <Textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descreva as atividades..." className="h-24" readOnly={camposEmpresaReadOnly} />
                            </div>
                            <div className="space-y-2">
                                <Label>Requisitos e Perfil Desejado</Label>
                                <Textarea value={requisitos} onChange={e => setRequisitos(e.target.value)} placeholder="Conhecimento em informática, boa comunicação..." readOnly={camposEmpresaReadOnly} />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label>Tipo de Contrato</Label>
                                    {camposEmpresaReadOnly ? (
                                        <p className="text-sm font-medium px-3 py-2 bg-muted rounded-md">{tipoContrato}</p>
                                    ) : (
                                        <Select value={tipoContrato} onValueChange={setTipoContrato}>
                                            <SelectTrigger><SelectValue placeholder="Tipo de contrato" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="clt">CLT</SelectItem>
                                                <SelectItem value="estagio">Estágio</SelectItem>
                                                <SelectItem value="aprendiz">Jovem Aprendiz</SelectItem>
                                                <SelectItem value="pj">PJ / Freelancer</SelectItem>
                                                <SelectItem value="temporario">Temporário</SelectItem>
                                                <SelectItem value="autonomo">Autônomo</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label>Salário / Bolsa</Label>
                                    <Input value={salario} readOnly={camposEmpresaReadOnly} onChange={e => setSalario(e.target.value)} placeholder="R$ 0,00" className={camposEmpresaReadOnly ? "bg-muted" : ""} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Total de Vagas</Label>
                                    <Input type="number" value={totalVagas} readOnly={camposEmpresaReadOnly} onChange={e => setTotalVagas(e.target.value)} className={camposEmpresaReadOnly ? "bg-muted" : ""} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Faixa Etária *</Label>
                                <Select value={faixaEtaria} onValueChange={setFaixaEtaria}>
                                    <SelectTrigger className={!faixaEtaria ? "border-amber-500/60" : ""}><SelectValue placeholder="Selecione a faixa etária..." /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="A partir de 14 anos">A partir de 14 anos</SelectItem>
                                        <SelectItem value="Maior de 18 anos">Maior de 18 anos</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Carga Horária</Label>
                                    {camposEmpresaReadOnly ? (
                                        <p className="text-sm font-medium px-3 py-2 bg-muted rounded-md">{vaga?.carga_horaria || "—"}</p>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="flex gap-2">
                                                {(["horario_comercial", "escala", "jornada_corrida"] as const).map(t => (
                                                    <button key={t} type="button" onClick={() => setCargaTipo(t)}
                                                        className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${cargaTipo === t ? "bg-cuca-blue text-white border-cuca-blue" : "border-border text-muted-foreground hover:border-cuca-blue/50"}`}>
                                                        {t === "horario_comercial" ? "Comercial" : t === "escala" ? "Escala" : "Corrida"}
                                                    </button>
                                                ))}
                                            </div>
                                            {cargaTipo === "escala" && (
                                                <div className="flex items-center gap-2">
                                                    <Input className="w-16 text-center text-sm" value={cargaEscalaT} onChange={e => setCargaEscalaT(e.target.value)} placeholder="6" />
                                                    <span className="text-muted-foreground">x</span>
                                                    <Input className="w-16 text-center text-sm" value={cargaEscalaF} onChange={e => setCargaEscalaF(e.target.value)} placeholder="2" />
                                                </div>
                                            )}
                                            {(cargaTipo === "horario_comercial" || cargaTipo === "jornada_corrida") && (
                                                <div className="flex items-center gap-2">
                                                    <Input className="w-16 text-center text-sm" value={cargaHoras} onChange={e => setCargaHoras(e.target.value)} placeholder="8" />
                                                    <span className="text-xs text-muted-foreground">h/dia</span>
                                                </div>
                                            )}
                                            {buildCargaHoraria(cargaTipo, cargaHoras, cargaEscalaT, cargaEscalaF, cargaDias, cargaTrabSabado, cargaSabadoAte) && (
                                                <p className="text-xs text-muted-foreground">{buildCargaHoraria(cargaTipo, cargaHoras, cargaEscalaT, cargaEscalaF, cargaDias, cargaTrabSabado, cargaSabadoAte)}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label>Localização da Vaga</Label>
                                    <Input value={local} readOnly={camposEmpresaReadOnly} onChange={e => setLocal(e.target.value)} className={camposEmpresaReadOnly ? "bg-muted" : ""} />
                                </div>
                            </div>
                        </div>

                        {/* Status + Unidade Destino + Expansiva — editável pela CUCA */}
                        <div className="space-y-4 bg-muted/40 p-4 rounded-xl border">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Controles da Rede CUCA</p>

                            {/* Área / Setor — obrigatório */}
                            <div className="space-y-2">
                                <Label className="font-medium">Área da Vaga *</Label>
                                <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
                                    {[
                                        "Serviços Gerais (limpeza, portaria, zeladoria)",
                                        "Construção Civil (pedreiro, ajudante, eletricista, encanador)",
                                        "Logística e Entregas (estoque, separação, entregador, motorista)",
                                        "Comércio e Vendas (vendedor, caixa, atendimento)",
                                        "Alimentação (cozinha, garçom, lanchonete)",
                                        "Tecnologia (suporte técnico, programação, dados)",
                                        "Criativo / Digital (design, vídeo, redes sociais)",
                                        "Beleza e Estética (barbeiro, manicure, cabeleireiro)",
                                        "Cuidados Pessoais (babá, cuidador de idosos)",
                                        "Administrativo / Escritório (recepção, auxiliar administrativo)",
                                        "Produção (auxiliar, analista e tecnico)",
                                    ].map(s => (
                                        <label key={s} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 cursor-pointer text-sm transition-colors ${setoresMarcados.includes(s) ? "border-cuca-blue bg-cuca-blue/10 text-cuca-blue font-medium" : "border-border hover:border-cuca-blue/40"}`}>
                                            <input
                                                type="checkbox"
                                                className="accent-blue-600"
                                                checked={setoresMarcados.includes(s)}
                                                onChange={() => setSetoresMarcados(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
                                            />
                                            {s}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Unidade de Destino *</Label>
                                <Select value={unidadeDestino} onValueChange={setUnidadeDestino}>
                                    <SelectTrigger className={!unidadeDestino ? "border-amber-500/60" : ""}><SelectValue placeholder="Selecione a unidade de destino..." /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="global">🌐 Toda a Rede CUCA</SelectItem>
                                        {Object.keys(unidadesMap).map(id => (
                                            <SelectItem key={id} value={id}>{unidadesMap[id]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {unidadeDestino === "global"
                                        ? "Candidatos serão questionados sobre a unidade mais próxima pelo bot."
                                        : "Candidatos serão encaminhados diretamente para esta unidade."}
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-4 items-center">
                                <div className="space-y-2">
                                    <Label>Status da Vaga</Label>
                                    <Select value={status} onValueChange={setStatus}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="pre_cadastro">Pré-Cadastro (Rascunho)</SelectItem>
                                            <SelectItem value="aberta">Pública / Aberta</SelectItem>
                                            <SelectItem value="preenchida">Preenchida</SelectItem>
                                            <SelectItem value="cancelada">Cancelada</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex flex-row items-start space-x-3 space-y-0 mt-6">
                                    <Checkbox id="expansiva" checked={expansiva} onCheckedChange={c => setExpansiva(c as boolean)} />
                                    <div className="space-y-1 leading-none">
                                        <Label htmlFor="expansiva">Vaga Expansiva</Label>
                                        <p className="text-sm text-muted-foreground">Divulgada para todas as unidades do CUCA.</p>
                                    </div>
                                </div>
                            </div>
                            {/* Endereço da entrevista (condicional: na_empresa) */}
                            {localEntrevista === "na_empresa" && (
                                <div className="space-y-2">
                                    <Label>Endereço da Entrevista</Label>
                                    <Input
                                        value={enderecoEntrevista}
                                        onChange={e => setEnderecoEntrevista(e.target.value)}
                                        placeholder="Rua, número, bairro — endereço da empresa contratante"
                                    />
                                </div>
                            )}

                            {/* Contato da empresa — editável pelo CUCA para correções */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>E-mail para envio de CVs</Label>
                                    <Input
                                        value={emailContatoEmpresa}
                                        onChange={e => setEmailContatoEmpresa(e.target.value)}
                                        placeholder="rh@empresa.com.br"
                                        type="email"
                                    />
                                    <p className="text-xs text-muted-foreground">Usado para enviar currículos por e-mail.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label>Telefone do Responsável (RH)</Label>
                                    <Input
                                        value={telefoneResponsavel}
                                        onChange={e => setTelefoneResponsavel(e.target.value)}
                                        placeholder="(85) 99999-9999"
                                        type="tel"
                                    />
                                    <p className="text-xs text-muted-foreground">Usado para envio de feedback via WhatsApp.</p>
                                </div>
                            </div>

                            {/* PCD */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-3">
                                    <Checkbox id="pcdVaga" checked={pcdVaga} onCheckedChange={c => { setPcdVaga(c as boolean); if (!c) { setPcdTipo(""); setPcdHomologado(false) } }} />
                                    <Label htmlFor="pcdVaga" className="cursor-pointer">Vaga para PCD</Label>
                                </div>
                                {pcdVaga && (
                                    <div className="pl-7 space-y-2">
                                        <Input value={pcdTipo} onChange={e => setPcdTipo(e.target.value)} placeholder="Tipo de deficiência (opcional)" className="text-sm" />
                                        <div className="flex items-center gap-2">
                                            <Checkbox id="pcdHomologado" checked={pcdHomologado} onCheckedChange={c => setPcdHomologado(c as boolean)} />
                                            <Label htmlFor="pcdHomologado" className="text-sm cursor-pointer">Homologado para PCD</Label>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>


                        {/* Erro */}
                        {erro && (
                            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                <span>{erro}</span>
                            </div>
                        )}

                        {/* Ações */}
                        <div className="flex justify-end gap-2 mt-2">
                            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                                {canEdit ? "Cancelar" : "Fechar"}
                            </Button>
                            {canEdit && (
                                <Button
                                    className="bg-cuca-blue hover:bg-sky-800 text-white"
                                    onClick={camposEmpresaReadOnly ? handleSaveStatus : handleSave}
                                    disabled={loading || (!camposEmpresaReadOnly && (!empresaId || !titulo || !descricao || !unidadeCucaId)) || !unidadeDestino || setoresMarcados.length === 0}
                                >
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                                    {camposEmpresaReadOnly ? "Salvar Alterações" : "Salvar Vaga"}
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
