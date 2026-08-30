"use client";

import { useState } from "react";
import ChatSidebar from "@/components/chat/chat-sidebar";
import ChatWindow from "@/components/chat/chat-window";
import { ChatMasterDetail } from "@/components/chat/chat-master-detail";
import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";

// Constante estável — evita recriar canal Realtime a cada render
const CANAL_INSTITUCIONAL = "Institucional";

export default function ProgramacaoMensagensPage() {
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-background">
            <div className="px-4 sm:px-6 py-4 border-b bg-card">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex flex-wrap items-center gap-2 sm:gap-3">
                    <MessageSquare className="h-6 w-6 text-cuca-blue" />
                    Atendimento — Programação
                    <Badge variant="secondary" className="bg-cuca-blue/10 text-cuca-blue hover:bg-cuca-blue/20">institucionalredecuca</Badge>
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                    Conversas e transbordos da instância institucional da Rede CUCA.
                </p>
            </div>
            <ChatMasterDetail
                activeConversationId={activeConversationId}
                sidebar={
                    <ChatSidebar
                        title="Institucional"
                        activeConversationId={activeConversationId}
                        onSelectConversation={setActiveConversationId}
                        filterCanalTipo={CANAL_INSTITUCIONAL}
                    />
                }
                chat={
                    <ChatWindow
                        conversationId={activeConversationId}
                        moduloAtendimento="atendimentos_programacao"
                        onBack={() => setActiveConversationId(null)}
                    />
                }
            />
        </div>
    );
}
