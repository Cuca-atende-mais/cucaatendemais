# S-WM-67 — Correção do Cálculo de Teto Diário de Envio (Meta, todos os números)

## Status
Ready for Review

## Story
**Como** operador dos canais Meta (Institucional, Empregabilidade, Divulgação e, em breve, Academia Enem),
**quero** que o sistema respeite de verdade o limite diário de mensagens por número confirmado pela Meta,
**para que** nenhum canal ultrapasse o teto real e arrisque penalização/qualidade do número.

## Contexto
Levantamento técnico (`docs/migracao-meta/PLANO-Academia-Enem-Migracao-Meta-Direta.md`, seção 5) identificou dois problemas no desenho atual (`worker/campanhas_engine.py::_get_daily_limit_by_phone_sync`/`_warn_if_daily_limit_above_tier_sync`):
1. Quando o limite configurado está acima do tier real confirmado pela Meta, o sistema só **loga um aviso** — nunca ajusta nem bloqueia.
2. O contador de "limite" é por **execução de disparo**, não por dia real — duas campanhas no mesmo dia, cada uma dentro do próprio teto, somadas podem passar do que a Meta libera.

**Decisão do Junior (2026-08-20):** aplicar a correção para **todos os números** de uma vez (não só o da Academia Enem) — é a mesma lacuna, mesmo risco, para qualquer canal. Como o cálculo é por `phone_number_id`, o número da Academia Enem (quando existir, via S-AE-02) já fica automaticamente protegido sem risco de misturar teto com Institucional/Empregabilidade/Divulgação.

## Escopo
### IN
- No momento de decidir quantas mensagens uma execução pode mandar, calcular o teto efetivo como `mínimo(daily_limit configurado, messaging_limit_tier confirmado)` — usar esse valor para **bloquear**, não só avisar.
- Antes de iniciar o envio, somar quantas mensagens **já saíram naquele número, no dia corrente** (consultar `logs_disparo.enviado_em`/`status`, cruzado com o `phone_number_id` do disparo). Se a soma do dia já bateu o teto efetivo, a nova execução não inicia (ou inicia só com o que sobra de teto).
- Quando o tier ainda não foi confirmado (`NULL`), manter o fallback conservador atual (500) — já está correto.

### OUT
- Qualquer mudança na lógica de conteúdo/template/disparo em si — só o cálculo/trava do teto.

## Critérios de Aceite (Given/When/Then)
1. **Given** um número com `messaging_limit_tier` confirmado menor que o `daily_limit` configurado, **when** uma execução de disparo roda, **then** o teto efetivo usado é o `messaging_limit_tier` (o menor dos dois) — não só um log de aviso.
2. **Given** duas execuções de disparo no mesmo dia, no mesmo número, cada uma dentro do próprio teto isoladamente, **when** a soma das duas ultrapassaria o teto efetivo do dia, **then** a segunda execução é contida (envia só o que sobra de teto, ou não inicia).
3. **Given** um número sem `messaging_limit_tier` confirmado (`NULL`), **then** o fallback de 500 continua sendo aplicado, sem mudança de comportamento.
4. **Given** o número da Academia Enem (quando cadastrado via S-AE-02), **then** ele é protegido pela mesma lógica, com teto contado separadamente do teto de Institucional/Empregabilidade/Divulgação (por ser um `phone_number_id` diferente).
5. **Given** os testes existentes de `campanhas_engine.py` para Institucional/Empregabilidade, **then** todos continuam passando após a mudança (sem regressão de comportamento para quem já está dentro do teto).

## Dev Notes — análise de impacto (item por item)
1. **Toca:** `worker/campanhas_engine.py::_get_daily_limit_by_phone_sync`/`_warn_if_daily_limit_above_tier_sync` — código **compartilhado** por todos os disparos Meta (Institucional, Divulgação, Empregabilidade, e futuramente Academia Enem).
   **Depende disso hoje:** todo disparo em produção desses canais passa por essa função — é o caminho ativo, não um código morto.
   **Impacto real observável:** para números que hoje já estão dentro do tier real, **nenhuma mudança perceptível** (o teto efetivo já era o configurado). Para números cujo `daily_limit` configurado está acima do tier real, o comportamento muda de "avisa mas envia tudo" para "trava no tier real" — isso é a correção pretendida, mas é uma mudança de comportamento em produção que precisa ser comunicada antes do deploy (algum disparo que hoje "passa" pode começar a ser contido).
   **De-risk concreto:** antes de aplicar, rodar `execute_sql` (read-only) para conferir, para cada `phone_number_id` ativo hoje (Institucional, Empregabilidade), qual é o `daily_limit` configurado vs. `messaging_limit_tier` confirmado — se algum dos dois números em produção já estiver com `daily_limit` acima do tier real, a correção vai **conter** disparos que hoje passam sem trava; isso deve ser avisado ao Junior antes do deploy, não descoberto depois.
   **Teste de causalidade (regra do projeto):** antes de considerar pronto, reverter temporariamente a correção, confirmar que os novos testes falham com o comportamento antigo, restaurar a correção e confirmar que passam — mesmo padrão já usado nas últimas stories de empregabilidade desta sessão.

## Tasks
- [x] Levantar (read-only) o `daily_limit`/`messaging_limit_tier` reais dos números em produção — reportar ao Junior antes de aplicar, se houver divergência.
- [x] Corrigir `_get_daily_limit_by_phone_sync` para usar o mínimo entre configurado e tier confirmado.
- [x] Implementar soma cumulativa diária via `logs_disparo` antes de iniciar uma nova execução.
- [x] Testes cobrindo os 5 ACs, incluindo o cenário de duas execuções no mesmo dia.
- [x] Regressão: suíte completa de `test_campanhas_engine.py` (ou equivalente) verde.

## Dependências
Nenhuma story bloqueia esta — é código já em produção. É consumida por **S-AE-09** (disparo próprio da Academia Enem), que herda a proteção automaticamente quando o número existir.

## Quality Gate
- Tipo: backend (worker), código compartilhado entre módulos. Agentes: @qa (obrigatório rastrear os 2 canais já em produção, não só testar isoladamente — regra de análise de impacto do projeto). CodeRabbit: foco em regressão de Institucional/Empregabilidade.

## File List
**Modificados:**
- `worker/campanhas_engine.py` — `_get_daily_limit_by_phone_sync` agora retorna o mínimo entre `daily_limit` configurado e `messaging_limit_tier` confirmado (antes só logava aviso); nova `_contar_enviados_hoje_sync` (soma cumulativa do dia via `logs_disparo`, cruzando `disparos.instancia_uazapi`/`disparos_divulgacao.instancia_uazapi`); nova `_resolver_limite_restante_hoje_sync` (combina os dois, usada nos 2 pontos de envio — pontual/ouvidoria e divulgação mensal); `_warn_if_daily_limit_above_tier_sync` mantida no arquivo (não removida — @deprecated, sem uso interno, evita quebrar consumidor externo não identificado).
- `worker/tests/test_campanhas_engine.py` — 6 testes novos (tier capando o efetivo, tier NULL não capando, soma cumulativa cruzando os 2 caminhos de disparo, fail-safe sem disparo hoje, desconto do já-enviado, piso em zero, e daily_limit já resolvido pelo chamador não busca de novo); removida 1 linha de monkeypatch obsoleta da função deprecated.

## Dev Agent Record

### Agent Model Used
Dex (@dev) — claude-sonnet-5

### Completion Notes
- **Levantamento read-only ANTES de aplicar (Task 1, de-risk da story):** consultei `meta_phone_numbers` em produção (`execute_sql`, projeto `svzkrkfzpiqcesloukgb`). Resultado: **nenhuma divergência** — os 3 números cadastrados hoje têm `daily_limit == messaging_limit_tier` (Institucional ativo e inativo: 2000=2000) ou os dois `NULL` (Empregabilidade, cai no fallback 500 de qualquer jeito). **Não havia nenhum número com `daily_limit` acima do tier real** — a correção não altera o comportamento observável de nenhum disparo já em produção hoje. Não havia nada a reportar ao Junior antes do deploy (checagem feita, sem achado bloqueante).
- **Correção 1 (tier vira teto de fato):** `_get_daily_limit_by_phone_sync` agora lê `daily_limit` e `messaging_limit_tier` na mesma query e retorna `min(configurado, tier)` quando o tier está confirmado — antes só logava e devolvia o configurado. Tier `NULL` continua sem capar (AC3, "não sei" ≠ "inconsistente").
- **Correção 2 (soma cumulativa do dia):** nova `_contar_enviados_hoje_sync(phone_number_id)` soma `logs_disparo` (convenção `status <> 'falhou'`, mesma já usada em `usar_contagem_cumulativa`) cruzando os **dois** caminhos de disparo existentes — `disparos.instancia_uazapi` (eventos pontuais/ouvidoria) e `disparos_divulgacao.instancia_uazapi` (mensal) — ambas as colunas já guardam o `phone_number_id` de fato (nome legado da era uazapi, confirmado via schema; uazapi está desligado). Filtro por "hoje" no fuso America/Fortaleza, convertido pra UTC na query (mesmo fuso já usado localmente nos breadcrumbs do arquivo).
- **Composição:** nova `_resolver_limite_restante_hoje_sync(phone_number_id, daily_limit)` combina as duas correções — se `daily_limit` já veio resolvido pelo chamador (ex.: retomada manual), não busca de novo, só desconta o cumulativo; resultado nunca fica negativo (`max(0, ...)`). Substituiu o bloco `if daily_limit is None: ...` + chamada de aviso nos **2** pontos de envio (`_enviar_para_leads_pendentes` e `_enviar_divulgacao_para_leads_pendentes`) — cobre Institucional/Ouvidoria/Divulgação e, futuramente, Academia Enem, todos pela mesma função.
- **`_warn_if_daily_limit_above_tier_sync` não removida:** virou código morto (@deprecated no docstring, sem chamada interna) — mantida só para não quebrar um teste existente que a referenciava via `monkeypatch.setattr` e qualquer consumidor externo não identificado nesta revisão. Não é usada no fluxo real.
- **Teste de causalidade (exigência da própria story, seguido à risca):** reverti temporariamente `worker/campanhas_engine.py` pro estado do `HEAD` (mantendo os 6 testes novos), rodei a suíte — **os 6 testes novos falharam** (2 por `AttributeError` de função inexistente, 4 dos comportamentos que dependiam da correção). Restaurei o código novo — **suíte inteira voltou a passar**. Confirma que os testes realmente exercitam a mudança, não são falso-positivo.
- **Validações:** `py_compile` OK. Suíte completa do worker (`pytest tests/`, exceto `test_main_retomar_disparo.py`, que já falha na coleta por módulo `openai` ausente neste ambiente — pré-existente, não relacionado): **356 passed**, os mesmos **5 falhando** de sempre (`test_meta_adapter_outbound.py`, `ModuleNotFoundError: No module named 'worker'` — pré-existente, confirmado nesta sessão que predata qualquer mudança feita aqui).

### Debug Log References
- `execute_sql` (projeto `svzkrkfzpiqcesloukgb`): `SELECT phone_number_id, agente_tipo, canal_tipo, daily_limit, messaging_limit_tier, ... FROM meta_phone_numbers` → 3 linhas, nenhuma com `daily_limit > messaging_limit_tier`.
- `python3 -m pytest tests/test_campanhas_engine.py` → 57 passed (código novo); mesma suíte com `campanhas_engine.py` revertido ao `HEAD` → 6 failed / 51 passed (confirma causalidade).
- `python3 -m pytest tests/ --ignore=tests/test_main_retomar_disparo.py` → 356 passed, 5 failed (pré-existentes, `test_meta_adapter_outbound.py`).

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-08-20 | @sm (River) | Criação da story (Draft) — decisão do Junior de aplicar a correção do teto diário para todos os números de uma vez, motivada pela migração da Academia Enem para Meta direta. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 9/10) → Status Draft→Ready.** Análise de impacto sobre código compartilhado com Institucional/Empregabilidade está completa: nomeia o risco real (disparo que hoje "passa" pode passar a ser contido) e exige o levantamento read-only **antes** do deploy, não depois. Quality Gate corretamente exige rastrear os 2 canais já em produção, não só testar isolado — conforme regra do projeto. |
| 2026-08-20 | @dev (Dex) | **Implementação completa (Status Ready→Ready for Review).** Levantamento read-only confirmou 0 divergência em produção (nada a reportar). Tier vira teto de fato (não só aviso); soma cumulativa diária cruzando os 2 caminhos de disparo; 6 testes novos; teste de causalidade seguido (reverter/falhar/restaurar/passar); suíte completa sem regressão (356 passed, mesmos 5 pré-existentes). |

## QA Results

**Revisor:** Quinn (@qa) · **Data:** 2026-08-20 · **Veredito do gate: PASS**

### Verificação independente (refeita do zero, não aceitei o relato do @dev sem reproduzir)
1. **Levantamento em produção:** rodei minha própria query em `meta_phone_numbers` (`execute_sql`, `svzkrkfzpiqcesloukgb`) com uma coluna `divergente` calculada (`daily_limit > messaging_limit_tier`). Resultado: **3 linhas, 0 divergentes** — confirma exatamente o que o @dev relatou. Nenhum achado a reportar ao Junior.
2. **Diff do código:** li `git diff HEAD -- worker/campanhas_engine.py` linha a linha. Confirmado: (a) `_get_daily_limit_by_phone_sync` retorna `min(daily_limit, tier)` só quando `tier is not None`, sem capar em `NULL`; (b) `_contar_enviados_hoje_sync` cruza `disparos.instancia_uazapi` **e** `disparos_divulgacao.instancia_uazapi`, com `neq("status", "falhou")` — mesma convenção já usada em `usar_contagem_cumulativa`; (c) grep confirma que **só** os 2 pontos de envio (`_enviar_para_leads_pendentes`, `_enviar_divulgacao_para_leads_pendentes`) chamam `_resolver_limite_restante_hoje_sync` — nenhum terceiro caminho de envio ficou de fora.
3. **Suíte rodada por mim:** `test_campanhas_engine.py` → **57 passed**. Suíte completa do worker (exceto `test_main_retomar_disparo.py`, erro de coleta pré-existente por módulo `openai` ausente) → **356 passed, 5 failed** — os mesmos 5 de sempre (`test_meta_adapter_outbound.py`, `ModuleNotFoundError: No module named 'worker'`, pré-existente). Números batem exatamente com o relato do @dev.
4. **Teste de causalidade refeito por mim, do zero:** copiei o arquivo novo, reverti `campanhas_engine.py` pro `HEAD` anterior, rodei os 6 testes novos → **falharam** (2 `AttributeError` de função inexistente + 4 por comportamento antigo). Restaurei o arquivo novo → **57 passed** de novo, e `git diff --stat` confirma que o arquivo restaurado é byte-a-byte igual ao que estava antes da minha reversão (sem alteração acidental). Reprodução independente confirma a causalidade, não é só o relato do dev.
5. **Função morta:** grep confirma `_warn_if_daily_limit_above_tier_sync` só aparece na própria definição (linha 401) — nenhuma chamada no fluxo real. Só é referenciada em 1 teste (`monkeypatch.setattr`, harmless).

### 7 Quality Checks
1. **Code review** — ✅ Mudança cirúrgica, bem documentada, reaproveita a convenção de contagem já estabelecida no arquivo (não inventa uma nova).
2. **Testes** — ✅ 6 testes novos, cobrindo os 5 ACs + a borda "sem disparo hoje" + a borda "restante não fica negativo". Causalidade comprovada por mim, não só pelo dev.
3. **Acceptance Criteria** — ✅ Todos os 5 ACs verificados: AC1 (tier capa), AC2 (soma cumulativa via `_resolver_limite_restante_hoje_sync`), AC3 (tier NULL não capa), AC4 (lógica por `phone_number_id`, protege Academia Enem automaticamente quando existir), AC5 (regressão zero, suíte completa verde).
4. **Regressão** — ✅ Rastreei os consumidores reais (Institucional e Empregabilidade, os 2 canais já em produção), não só testei isolado — confirma a regra do projeto. 0 divergência em produção hoje = 0 mudança de comportamento observável para quem já está dentro do tier.
5. **Performance** — ✅ `_contar_enviados_hoje_sync` faz no máximo 4 queries leves (2 tabelas de disparo + até 2 contagens em `logs_disparo`), sem N+1 — volume de linhas em `disparos`/`disparos_divulgacao` é baixo (1 por campanha/evento, não por lead).
6. **Segurança** — ✅ Nenhum dado sensível exposto; fail-safe (erro de leitura conta como 0, não trava disparo) é o mesmo padrão já usado no resto do arquivo.
7. **Documentação** — ✅ Dev Agent Record completo e honesto (inclusive mantendo a função deprecated com justificativa, em vez de remover silenciosamente).

### Issues
Nenhuma. Nada bloqueante, nada Low/Medium a registrar.

### Decisão de Gate
**PASS.** Todo o trabalho foi verificado de forma independente — banco, diff de código, suíte de testes e teste de causalidade — e bate exatamente com o relatado pelo @dev. Liberado para @devops.
