"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { User, Bot, Send, ShieldCheck, Zap, PauseCircle, PlayCircle, HandshakeIcon } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUser } from "@/lib/auth/user-provider";

interface ChatWindowProps {
    conversationId: string | null;
}

export default function ChatWindow({ conversationId }: ChatWindowProps) {
    const { hasPermission } = useUser();
    const [messages, setMessages] = useState<any[]>([]);
    const [conversation, setConversation] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [newMessage, setNewMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [assumindo, setAssumindo] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const supabase = createClient();

    useEffect(() => {
        if (!conversationId) return;

        fetchConversationDetails();
        fetchMessages();
        markAsRead();

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
                    if (prev.find(m => m.id === payload.new.id)) return prev;
                    return [...prev, payload.new];
                });
                // Marcar como lido se a mensagem chegar em tempo real
                if (payload.new.remetente === 'lead') markAsRead();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [conversationId]);

    async function markAsRead() {
        if (!conversationId || !conversation) return;
        try {
            const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "";
            const token = process.env.NEXT_PUBLIC_INTERNAL_TOKEN;
            if (!workerUrl || !token) return;

            await fetch(`${workerUrl}/read-message/${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    remoteJid: `${conversation.leads.telefone}@s.whatsapp.net`,
                    instance: conversation.instancia_uazapi
                })
            });
        } catch (err) {
            console.error("Erro ao sincronizar leitura:", err);
        }
    }

    async function fetchConversationDetails() {
        if (!conversationId) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('conversas')
                .select('*, leads(*)')
                .eq('id', conversationId)
                .single();
            if (error) throw error;
            setConversation(data);
        } catch (err: any) {
            toast.error("Erro ao carregar conversa: " + err.message);
        } finally {
            setLoading(false);
        }
    }

    async function fetchMessages() {
        if (!conversationId) return;
        try {
            const { data, error } = await supabase
                .from('mensagens')
                .select('*')
                .eq('conversa_id', conversationId)
                .order('created_at', { ascending: true });
            if (error) throw error;
            setMessages(data || []);
        } catch (err: any) {
            toast.error("Erro ao carregar mensagens: " + err.message);
        }
    }

    async function handleSendMessage() {
        if (!newMessage.trim() || sending || !conversation) return;
        setSending(true);

        try {
            // 1. Salvar no Supabase (Realtime fará o resto na UI)
            const { data: savedMsg, error } = await supabase
                .from('mensagens')
                .insert([{
                    conversa_id: conversationId,
                    lead_id: conversation.lead_id,
                    remetente: 'agente',
                    tipo: 'text',
                    conteudo: newMessage.trim(),
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();

            if (error) throw error;

            // 2. Disparar via Worker -> UAZAPI
            const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "";
            const token = process.env.NEXT_PUBLIC_INTERNAL_TOKEN;
            if (!workerUrl || !token) throw new Error("Worker URL não configurada");

            await fetch(`${workerUrl}/send-message/${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    number: conversation.leads.telefone,
                    text: newMessage.trim(),
                    instance: conversation.instancia_uazapi
                })
            });

            setNewMessage("");
            toast.success("Mensagem enviada!");
        } catch (err: any) {
            toast.error("Erro ao enviar: " + err.message);
        } finally {
            setSending(false);
        }
    }

    // S13-03: Assumir Atendimento — pausa a IA e coloca conversa em modo humano
    async function handleAssumirAtendimento() {
        if (!conversationId || !conversation) return;
        setAssumindo(true);
        try {
            const { error } = await supabase
                .from("conversas")
                .update({ status: "awaiting_human", updated_at: new Date().toISOString() })
                .eq("id", conversationId);
            if (error) throw error;
            setConversation((prev: any) => prev ? { ...prev, status: "awaiting_human" } : prev);
            toast.success("IA pausada. Você assumiu o atendimento.");
        } catch (err: any) {
            toast.error("Erro ao assumir atendimento: " + err.message);
        } finally {
            setAssumindo(false);
        }
    }

    // ... (toggleIA, fetchMessages, etc permanecem iguais)

    return (
        <div className="flex-1 flex flex-col h-full bg-card/20 backdrop-blur-md relative overflow-hidden">
            {/* ... Header anterior ... */}

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
                                            ? "bg-muted border border-border/50 rounded-bl-none text-foreground"
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

            {/* Integration Footer with Input */}
            <div className="p-4 border-t bg-card/60 backdrop-blur-xl relative z-20 space-y-4 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.1)]">
                <div className={cn(
                    "flex items-center gap-2 p-1.5 rounded-2xl border bg-background/50 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all",
                    conversation?.status === 'ativa' && "opacity-50 pointer-events-none grayscale"
                )}>
                    <Input
                        placeholder={
                            !hasPermission("atendimentos", "create")
                                ? "Você não tem permissão para responder..."
                                : conversation?.status === 'ativa'
                                    ? "IA Maria está respondendo..."
                                    : "Digite sua mensagem..."
                        }
                        className="bg-transparent border-none focus-visible:ring-0 shadow-none px-4"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        disabled={conversation?.status === 'ativa' || sending || !hasPermission("atendimentos", "create")}
                    />
                    <Button
                        size="icon"
                        onClick={handleSendMessage}
                        disabled={!newMessage.trim() || conversation?.status === 'ativa' || sending || !hasPermission("atendimentos", "create")}
                        className={cn(
                            "rounded-xl shadow-lg transition-all active:scale-90",
                            conversation?.status === 'ativa' || !hasPermission("atendimentos", "create") ? "bg-muted" : "bg-primary hover:bg-primary/90"
                        )}
                    >
                        {sending ? <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" /> : <Send className="h-4 w-4" />}
                    </Button>
                </div>

                <div className={cn(
                    "rounded-xl p-3 text-center transition-all border flex items-center justify-between gap-3",
                    conversation?.status === 'ativa' ? "bg-primary/5 border-primary/10" : "bg-amber-500/5 border-amber-500/10"
                )}>
                    <div className="flex items-center gap-2">
                        {conversation?.status === 'ativa' ? <Zap className="h-3 w-3 text-primary" /> : <PauseCircle className="h-3 w-3 text-amber-500" />}
                        <p className="text-[10px] font-bold uppercase tracking-tight opacity-70">
                            {conversation?.status === 'ativa'
                                ? "Monitoramento Manual Pausado (IA Ativa)"
                                : "Modo de Intervenção Humana (IA Pausada)"}
                        </p>
                    </div>
                    {conversation?.status === 'ativa' && hasPermission("atendimentos", "update") && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] gap-1 border-primary/20 text-primary hover:bg-primary/10"
                            onClick={handleAssumirAtendimento}
                            disabled={assumindo}
                        >
                            <HandshakeIcon className="h-3 w-3" />
                            {assumindo ? "Assumindo..." : "Assumir Atendimento"}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
