"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

function makeQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 30 * 1000,       // 30s — dados frescos
                gcTime: 5 * 60 * 1000,      // 5min — manter em cache sem subscribers
                retry: 1,
                refetchOnWindowFocus: true,  // refetch ao voltar para a aba
                refetchOnReconnect: true,    // refetch ao reconectar
            },
        },
    });
}

export function ReactQueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(makeQueryClient);

    return (
        <QueryClientProvider client={queryClient}>
            {children}
            {process.env.NODE_ENV === "development" && (
                <ReactQueryDevtools initialIsOpen={false} />
            )}
        </QueryClientProvider>
    );
}
