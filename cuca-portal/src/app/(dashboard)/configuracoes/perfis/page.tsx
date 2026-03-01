"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Shield,
    Plus,
    Save,
    AlertCircle,
    Trash2,
    Users
} from "lucide-react"
import toast from "react-hot-toast"

const AVAILABLE_MODULES = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'leads', label: 'Módulo de Leads' },
    { id: 'atendimentos', label: 'Módulo de Atendimentos' },
    { id: 'programacao', label: 'Módulo de Programação' },
    { id: 'empregabilidade', label: 'Módulo de Empregabilidade' },
    { id: 'ouvidoria', label: 'Ouvidoria & Acesso' },
    { id: 'configuracoes', label: 'Configurações (Cuidado)' },
    { id: 'developer', label: 'Developer Console' },
]

export default function GestaoPerfisPage() {
    const [roles, setRoles] = useState<any[]>([])
    const [selectedRole, setSelectedRole] = useState<any>(null)
    const [permissions, setPermissions] = useState<any[]>([])

    const [isCreating, setIsCreating] = useState(false)
    const [newRoleName, setNewRoleName] = useState("")
    const [newRoleDesc, setNewRoleDesc] = useState("")

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const supabase = createClient()

    useEffect(() => {
        fetchRoles()
    }, [])

    const fetchRoles = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from('sys_roles')
            .select('*')
            .order('name')

        if (data) setRoles(data)
        if (error) toast.error("Falha ao carregar funções")
        setLoading(false)
    }

    const loadRolePermissions = async (role: any) => {
        setSelectedRole(role)
        setIsCreating(false)
        const { data, error } = await supabase
            .from('sys_permissions')
            .select('*')
            .eq('role_id', role.id)

        if (error) {
            toast.error("Erro ao carregar permissões")
            return
        }

        // Initialize state with DB data or default falses
        const perms = AVAILABLE_MODULES.map(mod => {
            const existing = data?.find(d => d.module === mod.id)
            if (existing) {
                return { ...existing, label: mod.label }
            }
            return {
                id: null,
                role_id: role.id,
                module: mod.id,
                label: mod.label,
                can_read: false,
                can_create: false,
                can_update: false,
                can_delete: false
            }
        })
        setPermissions(perms)
    }

    const handleCreateRole = async () => {
        if (!newRoleName) return toast.error("Digite o nome da Função")
        try {
            const { data, error } = await supabase
                .from('sys_roles')
                .insert({ name: newRoleName, description: newRoleDesc })
                .select()
                .single()

            if (error) throw error

            toast.success("Função criada com sucesso!")
            setIsCreating(false)
            setNewRoleName("")
            setNewRoleDesc("")
            fetchRoles()
            loadRolePermissions(data)
        } catch (err: any) {
            toast.error(err.message)
        }
    }

    const deleteRole = async (id: string) => {
        if (!confirm("Atenção: Destruir essa Função pode bloquear usuários associados. Confirmar?")) return
        const { error } = await supabase.from('sys_roles').delete().eq('id', id)
        if (error) return toast.error(error.message)
        toast.success("Função apagada")
        if (selectedRole?.id === id) setSelectedRole(null)
        fetchRoles()
    }

    const handleCheckboxChange = (moduleIdx: number, field: string, checked: boolean) => {
        const newPerms = [...permissions]
        newPerms[moduleIdx][field] = checked
        setPermissions(newPerms)
    }

    const savePermissions = async () => {
        setSaving(true)
        try {
            // Upsert mechanism: se id is nulo, é insert. Senão é update.
            // Para simplificar: deleta tudo e re-insere
            await supabase.from('sys_permissions').delete().eq('role_id', selectedRole.id)

            const toInsert = permissions.map(p => ({
                role_id: selectedRole.id,
                module: p.module,
                can_read: p.can_read,
                can_create: p.can_create,
                can_update: p.can_update,
                can_delete: p.can_delete
            }))

            const { error } = await supabase.from('sys_permissions').insert(toInsert)
            if (error) throw error

            toast.success("Permissões salvas no banco!")
        } catch (error: any) {
            toast.error(error.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col gap-6 p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
                        <Shield className="h-8 w-8 text-cuca-blue" />
                        Gestão de Perfis de Acesso (RBAC)
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Gerencie Cargos/Funções e defina matrizes rigorosas do que cada perfil pode acessar.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Lateral Esquerda - Lista de Cargos */}
                <div className="md:col-span-1 flex flex-col gap-4">
                    <Button onClick={() => { setIsCreating(true); setSelectedRole(null) }} className="w-full bg-cuca-blue h-12">
                        <Plus className="h-5 w-5 mr-2" /> Novo Cargo
                    </Button>

                    <Card className="border-0 shadow-sm h-[600px] overflow-auto">
                        <CardHeader className="bg-slate-50/50 sticky top-0 border-b p-4 z-10">
                            <CardTitle className="text-sm font-semibold text-slate-600 uppercase flex justify-between items-center">
                                Cargos Cadastrados
                                <Badge variant="secondary">{roles.length}</Badge>
                            </CardTitle>
                        </CardHeader>
                        <div className="p-2 space-y-1">
                            {loading ? <p className="text-xs text-center text-slate-400 p-4">Carregando...</p> :
                                roles.map(r => (
                                    <div
                                        key={r.id}
                                        onClick={() => loadRolePermissions(r)}
                                        className={`p-3 rounded-lg cursor-pointer transition-all border ${selectedRole?.id === r.id ? 'bg-blue-50 border-blue-200' : 'bg-white hover:bg-slate-50 border-transparent hover:border-slate-200'}`}
                                    >
                                        <div className="font-semibold text-sm text-slate-700">{r.name}</div>
                                        <div className="text-[10px] text-slate-400 truncate mt-0.5">{r.description || "Sem descrição"}</div>
                                    </div>
                                ))}
                        </div>
                    </Card>
                </div>

                {/* Lateral Direita - Configuração */}
                <div className="md:col-span-3">
                    {isCreating ? (
                        <Card className="border-0 shadow-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Shield className="h-5 w-5 text-cuca-blue" /> Criar Novo Cargo
                                </CardTitle>
                                <CardDescription>Defina a nomenclatura e propósito dessa função.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Nome da Função (Ex: Coordenador Esportivo)</Label>
                                    <Input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="Ex: Atendente de Recepção" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Descrição (Opcional)</Label>
                                    <Input value={newRoleDesc} onChange={e => setNewRoleDesc(e.target.value)} placeholder="Acesso focado no balcão" />
                                </div>
                                <Button onClick={handleCreateRole} className="bg-green-600 hover:bg-green-700">Gravar Cargo</Button>
                                <Button variant="ghost" onClick={() => setIsCreating(false)} className="ml-2">Cancelar</Button>
                            </CardContent>
                        </Card>
                    ) : selectedRole ? (
                        <div className="space-y-6">
                            <Card className="border-0 shadow-sm">
                                <CardHeader className="flex flex-row items-start justify-between bg-slate-50 border-b rounded-t-xl">
                                    <div>
                                        <CardTitle className="text-xl text-cuca-blue flex items-center gap-2">
                                            {selectedRole.name}
                                        </CardTitle>
                                        <CardDescription className="mt-1">{selectedRole.description}</CardDescription>
                                    </div>
                                    <Button variant="destructive" size="sm" onClick={() => deleteRole(selectedRole.id)}>
                                        <Trash2 className="h-4 w-4 mr-2" /> Deletar Inteiro
                                    </Button>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="p-4 bg-orange-50 border-b border-orange-100 flex items-start gap-3">
                                        <AlertCircle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
                                        <p className="text-sm text-orange-800">
                                            <strong>Matriz de Acessos:</strong> Marque a coluna <i>Visualizar Menu</i> para a tela aparecer. Sem isso, as outras opções (Criar/Editar/Apagar) ficam irrelevantes pois ele sequer alcança o módulo.
                                        </p>
                                    </div>
                                    <Table>
                                        <TableHeader className="bg-white">
                                            <TableRow>
                                                <TableHead className="w-[300px]">Módulo do Sistema</TableHead>
                                                <TableHead className="text-center font-bold text-slate-700">👀 Visualizar Menu</TableHead>
                                                <TableHead className="text-center font-bold text-green-700">➕ Criar</TableHead>
                                                <TableHead className="text-center font-bold text-orange-600">✏️ Editar</TableHead>
                                                <TableHead className="text-center font-bold text-red-600">🗑️ Deletar</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {permissions.map((perm, idx) => (
                                                <TableRow key={perm.module} className="hover:bg-slate-50/50">
                                                    <TableCell className="font-medium text-slate-700">
                                                        {perm.label}
                                                        <div className="text-[10px] text-slate-400 leading-none">ID: {perm.module}</div>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Checkbox
                                                            checked={perm.can_read}
                                                            onCheckedChange={c => handleCheckboxChange(idx, 'can_read', !!c)}
                                                            className="data-[state=checked]:bg-cuca-blue"
                                                        />
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Checkbox
                                                            checked={perm.can_create}
                                                            onCheckedChange={c => handleCheckboxChange(idx, 'can_create', !!c)}
                                                            className="data-[state=checked]:bg-green-600 border-green-200"
                                                        />
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Checkbox
                                                            checked={perm.can_update}
                                                            onCheckedChange={c => handleCheckboxChange(idx, 'can_update', !!c)}
                                                            className="data-[state=checked]:bg-orange-500 border-orange-200"
                                                        />
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Checkbox
                                                            checked={perm.can_delete}
                                                            onCheckedChange={c => handleCheckboxChange(idx, 'can_delete', !!c)}
                                                            className="data-[state=checked]:bg-red-600 border-red-200"
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                                <div className="p-4 border-t bg-slate-50/50 flex justify-end">
                                    <Button onClick={savePermissions} disabled={saving} className="bg-cuca-blue px-6">
                                        <Save className="h-4 w-4 mr-2" /> {saving ? "Salvando..." : "Salvar Matriz"}
                                    </Button>
                                </div>
                            </Card>
                        </div>
                    ) : (
                        <div className="h-full min-h-[400px] flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl text-slate-400 bg-slate-50/30">
                            <Users className="h-16 w-16 mb-4 text-slate-300" />
                            <h2 className="text-xl font-semibold text-slate-600">Nenhum perfil selecionado</h2>
                            <p className="mt-2 text-sm max-w-sm text-center">Selecione um cargo no menu lateral para mapear as permissões exatas da UI e APIs.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
