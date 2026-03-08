"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search } from "lucide-react";

interface ChatSidebarProps {
    activeConversationId: string | null;
    onSelectConversation: (id: string) => void;
    filterAgenteTipo?: string[];
    filterCanalTipo?: string;
    title?: string;
}

export default function ChatSidebar({ activeConversationId, onSelectConversation, filterAgenteTipo, filterCanalTipo, title = "Atendimento" }: ChatSidebarProps) {
    const [conversations, setConversations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const supabase = createClient();

    useEffect(() => {
        fetchConversations();

        const channel = supabase
            .channel('conversas-changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'conversas'
            }, () => {
                fetchConversations();
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'mensagens'
            }, () => {
                fetchConversations(); // Update list when new message arrives
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    async function fetchConversations() {
        let query = supabase
            .from('conversas')
            .select(`*, leads (nome, telefone)`)
            .order('updated_at', { ascending: false });

        if (filterCanalTipo) {
            // Whitelist: busca instâncias do canal_tipo especificado e filtra conversas por elas
            const { data: instancias } = await supabase
                .from('instancias_uazapi')
                .select('nome')
                .eq('canal_tipo', filterCanalTipo)
                .eq('ativa', true);

            const nomes = instancias?.map(i => i.nome) ?? [];
            if (nomes.length > 0) {
                query = query.in('instancia_uazapi', nomes);
            } else {
                // Nenhuma instância institucional ativa — retorna lista vazia
                setConversations([]);
                setLoading(false);
                return;
            }
        } else if (filterAgenteTipo && filterAgenteTipo.length > 0) {
            query = query.in('agente_tipo', filterAgenteTipo);
        }

        const { data, error } = await query;

        if (!error && data) {
            setConversations(data);
        }
        setLoading(false);
    }

    const filteredConversations = conversations.filter(conv =>
        conv.leads?.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        conv.leads?.telefone?.includes(searchTerm)
    );

    return (
        <div className="flex flex-col h-full border-r bg-card/50 backdrop-blur-sm">
            <div className="p-4 space-y-4">
                <h2 className="text-xl font-bold tracking-tight">{title}</h2>
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
                ) : filteredConversations.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        Nenhuma conversa encontrada
                    </div>
                ) : (
                    filteredConversations.map((conv) => (
                        <button
                            key={conv.id}
                            onClick={() => onSelectConversation(conv.id)}
                            className={cn(
                                "w-full flex items-center gap-3 p-3 rounded-lg transition-all border border-transparent",
                                activeConversationId === conv.id
                                    ? "bg-white/10 border-primary/20 shadow-sm"
                                    : "hover:bg-white/5 hover:scale-[1.01] active:scale-[0.99]"
                            )}
                        >
                            <div className="relative">
                                <Avatar className="h-10 w-10 border border-muted ring-offset-background transition-transform">
                                    <AvatarFallback className="bg-primary/10 text-primary font-medium text-xs">
                                        {conv.leads?.nome?.substring(0, 2).toUpperCase() || "CN"}
                                    </AvatarFallback>
                                </Avatar>
                                {conv.status === 'ativa' && (
                                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background rounded-full animate-pulse" />
                                )}
                            </div>

                            <div className="flex-1 text-left overflow-hidden">
                                <div className="flex justify-between items-center gap-2">
                                    <span className="font-semibold truncate text-[13px] text-foreground/90 leading-tight">
                                        {conv.leads?.nome || "Cidadão"}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/80 whitespace-nowrap">
                                        {conv.updated_at && formatDistanceToNow(new Date(conv.updated_at), { addSuffix: false, locale: ptBR })}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <p className="text-[11px] text-muted-foreground truncate flex-1 opacity-70">
                                        {conv.leads?.telefone || conv.instancia_uazapi}
                                    </p>
                                    {conv.status === 'ativa' && (
                                        <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-primary/30 text-primary uppercase font-bold tracking-wider bg-primary/5">
                                            IA
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
