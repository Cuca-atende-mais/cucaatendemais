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
import { Loader2, Save, AlertCircle } from "lucide-react"
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
    const [faixaEtaria, setFaixaEtaria] = useState("15 a 29 anos")
    const [localEntrevista, setLocalEntrevista] = useState("na_empresa")
    const [tipoSelecao, setTipoSelecao] = useState("presencial")
    const [expansiva, setExpansiva] = useState(false)
    const [emailContatoEmpresa, setEmailContatoEmpresa] = useState("")
    const [escolaridadeMinima, setEscolaridadeMinima] = useState("")

    // Carga horária estruturada
    const [cargaTipo, setCargaTipo] = useState("horario_comercial")
    const [cargaHoras, setCargaHoras] = useState("")
    const [cargaEscalaT, setCargaEscalaT] = useState("")
    const [cargaEscalaF, setCargaEscalaF] = useState("")
    const [cargaDias, setCargaDias] = useState("Seg à Sex")
    const [cargaTrabSabado, setCargaTrabSabado] = useState(false)
    const [cargaSabadoAte, setCargaSabadoAte] = useState("12:00")

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
                setFaixaEtaria(vaga.faixa_etaria || "15 a 29 anos")
                setLocalEntrevista(vaga.local_entrevista || "na_empresa")
                setTipoSelecao(vaga.tipo_selecao || "presencial")
                setExpansiva(vaga.expansiva || false)
                setEmailContatoEmpresa(vaga.email_contato_empresa || "")
                setEscolaridadeMinima(vaga.escolaridade_minima || "")
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
        setFaixaEtaria("15 a 29 anos"); setLocalEntrevista("na_empresa")
        setTipoSelecao("presencial"); setExpansiva(false); setEmailContatoEmpresa("")
        setEscolaridadeMinima("")
        setCargaTipo("horario_comercial"); setCargaHoras(""); setCargaEscalaT("")
        setCargaEscalaF(""); setCargaDias("Seg à Sex"); setCargaTrabSabado(false); setCargaSabadoAte("12:00")
        setErro("")
    }

    const handleSave = async () => {
        if (!empresaId || !titulo || !descricao || !unidadeCucaId) return
        setErro("")
        setLoading(true)
        try {
            const cargaHoraria = buildCargaHoraria(cargaTipo, cargaHoras, cargaEscalaT, cargaEscalaF, cargaDias, cargaTrabSabado, cargaSabadoAte)

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
                unidade_cuca: unidadeCucaId,
                total_vagas: parseInt(totalVagas) || 1,
                status,
                faixa_etaria: faixaEtaria,
                local_entrevista: localEntrevista,
                tipo_selecao: tipoSelecao,
                expansiva,
                email_contato_empresa: emailContatoEmpresa || null,
                escolaridade_minima: escolaridadeMinima || null,
                data_abertura: status === 'aberta' ? new Date().toISOString() : null
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{vaga ? "Editar Vaga" : "Cadastrar Nova Vaga"}</DialogTitle>
                    <DialogDescription>
                        Preencha os detalhes da oportunidade de emprego ou estágio.
                    </DialogDescription>
                </DialogHeader>

                {fetching ? (
                    <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
                ) : (
                    <div className="grid gap-6 py-4">

                        {/* Empresa + Unidade */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Empresa Parceira *</Label>
                                <Select value={empresaId} onValueChange={setEmpresaId}>
                                    <SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
                                    <SelectContent>
                                        {empresas.map(e => <SelectItem key={e.id} value={e.id}>{e.nome} - {e.cnpj}</SelectItem>)}
                                    </SelectContent>
                                </Select>
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

                        {/* Título */}
                        <div className="space-y-2">
                            <Label>Título da Vaga *</Label>
                            <Input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Jovem Aprendiz Administrativo" />
                        </div>

                        {/* Descrição */}
                        <div className="space-y-2">
                            <Label>Descrição da Vaga *</Label>
                            <Textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descreva as atividades, ambiente de trabalho, etc." className="h-24" />
                        </div>

                        {/* Requisitos */}
                        <div className="space-y-2">
                            <Label>Requisitos e Perfil Desejado</Label>
                            <Textarea value={requisitos} onChange={e => setRequisitos(e.target.value)} placeholder="Conhecimento em informática, boa comunicação..." />
                        </div>

                        {/* Faixa etária + Salário + Total + Escolaridade */}
                        <div className="grid grid-cols-4 gap-4">
                            <div className="space-y-2">
                                <Label>Faixa Etária</Label>
                                <Input value={faixaEtaria} onChange={e => setFaixaEtaria(e.target.value)} placeholder="15 a 29 anos" />
                            </div>
                            <div className="space-y-2">
                                <Label>Salário / Bolsa</Label>
                                <Input value={salario} onChange={e => setSalario(e.target.value)} placeholder="R$ 1.412,00" />
                            </div>
                            <div className="space-y-2">
                                <Label>Total de Vagas</Label>
                                <Input type="number" value={totalVagas} onChange={e => setTotalVagas(e.target.value)} min="1" />
                            </div>
                            <div className="space-y-2">
                                <Label>Escolaridade Mínima</Label>
                                <Select value={escolaridadeMinima || "qualquer"} onValueChange={v => setEscolaridadeMinima(v === "qualquer" ? "" : v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="qualquer">Qualquer</SelectItem>
                                        <SelectItem value="fundamental_incompleto">Fund. Incompleto</SelectItem>
                                        <SelectItem value="fundamental_completo">Fund. Completo</SelectItem>
                                        <SelectItem value="medio_incompleto">Médio Incompleto</SelectItem>
                                        <SelectItem value="medio_completo">Médio Completo</SelectItem>
                                        <SelectItem value="superior_incompleto">Superior Incompleto</SelectItem>
                                        <SelectItem value="superior_completo">Superior Completo</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Tipo de Contrato */}
                        <div className="space-y-2">
                            <Label>Tipo de Contrato</Label>
                            <Select value={tipoContrato} onValueChange={setTipoContrato}>
                                <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="jovem_aprendiz">Jovem Aprendiz</SelectItem>
                                    <SelectItem value="estagio">Estágio</SelectItem>
                                    <SelectItem value="clt">CLT</SelectItem>
                                    <SelectItem value="pj">PJ</SelectItem>
                                    <SelectItem value="temporario">Temporário</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Carga Horária estruturada */}
                        <div className="space-y-3 border rounded-xl p-4 bg-muted/20">
                            <Label className="text-sm font-semibold">Carga Horária</Label>
                            <div className="grid grid-cols-3 gap-3">
                                {(["horario_comercial", "escala", "jornada_corrida"] as const).map(t => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setCargaTipo(t)}
                                        className={`text-xs px-3 py-2 rounded-lg border transition-colors ${cargaTipo === t ? "bg-cuca-blue text-white border-cuca-blue" : "border-border text-muted-foreground hover:bg-muted"}`}
                                    >
                                        {t === "horario_comercial" ? "Horário Comercial" : t === "escala" ? "Escala" : "Jornada Corrida"}
                                    </button>
                                ))}
                            </div>

                            {cargaTipo === "escala" && (
                                <div className="flex items-center gap-2 mt-2">
                                    <Input className="w-20 text-center" value={cargaEscalaT} onChange={e => setCargaEscalaT(e.target.value)} placeholder="6" />
                                    <span className="text-muted-foreground font-bold">×</span>
                                    <Input className="w-20 text-center" value={cargaEscalaF} onChange={e => setCargaEscalaF(e.target.value)} placeholder="2" />
                                    <span className="text-xs text-muted-foreground">(dias trabalhados × dias de folga)</span>
                                </div>
                            )}

                            {(cargaTipo === "horario_comercial" || cargaTipo === "jornada_corrida") && (
                                <div className="space-y-3 mt-2">
                                    <div className="flex items-center gap-2">
                                        <Input className="w-20 text-center" value={cargaHoras} onChange={e => setCargaHoras(e.target.value)} placeholder="8" />
                                        <span className="text-sm text-muted-foreground">horas / dia</span>
                                    </div>
                                    {cargaTipo === "horario_comercial" && (
                                        <>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-muted-foreground w-28">Dias:</span>
                                                <Input value={cargaDias} onChange={e => setCargaDias(e.target.value)} placeholder="Seg à Sex" className="flex-1" />
                                            </div>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <div className="flex items-center gap-2">
                                                    <Checkbox id="trab-sabado" checked={cargaTrabSabado} onCheckedChange={c => setCargaTrabSabado(c as boolean)} />
                                                    <Label htmlFor="trab-sabado" className="text-sm font-normal cursor-pointer">Trabalha aos sábados até</Label>
                                                </div>
                                                {cargaTrabSabado && (
                                                    <Input
                                                        type="time"
                                                        value={cargaSabadoAte}
                                                        onChange={e => setCargaSabadoAte(e.target.value)}
                                                        className="w-32"
                                                    />
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Preview */}
                            {buildCargaHoraria(cargaTipo, cargaHoras, cargaEscalaT, cargaEscalaF, cargaDias, cargaTrabSabado, cargaSabadoAte) && (
                                <p className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-md">
                                    Resumo: <span className="font-medium text-foreground">{buildCargaHoraria(cargaTipo, cargaHoras, cargaEscalaT, cargaEscalaF, cargaDias, cargaTrabSabado, cargaSabadoAte)}</span>
                                </p>
                            )}
                        </div>

                        {/* Localização + Local Entrevista */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Localização da Vaga</Label>
                                <Input value={local} onChange={e => setLocal(e.target.value)} placeholder="Bairro ou endereço do trabalho" />
                            </div>
                            <div className="space-y-2">
                                <Label>Local da Entrevista</Label>
                                <Select value={localEntrevista} onValueChange={setLocalEntrevista}>
                                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="na_empresa">Na Empresa Contratante</SelectItem>
                                        <SelectItem value="no_cuca">No CUCA / Empregabilidade</SelectItem>
                                        <SelectItem value="online">Online</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* E-mail */}
                        <div className="space-y-2">
                            <Label>E-mail de Contato da Empresa</Label>
                            <Input type="email" value={emailContatoEmpresa} onChange={e => setEmailContatoEmpresa(e.target.value)} placeholder="rh@empresa.com.br" />
                            <p className="text-xs text-muted-foreground">Usado para envio automático de CVs selecionados.</p>
                        </div>

                        {/* Benefícios */}
                        <div className="space-y-2">
                            <Label>Benefícios</Label>
                            <Input value={beneficios} onChange={e => setBeneficios(e.target.value)} placeholder="Vale transporte, Vale alimentação..." />
                        </div>

                        {/* Status + Expansiva */}
                        <div className="grid grid-cols-2 gap-4 items-center bg-muted/40 p-4 rounded-xl border">
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
                                    <p className="text-sm text-muted-foreground">Essa vaga será divulgada para todas as unidades do CUCA.</p>
                                </div>
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
                                    onClick={handleSave}
                                    disabled={loading || !empresaId || !titulo || !descricao || !unidadeCucaId}
                                >
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                                    Salvar Vaga
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
