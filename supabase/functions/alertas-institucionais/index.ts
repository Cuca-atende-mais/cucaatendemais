import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
    try {
        const payload = await req.json();
        const { record, table } = payload;

        console.log(`[Institucional] Evento em ${table}: ${record?.id || 'Sem ID'}`);

        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const META_SYSTEM_USER_TOKEN = Deno.env.get("META_SYSTEM_USER_TOKEN") || "";

        // 1. Localizar phone_number_id Meta Institucional
        const { data: phoneNumber, error: pnErr } = await supabase
            .from("meta_phone_numbers")
            .select("phone_number_id")
            .eq("canal_tipo", "Institucional")
            .eq("ativo", true)
            .limit(1)
            .maybeSingle();

        if (pnErr) throw pnErr;
        if (!phoneNumber) {
            console.warn("[Institucional] Sem phone_number_id Meta ativo para canal_tipo=Institucional");
            return new Response(JSON.stringify({ message: "Sem phone_number_id Meta ativo" }), { status: 200 });
        }

        const phoneNumberId = phoneNumber.phone_number_id;

        let recipients: any[] = [];
        let templateName = "";
        let templateComponents: object[] = [];

        // --- LÓGICA DE ROTEAMENTO DE ALERTAS ---

        if (table === 'eventos_pontuais' && record.status === 'aguardando_aprovacao') {
            // ALERTA: Novo Evento Pontual para Super Admin
            const { data: admins } = await supabase
                .from("colaboradores")
                .select("nome_completo, telefone, funcoes!inner(nome)")
                .eq("funcoes.nome", "super_admin")
                .eq("ativo", true);

            recipients = admins || [];
            // Template vars: {{1}} titulo, {{2}} unidade_cuca, {{3}} data_evento
            templateComponents = [{
                type: "body",
                parameters: [
                    { type: "text", text: record.titulo || "" },
                    { type: "text", text: record.unidade_cuca || "" },
                    { type: "text", text: String(record.data_evento || "") },
                ]
            }];
            const { data: tpl1 } = await supabase.from("meta_templates").select("nome")
                .ilike("nome", "%alerta_evento_pontual%").eq("ativo", true).eq("status", "aprovado")
                .limit(1).maybeSingle();
            templateName = tpl1?.nome ?? "";

        } else if (table === 'conversas' && record.status === 'awaiting_human') {
            // ALERTA: Handover para Operador da Unidade
            // Nota: trigger_alerta_handover foi dropado em cuca-dev (S-WM-09 cobre via _notificar_transbordo).
            // Bloco mantido pois trigger pode existir em produção — defer ao Junior decidir drop em prod.
            const { data: operators } = await supabase
                .from("colaboradores")
                .select("nome_completo, telefone, funcoes!inner(nome)")
                .eq("funcoes.nome", "operador")
                .eq("unidade_cuca", record.unidade_cuca)
                .eq("ativo", true);

            recipients = operators || [];

            const { data: lead } = await supabase
                .from("leads")
                .select("nome, telefone")
                .eq("id", record.lead_id)
                .single();

            // Template vars: {{1}} lead_nome, {{2}} lead_telefone, {{3}} unidade_cuca
            templateComponents = [{
                type: "body",
                parameters: [
                    { type: "text", text: lead?.nome || "Cidadão" },
                    { type: "text", text: lead?.telefone || "Desconhecido" },
                    { type: "text", text: record.unidade_cuca || "" },
                ]
            }];
            const { data: tpl2 } = await supabase.from("meta_templates").select("nome")
                .ilike("nome", "%alerta_handover%").eq("ativo", true).eq("status", "aprovado")
                .limit(1).maybeSingle();
            templateName = tpl2?.nome ?? "";

        } else if (table === 'solicitacoes_acesso') {
            if (record.status === 'aguardando_aprovacao_tecnica') {
                // ALERTA: Acesso CUCA N1 (Coordenador)
                const { data: coordinators } = await supabase
                    .from("colaboradores")
                    .select("nome_completo, telefone, funcoes!inner(nome)")
                    .eq("funcoes.nome", "coordenador")
                    .eq("unidade_cuca", record.unidade_cuca)
                    .eq("ativo", true);

                recipients = coordinators || [];
                // Template vars: {{1}} nome_solicitante, {{2}} tipo_evento, {{3}} data_evento, {{4}} unidade_cuca
                templateComponents = [{
                    type: "body",
                    parameters: [
                        { type: "text", text: record.nome_solicitante || "" },
                        { type: "text", text: record.tipo_evento || "" },
                        { type: "text", text: String(record.data_evento || "") },
                        { type: "text", text: record.unidade_cuca || "" },
                    ]
                }];
                const { data: tpl3 } = await supabase.from("meta_templates").select("nome")
                    .ilike("nome", "%alerta_acesso_n1%").eq("ativo", true).eq("status", "aprovado")
                    .limit(1).maybeSingle();
                templateName = tpl3?.nome ?? "";

            } else if (record.status === 'aguardando_aprovacao_secretaria') {
                // ALERTA: Acesso CUCA N2 (Secretaria)
                const { data: secretaries } = await supabase
                    .from("colaboradores")
                    .select("nome_completo, telefone, funcoes!inner(nome)")
                    .eq("funcoes.nome", "secretaria")
                    .eq("ativo", true);

                recipients = secretaries || [];
                // Template vars: {{1}} nome_solicitante, {{2}} tipo_evento, {{3}} unidade_cuca
                templateComponents = [{
                    type: "body",
                    parameters: [
                        { type: "text", text: record.nome_solicitante || "" },
                        { type: "text", text: record.tipo_evento || "" },
                        { type: "text", text: record.unidade_cuca || "" },
                    ]
                }];
                const { data: tpl4 } = await supabase.from("meta_templates").select("nome")
                    .ilike("nome", "%alerta_acesso_n2%").eq("ativo", true).eq("status", "aprovado")
                    .limit(1).maybeSingle();
                templateName = tpl4?.nome ?? "";
            }
        }

        if (recipients.length === 0) {
            return new Response(JSON.stringify({ message: "Nenhum destinatário elegível." }), { status: 200 });
        }

        if (!templateName) {
            console.warn(`[Institucional] Nenhum template aprovado para evento=${table}/${record.status} — envio cancelado`);
            return new Response(JSON.stringify({ message: "Nenhum template aprovado." }), { status: 200 });
        }

        // 2. Enviar templates Meta em lote
        const sendPromises = recipients.map(async (recipient) => {
            const telefone = recipient.telefone;
            try {
                const response = await fetch(
                    `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${META_SYSTEM_USER_TOKEN}`
                        },
                        body: JSON.stringify({
                            messaging_product: "whatsapp",
                            to: telefone,
                            type: "template",
                            template: {
                                name: templateName,
                                language: { code: "pt_BR" },
                                components: templateComponents,
                            }
                        })
                    }
                );
                const data = await response.json();
                if (!response.ok) {
                    console.warn(`[Institucional] HTTP ${response.status} para ${telefone}: ${JSON.stringify(data).slice(0, 200)}`);
                }
                return data;
            } catch (fErr) {
                console.error(`[Institucional] Erro ao disparar para ${telefone}:`, fErr);
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
