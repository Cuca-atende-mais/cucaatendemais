# Plan 003: Restringir o `fetch(midia_url)` de `transcreverAudio` a domínios confiáveis — e confirmar se o caminho é código morto

> **Executor instructions**: Este plano tem uma pergunta em aberto que PRECISA
> ser respondida pelo Valmir antes do Passo 2 (ver "Pergunta para o Valmir"
> abaixo). O Passo 1 (investigação) você pode fazer sozinho. Se a resposta
> não estiver disponível, pare depois do Passo 1 e reporte o que encontrou —
> não decida sozinho qual caminho seguir.
>
> **Drift check (rodar primeiro)**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente worker/meta_adapter_inbound.py`
> Se os arquivos mudaram desde que este plano foi escrito, revalide os
> trechos de "Estado atual" antes de prosseguir.

## Status

- **Priority**: P2 (rebaixado de P1 porque a investigação sugere que o caminho pode não ser alcançável pelo fluxo real do WhatsApp hoje — mas ainda é alcançável via chamada direta com a anon key, ver [[Plan 002]] sobre reachability)
- **Effort**: S (o fix em si) — mas o Passo 1 é obrigatório antes
- **Risk**: LOW
- **Depends on**: none, mas leia o Plan 002 primeiro — o argumento de reachability (anon key pública + sem `verify_jwt` override) é o mesmo e não vou repetir os detalhes aqui
- **Category**: security
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa (e uma descoberta que muda a prioridade)

`transcreverAudio` (`index.ts:692-703`) faz `fetch(audioUrl)` onde `audioUrl` é o campo `midia_url` do body do request, sem nenhum allowlist de domínio — um caller que alcance a função (ver Plan 002 sobre a anon key pública) pode mandar qualquer URL e a função vai buscá-la, criando uma superfície de SSRF.

**Só que investigando o fluxo real do worker, encontrei algo que precisa da sua confirmação, Valmir**: em `worker/meta_adapter_inbound.py:142-163` (`_parse_mensagem_meta`, caso `msg_type == "audio"`), o áudio já é **baixado e transcrito inteiramente no worker** (via `_baixar_midia_meta` + `_transcrever_audio_meta`, com o `Authorization: Bearer {META_SYSTEM_USER_TOKEN}` correto que a API da Meta exige) — e o worker retorna `midia_url=None` para mensagens de áudio, com `midia_tipo="voz"` (não `"audio"` nem `"ptt"`).

O `motor-agente` só entra no caminho de `transcreverAudio` quando `midia_tipo === "audio" || midia_tipo === "ptt"` (`index.ts:911`) — mas o worker nunca manda esses valores para áudio (manda `"voz"`). **Ou seja: pelo fluxo real de integração com a Meta hoje, esse branch inteiro em `motor-agente` parece inalcançável** — é possivelmente resíduo de uma arquitetura anterior (a API não-oficial pré-migração Meta, onde talvez o áudio fosse repassado como URL direto em vez de transcrito no worker).

Isso muda o quadro: não é só "adicionar um allowlist" — pode ser que o código certo seja **remover esse branch morto** (reduz superfície de ataque a zero, já que não há chamador legítimo) e deixar a transcrição de áudio como responsabilidade só do worker, que já faz certo. Mas eu não tenho contexto suficiente pra saber se: (a) existe algum outro caller/canal (ex.: um teste manual, uma integração futura, um fallback) que ainda depende desse branch, ou (b) há um motivo pra manter os dois caminhos.

## Pergunta para o Valmir

**Antes de aplicar qualquer fix, confirme**: existe algum caller real (hoje ou planejado) que envia `midia_tipo: "audio"` ou `midia_tipo: "ptt"` para `motor-agente` com uma `midia_url`? Procurei em todo `worker/` e não achei nenhum (`grep -rn "midia_tipo.*audio\|midia_tipo.*ptt" worker/` não retorna nada além da própria definição do contrato). Se a resposta for "não, pode remover" — o Passo 2a (remoção) é mais simples e mais seguro que o Passo 2b (allowlist). Se a resposta for "sim, existe/vai existir" — vá para o Passo 2b.

## Estado atual

- `supabase/functions/motor-agente/index.ts:692-703`:
  ```ts
  async function transcreverAudio(audioUrl: string, apiKey: string): Promise<string> {
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) throw new Error("Falha ao baixar audio");
    const audioBlob = await audioResp.blob();
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.ogg");
    formData.append("model", WHISPER_MODEL);
    formData.append("language", "pt");
    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { "Authorization": "Bearer " + apiKey }, body: formData });
    if (!resp.ok) throw new Error("Whisper error: " + await resp.text());
    return (await resp.json()).text;
  }
  ```
- `index.ts:910-911` (ponto de entrada no handler):
  ```ts
  let textoFinal = mensagem || "";
  if (midia_url && (midia_tipo === "audio" || midia_tipo === "ptt")) textoFinal = await transcreverAudio(midia_url, openaiKey);
  ```
- `worker/meta_adapter_inbound.py:142-163` — transcrição de áudio já acontece aqui, com `midia_url=None` e `midia_tipo="voz"` retornados para o contrato. Nota adicional: também tem um fallback de fixture local (`tests/fixtures/audio_teste.ogg`) quando `META_SYSTEM_USER_TOKEN` está ausente — mock-first, comportamento intencional documentado no próprio código.
- **Nota lateral, fora do escopo deste plano**: notei que `transcreverAudio` também não manda nenhum header de autenticação no `fetch(audioUrl)` (linha 693) — se esse branch algum dia FOR alcançado com uma URL real de mídia da Meta (`lookaside.fbsbx.com` ou similar), a Meta exige `Authorization: Bearer <token>` nesse GET (confirmado pelo próprio `_baixar_midia_meta` do worker, que manda o Bearer). Ou seja, mesmo que o branch fosse alcançado legitimamente, provavelmente falharia com 401 hoje. Reforça a suspeita de que é código morto, mas registro aqui como achado à parte — não tente "corrigir" a autenticação como parte deste plano, isso é decisão do Valmir depois de responder a pergunta acima.

## Comandos que você vai precisar

| Propósito | Comando | Esperado no sucesso |
|---|---|---|
| Grep de confirmação (Passo 1) | `grep -rn "midia_tipo" worker/` | Nenhuma ocorrência de `"audio"` ou `"ptt"` sendo atribuída a `midia_tipo` (só `"voz"`, `"image"`, `"text"`) |
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` (pasta `supabase/functions/motor-agente`) | todos passam |

## Escopo

**No escopo:**
- `supabase/functions/motor-agente/index.ts` — só a função `transcreverAudio` e a linha 911 que a invoca
- `supabase/functions/motor-agente/index.audit.test.ts` — testes novos (para o Passo 2b) ou remoção de referências (para o Passo 2a)

**Fora do escopo:**
- `worker/meta_adapter_inbound.py` — já está correto (baixa/transcreve com auth certo); não mexer.
- O header de autenticação ausente no `fetch(audioUrl)` — registrado como nota lateral acima, não corrigir aqui sem decisão do Valmir sobre qual caminho (2a ou 2b) seguir.
- `midia_tipo === "image"` — fora do escopo deste achado específico (SEC-02 é sobre o branch de áudio).

## Fluxo git

- Branch: `advisor/003-sec02-midia-url-ssrf`
- Commit único (fix + testes), mensagem no padrão do repo
- **Não** faça push nem abra PR a menos que instruído.

## Passos

### Passo 1: Investigar (obrigatório, faça sozinho)

Rode `grep -rn "midia_tipo" worker/` e `grep -rn "\"audio\"\|'audio'\|\"ptt\"\|'ptt'" worker/`. Confirme (ou refute) a leitura acima: nenhum caller no worker manda `midia_tipo` igual a `"audio"` ou `"ptt"`. Documente o resultado no seu relatório final, independente de qual caminho for seguido a seguir.

### Passo 2a: SE confirmado que é código morto — remover

Remova a função `transcreverAudio` (linhas 692-703) e a condicional que a invoca (linha 911), simplificando para:
```ts
const textoFinal = mensagem || "";
```
(mantendo o restante do fluxo — `if (!textoFinal) return ...` na linha 912 continua igual).

**Verify**: `grep -n "transcreverAudio" index.ts` não retorna nada.

### Passo 2b: SE confirmado que o caminho é usado/planejado — allowlist de domínio

Adicione uma validação de host antes do fetch:
```ts
const ALLOWLIST_HOSTS_MIDIA = ["lookaside.fbsbx.com"]; // confirme o(s) domínio(s) real(is) usado(s) pela Meta com o Valmir antes de fixar essa lista

async function transcreverAudio(audioUrl: string, apiKey: string): Promise<string> {
  const host = new URL(audioUrl).hostname;
  if (!ALLOWLIST_HOSTS_MIDIA.some((h) => host === h || host.endsWith("." + h))) {
    throw new Error("midia_url fora do allowlist de dominio permitido");
  }
  const audioResp = await fetch(audioUrl);
  // ... resto igual
}
```
**Importante**: não tenho certeza do domínio exato que a Meta usa para URLs temporárias de mídia (`lookaside.fbsbx.com` é o mais comum, mas confirme com o Valmir ou a documentação da conta real antes de travar a lista — um domínio errado quebra a funcionalidade em vez de protegê-la).

**Verify**: `grep -n "ALLOWLIST_HOSTS_MIDIA" index.ts` retorna a constante nova.

## Test plan

**Se seguiu 2a (remoção)**: nenhum teste novo necessário — apenas confirme que nenhum teste existente referenciava `transcreverAudio` (já sabemos que não, ver achado TEST-02 do relatório de auditoria) e que a suíte continua verde.

**Se seguiu 2b (allowlist)**: adicione em `index.audit.test.ts`:
1. `transcreverAudio` com uma URL de host fora do allowlist → deve rejeitar (`throw`) sem nunca chamar `fetch` para esse host (você pode exportar `transcreverAudio` temporariamente para testar isoladamente, seguindo o padrão de export das outras funções auxiliares no topo do arquivo, ex. `avaliarSelecaoUnidade`).
2. `transcreverAudio` com uma URL do host permitido → segue o fluxo normal (mock de `fetch` como em `comFetchMockado`, mas estendido para também interceptar a URL de áudio).

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → todos passam, incluindo os novos (se 2b).

## Done criteria

Machine-checkable. TODAS precisam valer:

- [ ] Passo 1 executado e resultado documentado (código mostrando ausência ou presença de `midia_tipo: "audio"/"ptt"` em `worker/`)
- [ ] Um dos caminhos (2a ou 2b) aplicado, não os dois
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] `plans/README.md` linha de status atualizada

## STOP conditions

Pare e reporte se:

- Você não conseguir confirmar com certeza qual caminho (2a/2b) seguir — não escolha por conta própria só com o grep do Passo 1; essa é uma decisão de produto/arquitetura do Valmir, o grep só informa a decisão.
- O domínio real usado pela Meta para mídia não for `lookaside.fbsbx.com` nem nenhum outro que você consiga confirmar com confiança — não trave um allowlist adivinhado.
- O código em `index.ts:692-703` ou `worker/meta_adapter_inbound.py:142-163` não bater com os trechos citados (arquivo já mudou).

## Maintenance notes

- Se 2a foi escolhido e no futuro alguém quiser reintroduzir transcrição de áudio direto na Edge Function (em vez do worker), essa decisão precisa vir com o allowlist de domínio desde o início, não depois.
- O que um revisor deve escrutinar: que a resposta à "Pergunta para o Valmir" está registrada em algum lugar rastreável (commit message, comentário, ou o próprio `plans/README.md`) — para não perder essa decisão de contexto depois.
