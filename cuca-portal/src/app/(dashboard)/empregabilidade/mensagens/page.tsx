"use client";

import { useState } from "react";
import ChatSidebar from "@/components/chat/chat-sidebar";
import ChatWindow from "@/components/chat/chat-window";
import { ChatMasterDetail } from "@/components/chat/chat-master-detail";
import { Badge } from "@/components/ui/badge";

// Constante estável fora do componente — evita recriar canal Realtime a cada render
const CANAL_EMPREGABILIDADE = "Empregabilidade";

export default function EmpregabilidadeMensagensPage() {
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-background">
            <div className="px-4 sm:px-6 py-4 border-b bg-card">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex flex-wrap items-center gap-2 sm:gap-3">
                    Atendimento — Empregabilidade
                    <Badge variant="secondary" className="bg-cuca-blue/10 text-cuca-blue hover:bg-cuca-blue/20">empregoredecuca</Badge>
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                    Conversas e transbordos da instância de empregabilidade da Rede CUCA.
                </p>
            </div>
            <ChatMasterDetail
                activeConversationId={activeConversationId}
                sidebar={
                    <ChatSidebar
                        title="Empregabilidade"
                        activeConversationId={activeConversationId}
                        onSelectConversation={setActiveConversationId}
                        filterCanalTipo={CANAL_EMPREGABILIDADE}
                    />
                }
                chat={
                    <ChatWindow
                        conversationId={activeConversationId}
                        moduloAtendimento="atendimentos_empregabilidade"
                        onBack={() => setActiveConversationId(null)}
                    />
                }
            />
        </div>
    );
}
