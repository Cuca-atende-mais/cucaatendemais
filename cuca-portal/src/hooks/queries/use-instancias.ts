"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const INSTANCIAS_KEY = ["instancias"] as const;
const QUERY_KEY = INSTANCIAS_KEY;

async function fetchInstancias() {
    const res = await fetch("/api/instancias/listar");
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    return res.json();
}

export function useInstancias() {
    return useQuery({
        queryKey: QUERY_KEY,
        queryFn: fetchInstancias,
        staleTime: 30_000,
    });
}

export function useInvalidateInstancias() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: QUERY_KEY });
}
