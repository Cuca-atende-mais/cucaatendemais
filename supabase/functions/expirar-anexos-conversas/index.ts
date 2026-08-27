// S-WM-68: expira anexos (imagem/PDF) de WhatsApp recebidos via Meta, 15 dias
// após o recebimento. Remove o objeto do bucket privado `anexos-conversas` e
// zera `midia_url` da mensagem correspondente — o texto do histórico (ex.:
// "[Imagem enviada sem legenda]") permanece intacto, só o arquivo some.
//
// Decisão do Junior (2026-08-27): sem manifesto/log de auditoria — apaga
// direto, sem deixar rastro além do texto que já existe no histórico.
//
// Cobre as duas tabelas de mensagens do projeto: `mensagens` (caminho
// compartilhado Institucional/Empregabilidade) e `ae_mensagens` (caminho
// isolado da Academia Enem, S-AE-16) — ambas ganham `midia_url` por esta
// mesma story.
//
// Agendamento: pg_cron + pg_net chamando esta função via net.http_post,
// mesmo padrão já usado no projeto (S-WM-15) — ver migration
// 20260827161500_s_wm_68_cron_expirar_anexos.sql.
//
// Idempotente por construção: só processa linhas com midia_url != null;
// depois de processada, midia_url vira null, então uma segunda execução no
// mesmo dia não reprocessa nada. Deletar um objeto que já não existe no
// Storage não é erro (semântica S3: remove de chave inexistente é no-op).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "anexos-conversas";
const DIAS_RETENCAO = 15;

type TabelaAlvo = {
    nome: "mensagens" | "ae_mensagens";
};

const TABELAS: TabelaAlvo[] = [
    { nome: "mensagens" },
    { nome: "ae_mensagens" },
];

Deno.serve(async (_req) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(Date.now() - DIAS_RETENCAO * 24 * 60 * 60 * 1000).toISOString();
    const resumo: Record<string, { encontradas: number; removidas: number; erros: number }> = {};

    for (const { nome } of TABELAS) {
        resumo[nome] = { encontradas: 0, removidas: 0, erros: 0 };

        const { data: linhas, error: erroSelect } = await supabase
            .from(nome)
            .select("id, midia_url")
            .not("midia_url", "is", null)
            .lt("created_at", cutoff);

        if (erroSelect) {
            console.error(`[expirar-anexos] Erro ao consultar ${nome}:`, erroSelect.message);
            resumo[nome].erros++;
            continue;
        }

        if (!linhas || linhas.length === 0) continue;
        resumo[nome].encontradas = linhas.length;

        const caminhos = linhas.map((l) => l.midia_url as string).filter(Boolean);
        const ids = linhas.map((l) => l.id);

        // Remove em lotes de até 1000 (limite da API de Storage) — na prática
        // este job roda diariamente, volume esperado é baixo.
        for (let i = 0; i < caminhos.length; i += 1000) {
            const lote = caminhos.slice(i, i + 1000);
            const { error: erroRemove } = await supabase.storage.from(BUCKET).remove(lote);
            if (erroRemove) {
                // Não interrompe o job por um lote — loga e segue pra limpar o
                // midia_url mesmo assim (AC5: idempotente, não trava as demais).
                console.error(`[expirar-anexos] Erro ao remover lote do Storage (${nome}):`, erroRemove.message);
                resumo[nome].erros++;
            }
        }

        const { error: erroUpdate } = await supabase
            .from(nome)
            .update({ midia_url: null })
            .in("id", ids);

        if (erroUpdate) {
            console.error(`[expirar-anexos] Erro ao limpar midia_url em ${nome}:`, erroUpdate.message);
            resumo[nome].erros++;
        } else {
            resumo[nome].removidas = ids.length;
        }
    }

    console.log("[expirar-anexos] Resumo:", JSON.stringify(resumo));

    return new Response(JSON.stringify({ success: true, cutoff, resumo }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
});
