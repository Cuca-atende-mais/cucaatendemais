# S-WM-18 — Migrar Central de Divulgação de UAZAPI para Meta

## Status
InReview

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - test ! -e cuca-portal/src/components/instancias/chip-divulgacao-tab.tsx + rg em page.tsx → arquivo removido e zero referências a ChipDivulgacaoTab/chip/QR/UAZAPI na feature; use-uazapi.ts global permanece
  - rg -n 'canal_tipo.*Divulgação|eq\("canal_tipo", "Divulgação"\)' cuca-portal/src/app/(dashboard)/divulgacao/page.tsx cuca-portal/src/app/api/divulgacao/disparar/route.ts → zero ocorrências; ambos resolvem Institucional
  - MCP execute_sql no cuca-dev → confirmar que meta_phone_numbers mantém exatamente o cadastro Institucional ativo 1233832826470497 usado pela feature, sem novo cadastro Divulgação criado
  - MCP execute_sql no cuca-dev → confirmar institucional_programacao_mensal_v1 ativo/aprovado e vinculado ao phone_number_id 1233832826470497
  - inspeção da UI → botão só habilita com 5 unidades aprovadas + permissão divulgacao:create + número/template Meta válidos; usuário read-only não abre modal
  - inspeção do modal → preview read-only deriva do corpo real do template Meta; não existe textarea editável cujo conteúdo seja ignorado
  - ~~git diff -- worker/campanhas_engine.py → vazio; worker não deve ser alterado~~ **GATE REVOGADO por Junior em 2026-07-04** — bug real encontrado no próprio worker durante o smoke test (ver Task 6); a premissa de que o worker já estava correto se provou falsa. Diff aceito, escopo desta story ampliado explicitamente pelo Junior. Detalhes completos no Change Log da S-WM-16 (onde o bug nasceu) e no Dev Agent Record abaixo.
  - smoke test seguro no cuca-dev/staging → fila criada, worker processa via Graph API usando 1233832826470497 e institucional_programacao_mensal_v1; somente destinatários de teste previamente confirmados
  - pytest worker/tests/ → baseline mínimo 74 passed/3 skipped, sem regressão
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que a Central de Divulgação dispare avisos globais pela API oficial da Meta usando o número Institucional já cadastrado,
**para que** a equipe envie a programação mensal sem criar chip, instância ou QR Code UAZAPI e sem receber informações enganosas na interface.

## Contexto e Problema

Investigação read-only do `@dev`, confirmada por código e consulta ao cuca-dev, encontrou três camadas desalinhadas:

1. **Gestão de chip — UAZAPI legado e órfão.** `ChipDivulgacaoTab` consulta `instancias_uazapi`, cria/reconecta chip e exibe QR Code por meio de `useUazapi`. O hook chama endpoints `/api/instancias/*` que não existem mais no código versionado do worker. No cuca-dev não existe instância UAZAPI com `canal_tipo='Divulgação'`.
2. **Tela/API — Meta com canal incorreto.** A página e `POST /api/divulgacao/disparar` já consultam `meta_phone_numbers`, mas filtram `canal_tipo='Divulgação'`. Esse cadastro não existe. O número real está cadastrado como `canal_tipo='Institucional'`; por isso o botão fica bloqueado e a API retornaria 422 mesmo se chamada diretamente.
3. **Worker — já pronto para Meta.** `worker/campanhas_engine.py::processar_disparos_divulgacao` resolve o número por `canal_tipo='Institucional'`, busca o template por automação + `phone_number_id` e envia via Graph API v23.0. Não depende de chip, QR Code ou `instancias_uazapi`.

O botão e a API também aceitam uma mensagem livre, mas o worker não lê `disparos_divulgacao.mensagem_template` para compor o outbound: ele usa exclusivamente o template Meta aprovado e envia dois parâmetros (`nome` e `mês`). A edição atual é enganosa.

### Estado confirmado no cuca-dev

- Número Meta ativo: `1233832826470497`.
- `canal_tipo='Institucional'`, `agente_tipo='Institucional'`, `display_name='CUCA Institucional'`.
- Template `institucional_programacao_mensal_v1`: ativo, aprovado, `automacoes=['Institucional']` e vinculado ao mesmo `phone_number_id`.
- Zero registros Meta com `canal_tipo='Divulgação'`.
- Zero chips UAZAPI de Divulgação.
- Zero registros em `disparos_divulgacao` no momento da investigação.

## Modelo Confirmado por Junior

O disparo global de Divulgação usa o **mesmo número Institucional** `1233832826470497`. Não criar chip, instância, QR Code ou um segundo registro em `meta_phone_numbers`.

## Escopo

### IN

1. Remover da página `/divulgacao` o componente e todo o fluxo de chip/QR/UAZAPI.
2. Excluir `cuca-portal/src/components/instancias/chip-divulgacao-tab.tsx`, confirmado como exclusivo da página `/divulgacao`.
3. Preservar `cuca-portal/src/hooks/use-uazapi.ts` e os demais consumidores UAZAPI fora desta feature.
4. Remover estados e seções mortas: `instanciasInstitucionais` e “Conversas Recentes — Canal Divulgação” (`conversas` nunca é preenchido).
5. Fazer tela e API resolverem o número ativo `canal_tipo='Institucional'`, sem hardcode operacional do ID e sem criar novo cadastro.
6. Mostrar na UI: **“Número Meta Institucional — CUCA Institucional”**, identificando o `phone_number_id` que será usado.
7. Incluir `podeCriar`/`divulgacao:create` no guard visual do botão, preservando o guard server-side existente.
8. Substituir a edição livre por preview read-only derivado do `corpo_texto` do template Meta que corresponde exatamente ao lookup do worker (`automacoes=['Institucional']`, contém o `phone_number_id`, ativo e aprovado).
9. A API deve persistir em `mensagem_template` um snapshot coerente do template real exibido, não confiar em texto arbitrário enviado pelo cliente.
10. Corrigir textos de erro e labels que ainda pedem chip, instância ou número Divulgação.
11. Implementar as decisões PO registradas abaixo, sem reabrir schema ou fonte de link durante o desenvolvimento.

### OUT

- Alterar `worker/campanhas_engine.py` ou a lógica da Graph API — o worker já está pronto e é protegido por gate de diff vazio.
- Criar outro registro em `meta_phone_numbers` para Divulgação.
- Excluir ou refatorar globalmente `use-uazapi.ts`, `canal-whatsapp-tab.tsx`, Configurações/WhatsApp ou Developer/Instâncias.
- Alterar o template aprovado na Meta ou criar novo template.
- Alterar o schema de `disparos_divulgacao` nesta story; eventual rename da coluna legada deve ser uma story expand/contract separada.
- Disparar para contatos reais em produção.
- Criar ou aplicar migration/schema change nesta story; produção permanece fora do escopo.

## Decisões PO — aprovadas para implementação

### DG1 — `disparos_divulgacao.instancia_uazapi`

**Decisão:** manter `instancia_uazapi` sem migration nesta story. A API continua gravando nela o `phone_number_id` Institucional resolvido no momento do enqueue, com comentário explícito de que o campo é um snapshot legado de auditoria, não a fonte usada pelo worker para escolher o remetente. Rename/contract fica para story futura.

O worker resolve novamente o número Institucional e não usa essa coluna para escolher o remetente. O snapshot deve corresponder ao número ativo no enqueue; qualquer divergência posterior por troca de configuração é histórica, não autorização para alterar o worker nesta story.

### DG2 — fonte legítima do link `wa.me`

**Decisão:** remover da aplicação o link `wa.me` e o fallback `NEXT_PUBLIC_CUCA_WHATSAPP` desta feature. O corpo aprovado de `institucional_programacao_mensal_v1` não contém link; termina com “Em caso de dúvidas, responda por este canal.” O preview deve reproduzir esse corpo real, sem conteúdo adicional.

`phone_number_id` Meta não é telefone público: não criar número fictício, não inferir telefone a partir do ID e não ampliar `meta_phone_numbers` nesta story.

## Critérios de Aceite

1. **Given** as cinco unidades têm programação aprovada, o usuário possui `divulgacao:create` e o número/template Institucional estão ativos, **when** `/divulgacao` carrega, **then** “Disparar Aviso Global” fica habilitado sem consultar ou exigir chip UAZAPI.
2. **Given** um usuário possui somente `divulgacao:read`, **when** acessa `/divulgacao`, **then** não consegue abrir o modal nem iniciar o POST; a API mantém retorno 403 caso seja chamada diretamente.
3. **Given** a página `/divulgacao`, **when** inspecionada, **then** não exibe criação de chip, QR Code, reconexão, troca de chip ou qualquer instrução UAZAPI.
4. **Given** o código da feature, **when** inspecionado, **then** `ChipDivulgacaoTab` e seu arquivo foram removidos, `use-uazapi.ts` global permanece e seus outros consumidores não foram alterados por esta remoção.
5. **Given** a tela e `POST /api/divulgacao/disparar`, **when** resolvem o remetente, **then** usam o único `meta_phone_numbers` ativo com `canal_tipo='Institucional'` e não criam registro `canal_tipo='Divulgação'`.
6. **Given** o modal de disparo, **when** aberto, **then** mostra “Número Meta Institucional — CUCA Institucional” e identifica corretamente `1233832826470497` como `phone_number_id`, sem apresentá-lo como telefone público.
7. **Given** o template `institucional_programacao_mensal_v1`, **when** o modal é exibido, **then** a mensagem é preview read-only do `corpo_texto` real e deixa claros os dois parâmetros efetivos (`nome` e `mês`); não existe edição livre ignorada pelo worker.
8. **Given** o usuário confirma o disparo, **when** a API cria a fila, **then** `disparos_divulgacao` recebe status `pendente`, snapshot coerente do template e `instancia_uazapi='1233832826470497'` como snapshot legado do número resolvido no enqueue; duplicata pendente/em andamento para o mesmo mês continua retornando 409.
9. **Given** um smoke test controlado no cuca-dev/staging, **when** o worker processa a fila, **then** envia pela Graph API usando `phone_number_id=1233832826470497` e template `institucional_programacao_mensal_v1`, atualizando métricas sem qualquer acesso a chip/QR/UAZAPI.
10. **Given** o escopo protegido, **when** o diff final é revisado, **then** `worker/campanhas_engine.py` está inalterado e não existe novo cadastro Meta de Divulgação.
11. **Given** o preview do template mensal, **when** exibido, **then** não contém `wa.me`, não usa `NEXT_PUBLIC_CUCA_WHATSAPP` e reproduz o texto aprovado “Em caso de dúvidas, responda por este canal.”
12. **Given** a suíte de regressão e os quality gates, **when** executados, **then** pytest mantém pelo menos o baseline de 74 passed/3 skipped, lint/typecheck/build passam e CodeRabbit não reporta CRITICAL; a ausência atual de script `npm test` no portal é registrada, sem criação de framework de testes fora do escopo.

## 🤖 CodeRabbit Integration

**Story Type Analysis:** Full-stack/Integration, com remoção de frontend legado e ajuste de API, sem mudança de schema ou worker. Complexidade **M**.

**Primary Agents:**
- `@dev` — implementação e pre-commit.
- `@qa` — validação independente de UI, API, cuca-dev e smoke test seguro.

**Supporting Agents:**
- `@po` — decisões DG1/DG2 já registradas e aprovadas nesta story.
- `@devops` — pre-PR/deploy, sem acesso ou promoção automática à produção.

**Quality Gate Tasks:**
- [ ] Pre-Commit (`@dev`): revisar remoção do fluxo UAZAPI, autorização UI/API, contrato do preview e ausência de mudança no worker.
- [ ] Pre-PR (`@devops`): executar gates completos e conferir que nenhum segredo/telefone real foi versionado indevidamente.
- [ ] Pre-Deployment (`@devops` + Junior): smoke somente em staging/cuca-dev com destinatários de teste; produção exige aprovação humana explícita.

**Self-Healing:** modo light do `@dev`, máximo 2 iterações/15 minutos, correção automática apenas para CRITICAL e documentação de HIGH.

**Focus Areas:**
- Autorização consistente entre UI e API.
- Nenhuma dependência de `instancias_uazapi` dentro da feature Divulgação.
- Mesmo critério relacional de número/template na UI, API e worker.
- Preview fiel ao template realmente enviado.
- Semântica explícita do snapshot legado em `instancia_uazapi`, sem migration nesta story.
- Segurança operacional do smoke test para impedir disparo a contatos reais.

## Tasks / Subtasks

- [x] **Task 0 — Resolver gates PO antes de editar código** (AC: 8, 11)
  - [x] DG1: manter `instancia_uazapi` como snapshot legado do `phone_number_id`; sem migration/rename nesta story.
  - [x] DG2: remover `wa.me`/`NEXT_PUBLIC_CUCA_WHATSAPP`; preview reproduz somente o template aprovado.
  - [x] Estimativa PO mantida em M; `@dev` registra eventual reestimativa sem alterar escopo.
- [x] **Task 1 — Remover fluxo UAZAPI da Central de Divulgação** (AC: 3, 4, 10)
  - [x] Remover import/render de `ChipDivulgacaoTab` em `/divulgacao`.
  - [x] Excluir `chip-divulgacao-tab.tsx`.
  - [x] Remover textos, ícones, modais e ações de chip/QR/reconexão da feature.
  - [x] Preservar `use-uazapi.ts` e demais consumidores globais.
- [x] **Task 2 — Limpar estados e UI morta** (AC: 3, 6)
  - [x] Remover `instanciasInstitucionais`, `conversas` e a seção “Conversas Recentes — Canal Divulgação”.
  - [x] Substituir labels “chip/instância Divulgação” por identificação correta do número Meta Institucional.
  - [x] Corrigir mensagens de erro e tooltips obsoletos.
- [x] **Task 3 — Alinhar número, permissão e preview na tela** (AC: 1, 2, 5, 6, 7, 11)
  - [x] Buscar `meta_phone_numbers` ativo com `canal_tipo='Institucional'`.
  - [x] Buscar o template aprovado pelo mesmo critério relacional usado no worker.
  - [x] Mostrar display name e `phone_number_id` com semântica correta.
  - [x] Incluir `divulgacao:create` no guard visual do botão/modal.
  - [x] Trocar textarea livre por preview read-only do `corpo_texto`, sem `wa.me` ou fallback de telefone.
- [x] **Task 4 — Corrigir contrato da API e auditoria do disparo** (AC: 2, 5, 8, 10)
  - [x] Trocar filtro da API de Divulgação para Institucional e corrigir erro 422.
  - [x] Resolver o template no servidor e persistir snapshot real; não confiar em mensagem arbitrária do cliente.
  - [x] Documentar `instancia_uazapi` como snapshot legado do `phone_number_id` resolvido no enqueue; sem schema change.
  - [x] Preservar autenticação, RBAC server-side e bloqueio 409 de duplicata mensal.
- [ ] **Task 5 — Testes automatizados e regressão** (AC: 1–12)
  - [x] Adicionar cobertura para a API: 401, 403, 409, 422, sucesso com canal Institucional e snapshot real.
  - [ ] Adicionar cobertura possível para o guard visual e preview, seguindo a infraestrutura existente; se não houver harness frontend, documentar e executar smoke manual.
  - [x] Executar `pytest worker/tests/` e confirmar que `campanhas_engine.py` não foi alterado.
  - [x] Executar `npm run lint`, `npx tsc --noEmit` e `npm run build`; registrar que o portal não possui script `npm test` sem adicionar harness fora do escopo.
- [ ] **Task 6 — Smoke test seguro no cuca-dev/staging** (AC: 5, 8, 9, 10)
  - [x] Antes do disparo, confirmar com Junior/QA que todos os destinatários elegíveis são números de teste; HALT se houver risco de envio real. Confirmado por Junior em 2026-07-04: `select telefone from leads where opt_in=true and bloqueado=false` retorna exatamente 1 registro (o número dele, `558591733321`); demais leads fake estão com `bloqueado=true`.
  - [x] Confirmar via SQL que não há novo `meta_phone_numbers.canal_tipo='Divulgação'`.
  - [x] Criar uma fila controlada e confirmar logs Graph API, número/template usados e métricas finais. **Causa raiz encontrada e corrigida.** 1ª tentativa (`fcdaa6c5-0b55-45d3-8575-a886e56e16bf`, 14:57:54 UTC): worker pegou em ~18s, travou em `em_andamento` 25+min sem enviar/errar. 2ª tentativa (`4501615d-1ff2-4eec-8557-0ba428474734`, 16:32:51 UTC) reproduziu o mesmo travamento. Junior abriu o log Live do `cuca-worker-staging` no exato momento e capturou o erro real: `.eq("automacoes", ["Institucional"])` em `worker/campanhas_engine.py:461` gera `automacoes=eq.['Institucional']` — sintaxe de lista Python, não array Postgres — o Postgrest rejeita com 400 (`malformed array literal`), e o `.maybe_single()` do postgrest-py levanta exceção não tratada (`Missing response`), travando a linha para sempre em `em_andamento` (a query só relê `status='pendente'`). Reproduzido via SQL puro (`automacoes = 'Institucional'::text[]` → mesmo erro). Investigação ampliada (autorizada por Junior) encontrou o mesmo padrão em mais 3 pontos — ver Change Log da S-WM-16 (origem do bug) para a lista completa e a correção aplicada nos 4 pontos. As 2 filas de teste travadas foram marcadas manualmente como `erro` (limpeza, sem risco — nenhum envio real ocorreu em nenhuma das duas). Após o redeploy do fix de array, a 3ª fila (`17b25ba5-5d33-4d65-8a1d-5b3bc2fb50d9`, 18:26:47 UTC — criada antes do fix de parameter_name abaixo estar deployado) confirmou que a query e o template já resolvem corretamente e a Graph API foi chamada de verdade, mas retornou **2º bug**: HTTP 400 `(#100) Parameter name is missing or empty` — o template `institucional_programacao_mensal_v1` é NAMED na Meta (`{{nome}}`, `{{mes}}`), e o código enviava `parameters` sem `parameter_name`. Corrigido com `_montar_parametros_named()` (deriva de `meta_templates.variaveis`, sem hardcode) — ver Change Log da S-WM-16 para detalhes completos, incluindo achado de escopo mais amplo (mesmo padrão em 2 outros pontos, 1 deles ativo em produção — `_notificar_transbordo`, pendente de confirmação do Junior antes de corrigir). Essa 3ª fila terminou como `concluido`/`total_erros=1` (não travou — confirma que o tratamento de erro gracioso da correção anterior funciona em produção). **Pendente:** novo redeploy com o fix de `parameter_name` + 4ª fila de smoke test para confirmar envio real bem-sucedido.
  - [ ] Executar CodeRabbit e atualizar Dev Agent Record/File List antes de Ready for Review.

## Dependências

- S-WM-16 — lookup relacional de templates Meta por automação + `phone_number_id`; confirmou e cadastrou `institucional_programacao_mensal_v1`.
- S-WM-17 — número Institucional e motor-agente validados no cuca-dev; sem dependência técnica direta no disparo, mas mesma frente de estabilização Meta.
- SQS-44 — regra existente: disparo global só é liberado quando as cinco unidades estão aprovadas.
- `.claude/rules/cuca-deploy-environments.md` — desenvolvimento/QA apenas em cuca-dev/staging; produção proibida aos agentes.
- Decisões DG1 e DG2 já aprovadas e incorporadas nesta story.

## Riscos

- **Disparo global involuntário:** o worker seleciona todos os leads `opt_in=true` e não possui filtro de destinatário de teste neste fluxo. Smoke E2E só pode ocorrer após confirmação explícita de dataset/credenciais seguras.
- **UI/API/worker divergirem novamente:** os três pontos devem usar a mesma semântica Institucional; testes devem impedir regressão para `canal_tipo='Divulgação'`.
- **Preview mentir sobre o outbound:** o worker usa template Meta aprovado e apenas dois parâmetros; qualquer texto livre no cliente cria falsa expectativa.
- **Confundir `phone_number_id` com telefone:** prevenido pela remoção de `wa.me` e do fallback de telefone nesta story.
- **Dívida de nomenclatura:** `instancia_uazapi` permanece legado por decisão PO; rename deve ocorrer depois via expand/contract, nunca drop/rename direto.
- **Remover UAZAPI fora do escopo:** `use-uazapi.ts` continua necessário em outras telas; somente o componente exclusivo de Divulgação deve ser excluído.

## Estimativa

**M** — remoção de UI legada + alinhamento frontend/API + autorização + preview real. Sem migration e com worker fora do diff.

## Dev Notes

### Fluxo atual da página

`cuca-portal/src/app/(dashboard)/divulgacao/page.tsx`:
- Linhas 147–156: busca incorreta por `canal_tipo='Divulgação'`.
- Linhas 158–164: estados mortos e fallback de telefone público sem fonte garantida.
- Linhas 183–220: monta/edita texto livre enviado à API, embora o worker o ignore.
- Linha 238: habilitação depende de `instanciaDisp`, mas não inclui `podeCriar`.
- Linha 312: renderiza `ChipDivulgacaoTab`.
- Linhas 402–464: seção de conversas nunca populada.
- Linhas 466–515: modal descreve “chip” e permite edição enganosa.

### Fluxo UAZAPI a remover somente desta feature

`cuca-portal/src/components/instancias/chip-divulgacao-tab.tsx`:
- Único consumidor é `/divulgacao`.
- Consulta `instancias_uazapi` com `canal_tipo='Divulgação'`.
- Usa `useUazapi` para criar, consultar status, gerar QR e logout.

`cuca-portal/src/hooks/use-uazapi.ts`:
- Ainda é usado por `canal-whatsapp-tab.tsx`, Configurações/WhatsApp e Developer/Instâncias; **não excluir nem refatorar globalmente nesta story**.
- Os endpoints UAZAPI chamados pelo hook não existem no worker versionado, mas corrigir os demais consumidores é outra frente.

### API atual

`cuca-portal/src/app/api/divulgacao/disparar/route.ts`:
- Linhas 10–29: autenticação e RBAC server-side existentes — preservar.
- Linhas 38–50: bloqueio de duplicata pendente/em andamento — preservar.
- Linhas 53–65: filtro incorreto `canal_tipo='Divulgação'` e mensagem de cadastro obsoleta.
- Linhas 73–86: grava `phone_number_id` na coluna legada `instancia_uazapi` e aceita `mensagem_template` arbitrária.

### Worker protegido — não alterar

`worker/campanhas_engine.py:416-520`:
- Busca fila pendente a cada ciclo.
- Linha 448: resolve `canal_tipo='Institucional'`.
- Linhas 459–465: busca template por `automacoes=['Institucional']` + `phone_number_id` + ativo/aprovado.
- Linhas 496–505: envia template Meta com parâmetros `nome` e `mês` via Graph API.
- Não lê `mensagem_template` para gerar o outbound e não usa chip/QR/UAZAPI.

### Data model relevante

`disparos_divulgacao` contém hoje: `id`, `mes`, `ano`, `titulo`, `mensagem_template`, `instancia_uazapi`, status/métricas, autor e timestamps. A coluna `instancia_uazapi` não tem FK e o worker não a usa para resolver o número.

### Project Structure Notes

Os arquivos arquiteturais configurados em `docs/framework/` e seus fallbacks portugueses não existem no workspace. Esta story usa os padrões diretamente verificados nos arquivos acima e nas regras `.aiox-core/constitution.md` + `.claude/rules/cuca-deploy-environments.md`.

### Testing

- Worker: `.venv/bin/python -m pytest worker/tests/` — baseline atual 74 passed/3 skipped.
- Portal: executar lint/typecheck/build; o `package.json` do portal não possui hoje scripts `test`/`typecheck`, portanto usar `npx tsc --noEmit` como typecheck e documentar ausência de `npm test`, sem criar harness fora do escopo.
- API: criar testes se existir infraestrutura compatível; cobrir autorização, duplicata e resolução relacional Institucional/template.
- UI: smoke manual deve confirmar guard de permissão, ausência de UAZAPI e preview read-only.
- Banco: usar somente MCP `.mcp.dev.json` para verificação read-only. DG1 exclui DDL/migration desta story.
- E2E outbound: somente com WABA/destinatários de teste confirmados. Nunca acessar produção.

## Dev Agent Record

### Agent Model Used
GPT-5 Codex (Dex, @dev)

### Debug Log References
- `node --experimental-strip-types tests/divulgacao-disparar-logic.test.ts` — 6 passed.
- `npm run lint` — passou sem erros.
- `npx tsc --noEmit` — passou sem erros.
- `.venv/bin/python -m pytest worker/tests/` — 74 passed, 3 skipped, 1 warning depreciação preexistente.
- `npm run build -- --webpack` em cópia temporária idêntica — 108/108 páginas geradas; execução exigiu rede para Google Fonts e placeholders de build para variáveis Supabase ausentes no shell.
- MCP Supabase `execute_sql` no cuca-dev — 1 Institucional ativo esperado, 0 Divulgação ativos e template relacional aprovado confirmado.
- `git diff -- worker/campanhas_engine.py` — vazio.
- CodeRabbit CLI/configuração local — indisponível no workspace; revisão manual sem achado CRITICAL.

### Completion Notes List
- Fluxo UAZAPI/QR removido somente da Central de Divulgação; hook e consumidores globais preservados.
- UI agora identifica o número Meta Institucional, bloqueia read-only e exibe preview somente leitura do template real.
- GET/POST da API aplicam RBAC e resolvem configuração no servidor; POST ignora texto arbitrário do cliente e persiste snapshot real.
- Regras puras da API extraídas e cobertas sem adicionar framework de testes; o portal continua sem script `npm test`.
- Banco cuca-dev validado sem DDL, migration ou novo cadastro Meta.
- Pendente: smoke visual autenticado.
- Smoke outbound (Task 6): destinatário único confirmado por Junior (`558591733321`, único `opt_in=true AND bloqueado=false`); fila de teste criada e o worker de staging confirmou estar vivo/conectado ao cuca-dev (pickup em 18s), mas o processamento travou em `em_andamento` sem concluir — achado a investigar antes de fechar a story (ver Task 6 e Change Log).

### File List
- `cuca-portal/src/app/(dashboard)/divulgacao/page.tsx` — modificado.
- `cuca-portal/src/app/api/divulgacao/disparar/route.ts` — modificado.
- `cuca-portal/src/app/api/divulgacao/disparar/logic.ts` — adicionado.
- `cuca-portal/tests/divulgacao-disparar-logic.test.ts` — adicionado.
- `cuca-portal/src/components/instancias/chip-divulgacao-tab.tsx` — removido.
- `worker/campanhas_engine.py` — modificado (fora do escopo original, gate revogado por Junior): corrige bug de sintaxe de array Postgres no lookup relacional de templates + adiciona tratamento de erro gracioso.
- `cuca-portal/src/app/api/empregabilidade/vagas/feedback-submit/route.ts` — modificado: mesmo bug de array Postgres, fora da feature Divulgação mas corrigido junto por ser o mesmo padrão.
- `docs/stories/S-WM-16-CRUD-Seguro-Numeros-Templates-Meta.md` — atualizado (Change Log com a causa raiz e correção, é onde o bug nasceu).
- `docs/stories/S-WM-18-Migrar-Central-Divulgacao-UAZAPI-Meta.md` — atualizado.

## QA Results

**Executor:** @qa (Quinn) — 2026-07-04
**Verdict:** **CONCERNS** (aprovado para @devops prosseguir com o push; 2 achados documentados abaixo não bloqueiam, mas precisam de acompanhamento)

### Verificação independente

1. `test ! -e chip-divulgacao-tab.tsx` → arquivo removido. `rg -ni "ChipDivulgacaoTab|QR Code|UAZAPI"` na feature → zero ocorrências reais (só o nome legado da coluna `instancia_uazapi`, decisão DG1 do @po). PASS (AC3, AC4).
2. `rg -n 'canal_tipo.*Divulgação|eq\("canal_tipo", "Divulgação"\)'` em page.tsx/route.ts → zero ocorrências. PASS (AC5).
3. SQL no cuca-dev: `meta_phone_numbers` só tem `1233832826470497` (Institucional) ativo, zero cadastro `Divulgação`. `institucional_programacao_mensal_v1` ativo/aprovado, vinculado ao mesmo `phone_number_id`. PASS (AC5, AC10).
4. Leitura de `page.tsx`: `podeDisparar` exige `podeCriar && 5 unidades aprovadas && numeroMeta && templateMeta`; botão desabilitado cobre também o caso read-only (`abrirModal` teria bloqueado de qualquer forma). PASS (AC1, AC2).
5. Modal: preview é `div role="textbox" aria-readonly="true"` renderizando `templateMeta.corpo_texto` — sem textarea editável, parâmetros `{{1}} nome`/`{{2}} mês` explicitados. PASS (AC6, AC7).
6. `logic.ts`: `montarRegistroDisparo` grava `mensagem_template` do `corpoTemplate` resolvido no servidor (não de input do cliente — POST só aceita `mes/ano/titulo` do body) e `instancia_uazapi` como snapshot do `phone_number_id`. `mensagemDuplicata` bloqueia pendente/em_andamento do mesmo mês. PASS (AC8).
7. `node tests/divulgacao-disparar-logic.test.ts` → **6/6 passed** (401, 403, 409, 422, RBAC, snapshot). Rodei eu mesmo, não só confiei no relato do @dev.
8. `grep "wa.me\|NEXT_PUBLIC_CUCA_WHATSAPP"` → zero ocorrências. SQL confirma que o `corpo_texto` real termina em "Em caso de dúvidas, responda por este canal." — o preview reproduz esse texto real, sem link. PASS (AC11).
9. `pytest worker/tests/` → 74 passed, 3 skipped, confirmado independentemente. PASS.
10. Bug de array Postgres (item separado, mas parte do mesmo push): verifiquei os 4 pontos corrigidos por grep, testei a query corrigida via SQL direto (`automacoes = '{"Institucional"}'::text[]` → casa corretamente), reproduzi o `automacao_tag` como sempre vindo de literal hardcoded no código (sem risco de injeção na concatenação de string). PASS.

### Achados

**1. AC9 (smoke test com envio real via worker) — NÃO fechado, por dependência circular do processo.** O bug que causava o travamento só pode ser validado ao vivo *depois* deste push + redeploy do `cuca-worker-staging`. Aprovar este push é o que **habilita** a validação final de AC9, não uma forma de pular essa validação — mas ela continua pendente até uma 3ª fila de smoke test confirmar envio real pós-redeploy. Recomendo manter `Status: In Progress` até essa confirmação, mesmo após o push.

**2. Achado de segurança (CONCERNS, pré-existente — não introduzido por este diff, mas relevante à AC2):** confirmei via `pg_policies` no cuca-dev que `disparos_divulgacao` tem RLS `INSERT` com `WITH CHECK = true` e `UPDATE` com `USING = true` para qualquer usuário autenticado — sem checagem de permissão `divulgacao:create` no banco. Isso significa que um usuário autenticado (mesmo sem essa permissão) pode inserir/atualizar linhas diretamente via client Supabase no navegador, contornando o RBAC da API Next.js (`avaliarAcesso` em `route.ts`), que só protege a rota `/api/divulgacao/disparar`. A AC2 afirma que a API mantém 403 "caso chamada diretamente", mas não cobre esse caminho de bypass via client direto. Recomendo abrir story/ticket separado para restringir a RLS (idealmente usando `has_permission()`, mecanismo canônico do projeto, em vez de `true`).

### Itens não verificados nesta rodada (ambiente)

- `npm run lint`: ESLint estourou memória neste sandbox (`JavaScript heap out of memory`) — limitação de ambiente, não achado de código.
- `npm run build`: não re-executado (já documentado pelo @dev como inconclusivo por rede/timeout nesta sessão anterior).
- CodeRabbit: indisponível neste ambiente.
- Cobertura de teste do guard visual/preview (Task 5): não bloqueante, story já registra que não há harness frontend no projeto.

### Conclusão

Os ACs 1-8, 10 e 11 estão cumpridos com evidência verificada de forma independente. AC9 depende do próprio push para ser validado (não é uma lacuna de qualidade, é uma dependência de sequência). Aprovado para `@devops` prosseguir com o commit + push, condicionado a: (a) uma 3ª fila de smoke test pós-redeploy confirmar AC9 antes de fechar a story como Done, e (b) o achado de RLS ser registrado como débito de segurança a corrigir separadamente.

## Change Log
| Data | Agente | Ação |
|---|---|---|
| 2026-07-04 | @sm (River) | Story criada a partir da investigação read-only do @dev e do modelo confirmado por Junior: remover chip/QR UAZAPI da Central de Divulgação, reutilizar o número Meta Institucional e alinhar tela/API ao worker já migrado. |
| 2026-07-04 | @po (Pax) | Validação GO: DG1 definido como compatibilidade sem migration; DG2 definido como remoção de wa.me/fallback; gates/testes ajustados ao projeto; story promovida de Draft para Approved. |
| 2026-07-04 | @dev (Dex) | Implementação frontend/API concluída, fluxo UAZAPI removido, testes e gates locais aprovados; story mantida In Progress aguardando smoke visual/outbound seguro e CodeRabbit externo. |
| 2026-07-04 | @dev (Dex) | Task 6 iniciada mediante autorização de Junior (único lead elegível `opt_in=true AND bloqueado=false` confirmado como o próprio número dele). Fila de smoke test criada no cuca-dev; worker de staging confirmado vivo (pickup em 18s), porém o processamento travou em `status='em_andamento'` por 25+min sem concluir nem dar erro visível — achado reportado, HALT aguardando confirmação de recebimento da mensagem por Junior e/ou logs do cuca-worker-staging no EasyPanel. |
| 2026-07-04 | @dev (Dex) | Causa raiz do travamento confirmada ao vivo por log Live do EasyPanel colado por Junior: `.eq("automacoes", [tag])` em `worker/campanhas_engine.py` gera sintaxe de lista Python em vez de array Postgres, Postgrest rejeita com 400, `.maybe_single()` levanta exceção não tratada, fila trava para sempre em `em_andamento`. **Gate "worker inalterado" desta story revogado por Junior** — bug real, não hipótese; premissa original do gate (worker já correto) se provou falsa. Corrigido nos 4 pontos com o mesmo padrão (2 no worker, 2 no portal, incluindo `divulgacao/disparar/route.ts` desta própria story) — detalhe completo documentado no Change Log da S-WM-16 (onde o bug nasceu, na migração para lookup relacional). Adicionado tratamento de erro gracioso (exceção não tratada agora marca `pausada`/`erro`, nunca mais trava silenciosamente). `pytest worker/tests/` 74/3 sem regressão. As 2 filas de teste travadas (`fcdaa6c5...`, `4501615d...`) marcadas como `erro` — nenhum envio real ocorreu. Pendente: redeploy do worker/portal em staging para validar o fix com uma 3ª fila de smoke test. |
| 2026-07-04 | @qa (Quinn) | Quality gate executado com verificação independente (ACs 1-8, 10, 11 confirmados por grep/SQL/testes próprios, não reaproveitando relatos do @dev sem checar). Veredito **CONCERNS**: aprovado para @devops prosseguir. 2 achados registrados: (1) AC9 só pode ser validado *depois* deste push + redeploy — dependência de sequência, não lacuna de qualidade; story deve continuar sem fechar como Done até uma 3ª fila de smoke test confirmar envio real pós-deploy; (2) achado de segurança novo (pré-existente, não introduzido por este diff): RLS de `disparos_divulgacao` permite INSERT/UPDATE irrestrito para qualquer usuário autenticado (`WITH CHECK`/`USING = true`), contornando o RBAC da API — recomendado ticket separado para restringir via `has_permission()`. Status → InReview. |
