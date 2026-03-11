"use client"

import { useState, useEffect } from "react"
import { Settings2, Save, Loader2, Info, CheckCircle2, AlertTriangle, ArrowLeft, KeyRound, Eye, EyeOff } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import toast from "react-hot-toast"

type SystemConfig = {
    chave: string
    valor: string
    descricao: string
}

export default function DevConfigPage() {
    const supabase = createClient()
    const [configs, setConfigs] = useState<SystemConfig[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [openaiKey, setOpenaiKey] = useState("")
    const [showKey, setShowKey] = useState(false)
    const [savingKey, setSavingKey] = useState(false)

    useEffect(() => {
        fetchConfigs()
    }, [])

    const fetchConfigs = async () => {
        setLoading(true)
        const { data } = await supabase.from("system_config").select("*").order("chave")
        if (data) setConfigs(data)
        setLoading(false)
    }

    const handleChange = (chave: string, valor: string) => {
        setConfigs(prev => prev.map(c => c.chave === chave ? { ...c, valor } : c))
    }

    const handleSave = async (config: SystemConfig) => {
        setSaving(true)
        const { error } = await supabase
            .from("system_config")
            .update({ valor: config.valor, updated_at: new Date().toISOString() })
            .eq("chave", config.chave)

        if (error) {
            toast.error(`Erro ao salvar ${config.chave}`)
        } else {
            toast.success(`Configuração ${config.chave} atualizada`)
        }
        setSaving(false)
    }

    const handleUpdateVaultKey = async () => {
        if (!openaiKey.trim()) {
            toast.error("Cole a nova chave antes de salvar")
            return
        }
        setSavingKey(true)
        try {
            const res = await fetch("/api/developer/update-vault-secret", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ secret_name: "openai_api_key", secret_value: openaiKey.trim() }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Erro desconhecido")
            toast.success("Chave OpenAI atualizada no Vault com sucesso")
            setOpenaiKey("")
        } catch (err: any) {
            toast.error(`Erro ao atualizar: ${err.message}`)
        } finally {
            setSavingKey(false)
        }
    }

    const handleSaveAll = async () => {
        setSaving(true)
        for (const config of configs) {
            await supabase
                .from("system_config")
                .update({ valor: config.valor, updated_at: new Date().toISOString() })
                .eq("chave", config.chave)
        }
        toast.success("Todas as configurações foram salvas")
        setSaving(false)
    }

    if (loading) return <div className="flex justify-center py-40"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/developer">
                        <Button variant="outline" size="icon">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2"><Settings2 className="h-6 w-6 text-primary" /> Configurações do Sistema</h1>
                        <p className="text-sm text-muted-foreground mt-1">Gerencie variáveis de ambiente e parâmetros operacionais em tempo real.</p>
                    </div>
                </div>
                <Button onClick={handleSaveAll} disabled={saving} className="bg-primary hover:bg-primary/90">
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Salvar Tudo
                </Button>
            </div>

            <div className="grid grid-cols-1 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base font-semibold">Parâmetros de Operação</CardTitle>
                        <CardDescription>
                            Alterações nestes campos afetam o comportamento imediato do Worker sem necessidade de restart.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {configs.map((config) => (
                            <div key={config.chave} className="flex flex-col md:flex-row md:items-start gap-4 p-4 rounded-lg border bg-slate-50/50 hover:bg-slate-50 transition-colors">
                                <div className="flex-1 space-y-1">
                                    <Label className="text-sm font-bold uppercase tracking-wider text-slate-700">{config.chave.replace(/_/g, " ")}</Label>
                                    <p className="text-xs text-muted-foreground">{config.descricao}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <code className="bg-slate-200 px-1.5 py-0.5 rounded text-[10px] text-slate-600">KEY: {config.chave}</code>
                                    </div>
                                </div>
                                <div className="flex flex-col md:items-end gap-2 w-full md:w-1/3">
                                    <Input
                                        value={config.valor}
                                        onChange={(e) => handleChange(config.chave, e.target.value)}
                                        className="font-mono bg-white"
                                    />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleSave(config)}
                                        className="text-xs h-7 hover:text-primary"
                                    >
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Atualizar apenas esta
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                            <KeyRound className="h-4 w-4 text-amber-500" /> Credenciais do Sistema
                        </CardTitle>
                        <CardDescription>
                            Atualize chaves de API armazenadas de forma segura no Vault do Supabase. O valor atual não é exibido por segurança.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col md:flex-row md:items-end gap-4 p-4 rounded-lg border bg-slate-50/50">
                            <div className="flex-1 space-y-1">
                                <Label className="text-sm font-bold uppercase tracking-wider text-slate-700">OpenAI API Key</Label>
                                <p className="text-xs text-muted-foreground">Usada pelo motor-agente para embeddings (RAG) e respostas GPT-4o. Cole a nova chave apenas quando a atual expirar.</p>
                                <code className="bg-slate-200 px-1.5 py-0.5 rounded text-[10px] text-slate-600">Vault: openai_api_key</code>
                            </div>
                            <div className="flex flex-col md:items-end gap-2 w-full md:w-1/2">
                                <div className="relative w-full">
                                    <Input
                                        type={showKey ? "text" : "password"}
                                        placeholder="sk-proj-..."
                                        value={openaiKey}
                                        onChange={(e) => setOpenaiKey(e.target.value)}
                                        className="font-mono bg-white pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowKey(v => !v)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                                <Button
                                    onClick={handleUpdateVaultKey}
                                    disabled={savingKey || !openaiKey.trim()}
                                    className="w-full md:w-auto bg-amber-500 hover:bg-amber-600 text-white"
                                    size="sm"
                                >
                                    {savingKey ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
                                    Atualizar Chave no Vault
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                    <div>
                        <p className="text-sm font-bold text-amber-900">Atenção com as chaves</p>
                        <p className="text-xs text-amber-800 mt-0.5">
                            As chaves de configuração são utilizadas diretamente pelo Worker em Python. Alterar o NOME da chave pode quebrar integrações. Altere apenas os VALORES.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
