"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

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

export function useInvalidateVagas() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: VAGAS_KEY });
}
