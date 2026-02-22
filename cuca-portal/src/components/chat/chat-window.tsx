"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { User, Bot, Send, ShieldCheck, Zap, PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ChatWindowProps {
    conversationId: string | null;
}

export default function ChatWindow({ conversationId }: ChatWindowProps) {
    const [messages, setMessages] = useState<any[]>([]);
    const [conversation, setConversation] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [newMessage, setNewMessage] = useState("");
    const [sending, setSending] = useState(false);
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

    // ... (toggleIA, fetchMessages, etc permanecem iguais)

    return (
        <div className="flex-1 flex flex-col h-full bg-card/20 backdrop-blur-md relative overflow-hidden">
            {/* ... Header anterior ... */}

            {/* Messages Area */}
            {/* ... Bloco ref={scrollRef} anterior ... */}

            {/* Integration Footer with Input */}
            <div className="p-4 border-t bg-card/60 backdrop-blur-xl relative z-20 space-y-4 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.1)]">
                <div className={cn(
                    "flex items-center gap-2 p-1.5 rounded-2xl border bg-background/50 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all",
                    conversation?.status === 'ativa' && "opacity-50 pointer-events-none grayscale"
                )}>
                    <Input
                        placeholder={conversation?.status === 'ativa' ? "IA Maria está respondendo..." : "Digite sua mensagem..."}
                        className="bg-transparent border-none focus-visible:ring-0 shadow-none px-4"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        disabled={conversation?.status === 'ativa' || sending}
                    />
                    <Button
                        size="icon"
                        onClick={handleSendMessage}
                        disabled={!newMessage.trim() || conversation?.status === 'ativa' || sending}
                        className={cn(
                            "rounded-xl shadow-lg transition-all active:scale-90",
                            conversation?.status === 'ativa' ? "bg-muted" : "bg-primary hover:bg-primary/90"
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
                </div>
            </div>
        </div>
    );
}
