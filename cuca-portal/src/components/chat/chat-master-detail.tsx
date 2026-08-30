"use client";

import { cn } from "@/lib/utils";

interface ChatMasterDetailProps {
    /** null = nenhuma conversa selecionada. No mobile decide qual painel aparece;
     * no desktop (md+) os dois painéis sempre ficam lado a lado. */
    activeConversationId: string | null;
    sidebar: React.ReactNode;
    chat: React.ReactNode;
}

/**
 * Layout responsivo padrão das telas de Atendimento (lista de conversas + janela de chat).
 * Extraído das páginas de atendimento/mensagens (institucional, empregabilidade, programação,
 * academia enem) — todas compartilhavam o mesmo shell fixo `w-80 lg:w-96` que, sem breakpoint
 * pra mobile, empurrava as duas colunas simultaneamente pra uma tela de ~360-412px de largura,
 * sobrepondo o texto do painel vazio ("Selecione uma conversa...") por cima da lista.
 *
 * Mobile (< md): mostra SÓ um painel por vez — a lista quando não há conversa selecionada, o
 * chat quando há (o botão de voltar do `ChatWindow`, via prop `onBack`, volta pra lista).
 * Desktop (md+): os dois painéis ficam lado a lado, como sempre foi.
 */
export function ChatMasterDetail({ activeConversationId, sidebar, chat }: ChatMasterDetailProps) {
    return (
        <div className="flex flex-1 overflow-hidden">
            <div
                className={cn(
                    "w-full md:w-80 lg:w-96 h-full flex-shrink-0 border-r border-[#E5E7EB]",
                    activeConversationId ? "hidden md:block" : "block"
                )}
            >
                {sidebar}
            </div>
            <div
                className={cn(
                    "flex-1 h-full relative",
                    activeConversationId ? "flex" : "hidden md:flex"
                )}
            >
                {chat}
            </div>
        </div>
    );
}
