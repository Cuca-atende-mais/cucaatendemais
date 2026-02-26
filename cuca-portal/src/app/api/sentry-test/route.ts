// Rota de teste para verificar se o Sentry está capturando erros.
// Após confirmar que funciona, pode ser removida.
// Acesse: /api/sentry-test para disparar um erro de teste.

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        // Dispara um erro proposital para testar o Sentry
        throw new Error("CUCA Portal - Teste do Sentry: este erro é intencional!");
    } catch (error) {
        // Captura e envia explicitamente para o Sentry
        Sentry.captureException(error);

        return NextResponse.json({
            status: "error_sent",
            message: "Erro de teste enviado ao Sentry com sucesso!",
            timestamp: new Date().toISOString(),
        });
    }
}
