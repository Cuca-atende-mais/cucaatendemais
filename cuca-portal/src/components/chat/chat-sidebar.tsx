"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search } from "lucide-react";

const PAGE_SIZE = 50;

interface ChatSidebarProps {
    activeConversationId: string | null;
    onSelectConversation: (id: string) => void;
    filterAgenteTipo?: readonly string[];
    filterCanalTipo?: string;
    filterUnidade?: string;
    title?: string;
}

export default function ChatSidebar({
    activeConversationId,
    onSelectConversation,
    filterAgenteTipo,
    filterCanalTipo,
    filterUnidade,
    title = "Atendimento",
}: ChatSidebarProps) {
    const [conversations, setConversations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const supabase = createClient();
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // Ref estável para fetchConversations — evita stale closure no canal Realtime
    const fetchRef = useRef<() => Promise<void>>(async () => {});

    const channelName = useMemo(() => {
        const key = filterCanalTipo ?? filterAgenteTipo?.join("-") ?? "global";
        return `conversas-changes-${key}`;
    }, [filterCanalTipo, filterAgenteTipo]);

    function scheduleFetch() {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchRef.current(), 300);
    }

    useEffect(() => {
        const fetchConversations = async () => {
            let query = supabase
                .from('conversas')
                .select(`*, leads (nome, telefone)`)
                .order('updated_at', { ascending: false })
                .limit(PAGE_SIZE);

            if (filterCanalTipo) {
                const { data: instancias } = await supabase
                    .from('instancias_uazapi')
                    .select('nome')
                    .eq('canal_tipo', filterCanalTipo)
                    .eq('ativa', true);

                const nomes = instancias?.map(i => i.nome) ?? [];
                if (nomes.length > 0) {
                    query = query.in('instancia_uazapi', nomes);
                } else {
                    setConversations([]);
                    setLoading(false);
                    return;
                }
            } else if (filterAgenteTipo && filterAgenteTipo.length > 0) {
                if (filterUnidade) {
                    const { data: instanciasUnidade } = await supabase
                        .from('instancias_uazapi')
                        .select('nome')
                        .eq('unidade_cuca', filterUnidade)
                        .eq('ativa', true);
                    const nomesUnidade = instanciasUnidade?.map(i => i.nome) ?? [];
                    if (nomesUnidade.length > 0) {
                        query = query.in('agente_tipo', filterAgenteTipo).in('instancia_uazapi', nomesUnidade);
                    } else {
                        setConversations([]);
                        setLoading(false);
                        return;
                    }
                } else {
                    query = query.in('agente_tipo', filterAgenteTipo);
                }
            }

            const { data, error } = await query;
            if (!error && data) setConversations(data);
            setLoading(false);
        };

        // Registrar ref estável antes de montar o canal
        fetchRef.current = fetchConversations;
        fetchConversations();

        // T4: ouvir apenas 'conversas.*' — worker atualiza conversas.updated_at a cada mensagem nova,
        // portanto o listener de mensagens.INSERT global foi removido (era O(N) desnecessário).
        const channel = supabase
            .channel(channelName)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'conversas',
            }, () => scheduleFetch())
            .subscribe();

        return () => {
            clearTimeout(debounceRef.current);
            supabase.removeChannel(channel);
        };
    }, [channelName, filterCanalTipo, filterAgenteTipo, filterUnidade]);

    // T5: ordenar — awaiting_human primeiro, depois por updated_at desc
    const sortedConversations = useMemo(() => {
        const filtered = conversations.filter(conv =>
            conv.leads?.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            conv.leads?.telefone?.includes(searchTerm)
        );
        return [...filtered].sort((a, b) => {
            const aHuman = a.status === 'awaiting_human' ? 0 : 1;
            const bHuman = b.status === 'awaiting_human' ? 0 : 1;
            if (aHuman !== bHuman) return aHuman - bHuman;
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });
    }, [conversations, searchTerm]);

    return (
        <div className="flex flex-col h-full border-r bg-card/50 backdrop-blur-sm">
            <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold tracking-tight">{title}</h2>
                    {conversations.some(c => c.status === 'awaiting_human') && (
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
                        {[1, 2, 3].map(i => (
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
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        Nenhuma conversa encontrada
                    </div>
                ) : (
                    sortedConversations.map((conv) => {
                        const isHuman = conv.status === 'awaiting_human';
                        const unreadCount: number = conv.nao_lidas ?? 0;

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
                                            : "border-transparent hover:bg-white/5 hover:scale-[1.01] active:scale-[0.99]"
                                )}
                            >
                                <div className="relative shrink-0">
                                    <Avatar className="h-10 w-10 border border-muted ring-offset-background">
                                        <AvatarFallback className={cn(
                                            "text-xs font-medium",
                                            isHuman ? "bg-amber-500/10 text-amber-700" : "bg-primary/10 text-primary"
                                        )}>
                                            {conv.leads?.nome?.substring(0, 2).toUpperCase() || "CN"}
                                        </AvatarFallback>
                                    </Avatar>
                                    {/* T5: badge de não lidas */}
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
                                            isHuman ? "text-amber-700 dark:text-amber-400" : "text-foreground/90"
                                        )}>
                                            {conv.leads?.nome || "Cidadão"}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground/80 whitespace-nowrap shrink-0">
                                            {conv.updated_at && formatDistanceToNow(new Date(conv.updated_at), { addSuffix: false, locale: ptBR })}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <p className="text-[11px] text-muted-foreground truncate flex-1 opacity-70">
                                            {conv.leads?.telefone || conv.instancia_uazapi}
                                        </p>
                                        {/* T5: badge de status */}
                                        {isHuman ? (
                                            <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-amber-500/40 text-amber-600 uppercase font-bold tracking-wider bg-amber-500/5 shrink-0">
                                                Humano
                                            </Badge>
                                        ) : conv.status === 'ativa' ? (
                                            <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-primary/30 text-primary uppercase font-bold tracking-wider bg-primary/5 shrink-0">
                                                IA
                                            </Badge>
                                        ) : null}
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
