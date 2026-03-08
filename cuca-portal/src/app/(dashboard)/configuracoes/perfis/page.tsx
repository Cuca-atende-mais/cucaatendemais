"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
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
    AlertTriangle,
    Trash2,
    Users,
    CheckSquare,
    Square,
    Pencil
} from "lucide-react"
import toast from "react-hot-toast"
import { Skeleton } from "@/components/ui/skeleton"

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
            { id: 'acesso_solicitacoes_n1', label: 'Solicitações (Aprovação N1 — Materiais/Espaço)' },
            { id: 'acesso_solicitacoes_n2', label: 'Solicitações (Aprovação Final N2 — Gerencial)' },
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
        category: 'Divulgação & RAG Global',
        modules: [
            { id: 'divulgacao', label: 'Central de Divulgação (Painel Gestor Geral + Disparar Aviso Global)' },
            { id: 'programacao_rag_global', label: 'Base de Conhecimento — Rede CUCA (RAG Global)' },
        ]
    },
    {
        category: 'Módulo Técnico',
        modules: [
            { id: 'developer', label: 'Developer Console' },
        ]
    }
]

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

    useEffect(() => { fetchRoles() }, [])

    const fetchRoles = async () => {
        setLoading(true)
        const canSeeAllUnits = isDeveloper || profile?.funcao?.nome === 'Super Admin Cuca'
        let query = supabase.from('sys_roles').select('*').order('name')
        if (!canSeeAllUnits && profile?.unidade_cuca) {
            query = query.or(`unidade_cuca.is.null,unidade_cuca.eq.${profile.unidade_cuca}`)
            query = query.neq('name', 'Super Admin Cuca')
        }
        if (!isDeveloper) query = query.neq('name', 'Developer')
        const { data, error } = await query
        if (data) {
            setRoles(data)
            if (selectedRole) {
                const refreshed = data.find(r => r.id === selectedRole.id)
                if (refreshed) setSelectedRole(refreshed)
            }
        }
        if (error) toast.error("Falha ao carregar perfis")
        setLoading(false)
    }

    const loadRolePermissions = async (role: any) => {
        setSelectedRole(role)
        setIsCreating(false)
        setIsEditingRoleInfo(false)
        const { data, error } = await supabase
            .from('sys_permissions').select('*').eq('role_id', role.id)
        if (error) { toast.error("Erro ao carregar permissões"); return }
        const perms = validFlatModules.map(mod => {
            const existing = data?.find(d => d.module === mod.id)
            return existing
                ? { ...existing, label: mod.label }
                : { id: null, role_id: role.id, module: mod.id, label: mod.label, can_read: false, can_create: false, can_update: false, can_delete: false }
        })
        setPermissions(perms)
    }

    const handleSaveRoleInfo = async () => {
        if (!roleForm.name.trim()) return toast.error("Digite o nome do Perfil")
        try {
            if (isCreating) {
                const canSeeAllUnits = isDeveloper || profile?.funcao?.nome === 'Super Admin Cuca'
                const { data, error } = await supabase
                    .from('sys_roles')
                    .insert({ name: roleForm.name, description: roleForm.description, unidade_cuca: canSeeAllUnits ? null : profile?.unidade_cuca })
                    .select().single()
                if (error) throw error
                toast.success("Perfil criado com sucesso!")
                setIsCreating(false)
                fetchRoles()
                loadRolePermissions(data)
            } else {
                const { error } = await supabase
                    .from('sys_roles').update({ name: roleForm.name, description: roleForm.description }).eq('id', selectedRole.id)
                if (error) throw error
                toast.success("Perfil atualizado!")
                setIsEditingRoleInfo(false)
                fetchRoles()
            }
        } catch (err: any) { toast.error(err.message) }
    }

    const deleteRole = async (id: string, name: string) => {
        if (!confirm(`Atenção: Você está prestes a DELETAR o perfil "${name}". Isso privará o acesso de todos os colaboradores associados. Confirmar?`)) return
        const { error } = await supabase.from('sys_roles').delete().eq('id', id)
        if (error) return toast.error("Erro ao deletar: " + error.message)
        toast.success("Perfil deletado")
        if (selectedRole?.id === id) setSelectedRole(null)
        fetchRoles()
    }

    const handleCheckboxChange = (moduleId: string, field: string, checked: boolean) => {
        setPermissions(prev => prev.map(p => {
            if (p.module !== moduleId) return p
            const updated = { ...p, [field]: checked }
            if (checked && field !== 'can_read') updated.can_read = true
            if (!checked && field === 'can_read') { updated.can_create = false; updated.can_update = false; updated.can_delete = false }
            return updated
        }))
    }

    const handleRowSelectAll = (moduleId: string, check: boolean) => {
        setPermissions(prev => prev.map(p =>
            p.module === moduleId
                ? { ...p, can_read: check, can_create: check, can_update: check, can_delete: check }
                : p
        ))
    }

    const handleColumnSelectAll = (field: string, check: boolean) => {
        setPermissions(prev => prev.map(p => {
            const updated = { ...p, [field]: check }
            if (check && field !== 'can_read') updated.can_read = true
            if (!check && field === 'can_read') { updated.can_create = false; updated.can_update = false; updated.can_delete = false }
            return updated
        }))
    }

    const savePermissionsMatrix = async () => {
        setSaving(true)
        try {
            await supabase.from('sys_permissions').delete().eq('role_id', selectedRole.id)
            const toInsert = permissions.map(p => ({
                role_id: selectedRole.id, module: p.module,
                can_read: p.can_read, can_create: p.can_create, can_update: p.can_update, can_delete: p.can_delete
            }))
            const { error } = await supabase.from('sys_permissions').insert(toInsert)
            if (error) throw error
            toast.success("Matriz de permissões salva!")
        } catch (error: any) {
            toast.error(error.message)
        } finally { setSaving(false) }
    }

    const COLS = [
        { field: 'can_read', label: 'Ver Menu', checkClass: 'data-[state=checked]:bg-primary data-[state=checked]:border-primary' },
        { field: 'can_create', label: 'Criar', checkClass: 'data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600' },
        { field: 'can_update', label: 'Editar', checkClass: 'data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500' },
        { field: 'can_delete', label: 'Apagar', checkClass: 'data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500' },
    ]

    return (
        <div className="flex-1 flex flex-col gap-5 p-4 lg:p-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-card p-5 rounded-2xl border border-border">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <Shield className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">Gestão de Perfis de Acesso (RBAC)</h1>
                        <p className="text-muted-foreground text-sm mt-0.5">
                            Crie perfis, configure a matriz CRUD granular e controle o que cada cargo pode ver e fazer.
                        </p>
                    </div>
                </div>
                <Button
                    onClick={() => { setIsCreating(true); setSelectedRole(null); setRoleForm({ name: "", description: "" }) }}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shrink-0"
                >
                    <Plus className="h-4 w-4 mr-2" /> Novo Perfil
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
                {/* Painel Esquerdo — Lista de Perfis */}
                <div className="lg:col-span-1 bg-card rounded-2xl border border-border overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 220px)" }}>
                    <div className="px-4 py-3 border-b border-border shrink-0 flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Perfis Cadastrados</span>
                        <Badge variant="outline" className="text-xs">{roles.length}</Badge>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {loading ? (
                            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)
                        ) : roles.map(r => (
                            <button
                                key={r.id}
                                onClick={() => loadRolePermissions(r)}
                                className={`w-full text-left p-3 rounded-xl border transition-all ${selectedRole?.id === r.id
                                    ? 'bg-primary/10 border-primary/30 text-foreground'
                                    : 'border-transparent hover:bg-muted/50 hover:border-border text-foreground'
                                }`}
                            >
                                <div className="font-semibold text-sm leading-tight">{r.name}</div>
                                <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{r.description || "Sem descrição"}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Painel Direito */}
                <div className="lg:col-span-3">
                    {(isCreating || isEditingRoleInfo) ? (
                        <div className="bg-card rounded-2xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                            <div className="px-6 pt-6 pb-4 border-b border-border">
                                <h2 className="font-bold text-base flex items-center gap-2">
                                    <Shield className="h-4 w-4 text-primary" />
                                    {isCreating ? "Novo Perfil de Acesso" : "Editar Informações do Perfil"}
                                </h2>
                                <p className="text-muted-foreground text-sm mt-1">
                                    {isCreating
                                        ? "Defina o nome oficial (ex: 'Gerente da Ouvidoria'). Depois configure a matriz de permissões."
                                        : "Atualizar o nome reflete instantaneamente para todos os colaboradores com este perfil."}
                                </p>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="space-y-1.5">
                                    <Label className="font-semibold text-sm">Nome do Perfil <span className="text-red-400">*</span></Label>
                                    <Input
                                        value={roleForm.name}
                                        onChange={e => setRoleForm({ ...roleForm, name: e.target.value })}
                                        placeholder="Ex: Auxiliar Administrativo"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="font-semibold text-sm">Descrição</Label>
                                    <Input
                                        value={roleForm.description}
                                        onChange={e => setRoleForm({ ...roleForm, description: e.target.value })}
                                        placeholder="Destinado a operadores do balcão, foco na triagem."
                                    />
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <Button onClick={handleSaveRoleInfo} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                        <Save className="h-4 w-4 mr-2" /> Salvar
                                    </Button>
                                    <Button variant="outline" onClick={() => { setIsCreating(false); setIsEditingRoleInfo(false) }}>
                                        Cancelar
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : selectedRole ? (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            {/* Cabeçalho do perfil selecionado */}
                            <div className="bg-card rounded-2xl border border-border overflow-hidden">
                                <div className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                            <Shield className="h-5 w-5 text-primary" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-bold flex items-center gap-2.5 flex-wrap">
                                                {selectedRole.name}
                                                <Badge variant="outline" className="text-[10px] font-mono">
                                                    {selectedRole.id.split('-')[0]}
                                                </Badge>
                                            </h2>
                                            <p className="text-sm text-muted-foreground mt-0.5 max-w-lg">
                                                {selectedRole.description || "Nenhuma descrição fornecida."}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                        <Button variant="outline" size="sm" onClick={() => { setIsEditingRoleInfo(true); setRoleForm({ name: selectedRole.name, description: selectedRole.description || "" }) }}>
                                            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
                                        </Button>
                                        <Button variant="outline" size="sm" className="text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-400" onClick={() => deleteRole(selectedRole.id, selectedRole.name)}>
                                            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Destruir
                                        </Button>
                                    </div>
                                </div>
                                <div className="bg-amber-500/10 border-t border-amber-500/20 px-5 py-3 flex items-start gap-2.5">
                                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-400/90">
                                        <strong>Ver Menu</strong> é o pilar fundamental. Se não marcado, a rota deixa de existir para o colaborador. Ao ativar Criar ou Editar, Ver Menu é marcado automaticamente.
                                    </p>
                                </div>
                            </div>

                            {/* Matriz CRUD */}
                            <div className="bg-card rounded-2xl border border-border overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Matriz de Controle (CRUD)</span>
                                    <Button onClick={savePermissionsMatrix} disabled={saving} size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-full px-5">
                                        <Save className="h-3.5 w-3.5 mr-2" />
                                        {saving ? "Salvando..." : "Gravar Permissões"}
                                    </Button>
                                </div>

                                <div className="overflow-x-auto">
                                    <Table className="min-w-[700px]">
                                        <TableHeader>
                                            <TableRow className="border-b border-border hover:bg-transparent">
                                                <TableHead className="w-[260px] bg-card text-muted-foreground text-xs font-bold uppercase tracking-wider">
                                                    Módulo
                                                </TableHead>
                                                {COLS.map(col => {
                                                    const allChecked = permissions.length > 0 && permissions.every(p => p[col.field])
                                                    return (
                                                        <TableHead key={col.field} className="text-center bg-card min-w-[100px] border-l border-border">
                                                            <div className="flex flex-col items-center gap-1.5 py-1">
                                                                <span className="text-xs font-bold text-foreground">{col.label}</span>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="h-5 text-[10px] px-2 rounded-full w-full max-w-[72px] border-border"
                                                                    onClick={() => handleColumnSelectAll(col.field, !allChecked)}
                                                                >
                                                                    {allChecked ? 'Desfazer' : 'Todos'}
                                                                </Button>
                                                            </div>
                                                        </TableHead>
                                                    )
                                                })}
                                                <TableHead className="w-[60px] bg-card border-l border-border" />
                                            </TableRow>
                                        </TableHeader>

                                        <TableBody>
                                            {groupsToRender.map(group => (
                                                <div key={group.category} className="contents">
                                                    <TableRow className="bg-muted/30 hover:bg-muted/30 border-y border-border">
                                                        <TableCell colSpan={6} className="py-2 px-4">
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{group.category}</span>
                                                        </TableCell>
                                                    </TableRow>
                                                    {group.modules.map(mod => {
                                                        const perm = permissions.find(p => p.module === mod.id) || {}
                                                        const isRowFull = perm.can_read && perm.can_create && perm.can_update && perm.can_delete
                                                        return (
                                                            <TableRow key={mod.id} className="hover:bg-muted/20 transition-colors group/row border-b border-border/40">
                                                                <TableCell className="py-3 pl-5 bg-card group-hover/row:bg-muted/20">
                                                                    <div className="text-sm font-medium text-foreground">{mod.label}</div>
                                                                    <div className="font-mono text-[9px] text-muted-foreground/50 mt-0.5">{mod.id}</div>
                                                                </TableCell>
                                                                {COLS.map(col => (
                                                                    <TableCell key={col.field} className="text-center border-l border-border/40 bg-card group-hover/row:bg-muted/20">
                                                                        <Checkbox
                                                                            checked={perm[col.field] || false}
                                                                            onCheckedChange={c => handleCheckboxChange(mod.id, col.field, !!c)}
                                                                            className={`w-5 h-5 rounded border-border ${col.checkClass}`}
                                                                        />
                                                                    </TableCell>
                                                                ))}
                                                                <TableCell className="text-center border-l border-border/40 bg-card group-hover/row:bg-muted/20">
                                                                    <Button
                                                                        variant="ghost"
                                                                        onClick={() => handleRowSelectAll(mod.id, !isRowFull)}
                                                                        className={`h-7 w-7 p-0 rounded-md transition-all ${isRowFull ? 'text-primary bg-primary/10 border border-primary/30' : 'opacity-40 hover:opacity-100 hover:bg-primary/10 hover:text-primary'}`}
                                                                        title={isRowFull ? "Desmarcar linha" : "Marcar CRUD completo"}
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
                                </div>

                                <div className="px-5 py-4 border-t border-border flex flex-col md:flex-row justify-between items-center gap-3">
                                    <p className="text-xs text-muted-foreground">Modificações não salvas serão perdidas ao trocar de perfil.</p>
                                    <Button onClick={savePermissionsMatrix} disabled={saving} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-full px-8">
                                        <Save className="h-4 w-4 mr-2" />
                                        {saving ? "Salvando..." : "Salvar Matriz de Acesso"}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-[500px] flex flex-col items-center justify-center border border-dashed border-border rounded-2xl text-muted-foreground bg-muted/10 p-8 text-center animate-in zoom-in-95 duration-300">
                            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-5">
                                <Users className="h-7 w-7 text-muted-foreground/50" />
                            </div>
                            <h2 className="text-lg font-bold text-foreground">Selecione um Perfil</h2>
                            <p className="mt-2 text-sm text-muted-foreground max-w-sm">
                                Clique em um perfil na lista à esquerda para configurar sua matriz de permissões, ou crie um novo perfil.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
