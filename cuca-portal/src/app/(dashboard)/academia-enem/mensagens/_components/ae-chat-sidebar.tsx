"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search } from "lucide-react";

// Sidebar PRÓPRIA do módulo Academia Enem — opera sobre ae_conversas (camada própria), NUNCA sobre
// conversas/instancias_uazapi. Não reusa o ChatSidebar compartilhado (hard-keyed ao uazapi).

const PAGE_SIZE = 50;

type SidebarLead = {
    nome?: string | null;
    telefone?: string | null;
};

export type AeSidebarConversation = {
    id: string;
    status: string;
    wa_contact: string;
    push_name?: string | null;
    nao_lidas?: number | null;
    ultima_mensagem_em?: string | null;
    updated_at?: string | null;
    leads?: SidebarLead | null;
};

interface AeChatSidebarProps {
    activeConversationId: string | null;
    onSelectConversation: (id: string) => void;
    title?: string;
}

export default function AeChatSidebar({
    activeConversationId,
    onSelectConversation,
    title = "Academia Enem",
}: AeChatSidebarProps) {
    const [conversations, setConversations] = useState<AeSidebarConversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const supabase = useMemo(() => createClient(), []);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const requestSeqRef = useRef(0);
    const loadControllerRef = useRef<AbortController | null>(null);
    // Ref estável para o fetch — evita stale closure dentro do callback do canal Realtime.
    const fetchRef = useRef<() => Promise<void>>(async () => {});

    function scheduleFetch() {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchRef.current(), 300);
    }

    useEffect(() => {
        let mounted = true;
        const requestSeq = ++requestSeqRef.current;
        loadControllerRef.current?.abort();
        const controller = new AbortController();
        loadControllerRef.current = controller;

        const fetchConversations = async () => {
            if (!mounted || requestSeq !== requestSeqRef.current) return;
            setLoading(true);
            try {
                // "Número instanciado" (AC#1): só as instâncias ativas do módulo.
                const { data: instancias } = await supabase
                    .from("ae_instancias")
                    .select("id")
                    .eq("ativa", true)
                    .abortSignal(controller.signal);
                if (!mounted || requestSeq !== requestSeqRef.current || controller.signal.aborted) return;

                const ids = instancias?.map((i) => i.id) ?? [];
                if (ids.length === 0) {
                    setConversations([]);
                    return;
                }

                const { data, error } = await supabase
                    .from("ae_conversas")
                    .select("id, status, wa_contact, push_name, nao_lidas, ultima_mensagem_em, updated_at, leads (nome, telefone)")
                    .in("ae_instancia_id", ids)
                    .order("ultima_mensagem_em", { ascending: false, nullsFirst: false })
                    .limit(PAGE_SIZE)
                    .abortSignal(controller.signal);
                if (!mounted || requestSeq !== requestSeqRef.current || controller.signal.aborted) return;
                if (!error && data) setConversations(data as AeSidebarConversation[]);
            } catch (err) {
                if (controller.signal.aborted) return;
                if (mounted && requestSeq === requestSeqRef.current) {
                    console.warn("[ae-chat-sidebar] Falha ao carregar conversas:", err);
                    setConversations([]);
                }
            } finally {
                if (mounted && requestSeq === requestSeqRef.current && loadControllerRef.current === controller) {
                    setLoading(false);
                }
            }
        };

        fetchRef.current = fetchConversations;
        fetchConversations();

        // Realtime: qualquer mudança em ae_conversas re-busca (debounced). Entrega respeita a RLS do assinante.
        const channel = supabase
            .channel("ae-conversas-changes")
            .on("postgres_changes", { event: "*", schema: "public", table: "ae_conversas" }, () => scheduleFetch())
            .subscribe((status) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    console.warn(`[ae-chat-sidebar] Realtime ${status}`);
                }
            });

        return () => {
            mounted = false;
            clearTimeout(debounceRef.current);
            controller.abort();
            supabase.removeChannel(channel);
        };
    }, [supabase]);

    const sortedConversations = useMemo(() => {
        const term = searchTerm.toLowerCase();
        const filtered = conversations.filter((conv) => {
            const nome = (conv.leads?.nome ?? conv.push_name ?? "").toLowerCase();
            const tel = conv.leads?.telefone ?? conv.wa_contact ?? "";
            return nome.includes(term) || tel.includes(searchTerm);
        });
        // awaiting_human primeiro, depois por última mensagem desc.
        return [...filtered].sort((a, b) => {
            const aHuman = a.status === "awaiting_human" ? 0 : 1;
            const bHuman = b.status === "awaiting_human" ? 0 : 1;
            if (aHuman !== bHuman) return aHuman - bHuman;
            const at = new Date(a.ultima_mensagem_em ?? a.updated_at ?? 0).getTime();
            const bt = new Date(b.ultima_mensagem_em ?? b.updated_at ?? 0).getTime();
            return bt - at;
        });
    }, [conversations, searchTerm]);

    return (
        <div className="flex flex-col h-full border-r bg-card/50 backdrop-blur-sm">
            <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold tracking-tight">{title}</h2>
                    {conversations.some((c) => c.status === "awaiting_human") && (
                        <Badge variant="destructive" className="text-[9px] h-4 px-1.5 animate-pulse">
                            Aguardando
                        </Badge>
                    )}
                </div>
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar..."
                        className="pl-9 bg-background/50 border-primary/10 transition-colors focus:border-primary/30 h-9 text-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
                {loading ? (
                    <div className="p-8 text-center space-y-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="animate-pulse flex items-center gap-3 opacity-50">
                                <div className="h-10 w-10 bg-muted rounded-full" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-3 bg-muted rounded w-3/4" />
                                    <div className="h-2 bg-muted rounded w-1/2" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : sortedConversations.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada</div>
                ) : (
                    sortedConversations.map((conv) => {
                        const isHuman = conv.status === "awaiting_human";
                        const unreadCount: number = conv.nao_lidas ?? 0;
                        const nome = conv.leads?.nome || conv.push_name || "Cidadão";
                        const quando = conv.ultima_mensagem_em ?? conv.updated_at;

                        return (
                            <button
                                key={conv.id}
                                onClick={() => onSelectConversation(conv.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 p-3 rounded-lg transition-all border",
                                    activeConversationId === conv.id
                                        ? "bg-white/10 border-primary/20 shadow-sm"
                                        : isHuman
                                            ? "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10"
                                            : "border-transparent hover:bg-white/5 hover:scale-[1.01] active:scale-[0.99]",
                                )}
                            >
                                <div className="relative shrink-0">
                                    <Avatar className="h-10 w-10 border border-muted ring-offset-background">
                                        <AvatarFallback className={cn(
                                            "text-xs font-medium",
                                            isHuman ? "bg-amber-500/10 text-amber-700" : "bg-primary/10 text-primary",
                                        )}>
                                            {nome.substring(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                    {unreadCount > 0 && (
                                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow">
                                            {unreadCount > 99 ? "99+" : unreadCount}
                                        </span>
                                    )}
                                </div>

                                <div className="flex-1 text-left overflow-hidden">
                                    <div className="flex justify-between items-center gap-2">
                                        <span className={cn(
                                            "font-semibold truncate text-[13px] leading-tight",
                                            isHuman ? "text-amber-700 dark:text-amber-400" : "text-foreground/90",
                                        )}>
                                            {nome}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground/80 whitespace-nowrap shrink-0">
                                            {quando && formatDistanceToNow(new Date(quando), { addSuffix: false, locale: ptBR })}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <p className="text-[11px] text-muted-foreground truncate flex-1 opacity-70">
                                            {conv.leads?.telefone || conv.wa_contact}
                                        </p>
                                        {isHuman && (
                                            <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-amber-500/40 text-amber-600 uppercase font-bold tracking-wider bg-amber-500/5 shrink-0">
                                                Humano
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
}
