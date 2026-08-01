"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bot, Clock, HandshakeIcon, PauseCircle, Send, ShieldCheck, User, Zap } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUser } from "@/lib/auth/user-provider";
import { janelaAberta, restanteJanelaMs } from "@/lib/auctaflux/janela";

// Janela de chat PRÓPRIA do módulo Academia Enem — opera sobre ae_conversas/ae_mensagens.
// Envio via /api/academia-enem/mensagens/enviar (provider server-side). NÃO toca o uazapi.

const MODULO = "atendimentos_academia_enem";

type ChatLead = { nome?: string | null; telefone?: string | null };

type AeConversation = {
    id: string;
    lead_id: string | null;
    ae_instancia_id: string;
    wa_contact: string;
    push_name?: string | null;
    status: string;
    ultima_entrada_em?: string | null;
    leads?: ChatLead | null;
};

type AeMessage = {
    id: string;
    ae_conversa_id: string;
    remetente: "lead" | "atendente" | "ia" | "sistema" | string;
    tipo: string;
    conteudo: string | null;
    created_at: string;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export default function AeChatWindow({ conversationId }: { conversationId: string | null }) {
    const { hasPermission } = useUser();
    const podeResponder = hasPermission(MODULO, "create");
    const podeAssumir = hasPermission(MODULO, "update");

    const [messages, setMessages] = useState<AeMessage[]>([]);
    const [conversation, setConversation] = useState<AeConversation | null>(null);
    const [loading, setLoading] = useState(false);
    const [newMessage, setNewMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [assumindo, setAssumindo] = useState(false);
    // Tick de 1 min para reavaliar a janela de 24h sem depender de novo evento/render.
    const [, setTick] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const requestSeqRef = useRef(0);
    const loadControllerRef = useRef<AbortController | null>(null);
    const supabase = useMemo(() => createClient(), []);

    const janelaOk = janelaAberta(conversation?.ultima_entrada_em);
    const restanteMs = restanteJanelaMs(conversation?.ultima_entrada_em);

    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 60_000);
        return () => clearInterval(id);
    }, []);

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
        void fetchConversationDetails(requestSeq, controller.signal);
        void fetchMessages(requestSeq, controller.signal);

        const channel = supabase
            .channel(`ae-chat-${conversationId}`)
            // Mudanças da conversa (status, ultima_entrada_em da janela 24h, etc.).
            .on("postgres_changes", {
                event: "UPDATE",
                schema: "public",
                table: "ae_conversas",
                filter: `id=eq.${conversationId}`,
            }, (payload) => {
                const next = payload.new as Partial<AeConversation>;
                setConversation((prev) => (prev ? { ...prev, ...next } : prev));
            })
            // Mensagens novas (inbound do webhook ou outbound de outro atendente).
            .on("postgres_changes", {
                event: "INSERT",
                schema: "public",
                table: "ae_mensagens",
                filter: `ae_conversa_id=eq.${conversationId}`,
            }, (payload) => {
                const incoming = payload.new as AeMessage;
                setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
                if (incoming.remetente === "lead") void zerarNaoLidas();
            })
            .subscribe((status) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    console.warn(`[ae-chat-window] Realtime ${status} na conversa ${conversationId}`);
                }
            });

        return () => {
            controller.abort();
            supabase.removeChannel(channel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
        }
    }, [messages]);

    // Zera não lidas ao abrir/receber (requer permissão update; ignora falha de RLS silenciosamente).
    const zerarNaoLidas = useCallback(async () => {
        if (!conversationId || !podeAssumir) return;
        try {
            await supabase.from("ae_conversas").update({ nao_lidas: 0 }).eq("id", conversationId);
        } catch (err) {
            console.warn("[ae-chat-window] não foi possível zerar não lidas:", err);
        }
    }, [conversationId, podeAssumir, supabase]);

    async function fetchConversationDetails(requestSeq: number, signal: AbortSignal) {
        if (!conversationId) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("ae_conversas")
                .select("id, lead_id, ae_instancia_id, wa_contact, push_name, status, ultima_entrada_em, leads (nome, telefone)")
                .eq("id", conversationId)
                .abortSignal(signal)
                .single();
            if (requestSeq !== requestSeqRef.current || signal.aborted) return;
            if (error) throw error;
            setConversation(data as AeConversation);
            void zerarNaoLidas();
        } catch (err: unknown) {
            if (requestSeq !== requestSeqRef.current || signal.aborted) return;
            toast.error("Erro ao carregar conversa: " + errorMessage(err));
        } finally {
            if (requestSeq === requestSeqRef.current && !signal.aborted) setLoading(false);
        }
    }

    async function fetchMessages(requestSeq: number, signal: AbortSignal) {
        if (!conversationId) return;
        try {
            const { data, error } = await supabase
                .from("ae_mensagens")
                .select("id, ae_conversa_id, remetente, tipo, conteudo, created_at")
                .eq("ae_conversa_id", conversationId)
                .order("created_at", { ascending: false })
                .limit(200)
                .abortSignal(signal);
            if (requestSeq !== requestSeqRef.current || signal.aborted) return;
            if (error) throw error;
            setMessages(((data as AeMessage[]) || []).reverse());
        } catch (err: unknown) {
            if (requestSeq !== requestSeqRef.current || signal.aborted) return;
            toast.error("Erro ao carregar mensagens: " + errorMessage(err));
        }
    }

    async function handleSendMessage() {
        const conteudo = newMessage.trim();
        if (!conteudo || sending || !conversation || !janelaOk || !podeResponder) return;
        setSending(true);
        try {
            const resp = await fetch("/api/academia-enem/mensagens/enviar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversa_id: conversation.id, text: conteudo }),
            });
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(json?.error || `Falha ao enviar (HTTP ${resp.status})`);
            // Append imediato; o Realtime também entrega o INSERT (dedupe por id).
            if (json?.mensagem) {
                const salva = json.mensagem as AeMessage;
                setMessages((prev) => (prev.some((m) => m.id === salva.id) ? prev : [...prev, salva]));
            }
            setNewMessage("");
            toast.success("Mensagem enviada!");
        } catch (err: unknown) {
            toast.error("Erro ao enviar: " + errorMessage(err));
        } finally {
            setSending(false);
        }
    }

    async function alterarStatus(novo: "awaiting_human" | "ativa") {
        if (!conversationId || !conversation) return;
        setAssumindo(true);
        try {
            const { error } = await supabase
                .from("ae_conversas")
                .update({ status: novo, updated_at: new Date().toISOString() })
                .eq("id", conversationId);
            if (error) throw error;
            setConversation((prev) => (prev ? { ...prev, status: novo } : prev));
            toast.success(novo === "awaiting_human" ? "Você assumiu o atendimento (IA silenciada)." : "Atendimento devolvido à IA.");
        } catch (err: unknown) {
            toast.error("Erro ao atualizar atendimento: " + errorMessage(err));
        } finally {
            setAssumindo(false);
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

    const nome = conversation?.leads?.nome || conversation?.push_name || "Cidadão";
    const telefone = conversation?.leads?.telefone || conversation?.wa_contact || "—";
    const isHuman = conversation?.status === "awaiting_human";

    const inputPlaceholder = !podeResponder
        ? "Você não tem permissão para responder..."
        : !janelaOk
            ? "Janela de 24h fechada — envie um template para reabrir"
            : "Digite sua mensagem...";

    return (
        <div className="flex-1 flex flex-col h-full bg-card/20 backdrop-blur-md relative overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b bg-card/60 backdrop-blur-xl flex items-center gap-3 shadow-sm relative z-20">
                <Avatar className="h-9 w-9 border border-muted">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                        {nome.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{nome}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{telefone}</p>
                </div>
                {/* Indicador de janela de 24h (AC#4) */}
                <div className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider flex items-center gap-1",
                    janelaOk ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-destructive/10 border-destructive/20 text-destructive",
                )}>
                    <Clock className="h-2.5 w-2.5" />
                    {janelaOk
                        ? `Janela 24h • ${formatDistanceToNowStrict(new Date(Date.now() + restanteMs), { locale: ptBR })}`
                        : "Janela fechada"}
                </div>
                {isHuman && (
                    <div className="text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider bg-amber-500/10 border-amber-500/20 text-amber-600">
                        Humano
                    </div>
                )}
            </div>

            {/* Mensagens */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 relative z-10 scrollbar-thin scrollbar-thumb-primary/10">
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
                        const isLead = msg.remetente === "lead";
                        const isLastOfUser = idx === messages.length - 1 || messages[idx + 1]?.remetente !== msg.remetente;
                        return (
                            <div key={msg.id} className={cn(
                                "flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300",
                                isLead ? "justify-start" : "justify-end",
                            )}>
                                <div className={cn("max-w-[75%] flex items-end gap-2 group", isLead ? "flex-row" : "flex-row-reverse")}>
                                    <Avatar className={cn("h-7 w-7 border border-muted/50 shadow-sm transition-all shrink-0", !isLastOfUser && "opacity-0")}>
                                        <AvatarFallback className={cn("text-[10px] font-bold", isLead ? "bg-muted" : "bg-primary/10 text-primary")}>
                                            {isLead ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className={cn(
                                        "px-4 py-2.5 rounded-2xl text-[13px] shadow-sm relative transition-all",
                                        isLead ? "bg-muted border border-border/50 rounded-bl-none text-foreground" : "bg-[#f2eee6] border border-stone-300/70 text-slate-950 rounded-br-none",
                                    )}>
                                        <p className="leading-relaxed whitespace-pre-wrap">{msg.conteudo}</p>
                                        <div className={cn("text-[9px] mt-1.5 flex items-center gap-1 opacity-60", isLead ? "text-muted-foreground" : "text-slate-700")}>
                                            {format(new Date(msg.created_at), "HH:mm")}
                                            {!isLead && <ShieldCheck className="h-2 w-2" />}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t bg-card/60 backdrop-blur-xl relative z-20 space-y-3 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.1)]">
                <div className={cn(
                    "flex items-center gap-2 p-1.5 rounded-2xl border bg-background/50 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all",
                    (!janelaOk || !podeResponder) && "opacity-50 pointer-events-none grayscale",
                )}>
                    <Input
                        placeholder={inputPlaceholder}
                        className="bg-transparent border-none focus-visible:ring-0 shadow-none px-4"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                        disabled={!janelaOk || sending || !podeResponder}
                    />
                    <Button
                        size="icon"
                        onClick={handleSendMessage}
                        disabled={!newMessage.trim() || !janelaOk || sending || !podeResponder}
                        className={cn(
                            "rounded-xl shadow-lg transition-all active:scale-90 shrink-0",
                            !janelaOk || !podeResponder ? "bg-muted" : "bg-primary hover:bg-primary/90",
                        )}
                    >
                        {sending
                            ? <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />
                            : <Send className="h-4 w-4" />}
                    </Button>
                </div>

                {/* Aviso de janela fechada (AC#4) */}
                {!janelaOk && (
                    <div className="rounded-xl p-3 text-center border bg-destructive/5 border-destructive/10 flex items-center justify-center gap-2">
                        <Clock className="h-3 w-3 text-destructive" />
                        <p className="text-[10px] font-bold uppercase tracking-tight opacity-70 text-destructive">
                            Fora da janela de 24h — texto livre bloqueado. Use um template aprovado para reabrir.
                        </p>
                    </div>
                )}

                {/* Assumir / devolver (AC#5) */}
                {podeAssumir && (
                    <div className={cn(
                        "rounded-xl p-3 text-center transition-all border flex items-center justify-between gap-3",
                        isHuman ? "bg-amber-500/5 border-amber-500/10" : "bg-primary/5 border-primary/10",
                    )}>
                        <div className="flex items-center gap-2">
                            {isHuman ? <PauseCircle className="h-3 w-3 text-amber-500" /> : <Zap className="h-3 w-3 text-primary" />}
                            <p className="text-[10px] font-bold uppercase tracking-tight opacity-70">
                                {isHuman ? "Atendimento humano (IA silenciada)" : "IA no controle"}
                            </p>
                        </div>
                        {isHuman ? (
                            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 border-amber-500/30 text-amber-600 hover:bg-amber-500/10 shrink-0"
                                onClick={() => alterarStatus("ativa")} disabled={assumindo}>
                                <Zap className="h-3 w-3" /> Devolver para IA
                            </Button>
                        ) : (
                            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 border-primary/20 text-primary hover:bg-primary/10 shrink-0"
                                onClick={() => alterarStatus("awaiting_human")} disabled={assumindo}>
                                <HandshakeIcon className="h-3 w-3" /> {assumindo ? "Assumindo..." : "Assumir Atendimento"}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
