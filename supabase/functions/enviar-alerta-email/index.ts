// S-INST-QUAL-12 — Envia por e-mail (Resend) um alerta da central `alertas_sistema`.
//
// Quem chama: o gatilho `alertas_enviar_email` (AFTER INSERT em `alertas_sistema`), por
// `net.http_post`. A função não aceita texto de fora:
//   - o corpo leva só `{ alerta_id }`; título, detalhe e ação sugerida são lidos do banco;
//   - o cabeçalho `x-alerta-segredo` precisa bater com o segredo do cofre
//     (`alertas_email_segredo()`, só `service_role`). Sem ele, 401;
//   - o envio é único: antes de mandar, a função "reserva" o alerta
//     (`update ... set email_enviado_em = now() where email_enviado_em is null`). Uma segunda
//     chamada com o mesmo `alerta_id` não encontra nada para reservar e não manda outro e-mail.
//     Se o Resend falhar, a reserva é desfeita e o erro vai para `email_erro`.
//
// Segredos: a chave do Resend e o segredo do cabeçalho são lidos do cofre do banco
// (`get_resend_key()` e `alertas_email_segredo()`, ambas só para `service_role`). Nenhum valor
// fica no código nem nos segredos da Edge Function.
//
// Deploy com verify_jwt ligado: o gatilho manda a chave anon como Bearer (`get_anon_key()`), e
// o cabeçalho próprio é a segunda trava.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

export const REMETENTE = "Cuca Atende+ <noreply@cucaatendemais.com.br>";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Alerta = {
  id: string;
  origem: string;
  tipo: string;
  severidade: string;
  titulo: string;
  detalhe: string | null;
  acao_sugerida: string | null;
  criado_em: string;
  resolvido_em: string | null;
};

export type Email = { assunto: string; html: string; texto: string };

/** Dependências externas, trocadas por mocks nos testes (nenhum teste sai para a rede). */
export type Deps = {
  lerSegredo: () => Promise<string | null>;
  lerChaveResend: () => Promise<string | null>;
  lerConfig: () => Promise<{ destino: string[]; portalUrl: string }>;
  /** Reserva o alerta para envio. Devolve null se não existe ou já foi enviado. */
  reservar: (alertaId: string) => Promise<Alerta | null>;
  /** Desfaz a reserva e grava o erro. */
  registrarFalha: (alertaId: string, erro: string) => Promise<void>;
  fetch: typeof fetch;
};

const SEVERIDADE_ROTULO: Record<string, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  info: "Informativo",
};

export function rotuloSeveridade(severidade: string): string {
  return SEVERIDADE_ROTULO[severidade] ?? "Atenção";
}

/** Compara em tempo constante (para o tempo de resposta não revelar o segredo). */
export function segredoConfere(recebido: string | null, esperado: string | null): boolean {
  if (!recebido || !esperado) return false;
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(esperado);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function escaparHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatarDataFortaleza(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function montarEmail(alerta: Alerta, portalUrl: string): Email {
  const severidade = rotuloSeveridade(alerta.severidade);
  const abertoEm = formatarDataFortaleza(alerta.criado_em);
  const assunto = `[Cuca Atende+] ${severidade}: ${alerta.titulo}`;
  const linhas: [string, string][] = [
    ["Gravidade", severidade],
    ["Aberto em", abertoEm + " (horário de Fortaleza)"],
  ];
  if (alerta.detalhe) linhas.push(["O que aconteceu", alerta.detalhe]);
  if (alerta.acao_sugerida) linhas.push(["O que fazer", alerta.acao_sugerida]);

  const texto = [
    alerta.titulo,
    "",
    ...linhas.map(([k, v]) => `${k}: ${v}`),
    "",
    `Ver no portal (sino de alertas): ${portalUrl}`,
  ].join("\n");

  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:600px">`,
    `<h2 style="font-size:18px;margin:0 0 12px">${escaparHtml(alerta.titulo)}</h2>`,
    `<table style="border-collapse:collapse">`,
    ...linhas.map(([k, v]) =>
      `<tr><td style="padding:4px 12px 4px 0;vertical-align:top;color:#555;white-space:nowrap"><strong>${escaparHtml(k)}</strong></td>` +
      `<td style="padding:4px 0">${escaparHtml(v)}</td></tr>`
    ),
    `</table>`,
    `<p style="margin-top:16px"><a href="${escaparHtml(portalUrl)}">Abrir o portal</a> e clicar no sino de alertas.</p>`,
    `<p style="color:#888;font-size:12px">Aviso automático da central de alertas do Cuca Atende+.</p>`,
    `</div>`,
  ].join("");

  return { assunto, html, texto };
}

function json(status: number, corpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

export function criarHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json(405, { erro: "método não permitido" });

    const esperado = await deps.lerSegredo();
    if (!segredoConfere(req.headers.get("x-alerta-segredo"), esperado)) {
      return json(401, { erro: "não autorizado" });
    }

    let alertaId: unknown;
    try {
      alertaId = (await req.json())?.alerta_id;
    } catch {
      return json(400, { erro: "corpo inválido" });
    }
    if (typeof alertaId !== "string" || !UUID_RE.test(alertaId)) {
      return json(400, { erro: "alerta_id inválido" });
    }

    const alerta = await deps.reservar(alertaId);
    if (!alerta) return json(200, { status: "ignorado", motivo: "alerta inexistente ou e-mail já enviado" });

    try {
      const [chave, config] = await Promise.all([deps.lerChaveResend(), deps.lerConfig()]);
      if (!chave) throw new Error("chave do Resend não encontrada no cofre");
      if (config.destino.length === 0) throw new Error("destino do e-mail vazio em system_config (alertas_email_destino)");

      const email = montarEmail(alerta, config.portalUrl);
      const resp = await deps.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + chave, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: REMETENTE,
          to: config.destino,
          subject: email.assunto,
          html: email.html,
          text: email.texto,
        }),
      });
      const corpo = await resp.text();
      if (!resp.ok) throw new Error(`Resend respondeu HTTP ${resp.status}: ${corpo.slice(0, 300)}`);

      let resendId: string | null = null;
      try {
        resendId = JSON.parse(corpo)?.id ?? null;
      } catch { /* corpo sem JSON: o envio foi aceito mesmo assim */ }
      console.log(`[enviar-alerta-email] alerta ${alertaId} enviado (resend id ${resendId})`);
      return json(200, { status: "enviado", resend_id: resendId });
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      console.error(`[enviar-alerta-email] falha no alerta ${alertaId}: ${msg}`);
      await deps.registrarFalha(alertaId, msg.slice(0, 500));
      return json(502, { status: "falhou", erro: msg.slice(0, 300) });
    }
  };
}

function depsReais(): Deps {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return {
    lerSegredo: async () => {
      const { data, error } = await supabase.rpc("alertas_email_segredo");
      if (error) console.error("[enviar-alerta-email] erro ao ler o segredo:", error.message);
      return (data as string | null) ?? null;
    },
    lerChaveResend: async () => {
      const { data, error } = await supabase.rpc("get_resend_key");
      if (error) console.error("[enviar-alerta-email] erro ao ler a chave do Resend:", error.message);
      return (data as string | null) ?? null;
    },
    lerConfig: async () => {
      const { data } = await supabase
        .from("system_config")
        .select("chave, valor")
        .in("chave", ["alertas_email_destino", "portal_url_producao"]);
      const mapa = new Map((data ?? []).map((r: { chave: string; valor: string | null }) => [r.chave, r.valor ?? ""]));
      const destino = (mapa.get("alertas_email_destino") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return { destino, portalUrl: mapa.get("portal_url_producao") || "https://cucaatendemais.com.br" };
    },
    reservar: async (alertaId) => {
      const { data, error } = await supabase
        .from("alertas_sistema")
        .update({ email_enviado_em: new Date().toISOString(), email_erro: null })
        .eq("id", alertaId)
        .is("email_enviado_em", null)
        .select("id, origem, tipo, severidade, titulo, detalhe, acao_sugerida, criado_em, resolvido_em")
        .maybeSingle();
      if (error) {
        console.error("[enviar-alerta-email] erro ao reservar o alerta:", error.message);
        return null;
      }
      return (data as Alerta | null) ?? null;
    },
    registrarFalha: async (alertaId, erro) => {
      const { error } = await supabase
        .from("alertas_sistema")
        .update({ email_enviado_em: null, email_erro: erro })
        .eq("id", alertaId);
      if (error) console.error("[enviar-alerta-email] erro ao registrar a falha:", error.message);
    },
    fetch: (...args) => fetch(...args),
  };
}

if (import.meta.main) {
  const handler = criarHandler(depsReais());
  Deno.serve(handler);
}
