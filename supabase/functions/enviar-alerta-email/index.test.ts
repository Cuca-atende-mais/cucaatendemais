// S-INST-QUAL-12 — Testes da Edge Function enviar-alerta-email.
// Tudo com dependências falsas: nenhum teste chama o Resend nem o banco de verdade.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Alerta, criarHandler, type Deps, montarEmail, rotuloSeveridade, segredoConfere } from "./index.ts";

const SEGREDO = "a".repeat(64);
const ALERTA_ID = "11111111-2222-3333-4444-555555555555";

function alertaBase(): Alerta {
  return {
    id: ALERTA_ID,
    origem: "rag_saude",
    tipo: "busca_vazia_com_unidade",
    severidade: "atencao",
    titulo: "Buscas do Institucional voltando vazias",
    detalhe: "47 de 64 buscas com unidade voltaram vazias nas últimas 24h",
    acao_sugerida: "Conferir se um índice vetorial voltou",
    criado_em: "2026-11-03T15:45:00Z",
    resolvido_em: null,
  };
}

type Estado = {
  enviadoEm: string | null;
  erro: string | null;
  chamadasResend: { url: string; corpo: Record<string, unknown> }[];
  respostaResend: Response;
  chaveResend: string | null;
  destino: string[];
};

function criarDeps(estado: Estado): Deps {
  return {
    lerSegredo: () => Promise.resolve(SEGREDO),
    lerChaveResend: () => Promise.resolve(estado.chaveResend),
    lerConfig: () => Promise.resolve({ destino: estado.destino, portalUrl: "https://portal.teste" }),
    reservar: (id) => {
      if (id !== ALERTA_ID || estado.enviadoEm !== null) return Promise.resolve(null);
      estado.enviadoEm = "agora";
      estado.erro = null;
      return Promise.resolve(alertaBase());
    },
    registrarFalha: (_id, erro) => {
      estado.enviadoEm = null;
      estado.erro = erro;
      return Promise.resolve();
    },
    fetch: (input, init) => {
      estado.chamadasResend.push({ url: String(input), corpo: JSON.parse(String(init?.body ?? "{}")) });
      return Promise.resolve(estado.respostaResend.clone());
    },
  };
}

function novoEstado(parcial: Partial<Estado> = {}): Estado {
  return {
    enviadoEm: null,
    erro: null,
    chamadasResend: [],
    respostaResend: new Response(JSON.stringify({ id: "re_123" }), { status: 200 }),
    chaveResend: "re_chave_falsa",
    destino: ["dev.cucaatendemais@gmail.com"],
    ...parcial,
  };
}

function requisicao(corpo: unknown, segredo: string | null = SEGREDO, metodo = "POST"): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (segredo !== null) headers.set("x-alerta-segredo", segredo);
  return new Request("http://local/enviar-alerta-email", {
    method: metodo,
    headers,
    body: metodo === "POST" ? (typeof corpo === "string" ? corpo : JSON.stringify(corpo)) : undefined,
  });
}

Deno.test("segredoConfere: igual, diferente, vazio e tamanho diferente", () => {
  assert(segredoConfere(SEGREDO, SEGREDO));
  assert(!segredoConfere("b".repeat(64), SEGREDO));
  assert(!segredoConfere(null, SEGREDO));
  assert(!segredoConfere(SEGREDO, null));
  assert(!segredoConfere("a", SEGREDO));
});

Deno.test("rotuloSeveridade: os três níveis e o padrão", () => {
  assertEquals(rotuloSeveridade("critico"), "Crítico");
  assertEquals(rotuloSeveridade("atencao"), "Atenção");
  assertEquals(rotuloSeveridade("info"), "Informativo");
  assertEquals(rotuloSeveridade("qualquer"), "Atenção");
});

Deno.test("montarEmail: assunto, campos, data em Fortaleza e HTML escapado", () => {
  const a = { ...alertaBase(), detalhe: "<script>x</script> & cia" };
  const e = montarEmail(a, "https://portal.teste");
  assertEquals(e.assunto, "[Cuca Atende+] Atenção: Buscas do Institucional voltando vazias");
  assertStringIncludes(e.texto, "O que fazer: Conferir se um índice vetorial voltou");
  assertStringIncludes(e.texto, "03/11/2026, 12:45"); // 15:45 UTC = 12:45 em Fortaleza
  assertStringIncludes(e.texto, "https://portal.teste");
  assertStringIncludes(e.html, "&lt;script&gt;x&lt;/script&gt; &amp; cia");
  assert(!e.html.includes("<script>"));
});

Deno.test("montarEmail: sem detalhe nem ação, as linhas não aparecem", () => {
  const e = montarEmail({ ...alertaBase(), detalhe: null, acao_sugerida: null }, "https://p");
  assert(!e.texto.includes("O que aconteceu"));
  assert(!e.texto.includes("O que fazer"));
});

Deno.test("AC7: sem o segredo, 401 e nada é enviado nem reservado", async () => {
  const estado = novoEstado();
  const resp = await criarHandler(criarDeps(estado))(requisicao({ alerta_id: ALERTA_ID }, null));
  assertEquals(resp.status, 401);
  assertEquals(estado.chamadasResend.length, 0);
  assertEquals(estado.enviadoEm, null);
});

Deno.test("AC7: segredo errado, 401", async () => {
  const estado = novoEstado();
  const resp = await criarHandler(criarDeps(estado))(requisicao({ alerta_id: ALERTA_ID }, "b".repeat(64)));
  assertEquals(resp.status, 401);
  assertEquals(estado.chamadasResend.length, 0);
});

Deno.test("método diferente de POST, 405", async () => {
  const resp = await criarHandler(criarDeps(novoEstado()))(requisicao(null, SEGREDO, "GET"));
  assertEquals(resp.status, 405);
});

Deno.test("corpo inválido ou alerta_id fora do formato, 400 (texto de fora não é aceito)", async () => {
  const h = criarHandler(criarDeps(novoEstado()));
  assertEquals((await h(requisicao("{nao e json", SEGREDO))).status, 400);
  assertEquals((await h(requisicao({ alerta_id: "abc" }, SEGREDO))).status, 400);
  assertEquals((await h(requisicao({ titulo: "inventado" }, SEGREDO))).status, 400);
});

Deno.test("envio com sucesso: uma chamada ao Resend com remetente, destino e assunto", async () => {
  const estado = novoEstado();
  const resp = await criarHandler(criarDeps(estado))(requisicao({ alerta_id: ALERTA_ID }));
  assertEquals(resp.status, 200);
  assertEquals((await resp.json()).status, "enviado");
  assertEquals(estado.chamadasResend.length, 1);
  const c = estado.chamadasResend[0];
  assertEquals(c.url, "https://api.resend.com/emails");
  assertEquals(c.corpo.to, ["dev.cucaatendemais@gmail.com"]);
  assertStringIncludes(String(c.corpo.from), "noreply@cucaatendemais.com.br");
  assertStringIncludes(String(c.corpo.subject), "Buscas do Institucional voltando vazias");
  assertEquals(estado.enviadoEm, "agora");
  assertEquals(estado.erro, null);
});

Deno.test("AC7: segunda chamada com o mesmo alerta_id não manda outro e-mail", async () => {
  const estado = novoEstado();
  const h = criarHandler(criarDeps(estado));
  await h(requisicao({ alerta_id: ALERTA_ID }));
  const resp2 = await h(requisicao({ alerta_id: ALERTA_ID }));
  assertEquals(resp2.status, 200);
  assertEquals((await resp2.json()).status, "ignorado");
  assertEquals(estado.chamadasResend.length, 1);
});

Deno.test("AC2: Resend recusa, a reserva é desfeita e o erro fica gravado", async () => {
  const estado = novoEstado({ respostaResend: new Response('{"message":"domínio não verificado"}', { status: 403 }) });
  const resp = await criarHandler(criarDeps(estado))(requisicao({ alerta_id: ALERTA_ID }));
  assertEquals(resp.status, 502);
  assertEquals(estado.enviadoEm, null);
  assertStringIncludes(estado.erro ?? "", "HTTP 403");
});

Deno.test("AC2: sem chave do Resend no cofre, erro gravado e nada enviado", async () => {
  const estado = novoEstado({ chaveResend: null });
  const resp = await criarHandler(criarDeps(estado))(requisicao({ alerta_id: ALERTA_ID }));
  assertEquals(resp.status, 502);
  assertEquals(estado.chamadasResend.length, 0);
  assertStringIncludes(estado.erro ?? "", "chave do Resend");
});

Deno.test("destino vazio em system_config: erro gravado e nada enviado", async () => {
  const estado = novoEstado({ destino: [] });
  const resp = await criarHandler(criarDeps(estado))(requisicao({ alerta_id: ALERTA_ID }));
  assertEquals(resp.status, 502);
  assertEquals(estado.chamadasResend.length, 0);
  assertStringIncludes(estado.erro ?? "", "destino");
});

Deno.test("fetch lança exceção (rede): reserva desfeita e erro gravado", async () => {
  const estado = novoEstado();
  const deps = criarDeps(estado);
  deps.fetch = () => Promise.reject(new Error("timeout de rede"));
  const resp = await criarHandler(deps)(requisicao({ alerta_id: ALERTA_ID }));
  assertEquals(resp.status, 502);
  assertEquals(estado.enviadoEm, null);
  assertStringIncludes(estado.erro ?? "", "timeout de rede");
});
