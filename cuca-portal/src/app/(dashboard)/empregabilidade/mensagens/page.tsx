"use client";

import { useState } from "react";
import ChatSidebar from "@/components/chat/chat-sidebar";
import ChatWindow from "@/components/chat/chat-window";
import { Badge } from "@/components/ui/badge";

export default function EmpregabilidadeMensagensPage() {
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-background">
            <div className="px-6 py-4 border-b bg-card">
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                    Caixa de Entrada RH
                    <Badge variant="secondary" className="bg-cuca-blue/10 text-cuca-blue hover:bg-cuca-blue/20">Isolada</Badge>
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                    Gestão exclusiva de conversas e transbordos originados pelas agentes Júlia de Empregabilidade.
                </p>
            </div>
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar de Conversas (Filtro Empregabilidade) */}
                <div className="w-80 lg:w-96 h-full flex-shrink-0 border-r border-[#E5E7EB]">
                    <ChatSidebar
                        title="Dúvidas & Candidatos"
                        activeConversationId={activeConversationId}
                        onSelectConversation={setActiveConversationId}
                        filterAgenteTipo={["julia_geral", "julia_unidade"]}
                    />
                </div>

                {/* Janela de Chat Principal */}
                <div className="flex-1 h-full relative">
                    <ChatWindow conversationId={activeConversationId} />
                </div>
            </div>
        </div>
    );
}
