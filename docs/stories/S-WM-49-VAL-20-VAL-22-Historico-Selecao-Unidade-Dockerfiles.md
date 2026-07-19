# S-WM-49 — VAL-20 (histórico em `avaliarSelecaoUnidade`) + VAL-22 (classificador "qual unidade") + Dockerfiles divergentes

## Status
Ready for Review

## Origem
`PENDENCIAS-institucional-2026-07-18.md` (sócio) + `docs/qa/DIAGNOSTICO-institucional-pendencias-auditoria-2026-07-19.md` (validação @dev contra `origin/main` e produção, 2026-07-19). 3 achados confirmados reais, baixo risco, isolados — agrupados numa story por serem pequenos e independentes da região de alto risco (as 4 funções de decisão de unidade / `handler()`). VAL-19 e a consolidação das 4 funções ficam de fora desta story (decisão de produto pendente do Junior; ver diagnóstico).

## Complexidade
**S**

## Prioridade
P2 — bugs de UX confirmados + risco operacional (Dockerfiles), sem urgência de incidente.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . → mesma contagem de passed + novos testes
  - deno check index.ts → não piora baseline
  - grep -n "gunicorn -w 1" docker-compose.yml worker/docker-compose.yml → 2 ocorrências (hoje: -w 4 e -w 2)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** (1) que a resolução de unidade considere o histórico recente da conversa, (2) que perguntas tipo "qual unidade tem X" sejam roteadas pra resposta de rede em vez do menu, e (3) que os 2 Dockerfiles de desenvolvimento parem de divergir do real (`-w 1`),
**para que** a Maria não "esqueça" a pergunta anterior quando o lead manda em 2 partes, perguntas de rede cheguem na resposta certa, e ninguém reintroduza o bug do VAL-21 (debounce quebrado com >1 processo) usando um desses arquivos como referência.

## Contexto e Problema

### VAL-20 — `avaliarSelecaoUnidade` nunca vê histórico
`avaliarSelecaoUnidade(texto, openaiKey, tentativa = 0)` (`index.ts:515`) monta o prompt pro classificador `gpt-4o-mini` só com `texto` (mensagem atual) + o menu fixo (`index.ts:526-542`) — nenhuma linha do histórico da conversa. Usada nos 4 pontos de resolução de unidade do arquivo (`decidirPrimeiraMensagem`, `decidirAguardandoUnidade`, `decidirConversaEngajada`, branch inline `unidadeSalva`). Quando 2 mensagens do lead caem em despachos separados (debounce, ou lead manda em 2 partes), a 2ª resposta pode ignorar a pergunta que a Maria acabou de fazer.

### VAL-22 — classificador roteia "qual unidade tem X" errado
O prompt de `avaliarSelecaoUnidade` (`index.ts:539`) define `pedido_depende_unidade` como "pede algo cujo conteúdo real depende de saber qual unidade CUCA (cursos, horários, programação, atividades...)" sem distinguir "tem natação **nessa** unidade" (depende de unidade, correto) de "**qual** unidade tem natação" (pergunta de rede, deveria virar `pergunta_geral=true` e acionar `resumo_rede`, S-WM-32). Sem exemplo negativo no prompt, o classificador tende a rotear a 2ª forma pro menu de unidades em vez da resposta de rede.

### Dockerfiles divergentes
3 arquivos definem o número de workers do `gunicorn` de forma inconsistente:
- `worker/Dockerfile:18` — `-w 1` (o real, correto, batendo com o EasyPanel e o fix do VAL-21).
- `docker-compose.yml:36` (raiz) — `-w 4`.
- `worker/docker-compose.yml:14` — `-w 2`.

O debounce de mensagens (`_DEBOUNCE_TASKS`, `worker/meta_adapter_inbound.py:487`) é um dict em memória de 1 processo só — qualquer redeploy usando um dos 2 arquivos de compose como referência reintroduz o bug do VAL-21 (mensagens caindo em processos diferentes, resposta duplicada).

## Escopo

### IN

**1. VAL-20 — histórico em `avaliarSelecaoUnidade`**
- Adicionar parâmetro opcional `historico: { role: string; content: string }[] = []` à assinatura de `avaliarSelecaoUnidade` (mesmo padrão já usado em `resolverAtividadeMencionadaComHistorico`/`buscarAtividadeDeterministica` no próprio arquivo).
- Incluir as últimas 1-2 mensagens do histórico (preferencialmente a última pergunta da Maria, `role: "assistant"`) no prompt, antes de "Mensagem do lead: ".
- Atualizar os 4 call sites pra passar o histórico já disponível no `handler()`.

**2. VAL-22 — reforço de prompt do classificador**
- Adicionar exemplo negativo explícito no texto de `pedido_depende_unidade` (`index.ts:539`) distinguindo "tem natação na Barra?" (`pedido_depende_unidade=true`) de "qual unidade tem natação?"/"onde tem natação?" (`pergunta_geral=true`, não `pedido_depende_unidade`).
- Sem mudança de código fora do texto do prompt — é reforço textual, mesmo padrão do VAL-24 (Regra 7 de `INSTRUCAO_SEGURANCA`).

**3. Dockerfiles**
- Alinhar `docker-compose.yml:36` e `worker/docker-compose.yml:14` pra `-w 1`, igual ao `worker/Dockerfile:18` (fonte da verdade, já validada em produção).

### OUT
- VAL-19 (`decidirConversaEngajada`) — decisão de produto pendente do Junior, fica fora.
- Consolidação das 4 funções de decisão de unidade (recomendação do `RELATORIO-5`) — risco alto, região com histórico de bug de estado cruzado (S-WM-21), fora de escopo.
- Plano 015 (sanitizar `lead.nome`) — já tem story própria, `S-WM-48` (Draft, backlog P3) — não duplicar aqui, só sequenciar junto se o Junior quiser.
- Qualquer mudança de comportamento além dos 3 itens acima.
- Deploy automático.

## Acceptance Criteria

1. `avaliarSelecaoUnidade` aceita `historico` opcional (default `[]`) sem quebrar nenhuma chamada de teste existente que não passa esse parâmetro.
2. Teste novo: mensagem ambígua ("é sim") após a Maria ter perguntado "qual unidade?" no turno anterior → classificador considera o histórico (teste de integração via mock do fetch, prompt enviado contém o texto da pergunta anterior).
3. Teste novo: "qual unidade tem natação?" → `pergunta_geral=true`, não `pedido_depende_unidade=true` (teste de integração via mock do fetch do classificador).
4. Teste de regressão: "tem natação na Barra?" continua `pedido_depende_unidade=true` (comportamento atual preservado).
5. `docker-compose.yml` e `worker/docker-compose.yml` usam `-w 1` — `grep -c "gunicorn -w 1" docker-compose.yml worker/docker-compose.yml` retorna 1 em cada.
6. `deno test` → mesma contagem de passed da baseline + os testes novos, 0 failed.
7. `deno check index.ts` não piora vs. baseline.
8. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — VAL-20: histórico em `avaliarSelecaoUnidade`** (AC: 1, 2, 4)
  - [x] Adicionar parâmetro `historico` opcional à assinatura e ao prompt.
  - [x] Atualizar os 4 call sites no `handler()`.
  - [x] Teste novo de integração (AC2).
- [x] **Task 2 — VAL-22: reforço de prompt** (AC: 3, 4)
  - [x] Adicionar exemplo negativo no texto de `pedido_depende_unidade`.
  - [x] Teste novo de integração (AC3) + teste de regressão (AC4).
- [x] **Task 3 — Dockerfiles** (AC: 5)
  - [x] Alinhar `docker-compose.yml` e `worker/docker-compose.yml` pra `-w 1`.
- [x] **Task 4 — Fechamento** (AC: 6, 7, 8)
  - [x] Rodar suíte completa, confirmar sem regressão.
  - [x] Confirmar nenhum deploy/push executado.

## Dev Notes
- Base: `origin/main`/`develop` já reconciliados (commit `67ca783`, 2026-07-19) — nascer desta base, não da antiga.
- VAL-20 e VAL-22 tocam a mesma função (`avaliarSelecaoUnidade`) mas são mudanças independentes (parâmetro novo vs. texto de prompt) — podem ser implementadas na ordem que for mais conveniente, sem dependência entre si.
- Dockerfiles: mudança isolada, zero relação com o resto da story — não são usados no deploy real (EasyPanel usa `worker/Dockerfile` diretamente), só como referência/dev local.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente`.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-19 | 0.1 | Story criada agrupando VAL-20 + VAL-22 + Dockerfiles, a partir do diagnóstico de validação da auditoria/pendências do sócio (`DIAGNOSTICO-institucional-pendencias-auditoria-2026-07-19.md`). Base: origin/main pós-reconciliação (67ca783). | @sm River |
| 2026-07-19 | 0.2 | @po validate-story-draft: **GO** (10/10). Título objetivo, contexto e problema completos para os 3 achados, AC testáveis, IN/OUT bem definidos (VAL-19 e consolidação das 4 funções corretamente excluídos por risco), dependência com S-WM-48 mapeada sem duplicar escopo, complexidade S, valor de negócio claro, riscos documentados, critério de pronto explícito, alinhado ao diagnóstico de 2026-07-19. Status Draft → Ready. | @po Pax |
| 2026-07-19 | 0.3 | Implementados VAL-20, VAL-22 e alinhamento dos Docker Compose para `gunicorn -w 1`. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Debug Log References

- Análise read-only de impacto no schema local de produção (`schema_producao.sql`): relação relevante `leads 1:N conversas 1:N mensagens`; patch só lê `mensagens` já carregadas no handler e `lead.nome`, sem migration, sem nova coluna, sem alteração de FK/RLS.
- `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/motor-agente/index.test.ts supabase/functions/motor-agente/index.audit.test.ts` → 176 passed / 0 failed / 2 ignored.
- `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente` → 176 passed / 0 failed / 2 ignored.
- `grep -n "gunicorn -w" docker-compose.yml worker/docker-compose.yml worker/Dockerfile` → raiz e worker compose agora `-w 1`; `worker/Dockerfile` já estava `-w 1`.
- `deno lint supabase/functions/motor-agente/index.ts supabase/functions/motor-agente/index.test.ts supabase/functions/motor-agente/index.audit.test.ts` → falha no baseline conhecido de 7 problemas (imports inline jsr/https e `midia_url`/`midia_tipo` não usados), sem problema novo desta story.
- `deno check index.ts` em `supabase/functions/motor-agente` → falha no baseline conhecido de tipagem estrutural do handler/Supabase (`conversa` possivelmente null, `metadata` Json vs Record etc.), sem erro novo na assinatura `avaliarSelecaoUnidade`/call sites.
- `git diff --check` nos arquivos alterados → sem problemas.

### Completion Notes List

- `avaliarSelecaoUnidade` agora aceita `historico` opcional e inclui até 2 mensagens recentes no prompt do classificador.
- A montagem do histórico exclui a mensagem atual quando ela já aparece na tabela `mensagens`, evitando duplicar “Lead: é sim” e perdendo a pergunta anterior.
- Os 4 call sites semânticos do `handler()` passam `historico`: troca semântica com unidade salva, `aguardando_unidade`, `conversa_engajada` e primeira mensagem.
- Prompt do classificador ganhou exemplo explícito: “tem natação na Barra?” fica como pedido de unidade; “qual unidade tem natação?”/“onde tem natação?” fica como pergunta geral de rede.
- `docker-compose.yml` e `worker/docker-compose.yml` foram alinhados para `gunicorn -w 1`, preservando o desenho validado contra VAL-21/debounce em memória.
- Nenhum deploy/push executado por @dev.

### File List

- `supabase/functions/motor-agente/index.ts`
- `supabase/functions/motor-agente/index.audit.test.ts`
- `docker-compose.yml`
- `worker/docker-compose.yml`
- `docs/stories/S-WM-49-VAL-20-VAL-22-Historico-Selecao-Unidade-Dockerfiles.md`

## QA Results

### Review Date: 2026-07-19

### Reviewed By: @qa Quinn

### Gate Decision

PASS — implementação aprovada para seguir para @devops.

### Requirements Traceability

- AC1 assinatura com `historico` opcional: validada por inspeção; chamadas antigas sem terceiro argumento continuam cobertas pela suíte.
- AC2 histórico em mensagem ambígua: coberto por `S-WM-49 VAL-20: handler repassa histórico ao avaliarSelecaoUnidade em aguardando_unidade` e `S-WM-49 VAL-20: avaliarSelecaoUnidade inclui histórico recente no prompt do classificador`.
- AC3 “qual unidade tem natação?” como pergunta geral: coberto por `S-WM-49 VAL-22: prompt diferencia pergunta de rede 'qual unidade tem X' de pedido numa unidade`.
- AC4 regressão “tem natação na Barra?”: coberto por `S-WM-49 VAL-22: regressão 'tem natação na Barra?' continua pedido dependente de unidade`.
- AC5 Docker Compose `-w 1`: validado em `docker-compose.yml`, `worker/docker-compose.yml` e `worker/Dockerfile`.
- AC6 Deno test: validado, 176 passed / 0 failed / 2 ignored.
- AC7 Deno check não piora baseline: validado; permanece nos 36 erros baseline conhecidos do handler/Supabase.
- AC8 sem deploy: confirmado; QA não identificou ação de deploy/push nesta etapa.

### Risk Assessment

- Risco funcional: médio-baixo. A função classificador recebe mais contexto, mas o fluxo de decisão não foi reescrito.
- Risco de estado cruzado: controlado. O patch passa `historico` já carregado e remove a mensagem atual ao montar o contexto, evitando falso histórico duplicado.
- Risco operacional Docker: reduzido. Os dois compose agora seguem `gunicorn -w 1`, coerente com o debounce em memória e com `worker/Dockerfile`.
- Banco/produção: sem migration, sem alteração de tabela/FK/RLS. Relação relevante permanece `leads 1:N conversas 1:N mensagens`.

### Evidence

- `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente` → 176 passed / 0 failed / 2 ignored.
- `rg` de chamadas com 3º argumento em `avaliarSelecaoUnidade` → só assinatura, retry interno e 4 call sites atualizados; não encontrei chamada legada passando `tentativa` como 3º argumento.
- `grep -n "gunicorn -w" docker-compose.yml worker/docker-compose.yml worker/Dockerfile` → compose raiz `-w 1`, compose worker `-w 1`, Dockerfile `["-w", "1"]`.
- `deno lint supabase/functions/motor-agente/index.ts supabase/functions/motor-agente/index.test.ts supabase/functions/motor-agente/index.audit.test.ts` → 7 problemas baseline conhecidos, sem achado novo do patch.
- `deno check index.ts` → 36 erros baseline conhecidos de tipagem estrutural do handler/Supabase, sem erro novo na assinatura/call sites de `avaliarSelecaoUnidade`.
- `git diff --check` nos arquivos alterados → sem problemas.

### Notes

- Não há bloqueio QA para PR.
- Como `supabase/functions/motor-agente/index.ts` foi alterado, @devops deve redeployar a Supabase Edge Function `motor-agente` antes/ao atualizar a PR, conforme fluxo acordado.
- Mudanças em `docker-compose.yml` e `worker/docker-compose.yml` não exigem redeploy EasyPanel por si só, pois são arquivos de compose/dev; EasyPanel usa `worker/Dockerfile`. A confirmação final de serviços fica com @devops no handoff.
