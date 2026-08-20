"use client";

import { useState } from "react";
import ChatSidebar from "@/components/chat/chat-sidebar";
import ChatWindow from "@/components/chat/chat-window";
import { Badge } from "@/components/ui/badge";

// Constante estável fora do componente — evita recriar canal Realtime a cada render.
// "academia_enem" é o canal_tipo cadastrado em meta_phone_numbers pela S-AE-02.
const CANAL_ACADEMIA_ENEM = "academia_enem";

export default function AcademiaEnemMensagensPage() {
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-background">
            <div className="px-6 py-4 border-b bg-card">
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                    Atendimento — Academia Enem
                    <Badge variant="secondary">WhatsApp oficial</Badge>
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                    Conversas e transbordos do canal Meta oficial da Academia Enem.
                </p>
            </div>
            <div className="flex flex-1 overflow-hidden">
                <div className="w-80 lg:w-96 h-full flex-shrink-0 border-r border-[#E5E7EB]">
                    <ChatSidebar
                        title="Academia Enem"
                        activeConversationId={activeConversationId}
                        onSelectConversation={setActiveConversationId}
                        filterCanalTipo={CANAL_ACADEMIA_ENEM}
                    />
                </div>
                <div className="flex-1 h-full relative">
                    <ChatWindow conversationId={activeConversationId} moduloAtendimento="atendimentos_academia_enem" />
                </div>
            </div>
        </div>
    );
}
