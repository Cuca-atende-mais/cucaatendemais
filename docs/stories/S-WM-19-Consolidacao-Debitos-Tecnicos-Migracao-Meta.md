# S-WM-19 — Consolidação de Débitos Técnicos registrados na migração Meta (S-WM-16/18/20)

## Status
Ready for Review

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - Para CADA item 1-8: a Task correspondente contém, ANTES de qualquer diff de código, uma seção "Mapeamento de Impacto" preenchida (não um placeholder) com: (a) grep completo de call sites, (b) dependências de "action at a distance"/"shotgun surgery" identificadas ou descartadas com evidência, (c) avaliação de redundância/quebra de contrato. @qa rejeita (FAIL) qualquer Task cujo diff exista sem esse mapeamento documentado antes dele.
  - Item 1 (RLS disparos_divulgacao) — confirmar via mcp supabase (cuca-dev) que a policy final não é mais USING/WITH CHECK = true irrestrito, e que existe migration idempotente correspondente em supabase/migrations/ (não só aplicação direta).
  - Item 2 (CRUD exclusão de leads) — confirmar rota DELETE nova, com verificação de FKs/dependências (matrículas, atividades, disparos) antes de decidir entre hard delete e soft delete.
  - Item 3 (parameter_format) — migration idempotente aplicada + confirmação de quais templates hoje são NAMED vs NUMBERED (não assumir).
  - Item 4 (templates dormentes) — grep confirmando os novos call sites de disparo; nenhum outro fluxo quebrado pela mudança de _processar_item_disparo_interno/feedback-submit.
  - Item 5 (desalinhamento eventos_pontuais) — coordenado com o item 4 (mesmo template/dispatch path); verificar que a correção de um não reintroduz o problema do outro.
  - Item 6 (teste _montar_parametros_named) — pytest novo cobrindo NAMED e NUMBERED, sem regressão na suíte completa.
  - Item 7 (menu_inicial código morto) — grep confirmando zero alcance real antes de remover; pytest sem regressão.
  - Item 8 (unidade_cuca nos 7 call sites) — confirmar que _rotear_por_intencao não passa a depender do valor de forma que quebre algo hoje silencioso.
  - Item 9 — sem gate de código; apenas confirmar que o risco está registrado na EPIC/Riscos, não implementado como "correção".
  - Item 10 — diff do EPIC-Migracao-WhatsApp-Meta.md reflete o estado real (S-WM-09 a S-WM-20), não invenção de status.
  - pytest worker/tests/ completo sem regressão ao final de todas as tasks de código.
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que os 10 débitos técnicos registrados durante S-WM-16/18/20 sejam mapeados quanto ao seu raio de impacto real e então corrigidos (ou formalmente registrados como risco, quando for o caso), um de cada vez,
**para que** a migração Meta feche sem dívida técnica escondida, sem repetir as regressões que já aconteceram nesta migração por mudanças feitas sem entender o que mais dependia do comportamento atual.

## Contexto e Problema

Esta story consolida 10 itens que ficaram registrados como pendência não-bloqueante ao longo de S-WM-16, S-WM-18 e S-WM-20 — nenhum foi corrigido até agora porque não bloqueava o fechamento das stories de origem. Já houve **3 regressões nesta migração** causadas por mudanças aplicadas sem mapear antes quem mais dependia do comportamento alterado (ver Change Log de S-WM-16/S-WM-18 — `.eq("automacoes", [...])` como lista Python quebrando o Postgrest; fallback hardcoded de transbordo sendo, na prática, o único caminho funcional; edge function `alertas-institucionais` referenciando templates já removidos). Por isso esta story **não autoriza nenhuma correção de código sem o mapeamento de impacto documentado primeiro** — ver "Protocolo Obrigatório" abaixo.

### Origem de cada item (fato registrado, não suposição)

1. **RLS de `disparos_divulgacao` sem restrição de INSERT/UPDATE** — achado de segurança do @qa no gate de S-WM-18 (Change Log, 2026-07-04): a policy hoje permite INSERT/UPDATE irrestrito para qualquer autenticado (`USING`/`WITH CHECK = true`), contornando o RBAC da API. Nenhuma migration para essa tabela foi localizada em `supabase/migrations/` nem `cuca-portal/supabase/migrations/` durante a investigação desta story — ou a policy foi aplicada fora de um arquivo versionado, ou está em local ainda não localizado. Isso em si é um achado a confirmar, não a corrigir às cegas.
2. **CRUD de exclusão de leads ausente em `/leads`** — confirmado nesta investigação: `cuca-portal/src/app/api/leads/` só contém a subrota `importar-atividades/`; não existe rota `DELETE` para leads individuais. A tela `cuca-portal/src/app/(dashboard)/leads/page.tsx` não tem ação de exclusão correspondente.
3. **Coluna `parameter_format` (NAMED/NUMBERED) ausente em `meta_templates`** — registrado como decisão de escopo pendente com @po no Change Log de S-WM-18 (2026-07-04). Hoje o worker assume o formato via `_montar_parametros_named()` sem uma coluna explícita que documente qual template é NAMED vs NUMBERED.
4. **Templates dormentes sem wiring de disparo completo** (`empregabilidade_convite_entrevista_v1`, `empregabilidade_feedback_empresa_v1`, `institucional_programacao_pontual_v1`) — confirmado nesta investigação: `empregabilidade_convite_entrevista_v1` não tem nenhum call site no worker nem no portal (grep vazio) — 100% órfão. `empregabilidade_feedback_empresa_v1` é referenciado em `feedback-submit/route.ts`, mas por decisão documentada em S-WM-16 (Change Log) o endpoint não envia o conjunto de parâmetros que o corpo real do template espera — divergência conhecida, nunca corrigida. `institucional_programacao_pontual_v1` só é alcançável via a tag genérica "Divulgação" em `campanhas_engine.py::_processar_item_disparo_interno` (linha ~251) — **ver item 5, mesmo dispatch path.**
5. **Desalinhamento semântico em `eventos_pontuais`** (ordem de campos vs template) — registrado no Change Log de S-WM-18 (2026-07-04): possível desalinhamento dormente em `institucional_programacao_pontual_v1` (posição 1 "nome" recebendo "titulo" do evento). **Mesmo template e mesmo dispatch path do item 4** — as duas investigações devem ser coordenadas: item 4 decide *se e como* o template passa a ser disparado; item 5 decide *se os parâmetros enviados batem com o template* quando ele dispara. Corrigir um sem considerar o outro pode reintroduzir o problema do outro.
6. **Teste unitário de `_montar_parametros_named()` ausente** — registrado no Change Log de S-WM-18. Função em `worker/campanhas_engine.py:144`, usada em 4 call sites (`campanhas_engine.py:344,349,551` e via import em `meta_adapter_inbound.py:389,395`) sem nenhum teste dedicado hoje.
7. **`menu_inicial` código morto em `processar_mensagem_empregabilidade`** — registrado no Change Log de S-WM-20 (achado de QA, 2026-07-04): o bloco de dispatch `etapa_atual == "menu_inicial"` (`worker/empregabilidade_engine.py:2325`) é hoje inalcançável — nenhum código no arquivo define mais essa etapa (as duas ocorrências que definiam foram eliminadas em correções anteriores desta mesma story de origem). Confirmado ainda presente nesta investigação.
8. **7 call sites em `_processar_empresa` sem `unidade_cuca` explícito** — registrado no Change Log de S-WM-20 (achado cosmético de QA, 2026-07-04): os call sites de `_escape_semantico_ou_none` dentro de `_processar_empresa` usam o default `""` em vez de passar o valor real, ao contrário dos call sites de `_processar_publico`. Sem efeito hoje porque `_rotear_por_intencao` não lê esse parâmetro — mas frágil se isso mudar.
9. **CodeRabbit nunca executado** — limitação de ambiente registrada em S-WM-18/20 ao longo de toda a sessão. **Este item é só registro de risco de processo — não entra em nenhuma Task de correção desta story** (não há o que corrigir; é uma lacuna de ferramenta indisponível no ambiente, não um bug).
10. **`EPIC-Migracao-WhatsApp-Meta.md` desatualizado desde S-WM-08** — confirmado nesta investigação: o arquivo (`docs/stories/EPIC-Migracao-WhatsApp-Meta.md`) tem `Status: Em definição` e a tabela de stories só cobre até S-WM-08; nenhuma menção a S-WM-09 até S-WM-20 (11 stories já entregues ou em andamento).

## Protocolo Obrigatório de Análise de Impacto (NON-NEGOTIABLE para os itens 1-8)

Para **cada um dos itens 1 a 8** (código, não documentação), a Task correspondente é dividida em **duas sub-tasks sequenciais, com gate entre elas**:

**Sub-task A — Mapeamento de Impacto (obrigatório, documentado no corpo da Task antes de qualquer diff):**
- Todos os call sites/usos reais da função, coluna ou componente afetado — **grep completo, citando arquivo:linha**, não suposição de que "provavelmente só é usado ali".
- Verificação explícita de **"action at a distance" / "shotgun surgery"**: algo mais no sistema depende do comportamento atual, mesmo que pareça não relacionado? Documentar o que foi checado e o resultado (achou dependência → documentar; não achou → documentar a checagem que descartou, não só "não achei nada").
- Avaliação se a correção proposta pode gerar **redundância**, **quebrar um contrato de dados usado em outro lugar**, ou **remover algo que outro fluxo também usa**.

**Sub-task B — Implementação:**
- A correção **implementada é a que o mapeamento da Sub-task A indicar como segura** — esta story não prescreve a solução de antemão para os itens 1-8 (ao contrário de stories anteriores desta migração), justamente para que a implementação não preceda o entendimento do raio de impacto.
- Só pode começar depois que a Sub-task A estiver documentada na Task (não em paralelo, não "documentando enquanto corrige").

Isso vale mesmo para itens que pareçam triviais (ex.: item 8, cosmético) — o histórico desta migração já mostrou 3 regressões causadas por mudança sem esse mapeamento prévio (ver Contexto).

## Escopo

### IN
- **Task 1** — RLS de `disparos_divulgacao`: Sub-task A (localizar a policy real via `mcp supabase` no cuca-dev — `list_tables`/`execute_sql` — já que nenhuma migration foi encontrada no repo para ela; mapear quem hoje insere/atualiza essa tabela: rota admin, worker, outro?) → Sub-task B (policy restritiva coerente com o mecanismo canônico do projeto — `has_permission(recurso, acao)` —, entregue como migration idempotente versionada).
- **Task 2** — CRUD de exclusão de leads: Sub-task A (mapear FKs/dependências de `leads` — matrículas, atividades, disparos, histórico de conversas — decidir se soft ou hard delete é seguro) → Sub-task B (rota `DELETE` + ação na UI).
- **Task 3** — Coluna `parameter_format`: Sub-task A (confirmar no Business Manager/pelos corpos de template já cadastrados quais são NAMED vs NUMBERED hoje) → Sub-task B (migration idempotente adicionando a coluna + populando os 6 templates existentes).
- **Task 4** — Wiring de disparo dos templates dormentes: Sub-task A (para cada um dos 3 templates, mapear onde a Task deveria disparar, e o que quebra/não quebra ao ligar — **coordenar explicitamente com a Sub-task A da Task 5**, mesmo dispatch path) → Sub-task B (wiring determinado pelo mapeamento).
- **Task 5** — Desalinhamento semântico em `eventos_pontuais`: Sub-task A (comparar ordem real de campos do template `institucional_programacao_pontual_v1` com o que o dispatch envia hoje — **ler o resultado da Sub-task A da Task 4 antes de propor a correção**) → Sub-task B.
- **Task 6** — Teste unitário de `_montar_parametros_named()`: Sub-task A (mapear os 4 call sites reais e os formatos de entrada que cada um passa hoje) → Sub-task B (testes cobrindo NAMED e NUMBERED, casos de borda de `variaveis`/`valores` desalinhados).
- **Task 7** — Remoção do código morto `menu_inicial`: Sub-task A (grep confirmando que não há nenhum caminho remanescente que define essa etapa, incluindo fora de `empregabilidade_engine.py`) → Sub-task B (remoção + pytest).
- **Task 8** — `unidade_cuca` explícito nos 7 call sites: Sub-task A (confirmar, para cada um dos 7, que passar o valor real não muda comportamento hoje, e checar se `_rotear_por_intencao` ou qualquer chamador futuro já esperado no roadmap passa a usá-lo) → Sub-task B.
- **Task 9** — Registro formal do risco de processo "CodeRabbit nunca executado": adicionar/atualizar entrada nos Riscos desta story e, se aplicável, no EPIC (Task 10). **Sem código, sem correção.**
- **Task 10** — Atualizar `EPIC-Migracao-WhatsApp-Meta.md`: refletir o estado real de S-WM-09 a S-WM-20 (status, o que foi entregue, débitos conhecidos incluindo os desta própria story), sem inventar detalhes não confirmados.

### OUT
- Implementação da Task 4 (validação cruzada com API real da Meta) de S-WM-16 — não é objeto desta story.
- Qualquer mudança de escopo em `_montar_parametros_named()` além de cobertura de teste (a função em si só muda se a Sub-task A do item 6 revelar um bug real, não por preferência de estilo).
- Instalar ou configurar CodeRabbit no ambiente — item 9 é só registro de risco, não resolução da limitação de ambiente.
- Aplicação de qualquer alteração em produção — todo desenvolvimento e validação ocorrem no cuca-dev/staging (`.claude/rules/cuca-deploy-environments.md`).
- Dividir esta story em stories menores — foi pedida como uma consolidação única; se @po avaliar que algum item deveria ser desmembrado, essa decisão é registrada na validação, não antecipada aqui.

## Critérios de Aceite

1. **Given** qualquer uma das Tasks 1-8, **when** o @qa revisa a implementação, **then** a Task contém uma seção "Mapeamento de Impacto" preenchida com call sites reais (arquivo:linha), avaliação de action-at-a-distance e avaliação de redundância/quebra de contrato, **com timestamp/registro anterior ao diff de código** — Task sem esse mapeamento documentado antes do diff é motivo de FAIL, independente da qualidade do código em si.
2. **Given** a Task 1, **when** aplicada, **then** a RLS de `disparos_divulgacao` deixa de permitir INSERT/UPDATE irrestrito, a policy final é coerente com `has_permission()` (padrão canônico do projeto) e existe migration idempotente versionada em `supabase/migrations/` para ela.
3. **Given** a Task 2, **when** aplicada, **then** existe uma ação de exclusão funcional para leads (soft delete via `UPDATE excluido=true`, mesmo padrão arquitetural já usado pelas demais ações de escrita desta página — bloquear, opt-in, limpar tags — nenhuma delas passa por rota de API própria), com a decisão soft/hard justificada pelo mapeamento de FKs da Sub-task A, e ação correspondente na UI de `/leads`. *(Redação ajustada por @po em 2026-07-05 — o texto original previa "rota DELETE"; a decisão de soft delete, tomada durante a execução por causa do cascade em 10 FKs incluindo `conversas`/`mensagens`, tornou esse texto impreciso. Comportamento e intenção do AC continuam os mesmos, só a descrição do mecanismo foi corrigida.)*
4. **Given** a Task 3, **when** aplicada, **then** `meta_templates` tem coluna `parameter_format`, populada corretamente para os 6 templates existentes conforme confirmado na Sub-task A (não suposição).
5. **Given** as Tasks 4 e 5, **when** aplicadas, **then** os 3 templates dormentes passam a ter wiring real de disparo (ou a Sub-task A documenta explicitamente por que algum não deve ser ligado ainda) **e** `institucional_programacao_pontual_v1` recebe parâmetros na ordem correta quando disparado — as duas Tasks devem ser coerentes entre si (não introduzir de novo o problema uma da outra).
6. **Given** a Task 6, **when** aplicada, **then** `_montar_parametros_named()` tem teste unitário cobrindo NAMED, NUMBERED e pelo menos 1 caso de borda (ex.: `variaveis`/`valores` de tamanhos diferentes), sem regressão na suíte completa.
7. ~~**Given** a Task 7, **when** aplicada, **then** `grep 'etapa_atual == "menu_inicial"'` em `worker/empregabilidade_engine.py` não retorna mais o bloco morto, e `pytest worker/tests/` passa sem regressão.~~ **WAIVED (@po, 2026-07-05).** A premissa deste AC (achado de S-WM-20, Change Log de 2026-07-04: "nenhum código no arquivo define mais `menu_inicial`") deixou de existir por trabalho posterior dentro da própria S-WM-20 ("Task 5, 4 ajustes pós-redeploy"), **antes mesmo desta story começar** — `menu_inicial` foi reintroduzido como etapa viva e intencional (bypass global "menu"), com dispatch próprio (`_processar_menu_inicial`) e cobertura de teste dedicada (`test_ambiguo_define_menu_inicial_com_dígito_restaurado`, entre outros). @qa confirmou de forma independente (não só o relato do @dev) rastreando os 2 pontos que setam a etapa, o dispatch e os testes que o exercitam. Cumprir este AC como escrito exigiria remover funcionalidade viva e testada — seria uma regressão, não uma correção. **Decisão:** waived, sem ação de código. Nenhum "código morto" restava para a Task 7 corrigir; a Task foi encerrada com o mapeamento documentando esse achado, que é o resultado correto dado o estado real do código.
8. **Given** a Task 8, **when** aplicada, **then** os 7 call sites de `_escape_semantico_ou_none` dentro de `_processar_empresa` passam `unidade_cuca` explícito, sem mudança de comportamento observável hoje (confirmado por pytest).
9. **Given** a Task 9, **when** concluída, **then** o risco "CodeRabbit nunca executado" está registrado na seção Riscos desta story (e, se aplicável, no EPIC), sem nenhuma tentativa de "corrigir" a limitação de ambiente.
10. **Given** a Task 10, **when** concluída, **then** `EPIC-Migracao-WhatsApp-Meta.md` reflete o status real de todas as stories até S-WM-20, incluindo os débitos consolidados por esta própria story, sem inventar detalhes não confirmados por código/histórico (Artigo IV — No Invention).
11. **Given** a suíte `pytest worker/tests/` e os quality gates do portal (lint/typecheck), **when** executados ao final de todas as Tasks de código, **then** passam sem regressão.

## 🤖 CodeRabbit Integration

**Story Type Analysis:** Consolidação de débitos técnicos multi-camada (RLS, CRUD, schema, wiring de mensageria, testes, limpeza de código morto, documentação) — sem feature nova. Complexidade **L/XL** (heterogeneidade dos 10 itens, não profundidade individual).

**Primary Agents:**
- `@dev` — mapeamento de impacto (Sub-task A) e implementação (Sub-task B) de cada item.
- `@qa` — validação independente de cada Task, incluindo rejeição de qualquer diff sem Mapeamento de Impacto documentado antes dele (AC1).

**Supporting Agents:**
- `@po` — decisão de sequenciamento/desmembramento, se necessária durante a execução (ver Riscos).

**Quality Gate Tasks:**
- [ ] Pre-Commit (`@dev`): revisar, por Task, se a seção "Mapeamento de Impacto" foi escrita e datada antes do diff correspondente — não só se o diff existe.
- [ ] Pre-PR (`@devops`): gates completos (pytest/lint/typecheck) e confirmação de que nenhuma migration foi aplicada em produção.
- [ ] Pre-Deployment (`@devops` + Junior): aplicação em produção é passo humano controlado, fora do escopo desta story (`.claude/rules/cuca-deploy-environments.md`).

**Self-Healing:** modo light do `@dev` (2 iterações/15 min, CRITICAL/HIGH), **não executável neste ambiente** — CodeRabbit CLI indisponível (mesma limitação registrada em S-WM-18/20 e formalizada como risco de processo no item 9 desta própria story). Mitigação vigente: revisão manual linha a linha no gate do `@qa`, sem substituto automatizado.

**Focus Areas:**
- Segurança (RLS, item 1) e proteção de dados (exclusão de leads, item 2).
- Integridade de schema/migration (itens 1, 3).
- Coerência entre os dispatch paths compartilhados (itens 4 e 5 — mesmo template/fluxo).
- Cobertura de teste sem regressão em toda a suíte do worker (itens 6, 7, 8).
- Fidelidade documental sem invenção (item 10, Artigo IV).

## Tasks / Subtasks

- [x] **Task 1 — RLS de `disparos_divulgacao`** (AC: 1, 2)
  - [x] Sub-task A — Mapeamento de Impacto: localizar a policy real via MCP Supabase (cuca-dev); mapear quem hoje insere/atualiza a tabela (rota admin, worker, outro).
  - [x] Sub-task B — Implementação: policy restritiva coerente com `has_permission(recurso, acao)`, entregue como migration idempotente versionada.
- [x] **Task 2 — CRUD de exclusão de leads** (AC: 1, 3)
  - [x] Sub-task A — Mapeamento de Impacto: FKs/dependências de `leads` (matrículas, atividades, disparos, histórico de conversas); decidir soft vs hard delete.
  - [x] Sub-task B — Implementação: soft delete (decisão do usuário) + ação correspondente na UI de `/leads`.
- [x] **Task 3 — Coluna `parameter_format` em `meta_templates`** (AC: 1, 4)
  - [x] Sub-task A — Mapeamento de Impacto: confirmar quais dos 6 templates existentes são NAMED vs NUMBERED hoje (não assumir).
  - [x] Sub-task B — Implementação: migration idempotente adicionando a coluna + populando os 6 templates existentes.
- [x] **Task 4 — Wiring de disparo dos templates dormentes** (AC: 1, 5)
  - [x] Sub-task A — Mapeamento de Impacto: para cada um dos 3 templates, mapear onde deveria disparar e o que quebra/não quebra ao ligar. **Coordenar com a Sub-task A da Task 5 — mesmo dispatch path.**
  - [x] Sub-task B — Implementação: `institucional_programacao_pontual_v1` wireado. `empregabilidade_convite_entrevista_v1`/`empregabilidade_feedback_empresa_v1` — mapeamento indicou redesenho de endpoint (ver Debug Log); **decisão do usuário: virar story separada**, não implementado nesta story.
- [x] **Task 5 — Desalinhamento semântico em `eventos_pontuais`** (AC: 1, 5)
  - [x] Sub-task A — Mapeamento de Impacto: comparar ordem real de campos de `institucional_programacao_pontual_v1` com o que o dispatch envia hoje. **Ler o resultado da Sub-task A da Task 4 antes de propor a correção.**
  - [x] Sub-task B — Implementação: correção coerente com a Task 4 — concluída (6 posições, não só a 1ª).
- [x] **Task 6 — Teste unitário de `_montar_parametros_named()`** (AC: 1, 6)
  - [x] Sub-task A — Mapeamento de Impacto: mapear os 4 call sites reais e os formatos de entrada de cada um.
  - [x] Sub-task B — Implementação: testes cobrindo NAMED, NUMBERED e casos de borda.
- [x] **Task 7 — Remoção do código morto `menu_inicial`** (AC: 1, 7 — ver nota)
  - [x] Sub-task A — Mapeamento de Impacto: grep confirmou que a premissa mudou (ver Debug Log) — `menu_inicial` foi reintroduzido como etapa viva e testada após o achado original de S-WM-20.
  - [x] Sub-task B — Implementação: **nenhuma** — remover quebraria funcionalidade viva (bypass "menu"). AC7 como escrita não se aplica mais; sinalizado para @po/@qa.
- [x] **Task 8 — `unidade_cuca` explícito nos 7 call sites** (AC: 1, 8)
  - [x] Sub-task A — Mapeamento de Impacto: confirmar, para cada um dos 7, que passar o valor real não muda comportamento hoje; checar futuros chamadores de `_rotear_por_intencao`.
  - [x] Sub-task B — Implementação: correção + `pytest` sem regressão.
- [x] **Task 9 — Registro do risco "CodeRabbit nunca executado"** (AC: 9)
  - [x] Confirmar/atualizar entrada nos Riscos desta story (já presente desde o draft) e, via Task 10, no EPIC (seção 5.1, "Débitos técnicos conhecidos"). Sem código.
- [x] **Task 10 — Atualizar `EPIC-Migracao-WhatsApp-Meta.md`** (AC: 10)
  - [x] Refletir o estado real de S-WM-09 a S-WM-20, **incluindo esta própria story (S-WM-19)** na tabela de stories, sem inventar detalhes não confirmados.
- [x] **Task 11 — Regressão final** (AC: 11)
  - [x] `pytest worker/tests/` completo e gates do portal (lint/typecheck) sem regressão, ao final de todas as Tasks de código.

## Dependências
- S-WM-16 (origem dos itens 3, 6) — Done.
- S-WM-18 (origem dos itens 1, 3, 5, 6, 9) — Done.
- S-WM-20 (origem dos itens 7, 8, 9) — Done.
- `.claude/rules/cuca-deploy-environments.md` — todo desenvolvimento/validação no cuca-dev, nunca produção; migrations idempotentes e retrocompatíveis.
- Mecanismo canônico `has_permission(recurso, acao)` (referenciado nas regras de RLS do projeto) para a Task 1.

## Riscos
- **Itens 4 e 5 compartilham o mesmo dispatch path** (`institucional_programacao_pontual_v1` / `_processar_item_disparo_interno`) — corrigir um sem olhar o outro é o tipo exato de "action at a distance" que o Protocolo Obrigatório desta story existe para prevenir. Tratar como investigação conjunta antes de qualquer diff em qualquer um dos dois.
- **RLS de `disparos_divulgacao` (item 1) pode não ter migration versionada** — se a policy viva no banco não corresponder a nenhum arquivo em `supabase/migrations/`, isso é uma lacuna de rastreabilidade a resolver junto (a correção deve sair como migration nova, não como `apply_migration` solto sem arquivo correspondente).
- **CodeRabbit nunca executado (item 9)** — risco de processo aceito e recorrente nesta migração: revisão automatizada de qualidade não está disponível neste ambiente; mitigação atual é revisão manual linha a linha no gate do @qa. Não é resolvido por esta story, só formalmente registrado.
- **Heterogeneidade dos 10 itens** — esta story cobre RLS, CRUD, schema, wiring de mensageria, testes, limpeza de código morto e documentação. Cada item é independentemente entregável; se a execução mostrar que algum item bloqueia ou atrasa desproporcionalmente os demais, isso deve ser levantado com @po durante a validação (não decidido unilateralmente pelo @dev em execução).
- **Item 2 (exclusão de leads)** — se o mapeamento de FKs (Sub-task A) revelar dependências não triviais (ex.: matrículas ativas, histórico de conversas), a decisão soft vs hard delete pode exigir confirmação explícita de Junior antes da Sub-task B — não assumir hard delete por padrão.

## Estimativa
**L/XL** — 10 itens heterogêneos, cada um com uma etapa de investigação obrigatória antes da implementação (não é uma consolidação "rápida" por ser pequena por item; o protocolo de mapeamento é deliberadamente mais lento que uma correção direta). Itens são independentemente entregáveis — @po pode avaliar sequenciamento ou desmembramento durante a validação.

## Dev Notes

### Sobre não prescrever a solução (itens 1-8)
Ao contrário de S-WM-16 (que já veio com diffs específicos linha-a-linha pré-definidos), esta story **deliberadamente não define** a implementação exata de cada correção — isso é resultado esperado da Sub-task A de cada Task, não um input desta story. Se durante a Sub-task A o @dev encontrar uma solução óbvia e de baixo risco, ainda assim documentar o mapeamento antes de aplicá-la — o valor do protocolo está no hábito, não em cada caso isolado parecer "necessário".

### Sobre o item 1 (RLS) especificamente
Não foi possível localizar, nesta investigação, nenhuma migration em `supabase/migrations/` ou `cuca-portal/supabase/migrations/` que crie a tabela `disparos_divulgacao` ou sua RLS. O @dev deve tratar isso como parte da Sub-task A — confirmar via MCP Supabase (`list_tables`, `execute_sql` no cuca-dev) o estado real da tabela e da(s) policy(ies) hoje, antes de assumir que sabe o que precisa mudar.

### Testing
- Worker: `pytest worker/tests/` — rodar suíte completa após cada Task de código (1-8 que tocam worker), não só ao final.
- Frontend: sem suíte automatizada nas telas tocadas (`/leads`) — validação manual + QA gate, mesmo padrão já usado nas stories desta migração.
- Migrations (Tasks 1, 3): aplicar via `apply_migration` no cuca-dev e confirmar via `execute_sql`, nunca em produção.

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

#### Task 1 — RLS de `disparos_divulgacao` (2026-07-05)

**Mapeamento de Impacto (antes de qualquer diff):** consultei `pg_policies` no cuca-dev via MCP Supabase — 3 policies em `authenticated`: `auth_insert_disparos_divulgacao` (WITH CHECK=true), `auth_update_disparos_divulgacao` (USING=true), `auth_read_disparos_divulgacao` (USING=true, SELECT). Grep completo nos 2 únicos consumidores do código: `worker/campanhas_engine.py:108,456` usa `SUPABASE_SERVICE_ROLE_KEY` (RLS não se aplica); `cuca-portal/src/app/api/divulgacao/disparar/route.ts` faz o INSERT/duplicidade/UPDATE reais via `createAdminClient()` (service_role) — a autorização de verdade já é 100% em código (`autorizar()`/`avaliarAcesso()` lendo `sys_permissions.can_create`/`can_read`), a RLS permissiva não é o que protege a rota, só permite bypass via client autenticado direto. Terceiro consumidor achado (`divulgacao/page.tsx:164`) é **só SELECT** via client autenticado — fora do escopo desta task (AC2 só cobre INSERT/UPDATE); não toquei a policy de leitura para não arriscar regressão num caminho que não é o achado de segurança. Confirmei que `has_permission(p_recurso, p_acao)` existe (SECURITY DEFINER, `sys_permissions.module LIKE p_recurso || '%'`) e que `module = 'divulgacao'` já existe em `sys_permissions` — nenhuma criação de recurso nova necessária. **Redundância/quebra de contrato:** nenhuma — como todo write real já passa por service_role, apertar as 2 policies não muda nenhum comportamento funcional hoje, só fecha o bypass.

**Implementação:** migration `supabase/migrations/20260705000000_wm19_rls_disparos_divulgacao_insert_update.sql`, aplicada via `apply_migration` no cuca-dev. `auth_insert_disparos_divulgacao` → `WITH CHECK (has_permission('divulgacao','create'))`; `auth_update_disparos_divulgacao` → `USING`/`WITH CHECK (has_permission('divulgacao','update'))`. Confirmado via `pg_policies` pós-aplicação.

#### Task 6 — Teste unitário de `_montar_parametros_named()` (2026-07-05)

**Mapeamento de Impacto:** grep confirmou os 4 call sites reais — `campanhas_engine.py:344` (ramo `ouvidoria_eventos`, 2 valores), `campanhas_engine.py:349` (ramo padrão de evento pontual, 6 valores), `campanhas_engine.py:551` (divulgação mensal, 2 valores) e `meta_adapter_inbound.py:395` (transbordo, via import lazy, 3 valores). Todos passam `variaveis` vindo de `meta_templates.variaveis` (lista de dicts com `posicao`/`descricao`) e uma lista de strings `valores` na ordem esperada.

**Achado durante a implementação (parou a sequência momentaneamente, revertido antes de prosseguir):** `campanhas_engine.py` faz `from supabase import create_client, Client` + `create_client(...)` no topo do módulo. O pacote `supabase` não estava instalado neste ambiente (`.venv` local) — mesma limitação já documentada por @dev em `test_empregabilidade_engine.py` (S-WM-20). Tentei inicialmente instalar `supabase==2.7.4` para viabilizar o import direto do meu teste; isso (a) rebaixou `httpx` de 0.28.1 para 0.27.2 (dependência compartilhada) e (b) fez `create_client` real executar de verdade no import de `campanhas_engine.py` **e** de `empregabilidade_engine.py` (mesmo padrão de módulo), falhando com `SupabaseException: supabase_url is required` — **quebrando a coleta de `test_empregabilidade_engine.py`, que antes passava** (104 passed, 3 skipped na baseline). Revertido imediatamente: `pip uninstall supabase` + dependências trazidas por ele, `httpx` reinstalado em 0.28.1. Ambiente restaurado ao estado original antes de prosseguir — nenhuma dependência real nova ficou instalada.

**Implementação correta (sem alterar ambiente):** reaproveitei o mesmo stub de `sys.modules["supabase"]` já usado em `test_empregabilidade_engine.py` (`types.ModuleType` + `MagicMock` para `create_client`/`Client`) em vez de depender do pacote real — consistente com o padrão já estabelecido no projeto para este exato problema. 9 testes novos em `worker/tests/test_campanhas_engine.py`: ordenação por `posicao` independente da ordem de entrada, os 3 formatos reais (transbordo/divulgação/evento pontual), `variaveis=None`, `valores=[]`, fallback de `parameter_name` quando `descricao` ausente, e os 2 casos de borda de tamanhos desalinhados (valores a mais / variáveis a mais — `zip` trunca no menor, sem exception).

`pytest worker/tests/`: **113 passed, 3 skipped** (104 da baseline + 9 novos), sem regressão.

#### Tasks 4+5 — Templates dormentes + desalinhamento eventos_pontuais (2026-07-05) — PARCIAL, pausada por decisão

**Mapeamento de Impacto (via cuca-dev, os 3 templates):**
- `institucional_programacao_pontual_v1`: `automacoes=["Institucional","Pontual"]`, `phone_number_ids=["1233832826470497"]` (canal Institucional), `variaveis` na ordem `nome, titulo_evento, descricao_evento, data_evento, horario_evento, local_evento` (6 posições).
- `empregabilidade_convite_entrevista_v1`: `automacoes=["Empregabilidade","Convite"]`, `variaveis`: `primeiro_nome, titulo_vaga, data_entrevista, horario_entrevista, local_entrevista` (5 posições). Zero call site em todo o repositório (grep vazio, confirmado antes desta story).
- `empregabilidade_feedback_empresa_v1`: `automacoes=["Empregabilidade"]`, `variaveis`: `nome_empresa, titulo_vaga, link_feedback` (3 posições).
- `meta_phone_numbers.canal_tipo` no cuca-dev só tem os valores `Empregabilidade` e `Institucional` — **`Divulgação` nunca existiu como canal**, e **nenhum template tem a tag `Divulgação`** em `automacoes` (confirmado consultando os 6 templates ativos/aprovados). `eventos_pontuais` e `ouvidoria_eventos` estão com 0 linhas no cuca-dev — zero risco de dado ao mudar a lógica de dispatch.

**Item 4 + Item 5 — `institucional_programacao_pontual_v1` (mesmo dispatch path, corrigidos juntos): CONCLUÍDO.**
`_processar_item_disparo_interno` (`worker/campanhas_engine.py`) usava `canal_tipo="Divulgação"` e `automacao_tag="Divulgação"` para `origem="eventos_pontuais"` — **nenhum dos dois valores existe no banco**, então o item sempre falhava no próprio lookup de telefone (linha 238-245, antes de chegar no template) — confirma o item 4 (dormência). Corrigido para `canal_tipo="Institucional"` + match exato de 2 tags `["Institucional","Pontual"]` (generalizei `automacao_filtro` de string única para lista de tags, preservando a sintaxe de array literal Postgres já documentada no código — necessária desde o bug de S-WM-16/18). Além disso, confirmei que a lista de valores enviada ao template (branch `else` de `origem` na montagem de `components`) estava **desalinhada nas 6 posições, não só na 1ª como a story antecipava**: enviava `[titulo, descricao, data_fmt, hora_inicio, local_evento, unidade]` contra o template esperando `[nome, titulo_evento, descricao_evento, data_evento, horario_evento, local_evento]` — ou seja, a posição 1 (nome do lead) nunca era enviada, e todo o resto ficava deslocado. Corrigido para `[nome_lead, titulo, descricao, data_fmt, hora_inicio, local_evento]`, removendo o `unidade` solto (já embutido em `local_evento` via fallback, linha 323 — enviá-lo separado criaria uma 7ª posição sem `variaveis` correspondente). `pytest worker/tests/`: 113 passed, 3 skipped, sem regressão (nenhum teste existente cobre `_processar_item_disparo_interno` diretamente). **Não toquei** o branch `ouvidoria_eventos` (`automacao_tag="Ouvidoria"`, também sem template correspondente hoje) nem o branch `else`/default (inalcançável — `campanhas_loop()` só chama com `origem` em `{"eventos_pontuais","ouvidoria_eventos"}`) — nenhum dos dois faz parte dos 3 templates nomeados no item 4; registrado como achado à parte, não corrigido (fora do escopo desta story).

**Item 4 — `empregabilidade_convite_entrevista_v1` e `empregabilidade_feedback_empresa_v1`: PAUSADO, reportando antes de continuar (instrução explícita do usuário: mapeamento revelando risco/escopo maior).**

O mapeamento destes 2 templates revelou algo maior do que "wiring ausente/params errados no lugar onde já estão referenciados":

1. **`empregabilidade_feedback_empresa_v1` está referenciado no endpoint errado.** `feedback-submit/route.ts` (chamado *depois* que a empresa já enviou o feedback) hoje monta manualmente `components` com `[vaga.titulo, empresa.nome, String(aprovados)]`, **sem `parameter_name`** (mesmo bug NAMED de S-WM-18 — a Graph API vai rejeitar com HTTP 400 "(#100) Parameter name is missing or empty") e na ordem errada (nem bate com `[nome_empresa, titulo_vaga, link_feedback]` do template, nem existe um `link_feedback` real calculado nessa rota). O `corpo_texto` do template ("Para registrar o feedback, acesse: {{3}}...") é claramente uma mensagem **pedindo** feedback — ou seja, semanticamente pertence a `solicitar-feedback/route.ts` (a rota que roda *antes*, pedindo feedback), não a `feedback-submit`. Hoje `solicitar-feedback/route.ts` envia **texto livre** via `/send-message` do worker (não usa template Meta nenhum) — o que é uma contatação proativa fora de template aprovado, o tipo de coisa que a regra do projeto (`.claude/rules/cuca-deploy-environments.md` — "automações proativas exigem templates pré-aprovados, janela de 24h") sinaliza como exigência.
2. **`empregabilidade_convite_entrevista_v1` (convite de entrevista ao candidato) não tem nenhum call site — mas o lugar natural para ele existe e nunca foi conectado.** Confirmei via `information_schema.columns` que `candidaturas` já tem `nome`, `telefone`, `data_entrevista`, `hora_entrevista`, `local_entrevista` — exatamente os dados que `feedback-submit/route.ts` já grava (linhas 48-51) quando `evalItem.status === 'aprovado_empresa'`. Ou seja, o candidato aprovado para entrevista **nunca é notificado** — o template de convite existe, aprovado na Meta, e nunca dispara.

**Por que parei aqui em vez de corrigir "no lugar":** simplesmente reordenar os 3 parâmetros dentro de `feedback-submit/route.ts` resolveria o sintoma técnico (HTTP 400) mas manteria uma mensagem semanticamente errada indo para o destinatário errado no momento errado, e deixaria `empregabilidade_convite_entrevista_v1` continuar 100% órfão e `solicitar-feedback/route.ts` num caminho de compliance duvidoso (texto livre proativo). A correção que o mapeamento aponta como certa — mover `empregabilidade_feedback_empresa_v1` para `solicitar-feedback/route.ts` (substituindo o texto livre) e adicionar o disparo de `empregabilidade_convite_entrevista_v1` para o candidato dentro do branch `aprovado_empresa` de `feedback-submit/route.ts` — é uma mudança de comportamento proativo novo (contata um destinatário que hoje não é contatado) em 2 arquivos que a story não nomeou explicitamente, não um ajuste local de parâmetros. Isso é exatamente o tipo de decisão que o protocolo desta story pede para não tomar sozinho.

**Nenhum diff aplicado em `feedback-submit/route.ts` ou `solicitar-feedback/route.ts`.** Decisão do usuário (2026-07-05): **virar story separada** — não implementar nesta story. Registro para a story futura (@sm/@po):

> **Débito a virar story:** wiring de `empregabilidade_convite_entrevista_v1` e `empregabilidade_feedback_empresa_v1`. Escopo sugerido: (1) `solicitar-feedback/route.ts` passa a enviar `empregabilidade_feedback_empresa_v1` (params `nome_empresa, titulo_vaga, link_feedback` — todos já calculados na rota) em vez de texto livre via `/send-message`, resolvendo o gap de compliance (proativo fora de template aprovado); (2) `feedback-submit/route.ts`, no branch `evalItem.status === 'aprovado_empresa'`, passa a disparar `empregabilidade_convite_entrevista_v1` para o **candidato** (telefone/nome já em `candidaturas.telefone`/`.nome`, datas em `candidaturas.data_entrevista`/`hora_entrevista`/`local_entrevista`) e deixa de mandar a mensagem atual (errada) para a empresa. Ambos precisam de `parameter_name` (templates NAMED, mesmo padrão de `_montar_parametros_named`). Mapeamento completo já feito nesta story (ver acima) — a story nova pode partir direto da Sub-task B.

#### Task 3 — Coluna `parameter_format` em `meta_templates` (2026-07-05)

**Mapeamento de Impacto:** grep por `parameter_name`/`NUMBERED`/`positional` em todo `worker/` e nas rotas admin de templates — zero caminho de envio NUMBERED existe hoje; `_montar_parametros_named()` é o único ponto real de montagem de `parameters` e sempre emite `parameter_name`. Confirmado ainda: nenhum código lê uma coluna `parameter_format` hoje (grep vazio) — adição 100% aditiva, sem consumidor a quebrar.

**Implementação:** migration `supabase/migrations/20260705000001_wm19_meta_templates_parameter_format.sql`, aplicada via `apply_migration`. Coluna `text not null default 'NAMED'` com `check (parameter_format in ('NAMED','NUMBERED'))` — o default populou automaticamente os 6 registros existentes (confirmado via `execute_sql`: todos os 6 = `NAMED`).

#### Task 2 — CRUD de exclusão de leads em `/leads` (2026-07-05) — PAUSADA antes da implementação

**Mapeamento de Impacto:**
- Confirmado que `leads/page.tsx` não tem nenhuma ação de exclusão de `leads` (o único `.delete()` na página é em `lead_atividades`, sub-registro, não a linha do lead).
- **RLS de `leads` já tem policy de DELETE**: `"Leads: Deleção permitida com permissão"` — `has_permission('leads','delete')`. Ou seja, a trava de segurança para deleção **já existe e é canônica** — o que falta é só a ação na UI, não uma policy nova.
- **FKs apontando para `leads.id` — 14 tabelas**, sendo **10 com `ON DELETE CASCADE`**: `candidatos`, `conversas`, `mensagens`, `historico_opt_in`, `inscricoes_eventos`, `lead_atividades`, `lead_interesses`, `logs_disparo`, `participacoes_escuta`, `solicitacoes_acesso`. As outras 4 (`ae_conversas`, `ae_presencas`, `feedbacks`, `ouvidoria_registros`) são `ON DELETE SET NULL`. Ou seja, um `DELETE` real em `leads` hoje **apaga em cascata todo o histórico de conversas e mensagens WhatsApp do lead**, além de candidaturas, inscrições em eventos e logs de disparo — sem possibilidade de recuperação.
- **Achado lateral (não bloqueante, registrado para atenção futura, não corrigido aqui):** `has_permission('recurso', acao)` casa por `sp.module LIKE p_recurso || '%'`. Não existe módulo `sys_permissions` chamado exatamente `leads` — só variantes prefixadas (`leads_anonimizar`, `leads_bloquear`, `leads_novo`, `leads_output`, `leads_overview`). Isso significa que a policy de DELETE de `leads` hoje é satisfeita por `can_delete=true` em **qualquer** desses módulos, não só um "módulo de exclusão" dedicado — em tese mais permissivo do que o nome da policy sugere. Consultei quem tem `can_delete=true` nesses módulos hoje: **só `Developer` e `Super Admin Cuca`** — e ambos os papéis já dão bypass total em `has_permission()` antes mesmo de chegar nessa checagem (`is_developer()` e nome de role, passos 1-3 da função). Ou seja, hoje isso é um risco **latente, não ativo** — nenhum papel não-privilegiado tem esse `can_delete` concedido. Não corrigi (fora do escopo do item 2), só registrado.

**Por que parei antes da Sub-task B:** a própria story já antecipava esse cenário no Risco "Item 2" — "se o mapeamento de FKs revelar dependências não triviais... a decisão soft vs hard delete pode exigir confirmação explícita de Junior antes da Sub-task B — não assumir hard delete por padrão." O mapeamento confirmou exatamente isso: 10 tabelas em CASCADE, incluindo histórico de conversa/mensagens — dado real de produção potencialmente irrecuperável. Como a RLS de DELETE já existe e é canônica (não uma lacuna de segurança), a pergunta não é "posso implementar", é "devo implementar exclusão física dado esse raio de cascata, ou soft delete (`excluido`/`ativo` — `leads` não tem hoje nenhuma coluna equivalente, só `bloqueado`, que já significa outra coisa: bloqueado de receber mensagem, não removido da lista)". Reportado ao usuário antes de escrever qualquer migration ou código.

**Decisão do usuário (2026-07-05): soft delete.** Implementado:
- Migration `supabase/migrations/20260705000002_wm19_leads_soft_delete.sql`: coluna `leads.excluido boolean not null default false` + índice. Aplicada via `apply_migration` no cuca-dev.
- `Lead` type (`cuca-portal/src/lib/types/database.ts`) atualizado com `excluido: boolean`.
- `leads/page.tsx`: `buscarLeads()` agora filtra `.eq("excluido", false)` incondicionalmente (soft-deletado nunca aparece na listagem, independente de outros filtros). Novo item "Excluir" no dropdown de ações da linha (mesmo padrão visual de "Bloquear" — `text-destructive`), abrindo modal de confirmação próprio que deixa explícito que histórico de conversas/mensagens/candidaturas é preservado (não é a mesma coisa que apagar). `excluirLead()` faz `update({excluido:true})` via client autenticado — passa pela RLS de **UPDATE** (`has_permission('leads','update')`), não pela de DELETE.
- **Nota explícita:** a policy de DELETE (`has_permission('leads','delete')`) já existente **permanece sem uso** após esta decisão — não foi removida (não é reversível com segurança sem confirmar que nada mais depende dela), só não é mais o caminho usado pela feature de exclusão da UI. Registrado aqui para não parecer código morto "descoberto por acaso" numa auditoria futura.
- `npx tsc --noEmit`: erro pré-existente em `tests/divulgacao-disparar-logic.test.ts` (import de `.ts`, não relacionado, arquivo não tocado por mim) — nenhum erro novo nos arquivos desta task. `npx eslint` nos 2 arquivos tocados: todos os erros/warnings reportados são de linhas fora do meu diff (confirmado por número de linha) — nenhum introduzido.

#### Task 7 — Remoção do código morto `menu_inicial` (2026-07-05) — ACHADO: premissa do débito ficou obsoleta, nada a remover

**Mapeamento de Impacto:** grep fresco em `worker/empregabilidade_engine.py` mostrou algo diferente do que o item 7 descrevia. O achado original (Change Log de S-WM-20, 2026-07-04) dizia que **nenhum código no arquivo definia mais `"etapa": "menu_inicial"`** — mas isso foi escrito **antes** da própria S-WM-20 continuar com a "Task 5 (4 ajustes pós-redeploy)", que **reintroduziu** `menu_inicial` como etapa real e viva: linha 2302-2305, o bypass global de "menu" agora faz `_set_fluxo(conversa_id, {"etapa": "menu_inicial"})` de propósito, e a linha 2325 (`if etapa_atual == "menu_inicial": await _processar_menu_inicial(...)`) é o dispatch que trata a resposta seguinte do usuário a esse menu. `_processar_menu_inicial` (definida na linha 2387) é uma função real, ativamente testada — `worker/tests/test_empregabilidade_engine.py` a chama diretamente (linhas 375, 399) e tem um teste dedicado (`test_ambiguo_define_menu_inicial_com_dígito_restaurado`) cobrindo exatamente esse dispatch.

**Conclusão: não há código morto para remover.** A premissa do item 7 (documentada em 2026-07-04) ficou desatualizada por trabalho posterior dentro da própria S-WM-20 — remover esse bloco **quebraria o bypass global "menu"**, uma funcionalidade viva e testada, não uma limpeza segura. Nenhum diff aplicado. Item considerado verificado/encerrado por confirmação de que o achado original não se aplica mais — não por implementação.

#### Task 8 — `unidade_cuca` explícito nos 7 call sites (2026-07-05)

**Mapeamento de Impacto:** confirmados os 7 call sites de `_escape_semantico_ou_none` dentro de `_processar_empresa` (linhas 449, 490, 571, 741, 947, 972, 1042 — deslocadas do achado original por trabalho posterior de S-WM-20, mesma contagem de 7). Todos usam o default `unidade_cuca=""` do parâmetro. Rastreei o caminho completo até o consumidor final: `_escape_semantico_ou_none` → (quando `mudou_de_assunto`) `_perguntar_confirmacao_troca_rota` → persiste em `fluxo["_troca_rota_unidade_cuca"]` → etapa `confirmando_troca_rota` em `processar_mensagem_empregabilidade` → `_rotear_por_intencao(..., unidade_pendente, ...)`. **Confirmei lendo o corpo inteiro de `_rotear_por_intencao` (todas as 5 ramificações de intenção) que `unidade_cuca` é só um parâmetro aceito, nunca lido/usado em nenhum branch** — mesma conclusão do achado original de S-WM-20, mesmo após o dado percorrer um caminho mais longo (fluxo persistido) do que a versão do código na época do achado. Sem efeito comportamental hoje, confirmado de ponta a ponta, não só localmente.

**Implementação:** `unidade_cuca` adicionado como argumento posicional nos 7 call sites (`replace_all` sobre a assinatura de chamada idêntica, confirmada por grep antes = 7 ocorrências exatas). `pytest worker/tests/`: 113 passed, 3 skipped, sem regressão.

#### Task 10 — Atualizar `EPIC-Migracao-WhatsApp-Meta.md` (2026-07-05)

Confirmado que o EPIC estava parado no plano de 2026-06-22 (tabelas "Fase 0-3", só até S-WM-08). Ao checar o status real de **todas** as stories S-WM-00 a S-WM-20 (não só 09-20 — a AC10 pede "todas as stories até S-WM-20"), descobri que várias mudaram de título/escopo entre o plano e a execução (ex.: S-WM-04 planejado como "Migrar Empregabilidade → WABA #2", executado como "Dispatch Completo: Institucional, Sofia, Ana via Motor-Agente"). Li o H1 e o campo `## Status` de cada arquivo em `docs/stories/` diretamente (sem inventar) e adicionei a seção "5.1 Estado Real das Stories" com título+status reais das 21 stories, mais o registro dos débitos consolidados por esta própria story (corrigidos vs. adiado para story separada). **Não removi** as tabelas de plano original da seção 5 — mantidas como registro histórico, com nota explícita de que divergem da execução.

#### Regressão final (Task 11)

`pytest worker/tests/`: 113 passed, 3 skipped. `npx tsc --noEmit` (cuca-portal): 1 erro pré-existente e não-relacionado em `tests/divulgacao-disparar-logic.test.ts` (import de `.ts`, arquivo nunca tocado nesta story) — confirmado via `git status` que não está entre os arquivos modificados. `npx eslint` nos arquivos tocados: zero erros novos (todos pré-existentes, por linha).

### Completion Notes List
- **Task 1: concluída.** RLS de `disparos_divulgacao` não permite mais INSERT/UPDATE irrestrito; migration idempotente (`drop policy if exists` + `create policy`) versionada. SELECT deliberadamente não tocado (fora do escopo do achado de segurança original).
- **Task 6: concluída.** Cobertura de `_montar_parametros_named()` adicionada (9 testes, 4 call sites reais + casos de borda). Efeito colateral de ambiente identificado e revertido — ver Debug Log; nenhuma dependência real instalada, seguido o mesmo padrão de stub já usado em S-WM-20.
- **Tasks 4+5: concluídas dentro do escopo decidido.** `institucional_programacao_pontual_v1` — wiring (item 4) e ordem de parâmetros (item 5) corrigidos e verificados, sem regressão. `empregabilidade_convite_entrevista_v1` e `empregabilidade_feedback_empresa_v1` (restante do item 4) — mapeamento completo feito e reportado ao usuário; **decisão explícita: virar story separada**, não implementar aqui. Registro completo do escopo sugerido deixado no Debug Log para a story futura partir direto da implementação.
- **Task 3: concluída.** Coluna `parameter_format` adicionada (idempotente, default `'NAMED'`), 6 templates existentes confirmados/populados como NAMED.
- **Task 2: concluída.** Soft delete de leads (decisão do usuário) — coluna `excluido`, filtro na listagem, ação de exclusão na UI com modal de confirmação. RLS de DELETE pré-existente permanece intacta mas sem uso (registrado, não removida).
- **Task 7: concluída sem alteração de código.** O achado original (S-WM-20, 2026-07-04) ficou obsoleto por trabalho posterior na própria S-WM-20 — `menu_inicial` hoje é etapa viva e testada. Remover teria sido uma regressão, não uma limpeza. **AC7 não se aplica mais como escrita** — flag para @po/@qa reconhecerem no gate.
- **Task 8: concluída.** `unidade_cuca` explícito nos 7 call sites; rastreado até o consumidor final (`_rotear_por_intencao`) para confirmar zero efeito comportamental hoje, mesmo com o caminho mais longo introduzido por S-WM-20 (confirmação de troca de rota). Sem regressão.
- **Task 10: concluída.** EPIC atualizado com estado real de S-WM-00 a S-WM-20 (não só 09-20 — divergência de título/escopo encontrada em várias stories do plano original). Tabelas de plano original preservadas como histórico, não removidas.
- **Regressão final: sem pendências.** `pytest` 113/3/0, `tsc`/`eslint` sem erro novo (1 erro pré-existente não-relacionado, confirmado por `git status`).

### File List
- `supabase/migrations/20260705000000_wm19_rls_disparos_divulgacao_insert_update.sql` — criado.
- `worker/tests/test_campanhas_engine.py` — criado.
- `worker/campanhas_engine.py` — modificado (`_processar_item_disparo_interno`: tags de automação por lista + canal correto para `eventos_pontuais`; ordem de parâmetros do template corrigida).
- `supabase/migrations/20260705000001_wm19_meta_templates_parameter_format.sql` — criado.
- `supabase/migrations/20260705000002_wm19_leads_soft_delete.sql` — criado.
- `cuca-portal/src/lib/types/database.ts` — modificado (`Lead.excluido`).
- `cuca-portal/src/app/(dashboard)/leads/page.tsx` — modificado (filtro `excluido=false`, ação e modal de exclusão).
- `worker/empregabilidade_engine.py` — modificado (Task 8: `unidade_cuca` explícito nos 7 call sites de `_escape_semantico_ou_none` dentro de `_processar_empresa`).
- `docs/stories/EPIC-Migracao-WhatsApp-Meta.md` — modificado (seção 5.1 nova + Change Log).

## Change Log

| Data | Agente | Mudança |
|------|--------|---------|
| 2026-07-05 | @sm (River) | Story criada a partir da lista de 10 débitos técnicos fornecida por Junior, consolidando achados registrados em S-WM-16/18/20. Protocolo obrigatório de Análise de Impacto (Sub-task A → gate → Sub-task B) aplicado aos itens 1-8 por instrução explícita, motivado pelo histórico de 3 regressões nesta migração causadas por mudança sem mapeamento prévio. Item 9 mantido como registro de risco, sem task de correção. Status: Draft — aguardando validação de @po. |
| 2026-07-05 | @po (Pax) | `*validate-story-draft` executado (checklist de 10 pontos + validação de template). 2 gaps estruturais encontrados vs. `story-tmpl.yaml` e as stories-irmãs (S-WM-16/18/20): faltavam a seção `## 🤖 CodeRabbit Integration` e a seção `## Tasks / Subtasks` (checkboxes). Ambas adicionadas nesta validação como **renderização mecânica** do conteúdo já existente em Contexto/Protocolo/Escopo/Critérios de Aceite — nenhum requisito novo introduzido, nenhuma AC alterada. A seção CodeRabbit aponta explicitamente para o item 9 (ferramenta indisponível neste ambiente; mitigação = revisão manual do @qa), evitando contradição interna. `executor: "@dev"` e `quality_gate: "@qa"` mantidos como estão — a tabela genérica do checklist ("Projeto Bob") sugeriria `@data-engineer`/`@architect` para os itens de schema/RLS, mas este projeto roda o pipeline `@dev → @qa → @devops` (`aiox-pipeline-enforcement.md`) e todas as stories-irmãs já usam essa mesma atribuição — manter é a escolha consistente, não uma omissão. Demais 8 pontos do checklist (AC coverage, testabilidade, dependências, riscos, anti-alucinação — fatos verificados por grep durante o draft, sequenciamento de tasks) sem achados bloqueantes. **Veredito: GO.** Status: Draft → **Ready**. |
| 2026-07-05 | @dev (Dex) | Execução em sequência corrida (ordem definida por Junior): Task 1 (RLS) → Task 6 (teste) → Tasks 4+5 (templates dormentes + desalinhamento, coordenadas) → Task 3 (parameter_format) → Task 2 (CRUD leads) → Task 7 (código morto) → Task 8 (unidade_cuca) → Task 10 (EPIC). Mapeamento de Impacto documentado antes de cada diff, conforme protocolo obrigatório. **2 pausas para decisão do usuário** (mapeamento revelou risco maior que o previsto): Tasks 4+5 (wiring de `convite_entrevista`/`feedback_empresa` — decisão: virar story separada) e Task 2 (hard vs soft delete de leads, dado FK cascade em 10 tabelas incluindo conversas/mensagens — decisão: soft delete). **Achado que reverteu a premissa da Task 7**: `menu_inicial` não é mais código morto (foi reativado por trabalho posterior da própria S-WM-20) — nada removido, AC7 não se aplica mais como escrita. `pytest worker/tests/`: 113 passed, 3 skipped (104 baseline + 9 novos). `tsc`/`eslint`: sem erro novo. Status → **Ready for Review**. |
| 2026-07-05 | @qa (Quinn) | `*qa-gate` executado com verificação independente (RLS/`parameter_format`/`leads.excluido` reconferidos via MCP Supabase; `git diff` revisado arquivo a arquivo; `pytest` re-executado do zero; achado do AC7 rastreado no código-fonte e nos testes, não só aceito do relato do @dev). **Veredito: CONCERNS** — nenhum achado bloqueia push, mas 2 itens exigem ação do @po antes de "Done": AC7 (premissa não existe mais, recomendado WAIVED) e AC3 (texto desatualizado pela decisão de soft delete). 1 débito registrado, não bloqueante: cobertura de teste ausente para a correção comportamental das Tasks 4+5. Resultado completo na seção QA Results. |
| 2026-07-05 | @po (Pax) | Ação sobre os 2 itens do gate do @qa: **AC7 marcado WAIVED** (riscado + justificativa inline) — premissa (achado de S-WM-20) deixou de existir por trabalho posterior da própria S-WM-20, antes desta story começar; exigir a remoção literal seria regressão em funcionalidade viva e testada, não correção. **AC3 reescrito** — trocado "rota DELETE" por descrição fiel do soft delete via `UPDATE excluido=true`, mesmo padrão já usado pelas demais ações de escrita da página; comportamento/intenção do AC não mudaram, só a descrição do mecanismo. Nenhuma outra seção alterada. |

## QA Results

### Revisor
@qa (Quinn) — 2026-07-05, `*qa-gate S-WM-19`

### Metodologia
Verificação independente — não aceitei nenhum achado do @dev de segunda mão. Reconferi diretamente: policies RLS via `pg_policies` no cuca-dev, coluna `parameter_format` e seus 6 valores, coluna `leads.excluido` e contagem real de linhas, `git diff` de todos os arquivos tocados, `pytest worker/tests/` do zero, e o achado da Task 7 lendo o código fonte e os testes que o exercitam — não apenas o relato do Dev Agent Record.

### 1. Code review
Diffs revisados linha a linha (`campanhas_engine.py`, `empregabilidade_engine.py`, `leads/page.tsx`, `database.ts`, 3 migrations). Todos cirúrgicos, mínimos, com comentário explicando o "porquê" (não o "o quê"). Nenhum código morto deixado para trás (ex.: `unidade` em `campanhas_engine.py` confirmado ainda em uso após a Task 5, não órfão).

### 2. Testes unitários
`pytest worker/tests/`: **113 passed, 3 skipped** — reconfirmado por mim, não só aceito do relato. 9 testes novos (`test_campanhas_engine.py`) cobrem `_montar_parametros_named()` com boa qualidade (ordenação por posição, 3 formatos reais, 2 casos de borda). **Achado (Should-Fix, não bloqueante):** a correção de comportamento das Tasks 4+5 (`_processar_item_disparo_interno` — canal/tag corretos + ordem de parâmetros) **não tem nenhum teste automatizado próprio** — só verificação manual de código + consulta direta ao banco. Dado que o tema central desta story é "regressão por mudança não testada", é uma lacuna que vale registrar como débito para uma story futura (o fix em si está correto e de baixo risco — 0 linhas em `eventos_pontuais`/`ouvidoria_eventos` no cuca-dev).

### 3. Critérios de Aceite
- **AC1** (Mapeamento de Impacto antes do diff): PASS. Toda Task 1-8 tem a seção documentada com evidência real (grep com arquivo:linha, checagem de action-at-a-distance, avaliação de redundância) — inclusive nos 2 casos em que o mapeamento motivou parar e perguntar ao usuário (Tasks 4+5 e Task 2), que é exatamente o comportamento que este AC pede.
- **AC2** (RLS): PASS — reconfirmado via `pg_policies`, INSERT/UPDATE agora exigem `has_permission('divulgacao', ...)`. Migration versionada presente.
- **AC3** (CRUD exclusão de leads): PASS funcional, **nota de precisão**: o AC fala em "rota DELETE", mas a implementação (por decisão de soft delete) é um `UPDATE excluido=true` via client autenticado — mesmo padrão arquitetural já usado por *toda* ação de escrita nesta página (bloquear, opt-in, limpar tags não passam por rota de API própria também). Não é uma lacuna, é consistência com o padrão existente do arquivo — mas o texto do AC ficou desatualizado pela decisão de soft delete tomada durante a execução. Recomendo @po ajustar a redação (trocar "rota DELETE" por "ação de exclusão"), não é bloqueante.
- **AC4** (parameter_format): PASS — reconfirmado via `execute_sql`, 6/6 templates = NAMED.
- **AC5** (templates dormentes + ordem): PASS — `institucional_programacao_pontual_v1` wireado e com ordem correta (reconferi as 6 posições contra a `corpo_texto`/`variaveis` reais). A cláusula alternativa do AC ("ou a Sub-task A documenta explicitamente por que algum não deve ser ligado ainda") cobre corretamente os outros 2 templates, deferidos por decisão do usuário.
- **AC6** (teste `_montar_parametros_named`): PASS.
- **AC7** (remoção do código morto `menu_inicial`): **NÃO PODE SER SATISFEITO COMO ESCRITO — confirmado de forma independente, não apenas aceito do relato do @dev.** Rastreei eu mesmo: `_set_fluxo(conversa_id, {"etapa": "menu_inicial"})` ocorre em 2 pontos (linha 2311, bypass global "menu"; linha 2588, branch ambíguo de `_rotear_por_intencao`), o dispatch em `etapa_atual == "menu_inicial"` (linha 2332) chama `_processar_menu_inicial` (definida na linha 2394), e a suíte de testes exercita esse exato caminho diretamente (`test_ambiguo_define_menu_inicial_com_dígito_restaurado`, chamadas diretas a `emp._processar_menu_inicial` nas linhas 375 e 399 de `test_empregabilidade_engine.py`). **A funcionalidade é viva, intencional e testada — não existe "bloco morto" para remover.** O achado original de S-WM-20 (2026-07-04) ficou obsoleto por trabalho posterior dentro da própria S-WM-20. O @dev tomou a decisão certa ao não tocar o código. **Isto não é um defeito de implementação — é um AC que descreve um estado que deixou de existir antes mesmo desta story começar.** Recomendação: @po deve reescrever ou formalmente marcar este AC como WAIVED no Change Log, documentando que a premissa mudou; não deve ser resolvido por código.
- **AC8** (unidade_cuca): PASS — reconferi o caminho completo até `_rotear_por_intencao` (inclusive o trecho novo de S-WM-20 que persiste o valor em `_troca_rota_unidade_cuca` antes de devolvê-lo) e confirmei que o parâmetro nunca é lido em nenhum branch — fix é seguro.
- **AC9** (registro de risco CodeRabbit): PASS.
- **AC10** (EPIC atualizado): PASS — conferi 3 entradas da tabela nova (S-WM-04, S-WM-11, S-WM-20) contra o H1 e `## Status` reais dos arquivos correspondentes; batem exatamente. Nenhuma invenção detectada.
- **AC11** (regressão final): PASS — `pytest` 113/3/0 reconfirmado por mim; `tsc --noEmit` tem só o erro pré-existente e não-relacionado de `tests/divulgacao-disparar-logic.test.ts` (confirmado via `git status` que o arquivo não foi tocado nesta story).

### 4. Sem regressões
Baseline 104 → 113 (9 novos), 3 skipped mantidos, 0 falhas. `git diff` mostra apenas os arquivos esperados.

### 5. Performance
N/A — mudanças são RLS/schema/lookup de baixo volume e ajuste de UI; nenhum risco de performance identificado.

### 6. Segurança
- RLS de `disparos_divulgacao`: corrigida e verificada.
- **Achado lateral do @dev, reconfirmado por mim de forma independente**: `has_permission()` casa `sys_permissions.module` por prefixo (`LIKE p_recurso || '%'`), e não existe módulo chamado exatamente `leads` — só variantes prefixadas. Consultei `sys_permissions` diretamente: hoje só `Developer` e `Super Admin Cuca` têm `can_delete`/`can_update=true` em qualquer módulo `leads_*`, e ambos os papéis já têm bypass total em `has_permission()` antes dessa checagem (developer/role name). **Risco latente confirmado, não ativo.** Registrado, não é desta story corrigir.
- Soft delete de leads: escolha correta dado o cascade em 10 FKs (`conversas`, `mensagens`, `candidatos` inclusos) — verificado diretamente via `information_schema`.

### 7. Documentação
EPIC atualizado e verificado. Dev Agent Record completo e rastreável — cada Task tem Mapeamento de Impacto documentado antes da implementação, incluindo os 2 pontos de pausa.

### Veredito: **CONCERNS**

Nenhum achado bloqueia o push. Aprovado para @devops prosseguir. 2 itens não-bloqueantes que precisam de ação de **@po** (não de @dev) antes de fechar a story como **Done**:
1. **AC7** — reescrever ou marcar WAIVED no Change Log; a premissa do AC não existe mais (código não é mais morto), confirmado de forma independente por mim.
2. **AC3** — ajustar a redação de "rota DELETE" para refletir a decisão de soft delete via UPDATE (decisão já documentada e correta, só o texto do AC ficou desatualizado).

1 item registrado como débito técnico, não bloqueante: cobertura de teste ausente para a correção comportamental das Tasks 4+5 (`_processar_item_disparo_interno`).
