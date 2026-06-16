"use client";

import { useState } from "react";
import { useUser } from "@/lib/auth/user-provider";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";
import AeChatSidebar from "./_components/ae-chat-sidebar";
import AeChatWindow from "./_components/ae-chat-window";

export default function AcademiaEnemMensagensPage() {
    const { hasPermission, loading: authLoading } = useUser();
    const canRead = hasPermission("atendimentos_academia_enem", "read");
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    if (authLoading) return null;

    if (!canRead) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 py-24 text-muted-foreground">
                <ShieldAlert className="h-10 w-10" />
                <p>Você não tem permissão para acessar o atendimento da Academia Enem.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-background">
            <div className="px-6 py-4 border-b bg-card">
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                    Atendimento — Academia Enem
                    <Badge variant="secondary" className="bg-cuca-blue/10 text-cuca-blue hover:bg-cuca-blue/20">WhatsApp Oficial</Badge>
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                    Conversas do número instanciado (AuctaFlux / WhatsApp Oficial Meta) em tempo real.
                </p>
            </div>
            <div className="flex flex-1 overflow-hidden">
                <div className="w-80 lg:w-96 h-full flex-shrink-0 border-r border-[#E5E7EB]">
                    <AeChatSidebar
                        activeConversationId={activeConversationId}
                        onSelectConversation={setActiveConversationId}
                    />
                </div>
                <div className="flex-1 h-full relative">
                    <AeChatWindow conversationId={activeConversationId} />
                </div>
            </div>
        </div>
    );
}
