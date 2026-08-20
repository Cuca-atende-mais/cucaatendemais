# S-AE-03 — Painel de Atendimento Academia Enem

## Status
Done

## ⚠️ Story reaberta e reescrita em 2026-08-20 — mudança de arquitetura
Implementação anterior (Ready for Review, commit `7539e9a`) foi construída sobre as tabelas próprias `ae_conversas`/`ae_mensagens` e o provider AuctaFlux. Essa arquitetura foi abandonada (decisão do Junior, 2026-08-20): o painel passa a operar sobre as tabelas **compartilhadas** `conversas`/`mensagens` (as mesmas de Institucional/Empregabilidade), filtradas por canal — só a conexão com a Meta (credenciais/webhook) é isolada no serviço `cuca-academia-enem` (S-AE-02). Dev Agent Record e QA Results anteriores (abaixo) descrevem a implementação **obsoleta** — mantidos como histórico, não como estado atual.

## Story
**Como** atendente do módulo Academia Enem,
**quero** visualizar e responder as conversas do número da Academia Enem em tempo real,
**para que** eu acompanhe e atenda os leads, igual ao atendimento da Empregabilidade — reaproveitando o mesmo painel de chat.

## Contexto
Reaproveita **diretamente** os componentes de chat já existentes e validados (`components/chat/chat-sidebar.tsx`, `chat-window.tsx`, os mesmos usados por Institucional/Empregabilidade), filtrando as conversas por `agente_tipo='academia_enem'` (ou pelo `phone_number_id` cadastrado em S-AE-02). Os arquivos `ae-chat-sidebar.tsx`/`ae-chat-window.tsx` da implementação anterior viram código morto, a apagar.

## Escopo
### IN
- Rota `/academia-enem/mensagens` protegida por `atendimentos_academia_enem:read`.
- Lista de conversas e chat realtime usando `conversas`/`mensagens` (tabelas compartilhadas), filtradas pelo canal da Academia Enem.
- Envio manual via `meta_adapter_outbound` (mesmo mecanismo já usado por Institucional/Empregabilidade) — **não** mais `auctaflux.enviarTexto`.
- Indicador de janela de 24h (mesma regra Meta que os outros canais já respeitam) e bloqueio de texto livre fora da janela.
- Indicação visual de `awaiting_human` (transbordo, S-AE-06) silenciando a IA.

### OUT
- Automação/IA de resposta (S-AE-04/S-AE-10), transbordo em si (S-AE-06), envio de template/disparo (S-AE-09).

## Critérios de Aceite (Given/When/Then)
1. **Given** atendente com `atendimentos_academia_enem:read`, **when** abre o painel, **then** vê só as conversas do canal Academia Enem, em tempo real.
2. **Given** uma nova mensagem do lead, **when** chega pelo webhook do serviço `cuca-academia-enem`, **then** aparece no painel sem refresh manual.
3. **Given** a janela de 24h aberta, **when** o atendente envia texto, **then** a mensagem sai via `meta_adapter_outbound` e é gravada em `mensagens` (tabela compartilhada), sem misturar com conversas de outros canais na listagem.
4. **Given** a janela de 24h fechada, **when** o atendente tenta texto livre, **then** o envio é bloqueado com aviso de usar template.
5. **Given** conversa em `awaiting_human`, **then** a IA fica silenciada e o atendente assume.
6. **Given** um usuário sem permissão em `atendimentos_academia_enem`, **then** a rota/menu fica bloqueada (403 server-side, item invisível no menu).

## Dev Notes — análise de impacto (item por item)
1. **Toca:** troca da fonte de dados do painel, de `ae_conversas`/`ae_mensagens` para `conversas`/`mensagens` (compartilhadas); reuso de `components/chat/chat-sidebar.tsx`/`chat-window.tsx` já usados por Institucional/Empregabilidade.
   **Depende disso hoje:** os componentes compartilhados já são consumidos pelas telas de Institucional/Empregabilidade/Ouvidoria/Acesso Cuca.
   **Impacto real:** o painel da Academia Enem passa a ser **mais um consumidor** desses componentes, filtrando por canal — não altera o componente para os módulos existentes (o filtro de canal é um parâmetro, não uma mudança de comportamento default). Nenhuma regressão esperada nos outros módulos, desde que o filtro por canal seja aditivo (nunca removendo o filtro que já existe para os demais).
   **De-risk:** conferir, antes de implementar, como o filtro de canal é feito hoje nos componentes compartilhados (por `agente_tipo`? por rota?) — reaproveitar o mesmo padrão, não inventar um novo mecanismo de filtro.
2. **Toca:** apagar `ae-chat-sidebar.tsx`/`ae-chat-window.tsx` (código morto pós-migração).
   **Depende disso hoje:** nada — são arquivos exclusivos da rota `/academia-enem/mensagens`, sem outro consumidor.
   **Impacto real:** nenhum fora da própria rota.

## Tasks
- [x] Rota/página de atendimento do módulo (lista + chat realtime), reaproveitando `components/chat/*`, filtrada por canal Academia Enem.
- [x] Envio manual via `meta_adapter_outbound` — **achado bloqueante resolvido** (ver Completion Notes): a rota de envio compartilhada mandava tudo pro `cuca-worker` padrão; corrigido pra rotear pro serviço da Academia Enem quando `agente_tipo='academia_enem'`.
- [x] **Indicador/bloqueio de janela de 24h — DESISTÊNCIA (decisão do Junior, 2026-08-20).** Não existe regra de janela de 24h reaproveitável nos canais Meta diretos hoje; implementar seria inventar escopo novo. Junior decidiu: não se aplica mais, não será construído (nem agora, nem como débito futuro). AC3/AC4 considerados encerrados sem implementação — não é lacuna pendente.
- [x] Respeitar `awaiting_human` — já vem de graça do `ChatWindow` compartilhado (mesma lógica usada por Institucional/Empregabilidade).
- [x] Apagar `ae-chat-sidebar.tsx`/`ae-chat-window.tsx` e qualquer referência a `ae_conversas`/`ae_mensagens` nesta rota.

## Dependências
Depende de **S-AE-00** (fundação/menu) e **S-AE-02** (serviço/número Meta da Academia Enem). Relaciona-se com **S-AE-06** (transbordo).

## Quality Gate
- Tipo: front realtime. Agentes: @qa. CodeRabbit: foco em cleanup de subscriptions realtime, regra de janela de 24h, e confirmação de que o filtro por canal não afeta os outros módulos que usam os mesmos componentes.

## File List
**Novos:**
- `cuca-portal/src/app/(dashboard)/academia-enem/mensagens/page.tsx` — substitui integralmente a página anterior; espelha `empregabilidade/mensagens/page.tsx`, usando `ChatSidebar`/`ChatWindow` compartilhados com `filterCanalTipo="academia_enem"` e `moduloAtendimento="atendimentos_academia_enem"`.

**Modificados:**
- `cuca-portal/src/app/api/chat/send-message/route.ts` — resolve o worker de destino (`cuca-worker` padrão vs. `WORKER_URL_ACADEMIA_ENEM`) a partir de `conversas.agente_tipo`, em vez de sempre mandar pro worker padrão. Achado bloqueante corrigido (ver Completion Notes) — **código compartilhado**, análise de impacto abaixo.

**Removidos:**
- `cuca-portal/src/app/(dashboard)/academia-enem/mensagens/_components/ae-chat-sidebar.tsx`
- `cuca-portal/src/app/(dashboard)/academia-enem/mensagens/_components/ae-chat-window.tsx`

## Dev Agent Record (implementação atual — arquitetura Meta direta)

### Agent Model Used
Dex (@dev) — claude-sonnet-5

### Completion Notes
- **De-risk do filtro de canal (Task/AC obrigatório antes de implementar):** li `components/chat/chat-sidebar.tsx` e o consumidor real `empregabilidade/mensagens/page.tsx`. O padrão já existente é a prop `filterCanalTipo` — resolve `phone_number_id`s ativos em `meta_phone_numbers` pelo `canal_tipo` informado, depois filtra `conversas.origem_id IN (...)`. Usei exatamente esse padrão com `filterCanalTipo="academia_enem"` (mesmo `canal_tipo` já cadastrado na migration placeholder da S-AE-02) — não inventei nenhum mecanismo novo.
- **`awaiting_human` já vem de graça:** o `ChatWindow` compartilhado já trata esse estado (mesmo código usado por Institucional/Empregabilidade) — nenhum trabalho extra necessário além de reusar o componente.
- **⚠️ Achado bloqueante, corrigido:** `api/chat/send-message/route.ts` (rota compartilhada de envio manual, usada por TODOS os canais) sempre mandava a mensagem pro `WORKER_URL` padrão (`cuca-worker`). Como a Academia Enem tem credenciais Meta **isoladas** num serviço próprio (`cuca-academia-enem`, S-AE-02), enviar por ali usaria o número/credencial **errados**. Corrigido: a rota agora consulta `conversas.agente_tipo` (coluna já existente) e usa `WORKER_URL_ACADEMIA_ENEM` quando `agente_tipo='academia_enem'`, mantendo o `WORKER_URL` padrão para todos os outros casos — **comportamento idêntico ao de hoje para Institucional/Empregabilidade/Ouvidoria/Acesso Cuca**, só adiciona um caminho novo.
  - **Nova variável de ambiente necessária no portal (ainda não documentada em nenhuma story):** `WORKER_URL_ACADEMIA_ENEM` — aponta pro domínio do serviço `cuca-academia-enem` (mesmo domínio já configurado no EasyPanel pela S-AE-02, ex. `https://cuca-cuca-academia-enem.wte0ij.easypanel.host`). Sem essa env configurada, o código cai no `WORKER_URL` padrão (fail-safe — não quebra os outros canais, mas o envio da Academia Enem falharia no lado do worker por credencial errada). **Não é escopo desta story adicionar a variável no EasyPanel** (ação humana, S-AE-02) — só documentando que ela passou a ser necessária no portal a partir de agora.
- **⚠️ Achado — AC3/AC4 (janela de 24h) NÃO implementado, decisão levada ao @po/Junior:** investiguei antes de implementar (grep em `worker/*.py` e `cuca-portal/src/`) — a única lógica de "janela de 24h" existente no repositório é **exclusiva do AuctaFlux** (`lib/auctaflux/janela.ts`, rotas `academia-enem/mensagens/enviar`/`webhook/auctaflux` — todos código morto a apagar). **Institucional e Empregabilidade não têm nenhuma checagem de janela de 24h hoje**, nem client-side nem no worker (`worker/main.py` não tem nada disso). A story presumia "mesma regra que os outros canais já respeitam", mas essa regra não existe pra reaproveitar. Implementar do zero seria inventar escopo — decisão de produto (construir agora só pra Academia Enem, ou tratar como débito cross-canal a resolver depois) não é minha de tomar sozinho. Sinalizado como pendência.
- **Validações:** `tsc --noEmit` — só os 4 erros pré-existentes de `tests/*.test.ts` (import `.ts`, não relacionado). `eslint` nos 2 arquivos tocados: 0 erros, 0 warnings.
- **CodeRabbit:** não executado (CLI configurado pra WSL; ambiente atual é Linux nativo).

### Debug Log References
- Leitura de `components/chat/chat-sidebar.tsx` (linhas 84-130) e `chat-window.tsx` (linhas 169-217) para confirmar os mecanismos de filtro de canal e de envio antes de implementar.
- `grep -rln "janela.*24\|24h" worker/*.py cuca-portal/src/` → confirmou que só arquivos AuctaFlux (a apagar) têm essa lógica.
- `execute_sql` (`svzkrkfzpiqcesloukgb`): `SELECT column_name FROM information_schema.columns WHERE table_name='conversas'` → confirmou `agente_tipo`, `origem_id`, `canal_ativo` existem, usados na correção do `send-message`.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação da story (Draft) |
| 2026-06-14 | @po (Pax) | Cascata da decisão S-AE-02 (arquitetura anterior — tabelas próprias `ae_*`) |
| 2026-06-16 | @po (Pax) | Validação de draft (GO) → Status Draft→Ready |
| 2026-06-16 | @dev (Dex) | Implementação sobre `ae_conversas`/`ae_mensagens` (arquitetura anterior) |
| 2026-06-16 | @qa (Quinn) | QA gate CONCERNS (arquitetura anterior) |
| 2026-06-16 | @devops (Gage) | Push para `main` (commit `7539e9a`, arquitetura anterior) |
| 2026-08-20 | @sm (River) | **Reabertura e reescrita completa (decisão do Junior, migração Meta direta):** painel passa a usar `conversas`/`mensagens` compartilhadas + `meta_adapter_outbound`, reaproveitando `components/chat/*` (não mais `ae-chat-*`). Status resetado para Draft. Dev Agent Record/QA Results anteriores mantidos abaixo como histórico da arquitetura obsoleta. |
| 2026-08-20 | @po (Pax) | Validação (GO, 8/10) → Status Draft→Ready. |
| 2026-08-20 | @dev (Dex) | **Implementação completa (Status Ready→Ready for Review).** Nova página reaproveitando `ChatSidebar`/`ChatWindow` com `filterCanalTipo="academia_enem"`. Achado bloqueante corrigido: `send-message/route.ts` (compartilhado) agora roteia pro worker certo por `agente_tipo`, sem afetar os outros canais — nova env `WORKER_URL_ACADEMIA_ENEM` documentada. Achado sinalizado, não implementado: janela de 24h não existe pra nenhum canal Meta direto hoje (não é "reaproveitar", seria inventar) — decisão levada ao @po/Junior. `ae-chat-*` apagados. `tsc`/`eslint` OK. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 8/10) → Status Draft→Ready.** Consistente com S-AE-02 (depende do serviço/número). Ponto de atenção não-bloqueante levado ao Dev Notes da própria story: confirmar que o filtro por `agente_tipo` já é aplicado por todas as telas que hoje leem `conversas`/`mensagens`, para não vazar dados entre módulos. |
| 2026-08-20 | @devops (Gage) | Merge do PR #114 na `main`, aprovado pelo Junior. |
| 2026-08-20 | Junior | **Decisão de produto:** pendência da janela de 24h (AC3/AC4) marcada como **desistência** — não se aplica mais, não será implementada nem tratada como débito futuro. Item encerrado. |

## QA Results (implementação atual — arquitetura Meta direta)

**Revisor:** Quinn (@qa) · **Data:** 2026-08-20 · **Veredito do gate: PASS**

### Verificação independente (refeita do zero, atenção extra em Regressão — código compartilhado por 4 canais em produção)
1. **Código bate com a story:** li os 2 arquivos por completo — `page.tsx` novo usa `filterCanalTipo`/`moduloAtendimento` exatamente como descrito; `send-message/route.ts` tem a função `resolverWorkerUrl` exatamente como relatada.
2. **Mecanismo `filterCanalTipo` confirmado:** li `chat-sidebar.tsx` (linhas 84-116) — resolve `phone_number_id`s ativos via `meta_phone_numbers.canal_tipo`, filtra `conversas.origem_id IN (...)`. Bate com o relato.
3. **Retrocompatibilidade do `send-message/route.ts` — único consumidor real confirmado:** `grep -rl "chat/send-message"` retorna **só** `chat-window.tsx` — é o único ponto de entrada, usado por todos os canais (Institucional, Empregabilidade, Ouvidoria, Acesso Cuca, agora Academia Enem). Para `agente_tipo != 'academia_enem'` (100% dos canais já em produção hoje), o caminho cai direto no `return process.env.WORKER_URL...` de sempre — comportamento idêntico.
   - **Achado de nuance, não bloqueante:** a nova versão faz uma consulta a `conversas` (via `createAdminClient`) **antes** de decidir o worker, em **todo** envio de mensagem — inclusive para os canais que não precisam disso. É um round-trip extra ao banco por mensagem enviada, para todos os 4 canais já em produção. Baixo custo (query simples por `id`, com índice de PK) e protegido por `try/catch` com fallback seguro — não é um defeito, mas registrando como custo real, não zero.
   - **Achado de nuance, não bloqueante:** a ordem de validação mudou — antes, a rota checava `workerUrl`/`token` **antes** de validar o corpo da requisição; agora valida o corpo primeiro (precisa do `conversa_id` para resolver o worker). Efeito: um request malformado + env mal configurada agora responde 400 em vez de 500. Não afeta o uso real (o `ChatWindow` sempre manda corpo válido) — é uma mudança de precedência de erro, não de comportamento funcional.
4. **Janela de 24h — confirmado de forma independente:** rodei o mesmo grep e reproduzi o resultado — só arquivos AuctaFlux (`lib/auctaflux/janela.ts`, rotas `academia-enem/mensagens/enviar` e `webhook/auctaflux`) têm essa lógica, mais uma página `developer/worker` (console de diagnóstico interno, não é um canal real). Institucional/Empregabilidade não têm nada disso. Confirma a alegação do @dev — não é invenção, é ausência real de precedente.
5. **`ae-chat-*` removidos:** `find` não encontra mais os arquivos; `grep` não encontra nenhuma referência residual em `cuca-portal/src/`.
6. **`tsc --noEmit`/`eslint` rodados por mim:** mesmos 4 erros pré-existentes (`tests/*.test.ts`), 0 erros/0 warnings nos 2 arquivos tocados.
7. **Fail-safe de `resolverWorkerUrl` avaliado:** quando `agente_tipo='academia_enem'` mas `WORKER_URL_ACADEMIA_ENEM` não está configurada, cai no worker padrão em vez de travar com 500 imediato — o envio real vai falhar do lado do worker (Meta rejeita enviar por um `phone_number_id` que o token não possui), então **não é um mascaramento silencioso** (o envio falha e o atendente vê erro), mas a mensagem de erro que chega à UI hoje é genérica ("Falha ao enviar via worker") — não diz "variável de ambiente não configurada". Isso só afeta a Academia Enem, e só até a env ser configurada (S-AE-02, ainda pendente) — sem consumidor real hoje.

### 7 Quality Checks
1. **Code review** — ✅ Reuso correto e mínimo dos componentes compartilhados; achado do worker corrigido de forma elegante (aditivo, sem tocar o caminho padrão).
2. **Testes** — ⚠️ Sem teste automatizado para `resolverWorkerUrl` (gap de tooling já conhecido nesta sessão). Baixo risco dado que a lógica é curta e o fallback é seguro.
3. **Acceptance Criteria** — ✅ AC1/2/5/6 atendidos. AC3 parcialmente (envio funciona, sem checagem de janela). **AC4 não atendido** — mas corretamente sinalizado como decisão de produto em aberto, não como lacuna escondida.
4. **Regressão — atenção extra dada, conforme pedido:** ✅ Rastreado o único consumidor real da rota compartilhada; comportamento idêntico para os 4 canais já em produção quando `agente_tipo != 'academia_enem'`. Custo extra de 1 query por envio é aceitável (baixo, protegido por try/catch). Nenhuma regressão funcional real encontrada.
5. **Performance** — ✅ Aceitável (query simples por PK, timeout do worker inalterado).
6. **Segurança** — ✅ `WEBHOOK_INTERNAL_TOKEN` continua fora do bundle do client; nenhuma exposição nova.
7. **Documentação** — ✅ Dev Agent Record completo, achado do worker e da janela de 24h bem documentados, com evidência.

### Issues
| Sev | Cat | Descrição | Recomendação |
|-----|-----|-----------|--------------|
| Low | perf | Query extra a `conversas` em todo envio, para todos os canais (não só Academia Enem) | Aceitável agora; se algum dia o volume de envio manual crescer muito, considerar cachear o `agente_tipo` no client e passar como parâmetro |
| Low | ux | Mensagem de erro genérica quando `WORKER_URL_ACADEMIA_ENEM` não está configurada | Sem consumidor real hoje (S-AE-02 pendente); melhorar a mensagem quando o serviço entrar em uso |
| — | decisão | AC4 (janela de 24h) — **RESOLVIDO 2026-08-20:** Junior decidiu desistência, não se aplica mais | Nenhuma ação — encerrado |

### Decisão de Gate
**PASS.** Regressão investigada com o cuidado extra pedido — único consumidor real da rota compartilhada rastreado, comportamento idêntico preservado para os canais já em produção. Achados de nuance são Low, não-bloqueantes. AC4 é uma decisão de produto em aberto, corretamente não resolvida sozinha pelo @dev. Liberado para @devops.

## Dev Agent Record (histórico — arquitetura obsoleta, AuctaFlux/`ae_*`)
> ⚠️ Descreve a implementação anterior, substituída por esta reescrita. Mantido só para rastreabilidade.

### Agent Model Used
Dex (@dev) — claude-opus-4-8

### Completion Notes (obsoletas)
Implementação original usava `ae_conversas`/`ae_mensagens`, componentes próprios `ae-chat-*`, envio via `auctaflux.enviarTexto`. Ver histórico do arquivo (git log) para o texto completo.

## QA Results (histórico — arquitetura obsoleta)
Veredito original: **CONCERNS**. Bug crítico `status`×`estado` corrigido; RLS confirmada; AC#3 não verificado ao vivo (número `pending_signup`, AuctaFlux). Não se aplica à arquitetura atual — nova revisão @qa necessária após reimplementação.
