"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export const PROGRAMACAO_KEY = ["programacao"] as const;

interface FetchProgramacaoParams {
    unidadeFilter: string;
    searchTerm: string;
    isSuperAdmin: boolean;
    unidadeCuca?: string | null;
}

export function useProgramacao(params: FetchProgramacaoParams, enabled = true) {
    const supabase = createClient();

    return useQuery({
        queryKey: [...PROGRAMACAO_KEY, params],
        enabled,
        staleTime: 20_000,
        queryFn: async () => {
            let pQuery = supabase.from("eventos_pontuais").select("*").order("created_at", { ascending: false });
            let mQuery = supabase.from("campanhas_mensais").select("*").order("created_at", { ascending: false });

            if (!params.isSuperAdmin && params.unidadeCuca) {
                pQuery = pQuery.eq("unidade_cuca", params.unidadeCuca) as typeof pQuery;
                mQuery = mQuery.eq("unidade_cuca", params.unidadeCuca) as typeof mQuery;
            } else if (params.unidadeFilter !== "all") {
                pQuery = pQuery.eq("unidade_cuca", params.unidadeFilter) as typeof pQuery;
                mQuery = mQuery.eq("unidade_cuca", params.unidadeFilter) as typeof mQuery;
            }

            if (params.searchTerm) {
                pQuery = pQuery.ilike("titulo", `%${params.searchTerm}%`) as typeof pQuery;
                mQuery = mQuery.ilike("titulo", `%${params.searchTerm}%`) as typeof mQuery;
            }

            const [pontuaisRes, mensaisRes] = await Promise.all([pQuery, mQuery]);
            return {
                pontuais: pontuaisRes.data ?? [],
                mensais: mensaisRes.data ?? [],
            };
        },
    });
}

export function useDeleteProgramacao() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, tipo }: { id: string; tipo: "mensal" | "pontual" }) => {
            const res = await fetch(`/api/programacao/excluir?id=${id}&tipo=${tipo}`, { method: "DELETE" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro ao excluir");
            return data;
        },
        onSuccess: () => {
            toast.success("Programação excluída.");
            qc.invalidateQueries({ queryKey: PROGRAMACAO_KEY });
        },
        onError: (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
    });
}

export function useInvalidateProgramacao() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: PROGRAMACAO_KEY });
}
