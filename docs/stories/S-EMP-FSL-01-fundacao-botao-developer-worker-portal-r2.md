# S-EMP-FSL-01 — Fundação: botão Developer + canal worker→portal + gravação no R2 permanente

**Status:** Ready for Review
**Epic:** Fluxo do candidato 100% no WhatsApp (sem link)
**Origem:** `PLANO-EXECUCAO-fluxo-sem-link.md` (FSL-01), sessão de planejamento 2026-08-29.
**Prioridade:** P1 (fundação — nada do fluxo novo funciona sem ela) | **Esforço:** L | **Risco:**
ALTO — introduz um caminho que nunca existiu (worker chamando a API do portal) e um interruptor
que, se lido errado, poderia ligar o fluxo novo sem querer.
**Depende de:** nenhuma. É a base das FSL-02..08.

## Contexto

Hoje o worker (Python) **nunca** chama a API do `cuca-portal` — só o contrário acontece (o portal
chama o worker pra OCR, ver `process-cv/route.ts` → `worker/main.py:/process-cv`). O fluxo sem
link inverte isso: o worker vai precisar gravar currículo e criar candidatura chamando o portal.
Esta story constrói **só a fundação** (o caminho HTTP + o interruptor + a gravação no R2 correto),
sem plugar nenhuma conversa ainda.

Dois lugares de gravação hoje, que não podem se confundir (ver análise da sessão):
- **Bucket `anexos-conversas`** (Supabase Storage, privado) — anexo solto do WhatsApp, **expira em
  15 dias** (`meta_adapter_inbound.py`, S-WM-68). É lixo temporário pro atendente ver.
- **R2 da Cloudflare** (`lib/r2.ts::uploadToR2`) — currículo de verdade, **permanente**. É onde o
  formulário grava hoje.

O currículo do fluxo novo tem que ir pro **R2 permanente**, nunca no bucket de 15 dias.

## O que precisa ser implementado

### 1. Interruptor no menu Developer (não variável de ambiente)

- Estado persistido (liga/desliga sem deploy), exposto como botão numa tela do menu Developer do
  portal (onde já vivem `developer/meta-numeros`, `developer/meta-templates`).
- Lido pelo worker a cada conversa do Empregabilidade, antes de decidir link vs. fluxo novo.
- **Default: desligado** (comportamento 100% igual a hoje).
- Definir o mecanismo de leitura pelo worker (tabela de config no banco, lida no início do
  processamento — confirmar se já existe uma tabela de flags/config reaproveitável antes de criar
  nova).

### 2. Canal worker → portal (HTTP autenticado)

- Construir a chamada do worker pra API do portal, reaproveitando o padrão de token interno já
  usado no sentido inverso (`WEBHOOK_INTERNAL_TOKEN` ou equivalente — confirmar o nome real).
- Alvos: a rota de upload (`/api/empregabilidade/upload-cv`) e a de candidatura
  (`/api/empregabilidade/candidaturas`) — as mesmas que o formulário já usa.

### 3. Gravação no R2 permanente

- O worker envia o arquivo recebido no WhatsApp pra rota de upload do portal → R2 permanente,
  **não** pro bucket de 15 dias.
- Reaproveitar a rota `upload-cv` como está (a S-EMP-AUD-035 já a deixou aceitando PDF/JPEG/PNG/
  DOC/DOCX/HEIC) — o worker vira mais um cliente dela.

### 4. Tratamento de falha do portal (decisão 8 do plano)

- Se a chamada não responder a tempo, o worker não trava a conversa: retorna um estado que
  permite ao bot dar a mensagem "estou finalizando, já te confirmo o código" e re-tentar por trás.
- Definir timeout e política de retry (nº de tentativas, intervalo).

## Acceptance Criteria

1. Existe um botão no menu Developer que liga/desliga o fluxo sem link, com estado persistido,
   default desligado.
2. Com o botão **desligado**, o comportamento do Empregabilidade é idêntico ao de hoje (link) —
   nenhuma chamada nova ao portal acontece.
3. O worker consegue chamar `upload-cv` e `candidaturas` do portal com autenticação, e um arquivo
   enviado por esse caminho aparece no **R2 permanente** (não no bucket de 15 dias).
4. Falha/timeout do portal não trava nem derruba a conversa — o worker retorna um resultado
   tratável (sucesso, falha-retry, falha-definitiva), sem exceção não capturada.
5. Nenhum fluxo de conversa novo é ativado nesta story — só a fundação existe e é testável isolada.

## Escopo

**In:** interruptor Developer, canal worker→portal autenticado, gravação no R2 permanente, política
de timeout/retry. **Out:** qualquer mudança na sequência de conversa (isso é FSL-02+); a limpeza de
órfãos no R2 (FSL-06).

## ⚠️ Análise de impacto — por item

### Item 1 — Interruptor Developer
- **Toca:** nova tela/config no portal + leitura no worker (`empregabilidade_engine.py`, ponto de
  entrada). Nenhum consumidor externo.
- **Impacto observável:** nenhum enquanto desligado. Ligado, muda o roteamento (mas o roteamento
  novo só existe a partir da FSL-03 — aqui o botão liga "nada" ainda).
- **De-risk:** confirmar leitura correta do estado com botão on/off antes de qualquer fluxo
  depender dele. Testar que o default é desligado mesmo se a config não existir (fail-safe pro
  comportamento atual).

### Item 2 — Canal worker→portal
- **Toca:** worker ganha capacidade de fazer requisição HTTP autenticada pro portal (padrão novo
  no projeto). Portal: confirmar que `upload-cv`/`candidaturas` aceitam a autenticação interna
  (hoje `candidaturas` valida link assinado — ver `route.ts:38` "Link inválido ou expirado";
  precisa de um caminho de auth alternativo pro worker que não quebre o do formulário).
- **Impacto observável:** nenhum enquanto não chamado por um fluxo real.
- **De-risk:** testar a chamada isolada (worker → portal → R2) com um arquivo de teste, fora de
  qualquer conversa, confirmando que grava no R2 permanente. **Rastrear o consumidor real:** a
  rota `candidaturas` tem validação de link assinado — mapear exatamente como o worker autentica
  sem burlar a proteção existente.

### Item 3 — Gravação no R2
- **Toca:** reaproveita `upload-cv` (sem alteração na rota). O worker passa o arquivo.
- **Impacto observável:** arquivos do fluxo novo passam a existir no R2 permanente.
- **De-risk:** confirmar visualmente no R2 que o arquivo caiu no bucket permanente, com URL
  pública válida, igual aos do formulário.

### Item 4 — Falha do portal
- **Toca:** lógica de timeout/retry no worker.
- **Impacto observável:** em caso de portal lento/fora, o lead vê "estou finalizando" em vez de
  silêncio ou erro cru.
- **De-risk:** simular portal indisponível (mock/URL inválida) e confirmar que o worker não lança
  exceção não tratada nem trava a conversa.

## Test plan

- Botão desligado → conversa do Empregabilidade idêntica a hoje (regressão completa do fluxo do
  link, sem nenhuma chamada nova).
- Chamada worker→portal isolada com arquivo de teste → aparece no R2 permanente.
- Portal simulado indisponível → worker retorna falha tratável, sem exceção, sem travar conversa.
- Botão ligado → confirmar que o roteamento reconhece o estado (mesmo que ainda não haja fluxo
  novo pra rodar).

## Done criteria

- [x] Botão Developer liga/desliga, persistido, default off
- [x] Worker chama upload-cv/candidaturas autenticado
- [~] Arquivo do worker grava no R2 permanente (confirmado no R2) — *canal + classificação prontos e testados com httpx mockado; a confirmação visual ponta-a-ponta no R2 com arquivo real depende de rodar o worker contra o portal (teste ao vivo), que exige autorização do Junior (regra `qa-testes-sem-navegador-ao-vivo.md`) — pendente pro @qa/validação guiada*
- [x] Falha do portal não trava a conversa (timeout/retry testados — vira `retry`/`rejeitado` sem exceção)
- [x] Regressão: com botão off, fluxo do link 100% intacto (nenhum caminho novo é acionado — AC5)

## STOP conditions

- A rota `candidaturas` não permitir um caminho de auth pro worker sem enfraquecer a validação de
  link assinado do formulário → parar e desenhar a auth com o Junior antes de seguir.
- Não existir tabela de config reaproveitável pro flag e a criação de uma nova exigir decisão de
  schema → levantar antes de aplicar migration.

## Perguntas em aberto

- Timeout e nº de retries da chamada worker→portal — valor de partida a definir (sugestão: timeout
  curto + 2 retries, mas confirmar com dado real de latência do portal).
  - **Resolvido (partida):** `PORTAL_TIMEOUT_PRIMEIRA_TENTATIVA_S = 8.0` (curto, cabe no turno da
    conversa; o engine já usa `timeout=10` em outra chamada), `PORTAL_TIMEOUT_RETRY_S = 15.0`,
    `PORTAL_MAX_RETRIES = 2`, `PORTAL_RETRY_INTERVALO_S = 2.0`. A orquestração do retry (mensagem
    de espera da decisão 8 + re-tentar por trás) fica na FSL-03; a FSL-01 entrega só o primitivo
    de UMA tentativa classificada + as constantes de política. Ajustar com latência real do portal
    quando houver dado de produção.

---

## Dev Agent Record

### Decisões-chave (rastreadas no código antes de escrever)

1. **Flag store:** reaproveitada a tabela `system_config` (`chave`/`valor`, PK em `chave`
   confirmada em produção via `execute_sql`) — não foi preciso criar tabela nova. Migration
   idempotente (`ON CONFLICT (chave) DO NOTHING`), default `valor='false'`, aplicada e verificada
   direto em `cuca` (produção) via MCP.
2. **Auth worker→portal:** seguido o precedente **exato** do projeto — `triar-banco-talentos`
   (SOL-06), que já aceita `x-internal-token` == `WEBHOOK_INTERNAL_TOKEN` OU sessão. Aplicado o
   mesmo em `candidaturas`: as **duas** checagens derivadas de `link_params` (validade + confronto
   de `origem_tel`) ficaram dentro de `if (!isWorkerRequest)`, sem enfraquecer o caminho do
   formulário. `upload-cv` **já é rota pública** (candidatos externos, confirmado no middleware) →
   o worker só chama, sem bypass.
3. **Tri-state refinada (ponto crítico):** `2xx→ok`, `409→ja_inscrito` (terminal), `demais
   4xx→rejeitado` (terminal, preserva `http_status`+corpo pra FSL-04 ramificar no 400 de idade),
   `timeout/conn/5xx→retry`. Token ausente vira `retry` (config faltando), nunca `rejeitado`
   (não mentir "rejeição de negócio" pro lead).
4. **Botão Developer:** página dedicada com Switch + **confirmação** ao ligar/desligar + leitura
   fail-closed no worker (só `true/1/on/sim` liga) — as três mitigações do risco ALTO "ligar sem
   querer". Rota API com checagem server-side por e-mail de developer (padrão `meta-phone-numbers`),
   não só o gate client-side do layout.
5. **AC5:** o leitor do flag e o cliente do portal são **primitivos isolados + testes** — nenhum
   é chamado por roteamento de conversa. A fiação real é FSL-02/03. Confirmado por grep.
6. **Normalização de mime no upload (ajuste pós-review):** o WhatsApp costuma declarar
   `application/octet-stream`, que a rota `upload-cv` rejeita (400) por mime declarado ANTES de
   validar os bytes — um CV válido viraria "rejeição definitiva" pro lead. `enviar_curriculo_para_r2`
   agora normaliza o content-type (sniff de magic bytes → sempre um mime permitido), deixando a
   validação de bytes do portal ser o juiz real. HEIC continua convertido no portal.
7. **Consistência dos gates do toggle (verificado pós-review):** a lista `DEVELOPER_EMAILS` da rota
   API é **idêntica** à do `user-provider.tsx` (`valmir@cucateste.com`, `dev.cucaatendemais@gmail.com`,
   `admin@cucadev.com.br`) — quem enxerga o botão (gate client-side) consegue acioná-lo (gate
   server-side); sem risco de botão visível porém morto por 401.

### File List

**Migration (aplicada em produção `cuca` via MCP):**
- `cuca-portal/supabase/migrations/20260829000000_empreg_fluxo_sem_link_flag.sql` (novo)

**Worker (Python):**
- `worker/empregabilidade_engine.py` — adicionado `_fluxo_sem_link_ativo()` + constantes
  (`_FLUXO_SEM_LINK_CHAVE`, `_FLUXO_SEM_LINK_VALORES_LIGADOS`)
- `worker/empregabilidade_portal_client.py` (novo) — canal worker→portal, `ResultadoPortal`,
  `classificar_resposta`, `enviar_curriculo_para_r2`, `criar_candidatura`, política timeout/retry
- `worker/tests/test_empregabilidade_portal_client.py` (novo) — 29 testes

**Portal (Next.js/TS):**
- `cuca-portal/src/app/api/empregabilidade/candidaturas/route.ts` — bypass de auth do worker
- `cuca-portal/src/app/api/developer/fluxo-sem-link/route.ts` (novo) — GET/POST do flag, auth developer
- `cuca-portal/src/app/(dashboard)/developer/fluxo-sem-link/page.tsx` (novo) — toggle com confirmação
- `cuca-portal/src/app/(dashboard)/developer/page.tsx` — card novo no grid do console

### Validação executada

- Worker: `pytest tests/test_empregabilidade_portal_client.py` → **31 passed** (inclui 2 da
  normalização de mime).
- Regressão worker: `pytest tests/test_empregabilidade_engine.py tests/test_meta_adapter_inbound.py`
  → **272 passed** (sem novos warnings).
- Portal: `eslint` nos 4 arquivos → 0 erros (2 warnings **pré-existentes** de `status`/
  `requisitos_atendidos` na `candidaturas`, não introduzidos aqui); `tsc --noEmit` → nenhum erro
  nos arquivos desta story.
- Migration verificada em produção: linha `empreg_fluxo_sem_link='false'` presente.

### Pendente pro @qa / validação guiada (não bloqueia a fundação)

- Confirmação visual ponta-a-ponta no R2 (arquivo real subido pelo worker) — exige teste ao vivo
  worker→portal, que depende de autorização do Junior (regra `qa-testes-sem-navegador-ao-vivo.md`).
  O canal e a classificação já estão provados com httpx mockado.

## QA Results (@qa — Quinn)

**Veredito: PASS com 1 CONCERN registrada** (2026-08-29). Aprovado pra seguir; a concern é uma
validação pendente de autorização, não um defeito de código.

### 7 quality checks

1. **Code review — PASS.** Padrões consistentes com o projeto: bypass de auth idêntico ao
   precedente `triar-banco-talentos` (SOL-06); `httpx` lazy-import + `_supabase_to_thread`
   reaproveitados; auth server-side do toggle no padrão `meta-phone-numbers`. Comentários explicam
   o "porquê" nos pontos sensíveis (tri-state, mime, gates).
2. **Testes — PASS.** 31 novos + regressão verde (**461 passed** nas suítes que coletam). As
   falhas/erros de `test_main_*` e `test_meta_adapter_outbound` são **ambientais e pré-existentes**
   (`No module named 'worker'`/`openai` ausente neste ambiente) — em módulos que esta story **não
   toca**; reproduzem isoladas, sem relação com a mudança.
3. **Acceptance Criteria — 4/5 plenos, AC3 parcial.** AC1/AC2/AC4/AC5 atendidos e verificados.
   **AC3 (arquivo no R2 permanente):** o canal e a classificação estão provados com `httpx`
   mockado; a **gravação real ponta-a-ponta no R2** não foi exercida (exige teste ao vivo
   worker→portal). → **CONCERN** (ver abaixo).
4. **Regressão — PASS.** Botão off = nada é fiado (AC5 confirmado por grep: `_fluxo_sem_link_ativo`
   e o portal-client só têm definição + testes). Caminho do formulário: as duas checagens de link
   seguem intactas no ramo não-worker. Corte de idade (400) **permanece aplicado inclusive ao
   worker** — proposital (a FSL-04 ramifica nesse 400).
5. **Performance — PASS.** Leitura do flag = 1 lookup por PK (`chave`) por conversa, fora do loop
   via `_supabase_to_thread`; 1ª tentativa curta (8s). *Observação (não bloqueia):* sem cache do
   flag — ok no volume atual; reavaliar se virar caminho quente.
6. **Segurança — PASS.** RLS de `system_config` **ligada** (policy super-admin, `authenticated`) →
   a superfície de texto livre da página Configurações é RLS-gated; o toggle (service-role) é gated
   por `DEVELOPER_EMAILS` **no servidor**, lista idêntica ao `user-provider`. O bypass do worker não
   enfraquece o link do formulário. *Observação LOW:* comparação de token com `===` não é
   constant-time — **consistente com todo o padrão M2M já existente** (`main.py`,
   `triar-banco-talentos`), não é regressão desta story.
7. **Docs — PASS.** Story com File List / Change Log / Dev Agent Record completos; migration
   documentada e verificada em produção (`empreg_fluxo_sem_link='false'`, RLS on).

### CONCERN (1)

- **AC3 — confirmação ao vivo no R2 pendente de autorização.** Não é defeito: provar a gravação
  real exige rodar worker→portal ao vivo, o que depende de autorização explícita do Junior
  (`qa-testes-sem-navegador-ao-vivo.md`). Como nada é fiado em conversa na FSL-01, a validação
  end-to-end de fato só passa a importar na **FSL-03**. Recomendo fazê-la (com autorização) antes
  de o flag ser ligado em produção pela primeira vez.

### Verificações de banco (read-only, produção `cuca`)

- `system_config.empreg_fluxo_sem_link = 'false'` presente. RLS = **on**. Policy super-admin ALL.
- `chave` é PRIMARY KEY (migration idempotente coerente).

## Change Log

- 2026-08-29 — @qa (Quinn): gate PASS com 1 concern (AC3 ao vivo pendente de autorização). 7 checks
  ok; falhas de teste confirmadas como ambientais/pré-existentes fora do escopo da story.
- 2026-08-29 — @dev (Dex): implementada a fundação FSL-01 (flag `system_config` + toggle Developer
  + canal worker→portal autenticado + política timeout/retry + tri-state classificada). Migration
  aplicada em produção. 29 testes novos + regressão verde. Status Ready → Ready for Review.
