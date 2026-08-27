"use client";

import { useEffect, useState } from "react";
import { FileText, Download, Loader2, ImageOff } from "lucide-react";

interface AnexoMensagemProps {
    /** Caminho no bucket privado `anexos-conversas` (valor de mensagens.midia_url). */
    path: string;
    /** "image" ou "document" — controla se renderiza miniatura ou card de PDF. */
    tipo: string;
}

// S-WM-68: anexo (imagem/PDF) recebido do lead via WhatsApp. O bucket é
// privado — nunca renderiza midia_url direto como src; sempre busca uma
// signed URL de curta duração via /api/chat/anexo antes de exibir. Se o
// anexo já expirou (job de 15 dias já rodou), mostra aviso em vez de imagem
// quebrada — não é erro, é o comportamento esperado depois da expiração.
export default function AnexoMensagem({ path, tipo }: AnexoMensagemProps) {
    const [url, setUrl] = useState<string | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "erro">("loading");

    useEffect(() => {
        let cancelado = false;

        async function carregar() {
            try {
                const res = await fetch(`/api/chat/anexo?path=${encodeURIComponent(path)}`);
                const data = await res.json();
                if (cancelado) return;
                if (!res.ok || !data.url) {
                    setStatus("erro");
                    return;
                }
                setUrl(data.url);
                setStatus("ready");
            } catch {
                if (!cancelado) setStatus("erro");
            }
        }
        carregar();
        return () => { cancelado = true; };
    }, [path]);

    if (status === "loading") {
        return (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] opacity-60">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando anexo...
            </div>
        );
    }

    if (status === "erro" || !url) {
        return (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] opacity-50 italic">
                <ImageOff className="h-3 w-3 shrink-0" /> Anexo indisponível (pode ter expirado)
            </div>
        );
    }

    if (tipo === "image") {
        return (
            <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1.5 block w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL rotativa, não cabe em next/image */}
                <img
                    src={url}
                    alt="Anexo enviado pelo lead"
                    className="max-h-48 max-w-full rounded-lg border border-border/50 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                />
            </a>
        );
    }

    // document (PDF)
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 flex items-center gap-2 rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors w-fit"
        >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Documento (PDF)</span>
            <Download className="h-3 w-3 opacity-60 shrink-0" />
        </a>
    );
}
