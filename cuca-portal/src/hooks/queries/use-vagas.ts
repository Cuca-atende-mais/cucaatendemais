"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export const VAGAS_KEY = ["vagas"] as const;

interface FetchVagasParams {
    profileId?: string;
    abaFiltro: "minhas" | "todas";
    statusFilter: string;
}

export function useVagas(params: FetchVagasParams, enabled = true) {
    const supabase = createClient();

    return useQuery({
        queryKey: [...VAGAS_KEY, params],
        enabled,
        staleTime: 20_000,
        queryFn: async () => {
            let query = supabase.from("vagas").select("*").order("created_at", { ascending: false });

            if (params.abaFiltro === "minhas" && params.profileId) {
                query = query.eq("criado_por", params.profileId) as typeof query;
            }
            if (params.statusFilter !== "all") {
                query = query.eq("status", params.statusFilter) as typeof query;
            }

            const { data, error } = await query;
            if (error) throw error;
            return data ?? [];
        },
    });
}

export function useSolicitarFeedback() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (vagaId: string) => {
            const res = await fetch(`/api/empregabilidade/vagas/${vagaId}/solicitar-feedback`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro ao solicitar feedback");
            return data;
        },
        onSuccess: () => {
            toast.success("Solicitação de feedback enviada via WhatsApp!");
            qc.invalidateQueries({ queryKey: VAGAS_KEY });
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : "Falha ao solicitar feedback");
        },
    });
}

export function useInvalidateVagas() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: VAGAS_KEY });
}
