"use client";

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
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

type SidebarLead = {
    nome?: string | null;
    telefone?: string | null;
};

type SidebarConversation = {
    id: string;
    status: string;
    updated_at?: string | null;
    origem_id?: string | null;
    nao_lidas?: number | null;
    // S-WM-66: setado só pelo worker, na 1ª mensagem que o LEAD manda — nunca pelo
    // caminho de disparo/breadcrumb. Base da seção fixa abaixo.
    primeira_interacao_lead_em?: string | null;
    leads?: SidebarLead | null;
};

export default function ChatSidebar({
    activeConversationId,
    onSelectConversation,
    filterAgenteTipo,
    filterCanalTipo,
    filterUnidade,
    title = "Atendimento",
}: ChatSidebarProps) {
    // S-WM-66: 2 conjuntos separados — fixedConversations (já teve interação real do
    // lead, seção fixa, SEM limite de quantidade) e normalConversations (nunca
    // interagiu, seção normal, mesmo PAGE_SIZE de sempre). Substituem o antigo
    // estado único `conversations`.
    const [fixedConversations, setFixedConversations] = useState<SidebarConversation[]>([]);
    const [normalConversations, setNormalConversations] = useState<SidebarConversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const supabase = createClient();
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const requestSeqRef = useRef(0);
    const loadControllerRef = useRef<AbortController | null>(null);
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
        let mounted = true;
        const requestSeq = ++requestSeqRef.current;
        loadControllerRef.current?.abort();
        const controller = new AbortController();
        loadControllerRef.current = controller;

        // S-WM-66: os filtros de canal/agente/unidade (com seus lookups assíncronos em
        // meta_phone_numbers) são resolvidos 1x aqui e aplicados às DUAS queries
        // (fixa + normal) — evita duplicar os round-trips de phone_number_ids.
        const applyScopeFilters = <T extends { in: (column: string, values: readonly unknown[]) => T }>(
            query: T,
            phoneNumberIds: string[] | null,
        ): T => {
            if (filterCanalTipo) {
                return query.in('origem_id', phoneNumberIds ?? []);
            }
            if (filterAgenteTipo && filterAgenteTipo.length > 0) {
                if (filterUnidade) {
                    return query.in('agente_tipo', filterAgenteTipo).in('origem_id', phoneNumberIds ?? []);
                }
                // Ouvidoria: filtra por agente_tipo diretamente — sem dependência de instancias_uazapi ou meta_phone_numbers
                return query.in('agente_tipo', filterAgenteTipo);
            }
            return query;
        };

        const fetchConversations = async () => {
            if (!mounted || requestSeq !== requestSeqRef.current) return;
            setLoading(true);
            try {
                let phoneNumberIds: string[] | null = null;

                if (filterCanalTipo) {
                    const { data: phoneNumbers } = await supabase
                        .from('meta_phone_numbers')
                        .select('phone_number_id')
                        .eq('canal_tipo', filterCanalTipo)
                        .eq('ativo', true)
                        .abortSignal(controller.signal);

                    phoneNumberIds = phoneNumbers?.map(p => p.phone_number_id) ?? [];
                    if (!mounted || requestSeq !== requestSeqRef.current) return;
                    if (controller.signal.aborted) return;
                    if (phoneNumberIds.length === 0) {
                        setFixedConversations([]);
                        setNormalConversations([]);
                        return;
                    }
                } else if (filterAgenteTipo && filterAgenteTipo.length > 0 && filterUnidade) {
                    const { data: phoneNumbers } = await supabase
                        .from('meta_phone_numbers')
                        .select('phone_number_id')
                        .eq('unidade_cuca', filterUnidade)
                        .eq('ativo', true)
                        .abortSignal(controller.signal);
                    phoneNumberIds = phoneNumbers?.map(p => p.phone_number_id) ?? [];
                    if (!mounted || requestSeq !== requestSeqRef.current) return;
                    if (controller.signal.aborted) return;
                    if (phoneNumberIds.length === 0) {
                        setFixedConversations([]);
                        setNormalConversations([]);
                        return;
                    }
                }

                const fixedQuery = applyScopeFilters(
                    supabase
                        .from('conversas')
                        .select(`*, leads (nome, telefone)`)
                        .not('primeira_interacao_lead_em', 'is', null)
                        .order('updated_at', { ascending: false })
                        .abortSignal(controller.signal),
                    phoneNumberIds,
                );
                const normalQuery = applyScopeFilters(
                    supabase
                        .from('conversas')
                        .select(`*, leads (nome, telefone)`)
                        .is('primeira_interacao_lead_em', null)
                        .order('updated_at', { ascending: false })
                        .limit(PAGE_SIZE)
                        .abortSignal(controller.signal),
                    phoneNumberIds,
                );

                const [fixedRes, normalRes] = await Promise.all([fixedQuery, normalQuery]);
                if (!mounted || requestSeq !== requestSeqRef.current) return;
                if (controller.signal.aborted) return;
                if (!fixedRes.error && fixedRes.data) setFixedConversations(fixedRes.data);
                if (!normalRes.error && normalRes.data) setNormalConversations(normalRes.data);
            } catch (err) {
                if (controller.signal.aborted) return;
                if (mounted && requestSeq === requestSeqRef.current) {
                    console.warn("[chat-sidebar] Falha ao carregar conversas:", err);
                    setFixedConversations([]);
                    setNormalConversations([]);
                }
            } finally {
                if (mounted && requestSeq === requestSeqRef.current && loadControllerRef.current === controller) {
                    setLoading(false);
                }
            }
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
            .subscribe((status) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    console.warn(`[chat-sidebar] Realtime ${status} no canal ${channelName}`);
                }
            });

        return () => {
            mounted = false;
            clearTimeout(debounceRef.current);
            controller.abort();
            supabase.removeChannel(channel);
        };
    }, [supabase, channelName, filterCanalTipo, filterAgenteTipo, filterUnidade]);

    // T5 / S-WM-66: ordenar — awaiting_human primeiro, depois por updated_at desc.
    // Mesmo critério aplicado às 2 seções (na prática só importa pra fixa: uma
    // conversa só chega a awaiting_human depois de já ter primeira_interacao_lead_em
    // setado, então a seção normal nunca tem awaiting_human=true).
    const sortConversations = (list: SidebarConversation[]) =>
        [...list].sort((a, b) => {
            const aHuman = a.status === 'awaiting_human' ? 0 : 1;
            const bHuman = b.status === 'awaiting_human' ? 0 : 1;
            if (aHuman !== bHuman) return aHuman - bHuman;
            return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
        });

    const matchesSearch = useCallback(
        (conv: SidebarConversation) =>
            conv.leads?.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            conv.leads?.telefone?.includes(searchTerm),
        [searchTerm],
    );

    const sortedFixed = useMemo(
        () => sortConversations(fixedConversations.filter(matchesSearch)),
        [fixedConversations, matchesSearch],
    );
    const sortedNormal = useMemo(
        () => sortConversations(normalConversations.filter(matchesSearch)),
        [normalConversations, matchesSearch],
    );

    const renderConversationRow = (conv: SidebarConversation) => {
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
                            {conv.leads?.telefone || conv.origem_id}
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
    };

    return (
        <div className="flex flex-col h-full border-r bg-card/50 backdrop-blur-sm">
            <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold tracking-tight">{title}</h2>
                    {fixedConversations.some(c => c.status === 'awaiting_human') && (
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

            {loading ? (
                <div className="flex-1 overflow-y-auto px-2 pb-4">
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
                </div>
            ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* S-WM-66: seção fixa — toda conversa com interação real do lead, sem
                        limite de quantidade, scroll próprio (independente da seção normal
                        abaixo). Só aparece quando há pelo menos 1 conversa engajada. */}
                    {sortedFixed.length > 0 && (
                        <div className="flex flex-col shrink-0 border-b border-border/50" style={{ maxHeight: "45%" }}>
                            <div className="px-4 pt-3 pb-1.5 flex items-center gap-2 shrink-0">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Conversas ativas
                                </span>
                                <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                                    {sortedFixed.length}
                                </Badge>
                            </div>
                            <div className="overflow-y-auto px-2 pb-2 space-y-1">
                                {sortedFixed.map(renderConversationRow)}
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col flex-1 overflow-hidden">
                        <div className="px-4 pt-3 pb-1.5 shrink-0">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Aguardando primeiro contato
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
                            {sortedNormal.length === 0 ? (
                                <div className="p-8 text-center text-sm text-muted-foreground">
                                    {sortedFixed.length === 0 ? "Nenhuma conversa encontrada" : "Nenhuma conversa aguardando"}
                                </div>
                            ) : (
                                sortedNormal.map(renderConversationRow)
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
