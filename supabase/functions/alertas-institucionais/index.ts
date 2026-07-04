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

        // getComponents recebe o nome do destinatário e devolve os components Meta
        type ComponentsBuilder = (recipientNome: string) => object[];
        let getComponents: ComponentsBuilder = () => [];

        // --- ROTEAMENTO DE ALERTAS ---

        if (table === 'eventos_pontuais' && record.status === 'aguardando_aprovacao') {
            // Novo Evento Pontual → alerta ao super_admin
            const { data: admins } = await supabase
                .from("colaboradores")
                .select("nome_completo, telefone, funcoes!inner(nome)")
                .eq("funcoes.nome", "super_admin")
                .eq("ativo", true);

            recipients = admins || [];

            // Alerta admin de evento pontual: {{1}} titulo, {{2}} unidade_cuca, {{3}} data_evento
            getComponents = (_nome) => [{
                type: "body",
                parameters: [
                    { type: "text", text: record.titulo || "" },
                    { type: "text", text: record.unidade_cuca || "" },
                    { type: "text", text: String(record.data_evento || "") },
                ]
            }];

            // Lookup relacional (automação + phone_number_id, zero nome hardcoded — S-WM-16).
            // Tag "EventoAdmin" desambigua de outros templates Institucional (ex. programação mensal).
            const { data: tpl } = await supabase
                .from("meta_templates")
                .select("nome")
                .contains("automacoes", ["Institucional", "EventoAdmin"])
                .contains("phone_number_ids", [phoneNumberId])
                .eq("ativo", true)
                .eq("status", "aprovado")
                .maybeSingle();
            templateName = tpl?.nome ?? "";

        } else if (table === 'conversas' && record.status === 'awaiting_human') {
            // Handover → alerta ao operador da unidade
            // (trigger pode ter sido dropado em cuca-dev; mantido pois pode existir em produção)
            const { data: operators } = await supabase
                .from("colaboradores")
                .select("nome_completo, telefone, funcoes!inner(nome)")
                .eq("funcoes.nome", "operador")
                .eq("unidade_cuca", record.unidade_cuca)
                .eq("ativo", true);

            recipients = operators || [];

            const { data: lead } = await supabase
                .from("leads")
                .select("nome")
                .eq("id", record.lead_id)
                .maybeSingle();

            // Notificação de transbordo (handover): {{1}} nome colaborador, {{2}} nome lead, {{3}} canal
            const leadNome = lead?.nome || "Cidadão";
            const canal = record.unidade_cuca || "CUCA";
            getComponents = (recipientNome) => [{
                type: "body",
                parameters: [
                    { type: "text", text: recipientNome },
                    { type: "text", text: leadNome },
                    { type: "text", text: canal },
                ]
            }];

            // Lookup relacional — mesmo template usado por _notificar_transbordo (worker)
            const { data: tpl } = await supabase
                .from("meta_templates")
                .select("nome")
                .contains("automacoes", ["Institucional", "Transbordo"])
                .contains("phone_number_ids", [phoneNumberId])
                .eq("ativo", true)
                .eq("status", "aprovado")
                .maybeSingle();
            templateName = tpl?.nome ?? "";

        } else if (table === 'solicitacoes_acesso') {
            // Notificação de acesso: {{1}} nome colaborador, {{2}} solicitante, {{3}} "Acesso CUCA"
            const nomeSolicitante = record.nome_solicitante || "";
            getComponents = (recipientNome) => [{
                type: "body",
                parameters: [
                    { type: "text", text: recipientNome },
                    { type: "text", text: nomeSolicitante },
                    { type: "text", text: "Acesso CUCA" },
                ]
            }];

            // Lookup relacional. Nenhum template "Acesso CUCA"+"Transbordo" existe hoje —
            // pula graciosamente até um template real ser cadastrado para esse caso.
            const { data: tpl } = await supabase
                .from("meta_templates")
                .select("nome")
                .contains("automacoes", ["Acesso CUCA", "Transbordo"])
                .contains("phone_number_ids", [phoneNumberId])
                .eq("ativo", true)
                .eq("status", "aprovado")
                .maybeSingle();
            templateName = tpl?.nome ?? "";

            if (record.status === 'aguardando_aprovacao_tecnica') {
                const { data: coordinators } = await supabase
                    .from("colaboradores")
                    .select("nome_completo, telefone, funcoes!inner(nome)")
                    .eq("funcoes.nome", "coordenador")
                    .eq("unidade_cuca", record.unidade_cuca)
                    .eq("ativo", true);
                recipients = coordinators || [];

            } else if (record.status === 'aguardando_aprovacao_secretaria') {
                const { data: secretaries } = await supabase
                    .from("colaboradores")
                    .select("nome_completo, telefone, funcoes!inner(nome)")
                    .eq("funcoes.nome", "secretaria")
                    .eq("ativo", true);
                recipients = secretaries || [];
            }
        }

        if (recipients.length === 0) {
            return new Response(JSON.stringify({ message: "Nenhum destinatário elegível." }), { status: 200 });
        }

        if (!templateName) {
            console.warn(`[Institucional] Nenhum template aprovado para evento=${table}/${record.status} — envio cancelado`);
            return new Response(JSON.stringify({ message: "Nenhum template aprovado." }), { status: 200 });
        }

        // 2. Enviar templates Meta em lote (components por destinatário)
        const sendPromises = recipients.map(async (recipient) => {
            const telefone = recipient.telefone;
            const components = getComponents(recipient.nome_completo || "");
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
                                components,
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
