"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export const OUVIDORIA_KEY = ["ouvidoria"] as const;

export function useOuvidoria(enabled = true) {
    const supabase = createClient();

    return useQuery({
        queryKey: OUVIDORIA_KEY,
        enabled,
        staleTime: 30_000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("ouvidoria_registros")
                .select("*, conversas(id, status)")
                .order("created_at", { ascending: false });
            if (error) throw error;
            return data ?? [];
        },
    });
}

export function useAnaliseSentimento() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ registroId, texto }: { registroId: string; texto: string }) => {
            const res = await fetch("/api/sentiment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: texto, id: registroId }),
            });
            if (!res.ok) throw new Error("Erro na análise de sentimento");
            return res.json();
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: OUVIDORIA_KEY });
        },
        onError: (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
    });
}

export function useInvalidateOuvidoria() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: OUVIDORIA_KEY });
}
