"use client";

import { useState } from "react";
import ChatSidebar from "@/components/chat/chat-sidebar";
import ChatWindow from "@/components/chat/chat-window";
import { ChatMasterDetail } from "@/components/chat/chat-master-detail";

export default function AtendimentoPage() {
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    return (
        <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-background">
            <ChatMasterDetail
                activeConversationId={activeConversationId}
                sidebar={
                    <ChatSidebar
                        activeConversationId={activeConversationId}
                        onSelectConversation={setActiveConversationId}
                        filterCanalTipo="Institucional"
                        title="Atendimento Institucional"
                    />
                }
                chat={
                    <ChatWindow
                        conversationId={activeConversationId}
                        moduloAtendimento="atendimentos_institucional"
                        onBack={() => setActiveConversationId(null)}
                    />
                }
            />
        </div>
    );
}
