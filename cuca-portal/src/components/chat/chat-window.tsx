"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { User, Bot, Send, ShieldCheck, Zap, PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";

interface ChatWindowProps {
    conversationId: string | null;
}

export default function ChatWindow({ conversationId }: ChatWindowProps) {
    const [messages, setMessages] = useState<any[]>([]);
    const [conversation, setConversation] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const supabase = createClient();

    useEffect(() => {
        if (!conversationId) return;

        fetchConversationDetails();
        fetchMessages();

        // Subscribe to messages of this specific conversation
        const channel = supabase
            .channel(`chat-${conversationId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'mensagens',
                filter: `conversa_id=eq.${conversationId}`
            }, (payload) => {
                setMessages(prev => {
                    // Avoid duplicate messages if the insert also comes from the fetch re-run
                    if (prev.find(m => m.id === payload.new.id)) return prev;
                    return [...prev, payload.new];
                });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [conversationId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, loading]);

    async function fetchConversationDetails() {
        const { data } = await supabase
            .from('conversas')
            .select('*, leads(*)')
            .eq('id', conversationId)
            .single();

        if (data) setConversation(data);
    }

    async function fetchMessages() {
        setLoading(true);
        const { data, error } = await supabase
            .from('mensagens')
            .select('*')
            .eq('conversa_id', conversationId)
            .order('created_at', { ascending: true });

        if (!error && data) {
            setMessages(data);
        }
        setLoading(false);
    }

    async function toggleIA() {
        if (!conversationId || !conversation) return;

        let newStatus;
        if (conversation.status === 'ativa') {
            newStatus = 'manual';
        } else if (conversation.status === 'awaiting_human') {
            newStatus = 'manual';
        } else {
            newStatus = 'ativa';
        }

        const { error } = await supabase
            .from('conversas')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', conversationId);

        if (!error) {
            setConversation({ ...conversation, status: newStatus });
            if (newStatus === 'ativa') {
                toast.success("IA Maria ativada para esta conversa");
            } else if (newStatus === 'manual' && conversation.status === 'awaiting_human') {
                toast.success("Você assumiu o controle da conversa");
            } else {
                toast.success("Conversa colocada em modo manual");
            }
        } else {
            toast.error("Erro ao alterar status da IA");
        }
    }

    if (!conversationId) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-card/10 text-muted-foreground p-8 text-center space-y-6">
                <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-150 animate-pulse" />
                    <div className="relative p-8 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 shadow-xl">
                        <Send className="h-16 w-16 text-primary/40 rotate-12" />
                    </div>
                </div>
                <div className="space-y-2">
                    <h3 className="text-2xl font-bold text-foreground/80 tracking-tight">Painel de Monitoramento</h3>
                    <p className="text-sm max-w-sm mx-auto opacity-70">
                        Selecione um cidadão na lista lateral para acompanhar o atendimento automático e garantir a excelência da MARIA IA.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-card/20 backdrop-blur-md relative overflow-hidden">
            {/* Abstract background elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/5 blur-[100px] rounded-full translate-y-1/2 -translate-x-1/2" />

            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between bg-card/40 relative z-10">
                <div className="flex items-center gap-3">
                    <Avatar className="h-11 w-11 border-2 border-primary/10 shadow-lg transition-transform hover:scale-105">
                        <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/5 text-primary font-bold">
                            {conversation?.leads?.nome?.substring(0, 2).toUpperCase() || "CN"}
                        </AvatarFallback>
                    </Avatar>
                    <div>
                        <h3 className="font-bold text-base lg:text-lg tracking-tight">{conversation?.leads?.nome || "Cidadão"}</h3>
                        <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1 text-[11px] text-green-500 font-medium bg-green-500/10 px-1.5 rounded-full">
                                <span className="w-1 h-1 rounded-full bg-green-500 animate-ping" />
                                Online
                            </span>
                            <span className="text-[11px] text-muted-foreground/60">•</span>
                            <span className="text-[11px] text-muted-foreground font-mono">{conversation?.leads?.telefone}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="hidden md:flex items-center gap-1.5 text-[10px] text-muted-foreground mr-4 uppercase tracking-widest font-semibold opacity-50">
                        <ShieldCheck className="h-3 w-3" />
                        Espelhamento Seguro
                    </div>
                    <Badge variant="outline" className="h-7 bg-white/5 border-primary/20 text-primary font-medium shadow-sm px-3">
                        {conversation?.instancia_uazapi}
                    </Badge>
                    {conversation?.status === 'ativa' && (
                        <button
                            onClick={toggleIA}
                            className="h-7 px-3 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md shadow-md animate-in fade-in zoom-in duration-300 gap-1.5 flex items-center text-[10px] font-bold transition-all active:scale-95"
                        >
                            <Zap className="h-3 w-3 fill-current" />
                            IA MARIA ATIVA
                        </button>
                    )}
                    {conversation?.status === 'awaiting_human' && (
                        <button
                            onClick={toggleIA}
                            className="h-7 px-3 bg-amber-500 text-white hover:bg-amber-600 rounded-md shadow-md animate-in fade-in zoom-in duration-300 gap-1.5 flex items-center text-[10px] font-bold transition-all active:scale-95 animate-pulse"
                        >
                            <User className="h-3 w-3" />
                            ASSUMIR CONTROLE
                        </button>
                    )}
                    {(conversation?.status === 'manual' || !['ativa', 'awaiting_human'].includes(conversation?.status)) && (
                        <button
                            onClick={toggleIA}
                            className="h-7 px-3 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md shadow-md animate-in fade-in zoom-in duration-300 gap-1.5 flex items-center text-[10px] font-bold transition-all active:scale-95"
                        >
                            <PauseCircle className="h-3 w-3" />
                            MODO MANUAL
                        </button>
                    )}
                </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 relative z-10 scrollbar-thin scrollbar-thumb-primary/10">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full space-y-4 opacity-50">
                        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
                        <p className="text-xs font-medium text-muted-foreground">Sincronizando histórico...</p>
                    </div>
                ) : (
                    messages.map((msg, idx) => {
                        const isLastOfUser = idx === messages.length - 1 || messages[idx + 1].remetente !== msg.remetente;

                        return (
                            <div
                                key={msg.id}
                                className={cn(
                                    "flex w-full animate-in fade-in slide-in-from-bottom-2 duration-500",
                                    msg.remetente === 'lead' ? "justify-start" : "justify-end"
                                )}
                            >
                                <div className={cn(
                                    "max-w-[75%] flex items-end gap-3 group",
                                    msg.remetente === 'lead' ? "flex-row" : "flex-row-reverse"
                                )}>
                                    <Avatar className={cn(
                                        "h-8 w-8 border border-muted/50 shadow-sm transition-all",
                                        !isLastOfUser && "opacity-0"
                                    )}>
                                        <AvatarFallback className={cn(
                                            "text-[10px] font-bold",
                                            msg.remetente === 'lead' ? "bg-muted" : "bg-primary/10 text-primary"
                                        )}>
                                            {msg.remetente === 'lead' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                                        </AvatarFallback>
                                    </Avatar>

                                    <div className={cn(
                                        "p-4 rounded-2xl text-[13px] lg:text-sm shadow-sm relative transition-all group-hover:shadow-md",
                                        msg.remetente === 'lead'
                                            ? "bg-white border border-border rounded-bl-none text-foreground"
                                            : "bg-primary text-primary-foreground rounded-br-none"
                                    )}>
                                        <p className="leading-relaxed whitespace-pre-wrap">{msg.conteudo}</p>
                                        <div className={cn(
                                            "text-[9px] mt-2 flex items-center gap-1 font-medium scale-90 origin-left opacity-60",
                                            msg.remetente === 'lead' ? "text-muted-foreground" : "text-primary-foreground"
                                        )}>
                                            {format(new Date(msg.created_at), "HH:mm")}
                                            {msg.remetente !== 'lead' && <ShieldCheck className="h-2 w-2" />}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>

            {/* Footer / Status Label */}
            <div className="p-5 border-t bg-card/40 relative z-10">
                <div className={cn(
                    "rounded-2xl p-4 text-center transition-all border",
                    conversation?.status === 'ativa'
                        ? "bg-primary/5 border-primary/10"
                        : conversation?.status === 'awaiting_human'
                            ? "bg-amber-500/5 border-amber-500/20 shadow-[0_0_15px_-5px_rgba(245,158,11,0.3)]"
                            : "bg-destructive/5 border-destructive/10"
                )}>
                    <div className="flex items-center justify-center gap-3">
                        <div className={cn(
                            "p-2 rounded-full",
                            conversation?.status === 'ativa'
                                ? "bg-primary/10"
                                : conversation?.status === 'awaiting_human'
                                    ? "bg-amber-500/10"
                                    : "bg-destructive/10"
                        )}>
                            {conversation?.status === 'ativa' ? <Zap className="h-4 w-4 text-primary" /> : conversation?.status === 'awaiting_human' ? <User className="h-4 w-4 text-amber-500" /> : <PauseCircle className="h-4 w-4 text-destructive" />}
                        </div>
                        <div className="text-left">
                            <p className={cn(
                                "text-xs font-bold uppercase tracking-wider",
                                conversation?.status === 'ativa'
                                    ? "text-foreground/80"
                                    : conversation?.status === 'awaiting_human'
                                        ? "text-amber-600"
                                        : "text-destructive/80"
                            )}>
                                {conversation?.status === 'ativa' ? "Monitoramento Crítico Ativo" : conversation?.status === 'awaiting_human' ? "Aguardando Intervenção Humana" : "Intervenção Manual Necessária"}
                            </p>
                            <p className="text-[11px] text-muted-foreground opacity-70">
                                {conversation?.status === 'ativa'
                                    ? "A IA MARIA está gerenciando o fluxo. Você pode assumir a qualquer momento no botão acima."
                                    : conversation?.status === 'awaiting_human'
                                        ? "A IA detectou que o cidadão precisa de um humano. Por favor, assuma agora."
                                        : "A IA está pausada. Suas respostas não serão interferidas pelo motor automático."}
                            </p>
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            {conversation?.status === 'awaiting_human' && (
                                <Badge variant="outline" className="text-[9px] h-5 bg-amber-500 text-white border-none animate-bounce">
                                    URGENTE
                                </Badge>
                            )}
                            {conversation?.status === 'manual' && (
                                <Badge variant="destructive" className="text-[9px] h-5 animate-pulse">
                                    PAUSADO
                                </Badge>
                            )}
                            <Badge variant="outline" className="text-[10px] border-primary/20 text-primary cursor-pointer hover:bg-primary/10 transition-colors">
                                Sincronizado
                            </Badge>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
