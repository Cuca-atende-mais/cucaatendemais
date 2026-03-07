"use client";

import { useState } from "react";
import ChatSidebar from "@/components/chat/chat-sidebar";
import ChatWindow from "@/components/chat/chat-window";
import RagGlobalDrawer from "@/components/rag/rag-global-drawer";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";

export default function AtendimentoPage() {
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [ragDrawerOpen, setRagDrawerOpen] = useState(false);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-background">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-card/50 backdrop-blur-sm shrink-0">
                <h1 className="text-sm font-semibold text-foreground/80">Atendimento Institucional</h1>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRagDrawerOpen(true)}
                    className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                    <Globe className="h-4 w-4" />
                    Base de Conhecimento Global
                </Button>
            </div>

            {/* Layout principal */}
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar de Conversas — apenas institucionais */}
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

            {/* Drawer RAG Global */}
            <RagGlobalDrawer open={ragDrawerOpen} onOpenChange={setRagDrawerOpen} />
        </div>
    );
}
