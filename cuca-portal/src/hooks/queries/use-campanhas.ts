"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export const CAMPANHAS_KEY = ["campanhas"] as const;

export function useCampanhas(enabled = true) {
    const supabase = createClient();

    return useQuery({
        queryKey: CAMPANHAS_KEY,
        enabled,
        staleTime: 30_000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("campanhas_mensais")
                .select("*")
                .order("created_at", { ascending: false });
            if (error) throw error;
            return data ?? [];
        },
    });
}

export function useInvalidateCampanhas() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: CAMPANHAS_KEY });
}
