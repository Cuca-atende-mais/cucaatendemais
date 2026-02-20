"use client";

import { useState } from "react";
import ChatSidebar from "@/components/chat/chat-sidebar";
import ChatWindow from "@/components/chat/chat-window";

export default function AtendimentoPage() {
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    return (
        <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-background">
            {/* Sidebar de Conversas */}
            <div className="w-80 lg:w-96 h-full flex-shrink-0">
                <ChatSidebar
                    activeConversationId={activeConversationId}
                    onSelectConversation={setActiveConversationId}
                />
            </div>

            {/* Janela de Chat Principal */}
            <div className="flex-1 h-full relative">
                <ChatWindow conversationId={activeConversationId} />
            </div>
        </div>
    );
}
