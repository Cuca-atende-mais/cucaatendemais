"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { SinoAlertasBotao } from "@/components/alertas/sino-alertas-botao"
import { AlertasLista } from "@/components/alertas/alertas-lista"
import {
    ALERTAS_INTERVALO_MS,
    ALERTAS_POR_PAGINA,
    type AlertaItem,
    normalizarAlertas,
    totalPaginas,
} from "@/lib/alertas/alertas"

// S-INST-QUAL-12 — Sino de alertas do cabeçalho. Só aparece para as duas contas Developer
// (mesmo controle do módulo Developer: `isDeveloper` do UserProvider, que vale também sem
// `profile`). No banco, a RLS repete a regra (`public.is_developer()`).
//
// Atualização sem recarregar: consulta só a contagem a cada 60 s e ao voltar para a aba
// (padrão de consulta periódica que o portal já usa), e logo depois de marcar como lido.
// A lista é carregada pelos próprios cliques (abrir, trocar de página, marcar).
export function CentralAlertas() {
    const { isDeveloper, loading } = useUser()
    if (loading || !isDeveloper) return null
    return <CentralAlertasDeveloper />
}

type ClienteRpc = ReturnType<typeof createClient>

async function buscarContagem(supabase: ClienteRpc): Promise<number | null> {
    const { data, error } = await supabase.rpc("alertas_contar_nao_lidos")
    if (error) {
        console.error("[alertas] erro ao contar não lidos:", error.message)
        return null
    }
    return typeof data === "number" ? data : Number(data ?? 0)
}

function CentralAlertasDeveloper() {
    const supabase = useMemo(() => createClient(), [])
    const [naoLidos, setNaoLidos] = useState(0)
    const [aberto, setAberto] = useState(false)
    const [pagina, setPagina] = useState(1)
    const [itens, setItens] = useState<AlertaItem[]>([])
    const [total, setTotal] = useState(0)
    const [carregando, setCarregando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)

    const atualizarContagem = useCallback(async () => {
        const n = await buscarContagem(supabase)
        if (n !== null) setNaoLidos(n)
    }, [supabase])

    const carregarLista = useCallback(async (p: number): Promise<void> => {
        setCarregando(true)
        setErro(null)
        let alvo = Math.max(1, p)
        let lista: AlertaItem[] = []
        for (;;) {
            const { data, error } = await supabase.rpc("alertas_listar", {
                p_pagina: alvo,
                p_por_pagina: ALERTAS_POR_PAGINA,
            })
            if (error) {
                setCarregando(false)
                setErro("Não foi possível carregar os alertas. Tente de novo em instantes.")
                console.error("[alertas] erro ao listar:", error.message)
                return
            }
            lista = normalizarAlertas(data)
            // a página ficou vazia (ex.: menos alertas que antes): volta uma
            if (lista.length > 0 || alvo === 1) break
            alvo -= 1
        }
        setCarregando(false)
        setPagina(alvo)
        setItens(lista)
        setTotal(lista[0]?.total ?? 0)
    }, [supabase])

    // contagem: na entrada, a cada 60 s e ao voltar para a aba. O estado só muda quando a
    // resposta chega (dentro do .then), nunca direto no corpo do efeito.
    useEffect(() => {
        let ativo = true
        const atualizar = () => {
            void buscarContagem(supabase).then((n) => {
                if (ativo && n !== null) setNaoLidos(n)
            })
        }
        atualizar()
        const intervalo = setInterval(atualizar, ALERTAS_INTERVALO_MS)
        const aoVoltar = () => {
            if (document.visibilityState === "visible") atualizar()
        }
        document.addEventListener("visibilitychange", aoVoltar)
        return () => {
            ativo = false
            clearInterval(intervalo)
            document.removeEventListener("visibilitychange", aoVoltar)
        }
    }, [supabase])

    const marcar = useCallback(async (ids: string[] | null) => {
        setCarregando(true)
        const { error } = await supabase.rpc("alertas_marcar_lidos", { p_ids: ids })
        setCarregando(false)
        if (error) {
            setErro("Não foi possível marcar como lido. Tente de novo em instantes.")
            console.error("[alertas] erro ao marcar como lido:", error.message)
            return
        }
        await Promise.all([atualizarContagem(), carregarLista(pagina)])
    }, [supabase, atualizarContagem, carregarLista, pagina])

    const abrir = (estado: boolean) => {
        setAberto(estado)
        if (estado) {
            void atualizarContagem()
            void carregarLista(1)
        }
    }

    return (
        <>
            <SinoAlertasBotao naoLidos={naoLidos} onClick={() => abrir(true)} />
            <Dialog open={aberto} onOpenChange={abrir}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Alertas do sistema</DialogTitle>
                        <DialogDescription>
                            Avisos automáticos da base de conhecimento do atendimento. Cada um também é enviado por e-mail.
                        </DialogDescription>
                    </DialogHeader>
                    <AlertasLista
                        itens={itens}
                        pagina={pagina}
                        totalPaginas={totalPaginas(total)}
                        naoLidos={naoLidos}
                        carregando={carregando}
                        erro={erro}
                        onPagina={(p) => void carregarLista(p)}
                        onMarcarLido={(id) => void marcar([id])}
                        onMarcarTodos={() => void marcar(null)}
                    />
                </DialogContent>
            </Dialog>
        </>
    )
}
