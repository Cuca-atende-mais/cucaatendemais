"use client";

// global-error.tsx — captura erros não tratados em toda a aplicação Next.js
// Este componente substitui o layout raiz quando um erro crítico ocorre.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Envia o erro para o Sentry automaticamente
        Sentry.captureException(error);
    }, [error]);

    return (
        <html lang="pt-BR">
            <body className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
                <div className="text-center space-y-6 max-w-md">
                    <div className="flex justify-center">
                        <div className="p-4 bg-destructive/20 rounded-full">
                            <AlertTriangle className="h-12 w-12 text-destructive" />
                        </div>
                    </div>

                    <div>
                        <h1 className="text-2xl font-bold text-white mb-2">
                            Oops! Algo deu errado
                        </h1>
                        <p className="text-slate-400 text-sm">
                            Ocorreu um erro inesperado. Nossa equipe técnica foi notificada
                            automaticamente e irá investigar.
                        </p>
                    </div>

                    {error.digest && (
                        <div className="bg-slate-800 rounded-lg px-4 py-2 border border-slate-700">
                            <p className="text-xs text-slate-500 font-mono">
                                Código do erro: {error.digest}
                            </p>
                        </div>
                    )}

                    <div className="flex gap-3 justify-center">
                        <Button
                            onClick={reset}
                            className="bg-primary hover:bg-primary/90"
                        >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Tentar novamente
                        </Button>
                        <Button
                            variant="outline"
                            className="border-slate-600 text-slate-300 hover:bg-slate-700"
                            onClick={() => window.location.href = "/dashboard"}
                        >
                            Ir para o Dashboard
                        </Button>
                    </div>

                    <p className="text-xs text-slate-600">
                        Sistema CUCA Atende+ — Se o problema persistir, contate o suporte técnico.
                    </p>
                </div>
            </body>
        </html>
    );
}
