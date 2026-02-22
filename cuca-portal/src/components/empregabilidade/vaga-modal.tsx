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
import { unidadesCuca } from "@/lib/constants"
import { Loader2, Save } from "lucide-react"

interface VagaModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess: () => void
    vaga?: Vaga | null
}

export function VagaModal({ open, onOpenChange, onSuccess, vaga }: VagaModalProps) {
    const [loading, setLoading] = useState(false)
    const [fetching, setFetching] = useState(false)
    const [empresas, setEmpresas] = useState<Empresa[]>([])
    const [unidadesMap, setUnidadesMap] = useState<Record<string, string>>({})

    const [empresaId, setEmpresaId] = useState("")
    const [titulo, setTitulo] = useState("")
    const [descricao, setDescricao] = useState("")
    const [requisitos, setRequisitos] = useState("")
    const [salario, setSalario] = useState("")
    const [beneficios, setBeneficios] = useState("")
    const [tipoContrato, setTipoContrato] = useState("clt")
    const [cargaHoraria, setCargaHoraria] = useState("")
    const [local, setLocal] = useState("")
    const [unidadeCucaId, setUnidadeCucaId] = useState("")
    const [totalVagas, setTotalVagas] = useState("1")
    const [status, setStatus] = useState("pre_cadastro")
    const [faixaEtaria, setFaixaEtaria] = useState("15 a 29 anos")
    const [localEntrevista, setLocalEntrevista] = useState("na_empresa")
    const [tipoSelecao, setTipoSelecao] = useState("presencial")
    const [expansiva, setExpansiva] = useState(false)

    const supabase = createClient()

    useEffect(() => {
        if (open) {
            carregarDadosPreAbertura()
        }
    }, [open])

    const carregarDadosPreAbertura = async () => {
        setFetching(true)
        try {
            // Buscar empresas ativas
            const { data: empData } = await supabase.from('empresas').select('*').eq('ativa', true)
            if (empData) setEmpresas(empData)

            // Buscar unidades
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
                setCargaHoraria(vaga.carga_horaria || "")
                setLocal(vaga.local || "")
                setUnidadeCucaId(vaga.unidade_cuca || "")
                setTotalVagas(vaga.total_vagas.toString())
                setStatus(vaga.status)
                setFaixaEtaria(vaga.faixa_etaria || "15 a 29 anos")
                setLocalEntrevista(vaga.local_entrevista || "na_empresa")
                setTipoSelecao(vaga.tipo_selecao || "presencial")
                setExpansiva(vaga.expansiva || false)
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
        setEmpresaId("")
        setTitulo("")
        setDescricao("")
        setRequisitos("")
        setSalario("")
        setBeneficios("")
        setTipoContrato("clt")
        setCargaHoraria("")
        setLocal("")
        setUnidadeCucaId("")
        setTotalVagas("1")
        setStatus("pre_cadastro")
        setFaixaEtaria("15 a 29 anos")
        setLocalEntrevista("na_empresa")
        setTipoSelecao("presencial")
        setExpansiva(false)
    }

    const handleSave = async () => {
        if (!empresaId || !titulo || !descricao || !unidadeCucaId) return

        setLoading(true)
        try {
            const payload = {
                empresa_id: empresaId,
                titulo,
                descricao,
                requisitos,
                salario,
                beneficios,
                tipo_contrato: tipoContrato,
                carga_horaria: cargaHoraria,
                local,
                unidade_cuca: unidadeCucaId,
                total_vagas: parseInt(totalVagas) || 1,
                status,
                faixa_etaria: faixaEtaria,
                local_entrevista: localEntrevista,
                tipo_selecao: tipoSelecao,
                expansiva,
                data_abertura: status === 'aberta' ? new Date().toISOString() : null
            }

            if (vaga) {
                await supabase.from('vagas').update(payload).eq('id', vaga.id)
            } else {
                await supabase.from('vagas').insert(payload)
            }

            onSuccess()
            onOpenChange(false)
            resetForm()
        } catch (error) {
            console.error("Erro ao salvar vaga:", error)
        } finally {
            setLoading(false)
        }
    }

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

                        <div className="space-y-2">
                            <Label>Título da Vaga *</Label>
                            <Input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Jovem Aprendiz Administrativo" />
                        </div>

                        <div className="space-y-2">
                            <Label>Descrição da Vaga *</Label>
                            <Textarea
                                value={descricao}
                                onChange={e => setDescricao(e.target.value)}
                                placeholder="Descreva as atividades, ambiente de trabalho, etc."
                                className="h-24"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Requisitos e Perfil Desejado</Label>
                            <Textarea
                                value={requisitos}
                                onChange={e => setRequisitos(e.target.value)}
                                placeholder="Conhecimento em informática, boa comunicação..."
                            />
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label>Faixa Etária</Label>
                                <Input value={faixaEtaria} onChange={e => setFaixaEtaria(e.target.value)} placeholder="Ex: 15 a 29 anos" />
                            </div>
                            <div className="space-y-2">
                                <Label>Salário / Bolsa</Label>
                                <Input value={salario} onChange={e => setSalario(e.target.value)} placeholder="R$ 1.412,00 ou A Combinar" />
                            </div>
                            <div className="space-y-2">
                                <Label>Total de Vagas</Label>
                                <Input type="number" value={totalVagas} onChange={e => setTotalVagas(e.target.value)} min="1" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Tipo de Contrato</Label>
                                <Select value={tipoContrato} onValueChange={setTipoContrato}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="jovem_aprendiz">Jovem Aprendiz</SelectItem>
                                        <SelectItem value="estagio">Estágio</SelectItem>
                                        <SelectItem value="clt">CLT</SelectItem>
                                        <SelectItem value="pj">PJ</SelectItem>
                                        <SelectItem value="temporario">Temporário</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Carga Horária</Label>
                                <Input value={cargaHoraria} onChange={e => setCargaHoraria(e.target.value)} placeholder="Ex: 4h ou 8h/dia" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Localização da Vaga</Label>
                                <Input value={local} onChange={e => setLocal(e.target.value)} placeholder="Bairro ou Endereço do trabalho" />
                            </div>
                            <div className="space-y-2">
                                <Label>Local da Entrevista</Label>
                                <Select value={localEntrevista} onValueChange={setLocalEntrevista}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="na_empresa">Na Empresa Contratante</SelectItem>
                                        <SelectItem value="no_cuca">No CUCA / Empregabilidade</SelectItem>
                                        <SelectItem value="online">Online</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

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
                                <Checkbox
                                    id="expansiva"
                                    checked={expansiva}
                                    onCheckedChange={(c) => setExpansiva(c as boolean)}
                                />
                                <div className="space-y-1 leading-none">
                                    <Label htmlFor="expansiva">Vaga Expansiva</Label>
                                    <p className="text-sm text-muted-foreground">Essa vaga será divulgada para todas as unidades do CUCA.</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-4">
                            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
                            <Button
                                className="bg-cuca-blue hover:bg-sky-800 text-white"
                                onClick={handleSave}
                                disabled={loading || !empresaId || !titulo || !descricao || !unidadeCucaId}
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                                Salvar Vaga
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
