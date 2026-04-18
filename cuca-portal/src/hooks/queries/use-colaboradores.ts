"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export const COLABORADORES_KEY = ["colaboradores"] as const;

export function useColaboradores(enabled = true) {
    const supabase = createClient();

    return useQuery({
        queryKey: COLABORADORES_KEY,
        enabled,
        staleTime: 60_000, // dados de colaboradores mudam menos
        queryFn: async () => {
            const [colaboradoresRes, rolesRes] = await Promise.all([
                supabase.from("colaboradores").select("*, sys_roles(name)").order("nome_completo"),
                supabase.from("sys_roles").select("*").order("name"),
            ]);
            return {
                colaboradores: colaboradoresRes.data ?? [],
                roles: rolesRes.data ?? [],
            };
        },
    });
}

export function useSaveColaborador() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ isEditing, formData }: { isEditing: boolean; formData: any }) => {
            const url = isEditing ? "/api/colaboradores/update" : "/api/colaboradores/create";
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro ao salvar colaborador");
            return data;
        },
        onSuccess: (_, { isEditing }) => {
            toast.success(isEditing ? "Colaborador atualizado!" : "Colaborador criado!");
            qc.invalidateQueries({ queryKey: COLABORADORES_KEY });
        },
        onError: (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
    });
}

export function useInvalidateColaboradores() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: COLABORADORES_KEY });
}
