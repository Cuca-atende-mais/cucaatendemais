"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { User, Bot, Send, ShieldCheck, Zap, PauseCircle, HandshakeIcon, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUser } from "@/lib/auth/user-provider";
import AnexoMensagem from "./anexo-mensagem";

interface ChatWindowProps {
    conversationId: string | null;
    moduloAtendimento?: string;
    /** Mobile: volta pra lista de conversas (esconde o chat, mostra a sidebar). Sem isso, o
     * botão de voltar não aparece — desktop não precisa, as 2 colunas já ficam lado a lado. */
    onBack?: () => void;
}

type ChatLead = {
    nome?: string | null;
    telefone?: string | null;
};

type ChatConversation = {
    id: string;
    lead_id: string;
    origem_id: string;
    status: string;
    leads?: ChatLead | null;
};

type ChatMessage = {
    id: string;
    conversa_id: string;
    lead_id: string;
    remetente: "lead" | "agente" | string;
    tipo: string;
    conteudo: string | null;
    created_at: string;
    midia_url?: string | null;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export default function ChatWindow({ conversationId, moduloAtendimento = 'atendimentos_institucional', onBack }: ChatWindowProps) {
    const { hasPermission } = useUser();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [conversation, setConversation] = useState<ChatConversation | null>(null);
    const [loading, setLoading] = useState(false);
    const [newMessage, setNewMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [assumindo, setAssumindo] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const requestSeqRef = useRef(0);
    const loadControllerRef = useRef<AbortController | null>(null);
    const supabase = createClient();

    useEffect(() => {
        const requestSeq = ++requestSeqRef.current;
        if (!conversationId) {
            loadControllerRef.current?.abort();
            setConversation(null);
            setMessages([]);
            setLoading(false);
            return;
        }

        loadControllerRef.current?.abort();
        const controller = new AbortController();
        loadControllerRef.current = controller;

        setConversation(null);
        setMessages([]);
        fetchConversationDetails(requestSeq, controller.signal);
        fetchMessages(requestSeq, controller.signal);

        const channel = supabase
            .channel(`chat-${conversationId}`)
            // T1: Ouvir mudanças de STATUS da conversa (outro agente assume, IA retoma, worker pausa, etc.)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'conversas',
                filter: `id=eq.${conversationId}`,
            }, (payload) => {
                const next = payload.new as ChatConversation;
                setConversation((prev) => prev ? { ...prev, ...next } : next);
            })
            // Mensagens novas da conversa
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'mensagens',
                filter: `conversa_id=eq.${conversationId}`,
            }, (payload) => {
                const incoming = payload.new as ChatMessage;
                setMessages(prev => {
                    if (prev.find(m => m.id === incoming.id)) return prev;
                    return [...prev, incoming];
                });
            })
            .subscribe((status) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    console.warn(`[chat-window] Realtime ${status} na conversa ${conversationId}`);
                }
            });

        return () => {
            controller.abort();
            supabase.removeChannel(channel);
        };
    }, [conversationId]);

    // T3: Auto-scroll ao receber mensagens novas
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [messages]);

    async function fetchConversationDetails(requestSeq: number, signal: AbortSignal) {
        if (!conversationId) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('conversas')
                .select('*, leads(*)')
                .eq('id', conversationId)
                .abortSignal(signal)
                .single();
            if (requestSeq !== requestSeqRef.current) return;
            if (signal.aborted) return;
            if (error) throw error;
            setConversation(data);
        } catch (err: unknown) {
            if (requestSeq !== requestSeqRef.current) return;
            if (signal.aborted) return;
            toast.error("Erro ao carregar conversa: " + errorMessage(err));
        } finally {
            if (requestSeq === requestSeqRef.current && !signal.aborted && loadControllerRef.current && !loadControllerRef.current.signal.aborted) {
                setLoading(false);
            }
        }
    }

    async function fetchMessages(requestSeq: number, signal: AbortSignal) {
        if (!conversationId) return;
        try {
            // Busca as 200 mais recentes (DESC) e inverte para exibir em ordem cronológica
            const { data, error } = await supabase
                .from('mensagens')
                .select('*')
                .eq('conversa_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(200)
                .abortSignal(signal);
            if (requestSeq !== requestSeqRef.current) return;
            if (signal.aborted) return;
            if (error) throw error;
            setMessages((data || []).reverse());
        } catch (err: unknown) {
            if (requestSeq !== requestSeqRef.current) return;
            if (signal.aborted) return;
            toast.error("Erro ao carregar mensagens: " + errorMessage(err));
        }
    }

    async function handleSendMessage() {
        if (!newMessage.trim() || sending || !conversation) return;
        if (!conversation.leads?.telefone) {
            toast.error("Conversa sem telefone do lead. Recarregue os dados antes de enviar.");
            return;
        }
        setSending(true);
        try {
            const { data: savedMsg, error } = await supabase
                .from('mensagens')
                .insert([{
                    conversa_id: conversationId,
                    lead_id: conversation.lead_id,
                    remetente: 'agente',
                    tipo: 'text',
                    conteudo: newMessage.trim(),
                    created_at: new Date().toISOString(),
                }])
                .select()
                .single();
            if (error) throw error;
            setMessages(prev => {
                if (prev.find(m => m.id === savedMsg.id)) return prev;
                return [...prev, savedMsg];
            });

            const sendResp = await fetch('/api/chat/send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    number: conversation.leads.telefone,
                    text: newMessage.trim(),
                    conversa_id: conversationId,
                }),
            });
            if (!sendResp.ok) {
                const errBody = await sendResp.text().catch(() => `HTTP ${sendResp.status}`);
                await supabase.from('mensagens').delete().eq('id', savedMsg.id);
                setMessages(prev => prev.filter(m => m.id !== savedMsg.id));
                throw new Error(`Falha ao enviar via worker (${sendResp.status}): ${errBody}`);
            }
            setNewMessage("");
            toast.success("Mensagem enviada!");
        } catch (err: unknown) {
            toast.error("Erro ao enviar: " + errorMessage(err));
        } finally {
            setSending(false);
        }
    }

    async function handleAssumirAtendimento() {
        if (!conversationId || !conversation) return;
        setAssumindo(true);
        try {
            const { error } = await supabase
                .from("conversas")
                .update({ status: "awaiting_human", updated_at: new Date().toISOString() })
                .eq("id", conversationId);
            if (error) throw error;
            toast.success("IA pausada. Você assumiu o atendimento.");
        } catch (err: unknown) {
            toast.error("Erro ao assumir atendimento: " + errorMessage(err));
        } finally {
            setAssumindo(false);
        }
    }

    async function handleRetornarIA() {
        if (!conversationId || !conversation) return;
        try {
            const { error } = await supabase
                .from("conversas")
                .update({ status: "ativa", updated_at: new Date().toISOString() })
                .eq("id", conversationId);
            if (error) throw error;
            toast.success("IA reativada. Bot voltará a responder.");
        } catch (err: unknown) {
            toast.error("Erro ao retornar IA: " + errorMessage(err));
        }
    }

    if (!conversationId) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center h-full bg-card/20 backdrop-blur-md text-muted-foreground gap-3">
                <div className="h-16 w-16 rounded-full bg-muted/30 flex items-center justify-center">
                    <Send className="h-7 w-7 opacity-30" />
                </div>
                <p className="text-sm font-medium opacity-50">Selecione uma conversa para começar</p>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col h-full bg-card/20 backdrop-blur-md relative overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b bg-card/60 backdrop-blur-xl flex items-center gap-3 shadow-sm relative z-20">
                {onBack && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 -ml-1 shrink-0 md:hidden"
                        onClick={onBack}
                        aria-label="Voltar pra lista de conversas"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                )}
                <Avatar className="h-9 w-9 border border-muted">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                        {conversation?.leads?.nome?.substring(0, 2).toUpperCase() || "CN"}
                    </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{conversation?.leads?.nome || "Cidadão"}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{conversation?.leads?.telefone || "—"}</p>
                </div>
                <div className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider",
                    conversation?.status === 'ativa'
                        ? "bg-primary/10 border-primary/20 text-primary"
                        : "bg-amber-500/10 border-amber-500/20 text-amber-600"
                )}>
                    {conversation?.status === 'ativa' ? "IA Ativa" : "Humano"}
                </div>
            </div>

            {/* Mensagens */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-4 relative z-10 scrollbar-thin scrollbar-thumb-primary/10"
            >
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full space-y-4 opacity-50">
                        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
                        <p className="text-xs font-medium text-muted-foreground">Sincronizando histórico...</p>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground opacity-50">
                        Nenhuma mensagem ainda
                    </div>
                ) : (
                    messages.map((msg, idx) => {
                        const isLastOfUser = idx === messages.length - 1 || messages[idx + 1]?.remetente !== msg.remetente;
                        return (
                            <div
                                key={msg.id}
                                className={cn(
                                    "flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300",
                                    msg.remetente === 'lead' ? "justify-start" : "justify-end"
                                )}
                            >
                                <div className={cn(
                                    // min-w-0 é o que falta pro flexbox de fato respeitar o max-w-[75%]: sem
                                    // isso, um item flex não encolhe abaixo da largura "natural" do conteúdo
                                    // (o texto sem quebrar), e a bolha empurra a página inteira pra largura
                                    // maior que a tela — foi o que causou o scroll horizontal no mobile.
                                    "max-w-[75%] min-w-0 flex items-end gap-2 group",
                                    msg.remetente === 'lead' ? "flex-row" : "flex-row-reverse"
                                )}>
                                    <Avatar className={cn(
                                        "h-7 w-7 border border-muted/50 shadow-sm transition-all shrink-0",
                                        !isLastOfUser && "opacity-0"
                                    )}>
                                        <AvatarFallback className={cn(
                                            "text-[10px] font-bold",
                                            msg.remetente === 'lead' ? "bg-muted" : "bg-primary/10 text-primary"
                                        )}>
                                            {msg.remetente === 'lead' ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className={cn(
                                        "px-4 py-2.5 rounded-2xl text-[13px] shadow-sm relative transition-all min-w-0",
                                        msg.remetente === 'lead'
                                            ? "bg-muted border border-border/50 rounded-bl-none text-foreground"
                                            : "bg-[#f2eee6] border border-stone-300/70 text-slate-950 rounded-br-none"
                                    )}>
                                        <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.conteudo}</p>
                                        {msg.midia_url && (msg.tipo === "image" || msg.tipo === "document") && (
                                            <AnexoMensagem path={msg.midia_url} tipo={msg.tipo} />
                                        )}
                                        <div className={cn(
                                            "text-[9px] mt-1.5 flex items-center gap-1 opacity-60",
                                            msg.remetente === 'lead' ? "text-muted-foreground" : "text-slate-700"
                                        )}>
                                            {format(new Date(msg.created_at), "HH:mm")}
                                            {msg.remetente !== 'lead' && <ShieldCheck className="h-2 w-2" />}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Footer com input */}
            <div className="p-4 border-t bg-card/60 backdrop-blur-xl relative z-20 space-y-3 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.1)]">
                <div className={cn(
                    "flex items-center gap-2 p-1.5 rounded-2xl border bg-background/50 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all",
                    conversation?.status === 'ativa' && "opacity-50 pointer-events-none grayscale"
                )}>
                    <Input
                        placeholder={
                            !hasPermission(moduloAtendimento, "create")
                                ? "Você não tem permissão para responder..."
                                : conversation?.status === 'ativa'
                                    ? "IA Maria está respondendo..."
                                    : "Digite sua mensagem..."
                        }
                        className="bg-transparent border-none focus-visible:ring-0 shadow-none px-4"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                        disabled={conversation?.status === 'ativa' || sending || !hasPermission(moduloAtendimento, "create")}
                    />
                    <Button
                        size="icon"
                        onClick={handleSendMessage}
                        disabled={!newMessage.trim() || conversation?.status === 'ativa' || sending || !hasPermission(moduloAtendimento, "create")}
                        className={cn(
                            "rounded-xl shadow-lg transition-all active:scale-90 shrink-0",
                            conversation?.status === 'ativa' || !hasPermission(moduloAtendimento, "create") ? "bg-muted" : "bg-primary hover:bg-primary/90"
                        )}
                    >
                        {sending
                            ? <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />
                            : <Send className="h-4 w-4" />}
                    </Button>
                </div>

                <div className={cn(
                    "rounded-xl p-3 text-center transition-all border flex items-center justify-between gap-3",
                    conversation?.status === 'ativa' ? "bg-primary/5 border-primary/10" : "bg-amber-500/5 border-amber-500/10"
                )}>
                    <div className="flex items-center gap-2">
                        {conversation?.status === 'ativa'
                            ? <Zap className="h-3 w-3 text-primary" />
                            : <PauseCircle className="h-3 w-3 text-amber-500" />}
                        <p className="text-[10px] font-bold uppercase tracking-tight opacity-70">
                            {conversation?.status === 'ativa'
                                ? "Monitoramento Manual Pausado (IA Ativa)"
                                : "Modo de Intervenção Humana (IA Pausada)"}
                        </p>
                    </div>
                    {conversation?.status === 'ativa' && hasPermission(moduloAtendimento, "update") && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] gap-1 border-primary/20 text-primary hover:bg-primary/10 shrink-0"
                            onClick={handleAssumirAtendimento}
                            disabled={assumindo}
                        >
                            <HandshakeIcon className="h-3 w-3" />
                            {assumindo ? "Assumindo..." : "Assumir Atendimento"}
                        </Button>
                    )}
                    {conversation?.status === 'awaiting_human' && hasPermission(moduloAtendimento, "update") && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] gap-1 border-amber-500/30 text-amber-600 hover:bg-amber-500/10 shrink-0"
                            onClick={handleRetornarIA}
                        >
                            <Zap className="h-3 w-3" />
                            Retornar para IA
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
