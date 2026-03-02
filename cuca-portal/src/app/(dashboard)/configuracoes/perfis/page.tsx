"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
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
    Users,
    CheckSquare,
    Square
} from "lucide-react"
import toast from "react-hot-toast"

const MODULE_GROUPS = [
    {
        category: 'Módulo de Leads',
        modules: [
            { id: 'dashboard', label: 'Estatísticas Básicas (Visualização)' },
            { id: 'leads_overview', label: 'Visualizar Lista de Leads' },
            { id: 'leads_novo', label: 'Novo Lead (Cadastro)' },
            { id: 'leads_output', label: 'Registrar Output em Lead' },
            { id: 'leads_bloquear', label: 'Bloquear/Desbloquear Lead' },
            { id: 'leads_anonimizar', label: 'Anonimizar Dados de Lead (LGPD)' },
        ]
    },
    {
        category: 'Atendimentos & Ouvidoria',
        modules: [
            { id: 'atendimentos', label: 'Painel de Atendimentos (Omnichannel)' },
            { id: 'ouvidoria', label: 'Manifestações e Ouvidoria' },
        ]
    },
    {
        category: 'Acesso CUCA',
        modules: [
            { id: 'acesso_solicitacoes', label: 'Solicitações de Acesso (Aprovar/Recusar)' },
            { id: 'acesso_espacos', label: 'Gestão de Espaços e Equipamentos' },
        ]
    },
    {
        category: 'Programação & Empregabilidade',
        modules: [
            { id: 'programacao_mensal', label: 'Programação de Eventos: Mensal' },
            { id: 'programacao_pontual', label: 'Programação de Eventos: Pontual' },
            { id: 'empreg_banco_cv', label: 'Empregabilidade: Banco de Currículos (Candidatos)' },
            { id: 'empreg_vagas', label: 'Empregabilidade: Gestão de Vagas' },
        ]
    },
    {
        category: 'Administração & Sistema',
        modules: [
            { id: 'config_whatsapp', label: 'Config. WhatsApp (Gerenciar Instâncias e QR Code)' },
            { id: 'config_colaboradores', label: 'Gestão da Equipe (Convidar e Editar Colaboradores)' },
            { id: 'config_perfis', label: 'Perfis de Acesso (Controle de Matriz RBAC)' },
            { id: 'config_unidades', label: 'Cadastro e Edição de Unidades Físicas' },
            { id: 'config_categorias', label: 'Cadastro e Edição de Categorias de Equipamentos' },
        ]
    },
    {
        category: 'Módulo Técnico',
        modules: [
            { id: 'developer', label: 'Developer Console' },
        ]
    }
]

// Lista flat de módulos para facilitar a inicialização
const FLAT_MODULES = MODULE_GROUPS.flatMap(g => g.modules)

export default function GestaoPerfisPage() {
    const { isDeveloper, profile } = useUser()
    const groupsToRender = isDeveloper ? MODULE_GROUPS : MODULE_GROUPS.filter(g => g.category !== 'Módulo Técnico')
    const validFlatModules = groupsToRender.flatMap(g => g.modules)

    const [roles, setRoles] = useState<any[]>([])
    const [selectedRole, setSelectedRole] = useState<any>(null)
    const [permissions, setPermissions] = useState<any[]>([])

    const [isCreating, setIsCreating] = useState(false)
    const [isEditingRoleInfo, setIsEditingRoleInfo] = useState(false)

    const [roleForm, setRoleForm] = useState({ name: "", description: "" })

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const supabase = createClient()

    useEffect(() => {
        fetchRoles()
    }, [])

    const fetchRoles = async () => {
        setLoading(true)

        const canSeeAllUnits = isDeveloper || profile?.funcao?.nome === 'Super Admin Cuca'

        let query = supabase.from('sys_roles').select('*').order('name')

        if (!canSeeAllUnits && profile?.unidade_cuca) {
            query = query.or(`unidade_cuca.is.null,unidade_cuca.eq.${profile.unidade_cuca}`)
            query = query.neq('name', 'Super Admin Cuca')
        }

        if (!isDeveloper) {
            query = query.neq('name', 'Developer')
        }

        const { data, error } = await query

        if (data) {
            setRoles(data)
            // Se tinha um role selecionado antes de atualizar a lista, mantém ele vivo com os novos dados
            if (selectedRole) {
                const refreshed = data.find(r => r.id === selectedRole.id)
                if (refreshed) setSelectedRole(refreshed)
            }
        }
        if (error) toast.error("Falha ao carregar funções")
        setLoading(false)
    }

    const loadRolePermissions = async (role: any) => {
        setSelectedRole(role)
        setIsCreating(false)
        setIsEditingRoleInfo(false)

        const { data, error } = await supabase
            .from('sys_permissions')
            .select('*')
            .eq('role_id', role.id)

        if (error) {
            toast.error("Erro ao carregar permissões")
            return
        }

        const perms = validFlatModules.map(mod => {
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

    const handleSaveRoleInfo = async () => {
        if (!roleForm.name.trim()) return toast.error("Digite o nome da Função")
        try {
            if (isCreating) {
                const canSeeAllUnits = isDeveloper || profile?.funcao?.nome === 'Super Admin Cuca'
                const { data, error } = await supabase
                    .from('sys_roles')
                    .insert({
                        name: roleForm.name,
                        description: roleForm.description,
                        unidade_cuca: canSeeAllUnits ? null : profile?.unidade_cuca
                    })
                    .select()
                    .single()

                if (error) throw error
                toast.success("Função criada com sucesso!")
                setIsCreating(false)
                fetchRoles()
                loadRolePermissions(data)
            } else {
                // Modo Edição de Informações Básicas
                const { error } = await supabase
                    .from('sys_roles')
                    .update({ name: roleForm.name, description: roleForm.description })
                    .eq('id', selectedRole.id)

                if (error) throw error
                toast.success("Informações do Cargo atualizadas!")
                setIsEditingRoleInfo(false)
                fetchRoles()
            }
        } catch (err: any) {
            toast.error(err.message)
        }
    }

    const deleteRole = async (id: string, name: string) => {
        if (!confirm(`Atenção: Você está prestes a DELETAR a função "${name}". Isso privará o acesso de todos os colaboradores associados a ela. Confirmar destruição definitiva?`)) return
        const { error } = await supabase.from('sys_roles').delete().eq('id', id)
        if (error) return toast.error("Erro ao deletar: " + error.message)

        toast.success("Função deletada com sucesso")
        if (selectedRole?.id === id) setSelectedRole(null)
        fetchRoles()
    }

    const handleCheckboxChange = (moduleId: string, field: string, checked: boolean) => {
        setPermissions(prev => prev.map(p => {
            if (p.module === moduleId) {
                const updated = { ...p, [field]: checked }
                // Regra de Ouro: Se der permissão de criar, editar ou deletar, deve OBRIGATORIAMENTE dar Read
                if (checked && field !== 'can_read') {
                    updated.can_read = true
                }
                return updated
            }
            return p
        }))
    }

    const handleRowSelectAll = (moduleId: string, check: boolean) => {
        setPermissions(prev => prev.map(p => {
            if (p.module === moduleId) {
                return {
                    ...p,
                    can_read: check,
                    can_create: check,
                    can_update: check,
                    can_delete: check
                }
            }
            return p
        }))
    }

    const handleColumnSelectAll = (field: string, check: boolean) => {
        setPermissions(prev => prev.map(p => {
            const updated = { ...p, [field]: check }
            // Se mandou marcar toda a coluna de CRUD, marca auto a coluna Read também
            if (check && field !== 'can_read') updated.can_read = true
            return updated
        }))
    }

    const savePermissionsMatrix = async () => {
        setSaving(true)
        try {
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

            toast.success("Matriz de Permissões salva com sucesso!")
        } catch (error: any) {
            toast.error(error.message)
        } finally {
            setSaving(false)
        }
    }

    const openCreateMode = () => {
        setIsCreating(true)
        setSelectedRole(null)
        setRoleForm({ name: "", description: "" })
    }

    const openEditMode = () => {
        setIsEditingRoleInfo(true)
        setRoleForm({ name: selectedRole.name, description: selectedRole.description || "" })
    }

    return (
        <div className="flex flex-col gap-6 p-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
                    <Shield className="h-8 w-8 text-cuca-blue" />
                    Gestão de Perfis de Acesso (RBAC)
                </h1>
                <p className="text-muted-foreground mt-1 text-sm md:text-base">
                    Controle rígido de segurança: Crie cargos, edite seus detalhes e especifique em nível granular quais módulos e ferramentas a equipe pode visualizar ou modificar.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Painel Esquerdo - Lista de Roles */}
                <div className="lg:col-span-1 flex flex-col gap-4">
                    <Button onClick={openCreateMode} className="w-full bg-cuca-blue h-12 text-sm font-semibold shadow-sm hover:shadow-md transition-shadow">
                        <Plus className="h-5 w-5 mr-2" /> Novo Cargo Administrativo
                    </Button>

                    <Card className="border-0 shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 250px)" }}>
                        <CardHeader className="bg-slate-50 border-b p-4 shrink-0">
                            <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-wider flex justify-between items-center">
                                Tabela de Perfis
                                <Badge variant="secondary" className="bg-slate-200 text-slate-700">{roles.length}</Badge>
                            </CardTitle>
                        </CardHeader>
                        <div className="p-2 space-y-1 overflow-y-auto grow">
                            {loading ? <p className="text-xs text-center text-slate-400 p-4">Carregando...</p> :
                                roles.map(r => (
                                    <div
                                        key={r.id}
                                        onClick={() => loadRolePermissions(r)}
                                        className={`p-3 rounded-md cursor-pointer transition-all border group relative ${selectedRole?.id === r.id
                                            ? 'bg-blue-50 border-blue-200 shadow-sm'
                                            : 'bg-white hover:bg-slate-50 border-transparent hover:border-slate-200'
                                            }`}
                                    >
                                        <div className="font-bold text-sm text-slate-700 leading-tight pr-6">{r.name}</div>
                                        <div className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">{r.description || "Nenhuma descrição informada."}</div>
                                        {selectedRole?.id === r.id && (
                                            <div className="absolute right-2 top-0 bottom-0 flex items-center">
                                                <div className="w-1.5 h-1.5 rounded-full bg-cuca-blue"></div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                        </div>
                    </Card>
                </div>

                {/* Painel Direito - Editor do Cargo e Matriz */}
                <div className="lg:col-span-3">
                    {isCreating || isEditingRoleInfo ? (
                        <Card className="border border-blue-100 shadow-md animate-in fade-in zoom-in-95 duration-200">
                            <CardHeader className="bg-blue-50/50 border-b">
                                <CardTitle className="flex items-center gap-2 text-cuca-blue font-bold">
                                    <Shield className="h-5 w-5" />
                                    {isCreating ? "Criação de Novo Perfil" : "Edição dos Detalhes Básicos do Perfil"}
                                </CardTitle>
                                <CardDescription>
                                    {isCreating
                                        ? "Defina a nomenclatura oficial (ex: 'Gerente da Ouvidoria'). Em seguida, você poderá configurar a matriz de permissões deste perfil."
                                        : "Atualizar os nomes refletirá instantaneamente para todos os usuários com esse cargo."}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5 p-6 bg-white">
                                <div className="space-y-1.5">
                                    <Label className="text-slate-700 font-semibold text-sm">Nomenclatura da Função <span className="text-red-500">*</span></Label>
                                    <Input
                                        className="h-11 bg-slate-50"
                                        value={roleForm.name}
                                        onChange={e => setRoleForm({ ...roleForm, name: e.target.value })}
                                        placeholder="Ex: Auxiliar Administrativo"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-slate-700 font-semibold text-sm">Breve Descrição Propósito</Label>
                                    <Input
                                        className="h-11 bg-slate-50"
                                        value={roleForm.description}
                                        onChange={e => setRoleForm({ ...roleForm, description: e.target.value })}
                                        placeholder="Destinado a operadores do balcão, com foco restrito à triagem."
                                    />
                                </div>
                                <div className="pt-2 flex gap-3">
                                    <Button onClick={handleSaveRoleInfo} className="bg-green-600 hover:bg-green-700 h-10 px-8">
                                        <Save className="h-4 w-4 mr-2" /> Salvar Detalhes
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            if (isCreating) setIsCreating(false);
                                            if (isEditingRoleInfo) setIsEditingRoleInfo(false);
                                        }}
                                        className="h-10 text-slate-600 hover:text-slate-800"
                                    >
                                        Cancelar
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ) : selectedRole ? (
                        <div className="space-y-5 animate-in fade-in duration-300">
                            {/* Bloco Título Perfil */}
                            <Card className="border border-slate-200 shadow-sm overflow-hidden">
                                <div className="p-5 md:p-6 bg-white flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                    <div className="flex items-start gap-4">
                                        <div className="h-12 w-12 rounded-lg bg-blue-50 text-cuca-blue border border-blue-100 flex items-center justify-center shrink-0">
                                            <Shield className="h-6 w-6" />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                                                {selectedRole.name}
                                                <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-500 py-0.5 border-slate-200">
                                                    ID: {selectedRole.id.split('-')[0]}
                                                </Badge>
                                            </h2>
                                            <p className="text-sm text-slate-500 mt-1 max-w-xl">
                                                {selectedRole.description || "Nenhuma descrição fornecida para delimitar o escopo deste papel."}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                        <Button variant="outline" size="sm" onClick={openEditMode} className="text-slate-600 border-slate-200">
                                            Editar Nome
                                        </Button>
                                        <Button variant="destructive" size="sm" className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:border-red-300" onClick={() => deleteRole(selectedRole.id, selectedRole.name)}>
                                            <Trash2 className="h-4 w-4 md:mr-2" /> <span className="hidden md:inline">Destruir Cargo</span>
                                        </Button>
                                    </div>
                                </div>
                                <div className="bg-amber-50 border-t border-amber-100 p-3 px-5 flex items-start sm:items-center gap-3">
                                    <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                                    <p className="text-xs sm:text-sm text-amber-800">
                                        <strong>Segurança Frontend:</strong> O pilar fundamental é <strong className="font-black underline decoration-amber-300">Visualizar Menu</strong>. Se não marcado, a rota associada deixa de existir para o colaborador, inutilizando regras adjacentes. Ao ativar Criação ou Edição, o Visualizar Menu será ativado por consequência lógica.
                                    </p>
                                </div>
                            </Card>

                            {/* Bloco Matriz Complexa */}
                            <Card className="border border-slate-200 shadow-sm relative overflow-hidden">
                                <CardHeader className="bg-slate-50 border-b flex flex-row items-center justify-between py-3 px-5">
                                    <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
                                        Matriz de Controle (CRUD)
                                    </CardTitle>
                                    <Button onClick={savePermissionsMatrix} disabled={saving} className="bg-cuca-blue h-9 px-6 text-xs sm:text-sm font-semibold rounded-full shadow-md hover:shadow-lg transition-all">
                                        <Save className="h-4 w-4 mr-2" /> {saving ? "Salvando Definitivo..." : "Gravar Permissões no Banco"}
                                    </Button>
                                </CardHeader>
                                <CardContent className="p-0 overflow-x-auto">
                                    <Table className="min-w-[800px] border-b-0">
                                        <TableHeader className="bg-white sticky top-0 z-10 shadow-sm">
                                            <TableRow className="border-b border-slate-200 hover:bg-transparent">
                                                <TableHead className="w-[280px] bg-white pt-4 align-top">
                                                    Módulo e Granularidade
                                                </TableHead>
                                                {/* Header Actions for Columns */}
                                                {[
                                                    { field: 'can_read', label: 'Ver Menu', icon: '👀', color: 'text-slate-700', activeBg: 'data-[state=checked]:bg-cuca-blue' },
                                                    { field: 'can_create', label: 'Criar / Add', icon: '➕', color: 'text-green-700', activeBg: 'data-[state=checked]:bg-green-600' },
                                                    { field: 'can_update', label: 'Editar', icon: '✏️', color: 'text-orange-600', activeBg: 'data-[state=checked]:bg-orange-500' },
                                                    { field: 'can_delete', label: 'Apagar', icon: '🗑️', color: 'text-red-600', activeBg: 'data-[state=checked]:bg-red-600' }
                                                ].map(col => {
                                                    // Checa se todas da coluna estão marcadas (somente as linhas flat)
                                                    const allChecked = permissions.length > 0 && permissions.every(p => p[col.field])
                                                    const someChecked = permissions.some(p => p[col.field])

                                                    return (
                                                        <TableHead key={col.field} className="text-center bg-white p-3 align-top min-w-[110px] border-l border-slate-100">
                                                            <div className="flex flex-col items-center gap-2">
                                                                <span className={`font-bold text-[13px] ${col.color} whitespace-nowrap`}>
                                                                    {col.icon} {col.label}
                                                                </span>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className={`h-6 text-[10px] px-2 rounded-full w-full max-w-[90px] ${allChecked ? 'bg-slate-100 border-slate-300 text-slate-500 hover:bg-slate-200' : 'bg-white hover:bg-slate-50'}`}
                                                                    onClick={() => handleColumnSelectAll(col.field, !allChecked)}
                                                                >
                                                                    <CheckSquare className="w-3 h-3 mr-1" />
                                                                    {allChecked ? 'Desfazer' : 'Tudo'}
                                                                </Button>
                                                            </div>
                                                        </TableHead>
                                                    )
                                                })}
                                                <TableHead className="w-[80px] text-center bg-white p-3 align-top border-l border-slate-100 font-bold text-slate-400 text-xs flex flex-col items-center gap-2">
                                                    <span className="opacity-0">Linha</span>
                                                    <div className="h-6"></div> {/* Spacer to align with All Buttons */}
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>

                                        <TableBody>
                                            {groupsToRender.map((group, groupIndex) => (
                                                <div key={group.category} className="contents">
                                                    {/* Row Categoria */}
                                                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80 border-y border-slate-200">
                                                        <TableCell colSpan={6} className="py-2.5 px-4">
                                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{group.category}</span>
                                                        </TableCell>
                                                    </TableRow>

                                                    {group.modules.map(mod => {
                                                        const perm = permissions.find(p => p.module === mod.id) || {}
                                                        // Check se toda a linha dessa exata feature ta true
                                                        const isRowFull = perm.can_read && perm.can_create && perm.can_update && perm.can_delete

                                                        return (
                                                            <TableRow key={mod.id} className="hover:bg-slate-50/50 transition-colors group/row">
                                                                <TableCell className="font-medium text-slate-700 py-3 pl-6 border-r border-slate-50 bg-white group-hover/row:bg-slate-50/30">
                                                                    <div className="text-sm font-semibold">{mod.label}</div>
                                                                    <div className="font-mono text-[9px] text-slate-300 mt-0.5">{mod.id}</div>
                                                                </TableCell>

                                                                <TableCell className="text-center border-l border-slate-100 bg-white group-hover/row:bg-slate-50/30">
                                                                    <Checkbox
                                                                        checked={perm.can_read || false}
                                                                        onCheckedChange={c => handleCheckboxChange(mod.id, 'can_read', !!c)}
                                                                        className={`w-5 h-5 rounded border-slate-300 data-[state=checked]:bg-cuca-blue data-[state=checked]:border-cuca-blue ${perm.can_read ? 'shadow-sm' : ''}`}
                                                                    />
                                                                </TableCell>

                                                                <TableCell className="text-center border-l text-center border-slate-100 bg-white group-hover/row:bg-slate-50/30">
                                                                    <Checkbox
                                                                        checked={perm.can_create || false}
                                                                        onCheckedChange={c => handleCheckboxChange(mod.id, 'can_create', !!c)}
                                                                        className={`w-5 h-5 rounded border-slate-300 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600 ${perm.can_create ? 'shadow-sm' : ''}`}
                                                                    />
                                                                </TableCell>

                                                                <TableCell className="text-center border-l text-center border-slate-100 bg-white group-hover/row:bg-slate-50/30">
                                                                    <Checkbox
                                                                        checked={perm.can_update || false}
                                                                        onCheckedChange={c => handleCheckboxChange(mod.id, 'can_update', !!c)}
                                                                        className={`w-5 h-5 rounded border-slate-300 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 ${perm.can_update ? 'shadow-sm' : ''}`}
                                                                    />
                                                                </TableCell>

                                                                <TableCell className="text-center border-l border-r text-center border-slate-100 bg-white group-hover/row:bg-slate-50/30">
                                                                    <Checkbox
                                                                        checked={perm.can_delete || false}
                                                                        onCheckedChange={c => handleCheckboxChange(mod.id, 'can_delete', !!c)}
                                                                        className={`w-5 h-5 rounded border-slate-300 data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600 ${perm.can_delete ? 'shadow-sm' : ''}`}
                                                                    />
                                                                </TableCell>

                                                                {/* "Marcar Linha (Todos da feature)" */}
                                                                <TableCell className="text-center w-[80px] bg-slate-50/30 group-hover/row:bg-slate-100/50">
                                                                    <Button
                                                                        variant="ghost"
                                                                        onClick={() => handleRowSelectAll(mod.id, !isRowFull)}
                                                                        className={`h-7 w-7 p-0 rounded-md opacity-40 hover:opacity-100 hover:bg-blue-100 hover:text-blue-700 transition-all ${isRowFull ? 'text-blue-600 opacity-100 bg-blue-50 border border-blue-200' : ''}`}
                                                                        title={isRowFull ? "Desmarcar toda linha" : "Marcar Poder Total (CRUD) nesta feature"}
                                                                    >
                                                                        {isRowFull ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                                                                    </Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        )
                                                    })}
                                                </div>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                                <div className="p-4 border-t bg-slate-50 flex flex-col md:flex-row justify-between items-center gap-4">
                                    <div className="text-sm text-slate-500">
                                        Modificações não salvas serão perdidas ao trocar de aba.
                                    </div>
                                    <Button onClick={savePermissionsMatrix} disabled={saving} className="bg-cuca-blue h-11 px-8 w-full md:w-auto text-sm font-semibold shadow-md hover:shadow-lg transition-all rounded-full">
                                        <Save className="h-4 w-4 mr-2" />
                                        {saving ? "Registrando Níveis..." : "Salvar Níveis de Acesso (Matriz CRUD)"}
                                    </Button>
                                </div>
                            </Card>
                        </div>
                    ) : (
                        <div className="h-[600px] flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 bg-slate-50/50 p-8 text-center animate-in zoom-in-95 duration-500">
                            <div className="h-20 w-20 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100 mb-6">
                                <Users className="h-10 w-10 text-slate-300" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-700">Nenhum Cargo Ativo</h2>
                            <p className="mt-3 text-base text-slate-500 max-w-md">Para começar a desenhar as regras de acesso, clique em algum Perfil na lista à esquerda ou utilize o botão Novo Cargo Administrativo.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
