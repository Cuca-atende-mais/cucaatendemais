import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Função para disparar alertas institucionais via UAZAPI.
 * HUB de Alertas: Notifica admins/operadores conforme o evento no banco.
 */

Deno.serve(async (req) => {
    try {
        const payload = await req.json();
        const { record, table, type } = payload; // 'type' pode vir do webhook payload customizado

        console.log(`[Institucional] Evento em ${table}: ${record?.id || 'Sem ID'}`);

        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") || "https://uazapi.com.br";

        // 1. Localizar Instância UAZAPI ativa para envio
        const { data: instancia, error: instErr } = await supabase
            .from("instancias_uazapi")
            .select("nome, token")
            .eq("ativa", true)
            .limit(1)
            .maybeSingle();

        if (instErr) throw instErr;
        if (!instancia) {
            console.warn("[Institucional] Sem instância ativa.");
            return new Response(JSON.stringify({ message: "Sem instância ativa" }), { status: 200 });
        }

        let recipients: any[] = [];
        let message = "";

        // --- LÓGICA DE ROTEAMENTO DE ALERTAS ---

        if (table === 'eventos_pontuais' && record.status === 'aguardando_aprovacao') {
            // ALERTA S6-04: Novo Evento Pontual para Super Admin
            const { data: admins } = await supabase
                .from("colaboradores")
                .select("nome_completo, telefone, funcoes!inner(nome)")
                .eq("funcoes.nome", "super_admin")
                .eq("ativo", true);

            recipients = admins || [];
            message = `🔔 *SUPORTE CUCA: NOVA SOLICITAÇÃO*\n\n` +
                `Um novo evento pontual requer sua aprovação:\n\n` +
                `📌 *Título:* ${record.titulo}\n` +
                `🏢 *Unidade:* ${record.unidade_cuca}\n` +
                `📅 *Data:* ${record.data_evento}\n\n` +
                `⚠️ Acesse o portal para validar e liberar o disparo.`;

        } else if (table === 'conversas' && record.status === 'awaiting_human') {
            // ALERTA S7-02: Solicitação de Handover para Operador da Unidade
            const unitFilter = record.unidade_cuca; // Assumindo que a conversa tem a unidade vinculada

            const { data: operators } = await supabase
                .from("colaboradores")
                .select("nome_completo, telefone, funcoes!inner(nome)")
                .eq("funcoes.nome", "operador")
                .eq("unidade_cuca", unitFilter) // Filtra operadores daquela unidade específica
                .eq("ativo", true);

            recipients = operators || [];

            // Buscar dados do lead para o alerta
            const { data: lead } = await supabase
                .from("leads")
                .select("nome, telefone")
                .eq("id", record.lead_id)
                .single();

            message = `🎧 *CUCA: INTERVENÇÃO HUMANA REQUEST*\n\n` +
                `A IA Maria/Júlia solicitou ajuda em uma conversa:\n\n` +
                `👤 *Lead:* ${lead?.nome || 'Cidadão'} (${lead?.telefone || 'Desconhecido'})\n` +
                `🏢 *Unidade:* ${unitFilter}\n` +
                `📄 *Status:* Aguardando Operador\n\n` +
                `⚠️ Assuma o chat no portal para continuar o atendimento.`;

        } else if (table === 'solicitacoes_acesso') {
            const unitFilter = record.unidade_cuca;

            if (record.status === 'aguardando_aprovacao_tecnica') {
                // ALERTA S7-03: Acesso CUCA N1 (Coordenador)
                const { data: coordinators } = await supabase
                    .from("colaboradores")
                    .select("nome_completo, telefone, funcoes!inner(nome)")
                    .eq("funcoes.nome", "coordenador")
                    .eq("unidade_cuca", unitFilter)
                    .eq("ativo", true);

                recipients = coordinators || [];
                message = `🏛️ *ACESSO CUCA: NOVA SOLICITAÇÃO (N1)*\n\n` +
                    `Uma nova reserva de espaço requer análise técnica:\n\n` +
                    `👤 *Solicitante:* ${record.nome_solicitante}\n` +
                    `📌 *Evento:* ${record.tipo_evento}\n` +
                    `📅 *Data:* ${record.data_evento}\n` +
                    `🏢 *Unidade:* ${unitFilter}\n\n` +
                    `⚠️ Avalie a viabilidade técnica no portal.`;

            } else if (record.status === 'aguardando_aprovacao_secretaria') {
                // ALERTA S7-04: Acesso CUCA N2 (Secretaria)
                const { data: secretaries } = await supabase
                    .from("colaboradores")
                    .select("nome_completo, telefone, funcoes!inner(nome)")
                    .eq("funcoes.nome", "secretaria")
                    .eq("ativo", true);

                recipients = secretaries || [];
                message = `🏛️ *ACESSO CUCA: VALIDAÇÃO FINAL (N2)*\n\n` +
                    `Uma reserva foi aprovada tecnicamente e aguarda validação final:\n\n` +
                    `👤 *Solicitante:* ${record.nome_solicitante}\n` +
                    `📌 *Evento:* ${record.tipo_evento}\n` +
                    `🏢 *Unidade:* ${unitFilter}\n\n` +
                    `⚠️ Libere a reserva no portal para notificar o cidadão.`;
            }
        }

        if (recipients.length === 0) {
            return new Response(JSON.stringify({ message: "Nenhum destinatário elegível." }), { status: 200 });
        }

        // 3. Enviar mensagens em lote
        const sendPromises = recipients.map(async (recipient) => {
            try {
                const response = await fetch(`${UAZAPI_BASE_URL}/message/sendText/${instancia.nome}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "apikey": instancia.token
                    },
                    body: JSON.stringify({
                        number: recipient.telefone,
                        options: {
                            delay: 3000,
                            presence: "composing",
                            linkPreview: true
                        },
                        textMessage: { text: message }
                    })
                });
                return await response.json();
            } catch (fErr) {
                console.error(`Erro ao disparar para ${recipient.telefone}:`, fErr);
                return { error: true };
            }
        });

        await Promise.all(sendPromises);

        return new Response(JSON.stringify({ success: true, count: recipients.length }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (err: any) {
        console.error("[Institucional] Erro Crítico:", err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
