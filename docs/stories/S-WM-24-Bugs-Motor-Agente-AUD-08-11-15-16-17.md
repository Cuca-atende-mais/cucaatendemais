# S-WM-24 — Bugs confirmados no motor-agente (AUD-08, 11, 15, 16, 17)

## Status
InProgress (Task 2/AUD-08 implementada em 2026-08-07; Tasks 1, 3, 4, 5 seguem pendentes)

## Complexidade
**M** (médio) — 5 achados de tamanho pequeno/médio na mesma vizinhança já testada pela S-WM-21 (`supabase/functions/motor-agente/index.ts` + `prompts_agentes` no banco). Nenhum exige mudança de schema. 2 dos 5 (AUD-15, AUD-17) têm investigação prévia relevante desta sessão que reduz o escopo real.

## ⚠️ Conflito de execução conhecido — NÃO rodar em paralelo com a S-WM-27
A **Task 2 desta story (AUD-08)** mexe em `_executar_dispatch` (`worker/meta_adapter_inbound.py`) pra diferenciar "mídia sem legenda" de falha técnica real. A **S-WM-27** (débito técnico do split de mensagens, reconciliação de falha parcial) mexe **na mesma função**, no mesmo bloco de tratamento de fallback/erro de dispatch. Se as duas rodarem ao mesmo tempo (dois devs em paralelo, ou até o mesmo dev alternando sem terminar uma antes da outra), é conflito de merge praticamente garantido, além do risco de uma mudança pisar na lógica da outra sem ninguém perceber até o teste falhar de um jeito confuso.
**Regra:** só uma das duas (S-WM-24 ou S-WM-27) pode estar com a Task equivalente em andamento por vez. Se o mesmo dev pegar as duas, tudo bem rodar em sequência (uma mergeada antes de começar a outra); se forem dois devs, coordenar explicitamente antes de começar.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . (motor-agente) → todos os testes novos + suíte existente verdes
  - deno check supabase/functions/motor-agente/index.ts → não pode piorar o número da baseline (67, herdado da S-WM-21/22)
  - MCP execute_sql (cuca-dev, read-only) → ler prompt_sistema/prompt_contexto de Institucional/maria antes de editar (AUD-11, AUD-17)
  - grep -n "transcreverAudio\|WHISPER_MODEL" supabase/functions/motor-agente/index.ts → confirmar remoção completa (AUD-16), zero call site restante
  - inspeção manual: reabrir uma conversa encerrada de Institucional com unidade já selecionada, confirmar que NÃO recarrega toda a programação nem trata como 1ª mensagem (AUD-15, regressão do que já foi corrigido)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** corrigir os 5 bugs menores confirmados no motor-agente (mídia sem legenda com mensagem enganosa, conflito prompt/código no formato de listagem, reabertura de conversa tratada como 1ª mensagem — só pro Institucional, transcrição de áudio morta, e regra de HANDOVER repetida no prompt),
**para que** a experiência do canal Institucional pare de ter essas fricções pontuais, sem expandir escopo pra Sofia/Ouvidoria (que ainda não migraram pro Meta).

## Contexto e Problema

5 achados da auditoria original (`AUDITORIA-motor-agente-institucional-2026-07-07.md`) ainda pendentes, na mesma vizinhança de código já testada e estabilizada pela S-WM-21/22. Investigação desta sessão (@sm, antes de fatiar) já confirmou o estado real de 2 deles — documentado por item abaixo, pra não pedir trabalho redundante nem subestimar o que falta.

**Fora de escopo desta story (decisões de produto já fechadas por Junior, só documentar, não implementar):**
- **AUD-10** (corrida de leitura-modifica-escreve em `conversa.metadata`, sem lock): risco **aceito** por ora. Nenhuma trava/lock será implementada nesta story. Registrado como risco conhecido, não como pendência.
- **AUD-18** (handover automático obrigatório pra "mês anterior" pode gerar volume desnecessário): **mantido como está**. Nenhuma mudança de regra nesta story.

## Escopo

### IN — AUD-08: mídia sem legenda cai em mensagem enganosa
Lead manda imagem sem legenda → `mensagem=""` → motor-agente responde HTTP 400 "Nenhuma mensagem" → `_chamar_motor_agente` retorna `None` → dispatch envia a mensagem de fallback genérica de "problema técnico" (§1/AUD-03), que é **enganosa** aqui: não é uma falha técnica, é "o motor-agente não lê imagem". Já existe teste documentando esse comportamento sem corrigi-lo (`test_processar_webhook_imagem_cai_no_fallback_tecnico`, worker). Ajuste: distinguir "sem texto pra processar" (mídia sem legenda) de falha técnica real, e responder com uma mensagem adequada ao caso (ex.: pedir que o lead descreva o que precisa, já que o bot não lê imagem).

### IN — AUD-11: prompt e código conflitam sobre formato de listagem
`INSTRUCAO_SEGURANCA` regra 6 (código, `index.ts`) já define um formato compacto pra listar modalidades ("Nome - Dias", sem horários/professores na listagem geral — é literalmente o formato que a S-WM-22 reaproveitou pro critério de split). Auditoria original apontou que `prompt_contexto` (banco, `prompts_agentes`) tem instrução conflitante sobre o mesmo formato. Ajuste: `[db-read]` @dev lê o `prompt_contexto` atual via MCP, confirma o conflito, escolhe manter o formato do código (evita truncamento no WhatsApp, já validado pela S-WM-22) e `[db-write]` edita o conteúdo pra remover a instrução conflitante.

### IN — AUD-15: reabertura de conversa encerrada tratada como 1ª mensagem — **SÓ Institucional**
**Achado desta investigação, antes de fatiar (importante pro dimensionamento desta Task):** a VAL-07 (já implementada, commit `74d54a9`, 2026-07-09) **já corrigiu a maior parte deste achado para o Institucional** — introduziu `conversaGenuinamenteNova` (true só na inserção de fato, false na reabertura), usado em `calcularPrecisaVisaoGeral` (evita recarregar os ~40 chunks da programação) e na instrução final de prompt ("Esta é a primeira mensagem..."), ambos já escopados via `isAgenteProgramacao ? conversaGenuinamenteNova : conversaJustCreated` — ou seja, **só afeta Institucional/maria, Sofia/Ouvidoria continuam com `conversaJustCreated` original, sem mudança** (exatamente a decisão de escopo que Junior pediu aqui, já respeitada pelo código atual).

**O que resta, portanto, não é reimplementar — é verificar e fechar qualquer lacuna residual.** Esta Task é primariamente de **verificação com teste de regressão explícito** (hoje não existe teste automatizado cobrindo especificamente "reabrir conversa com unidade já selecionada não repete a instrução de 1ª mensagem no prompt final" — só existe teste do lado `precisaVisaoGeral`/log, ver `index.audit.test.ts`, testes `VAL-07`). Se a investigação do @dev encontrar um cenário residual não coberto pela VAL-07 (ex.: algum outro campo/comportamento que ainda trata reabertura como novo contato), corrigir; se não encontrar nenhum, a Task se torna só o teste de regressão que faltava + confirmação documentada de que AUD-15 está fechado para Institucional.

**Reforço explícito do escopo (Sofia/Ouvidoria fora):** não implementar nada que mude o comportamento de `conversaJustCreated`/`menu_boas_vindas` da Sofia. Esses agentes ainda não migraram pro Meta — tocar neles está fora de escopo aqui, mesmo que pareça "consistente" fazer o mesmo ajuste.

### IN — AUD-16: transcrição de áudio morta no motor-agente (limpeza, sem risco)
**Confirmado nesta investigação:** o worker (`meta_adapter_inbound.py::_parse_mensagem_meta`) já transcreve áudio via Whisper ANTES de chamar o motor-agente, retornando `(transcrição, None, "voz")` — ou seja, `midia_url` chega sempre `None` e `midia_tipo` chega `"voz"` (nunca `"audio"`/`"ptt"`) pro motor-agente. A condição em `index.ts` (`if (midia_url && (midia_tipo === "audio" || midia_tipo === "ptt")) textoFinal = await transcreverAudio(...)`) **nunca é verdadeira no caminho real de produção** — confirmado por leitura direta dos dois lados, não suposição. Ajuste: remover `transcreverAudio`, `WHISPER_MODEL` e a condição morta.

### IN — AUD-17: regra de HANDOVER repetida no prompt
Regra 5 de `INSTRUCAO_SEGURANCA` (código) já cobre 1 ocorrência ("NUNCA use [[HANDOVER]] quando o usuário mencionar o nome de uma unidade CUCA"). Auditoria original aponta 2 outras ocorrências da mesma regra em `prompt_sistema`/`prompt_contexto` (banco), com heurística frágil adicional de "3 tentativas" sem contador real. Ajuste: `[db-read]` @dev lê `prompt_sistema`/`prompt_contexto` via MCP, confirma as repetições, `[db-write]` consolida numa única instrução (mantendo a do código como fonte de verdade, já que é testável).

### OUT
- AUD-10, AUD-18 — decisões já fechadas, documentar sem implementar (ver Contexto).
- Qualquer mudança em Sofia, Ouvidoria, Empregabilidade/Julia, Ana.
- Mudança de schema — nenhum dos 5 itens exige; se surgir necessidade, parar e avisar.
- Deploy automático.

## Acceptance Criteria

### AUD-08
1. ~~**Given** o lead manda uma imagem sem legenda (mensagem vazia), **when** processada, **then** a resposta ao lead é diferente da mensagem genérica de "problema técnico" — reflete que o bot não conseguiu ler a imagem, não uma falha de sistema.~~
   **AC1 substituído por decisão direta do Junior em 2026-08-07** (achado ao vivo: lead mandou sticker, recebeu "problema técnico"): em vez de uma resposta explicativa, mídia sem interpretação (sticker, video, document, location, contacts, reaction, ... — qualquer `midia_tipo` fora de `text`/`voz`/`image`) é **ignorada em silêncio** — nenhuma resposta é enviada ao lead, "até decidirem como tratar" cada tipo. `image` (o caso literal do AC original) e `voz`/áudio com transcrição falha **não entram nesta mudança** — comportamento deles permanece o de antes (fallback "problema técnico"), decisão em aberto. Implementado só para `agente_tipo` Institucional/maria — Sofia/Ouvidoria e Ana/Acesso ficam de fora (ver Escopo/OUT).
2. **Given** uma falha técnica real (ex.: motor-agente HTTP 500), **when** processada, **then** a mensagem de "problema técnico" original continua sendo usada — não pode regredir esse caso. **Confirmado**: o guard novo só intercepta antes de chamar o motor-agente quando `midia_tipo` não tem interpretação; qualquer chamada real ao motor-agente (inclusive pra `image`/`voz`) segue o caminho antigo, fallback incluso.

### AUD-11
3. **Given** o `prompt_contexto` de Institucional/maria após a edição, **when** lido via MCP, **then** não contém mais instrução de formato de listagem conflitante com a regra 6 do código.

### AUD-15
4. **Given** uma conversa `encerrada` com `unidade_selecionada` já preenchida em metadata, **when** reaberta com uma nova mensagem, **then** o prompt final NÃO inclui a instrução "Esta é a primeira mensagem" (teste de regressão novo, cobrindo o que a VAL-07 já corrige mas ainda não tem teste dedicado a esse campo específico do prompt).
5. **Given** o mesmo cenário do AC4, **when** processado, **then** o comportamento de Sofia (`conversaJustCreated`/`menu_boas_vindas`) permanece **inalterado** — teste de regressão explícito confirmando que Sofia não foi afetada.

### AUD-16
6. **Given** o código final, **when** inspecionado (`grep`), **then** `transcreverAudio`/`WHISPER_MODEL` não existem mais em `index.ts`, e a suíte completa passa sem regressão (confirma que realmente era código morto).

### AUD-17
7. **Given** `prompt_sistema`/`prompt_contexto` após a edição, **when** lidos via MCP, **then** a regra de HANDOVER aparece **uma única vez**, sem a heurística de "3 tentativas" sem contador real.

### Transversal
8. **Given** a suíte `deno test` do motor-agente, **when** executada após os 5 ajustes, **then** passa sem regressão, com testes novos cobrindo cada AC acima.
9. **Given** o código final, **when** rodado `deno check`, **then** o número de erros não piora em relação à baseline herdada da S-WM-21/22 (67).
10. **Given** cada Task é concluída, **when** o @dev fecha a Task, **then** roda o subconjunto de teste relevante e registra o resultado no Dev Agent Record antes de seguir para a próxima Task.
11. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [ ] **Task 1 — AUD-16: remover transcrição de áudio morta** (AC: 6) — mais simples e sem risco, primeiro
  - [ ] Remover `transcreverAudio`, `WHISPER_MODEL`, a condição morta no handler.
  - [ ] `deno test` completo, confirmando zero regressão.
  - [ ] Reportar no Dev Agent Record.
- [x] **Task 2 — AUD-08: distinguir mídia sem legenda de falha técnica** (AC: 1, 2) — 2026-08-07
  - [x] ⚠️ Confirmar que a S-WM-27 não está com Task em andamento na mesma função (`_executar_dispatch`) antes de começar — ver aviso no topo da story. (Confirmado: S-WM-27 status "Ready", nenhuma Task em andamento.)
  - [x] Ajustar o worker (ou o contrato motor-agente→worker) pra diferenciar os dois casos. (Escopo mudou de "mensagem diferente" pra "ignorar em silêncio", decisão do Junior — ver AC1 acima.)
  - [x] Testes `pytest`: mídia sem legenda recebe mensagem adequada; falha técnica real preserva a mensagem original. (Adaptado: mídia sem interpretação não recebe NENHUMA mensagem — testes cobrem isso + preservação do caminho antigo pra image/Sofia.)
  - [x] Reportar no Dev Agent Record.
- [ ] **Task 3 — AUD-15: verificar/fechar lacuna residual + teste de regressão** (AC: 4, 5)
  - [ ] Investigar se sobra algum cenário não coberto pela VAL-07 (ver Contexto — pode não haver).
  - [ ] Se houver, corrigir. Se não houver, só o teste de regressão novo.
  - [ ] Teste de regressão confirmando Sofia inalterada.
  - [ ] Reportar no Dev Agent Record.
- [ ] **Task 4 — AUD-11 + AUD-17: consolidação de prompt (banco)** (AC: 3, 7)
  - [ ] `[db-read]` ler `prompt_sistema`/`prompt_contexto` de Institucional/maria via MCP.
  - [ ] `[db-write]` remover conflito de formato de listagem (AUD-11) e consolidar regra de HANDOVER (AUD-17) num único lugar.
  - [ ] Confirmar via MCP pós-edição.
  - [ ] Reportar no Dev Agent Record.
- [ ] **Task 5 — Fechamento** (AC: 8, 9, 10, 11)
  - [ ] `deno test` completo, sem regressão.
  - [ ] `deno check` sem piorar a baseline.
  - [ ] Atualizar File List e Change Log.
  - [ ] Anunciar conclusão e recomendar @qa — não chamar @qa/@devops automaticamente.

## Dev Notes

### Já confirmado nesta investigação (não reinvestigar)
- AUD-16 é 100% código morto no caminho real — confirmado cruzando `meta_adapter_inbound.py::_parse_mensagem_meta` (retorna `midia_tipo="voz"`, `midia_url=None` pra áudio) com a condição em `index.ts` (só dispara pra `"audio"`/`"ptt"` com `midia_url` presente).
- AUD-15 já tem a maior parte corrigida pela VAL-07 (commit `74d54a9`) — `conversaGenuinamenteNova` já escopado a `isAgenteProgramacao`. Task 3 é principalmente verificação + teste, não reimplementação.
- AUD-11/AUD-17 dependem de conteúdo do banco (`prompt_sistema`/`prompt_contexto`) que não pode ser inspecionado sem MCP — @dev confirma antes de editar.

### Testing
- Padrão já estabelecido: `deno test` (`index.audit.test.ts`, mocks de fetch/Supabase) e `pytest` (`worker/tests/test_meta_adapter_inbound.py`, mocks `AsyncMock`/`MagicMock`).

## Dependências
- Mesma vizinhança de código da S-WM-21/22 (`index.ts`) — recomendo rodar depois delas estarem mergeadas, pra evitar conflito de merge desnecessário, embora não haja dependência técnica de fato (nenhum dos 5 itens toca as mesmas linhas exatas alteradas por elas).
- **Conflito de execução com a [[S-WM-27]]** (ver aviso no topo da story) — mesma função (`_executar_dispatch`, `worker/meta_adapter_inbound.py`), tocada pela Task 2 (AUD-08) aqui e pela reconciliação de falha parcial lá. Não são dependência técnica uma da outra (nenhuma bloqueia o início da outra), mas não podem ter Task em andamento simultaneamente — coordenar antes de começar.

## Riscos
- AUD-11/AUD-17 exigem edição de conteúdo em produção (prompt do agente ativo) — qualquer erro de edição afeta a persona da Maria imediatamente. `[db-write]` só depois de `[db-read]` confirmado, sem pressa.
- AUD-15: se a investigação da Task 3 encontrar mais do que o esperado (algo não coberto pela VAL-07), o escopo dessa Task pode crescer — reportar antes de expandir silenciosamente.
- **Conflito de merge com a S-WM-27 se rodarem em paralelo** (ver aviso no topo) — risco de perda de trabalho ou de uma mudança mascarar/reverter a outra em `_executar_dispatch` sem ninguém perceber até um teste falhar de forma confusa.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-11 | 0.1 | Draft inicial — AUD-08/11/15/16/17, a pedido de Junior. AUD-10/18 documentados como decisão fechada (sem implementação). Achado de investigação: AUD-15 e AUD-16 já parcial/totalmente resolvidos, escopo das Tasks correspondentes ajustado pra verificação em vez de reimplementação | @sm River |
| 2026-07-11 | 0.2 | Validado (GO, 8/10 → 10/10 após ajuste). Ajuste aplicado: story não sinalizava o conflito de execução com a S-WM-27 (mesma função `_executar_dispatch`) — adicionado aviso destacado no topo, mais reforço em Dependências, Riscos e no checklist da Task 2. Status Draft → Ready | @po Pax |
| 2026-08-07 | 0.3 | Task 2 (AUD-08) implementada, a pedido direto do Junior (achado ao vivo: sticker gerando fallback "problema técnico"). **AC1 alterado** de "resposta explicativa" pra "ignorar em silêncio" — decisão do Junior, não do @dev; registrado em riscado + nota no próprio AC, não removido do histórico. Nota de processo: `story-lifecycle.md` reserva edição de AC a @po — este AC foi ajustado por @dev por vir de instrução direta e explícita do Junior em tempo real, não de interpretação própria; recomendo @po formalizar/registrar a validação retroativa quando revisar. Status Ready → InProgress (Tasks 1, 3, 4, 5 seguem pendentes). | @dev Dex |

## Dev Agent Record

### Task 2 — AUD-08 (2026-08-07)

**Gatilho:** Junior reportou ao vivo — lead mandou sticker pro número Institucional, recebeu
"Ih, deu um problema técnico aqui do meu lado 😅". Investigação confirmou: mesma causa raiz do
AUD-08 original (imagem sem legenda), só que via `sticker` em vez de `image` — nenhum tipo além
de `text`/`audio`/`image` é tratado por `_parse_mensagem_meta` (`worker/meta_adapter_inbound.py`),
e o motor-agente (`supabase/functions/motor-agente/index.ts:1205-1206`) valida `mensagem`
não-vazia sem nunca usar `midia_url`/`midia_tipo` — confirmado por grep, esses dois campos são
destructured do body e nunca mais referenciados no arquivo.

**Decisão do Junior (mensagem direta, não é interpretação do @dev):** em vez de implementar o
AC1 original ("resposta diferente, explicando que não leu a imagem"), o comportamento pedido é
**ignorar em silêncio** — sem chamar o motor-agente, sem marcar lida/digitando, sem nenhuma
resposta ao lead — pra sticker, video, document, e qualquer outro tipo sem interpretação, "até
decidirmos como tratar". `image` e `voz` (áudio) ficam de fora dessa mudança — comportamento
inalterado, decisão em aberto.

**Escopo restrito a Institucional/maria** — story original marca "qualquer mudança em Sofia,
Ouvidoria, ..., Ana" como fora de escopo (esses canais não migraram pra Meta ainda). O guard novo
(`_AGENTES_GUARD_MIDIA_SEM_INTERPRETACAO = frozenset({"Institucional", "maria"})`) só intercepta
pra esses dois `agente_tipo` — testado explicitamente que `sofia` continua chamando o
motor-agente normalmente com o mesmo tipo de mídia (sticker).

**Implementação:**
- `worker/meta_adapter_inbound.py`: 2 constantes novas (`_MIDIA_TIPOS_COM_INTERPRETACAO`,
  `_AGENTES_GUARD_MIDIA_SEM_INTERPRETACAO`) + guard em `_executar_dispatch`, antes de chamar
  `_meta_marcar_lida_e_digitando`/`_chamar_motor_agente`: se `agente_tipo` está no guard E
  `midia_tipo` não está em `{"text", "voz", "image"}`, loga e retorna sem nenhuma chamada à Meta
  API nem ao motor-agente. `_parse_mensagem_meta` não precisou mudar — já preservava o `type` cru
  do webhook em `midia_tipo` pro `else` (sticker/video/document/etc.), só não havia consumidor
  dessa informação antes.
- O inbound continua sendo gravado em `mensagens` (histórico visível no painel) — isso acontece
  antes do dispatch/debounce, em `processar_webhook_meta`, não tocado por esta mudança. Só a
  resposta automática deixa de acontecer.

**Testes (`worker/tests/test_meta_adapter_inbound.py`):**
- `test_parse_mensagem_tipo_sem_interpretacao` (parametrizado: sticker/video/document/location/
  contacts) — confirma `_parse_mensagem_meta` preserva `midia_tipo` corretamente pra cada um.
- `test_processar_webhook_midia_sem_interpretacao_ignorada_silenciosamente` (parametrizado:
  sticker/video/document) — ponta a ponta, sem mockar `_chamar_motor_agente`: confirma que ele
  **nunca é chamado**, `_meta_marcar_lida_e_digitando` **nunca é chamado**, `_meta_enviar` **nunca
  é chamado**, e o inbound é gravado no histórico normalmente.
- `test_processar_webhook_sticker_sofia_nao_afetada` — mesmo tipo de mídia (sticker), mas
  `agente_tipo="sofia"`: confirma que o motor-agente **é** chamado (guard não se aplica).
- `test_processar_webhook_imagem_cai_no_fallback_tecnico` (já existente, AUD-08 original) —
  confirmado sem alteração de resultado: `image` continua caindo no fallback "problema técnico",
  como antes desta mudança.

**Resultado dos testes:** `pytest worker/tests/test_meta_adapter_inbound.py` — 63/63 passando
(10 novos/modificados). Suíte completa do worker (`pytest tests/`, exceto
`test_main_retomar_disparo.py`, que já falha na coleta neste ambiente por `ModuleNotFoundError:
openai`, pré-existente e sem relação com esta mudança — confirmado via `git stash` que o mesmo
erro ocorre sem estas alterações): 223 passed, 5 failed — os 5 failures são pré-existentes
(`test_meta_adapter_outbound.py`, mesmos 5 antes e depois desta mudança via `git stash`), não
relacionados a este código.

**Não implementado nesta rodada:** Tasks 1 (AUD-16), 3 (AUD-15), 4 (AUD-11+AUD-17), 5
(fechamento) — só a Task 2 foi pedida.

## File List

| Arquivo | Mudança |
|---|---|
| `worker/meta_adapter_inbound.py` | Task 2/AUD-08 — 2 constantes novas + guard em `_executar_dispatch` (ver Dev Agent Record) |
| `worker/tests/test_meta_adapter_inbound.py` | Task 2/AUD-08 — payload helper `_payload_midia_sem_interpretacao` + 4 testes novos/parametrizados |

## QA Results

### Task 2 — AUD-08 (2026-08-07, @qa Quinn)

**Veredito: CONCERNS** (aprovado, com observação de processo a resolver)

Reexecutei a suíte de forma independente (não confiei só no relato do Dev Agent Record):
- `pytest worker/tests/test_meta_adapter_inbound.py -v`: 63/63 passando.
- `git stash` + rodada completa (`pytest tests/ --ignore=test_main_retomar_disparo.py`): confirmei que as 5 falhas em `test_meta_adapter_outbound.py` são idênticas com e sem esta mudança (214 passed sem a mudança, 223 passed com ela — diferença de exatamente 9, batendo com os testes novos). Não são regressão desta Task.
- Revisei o diff completo de `meta_adapter_inbound.py` e `test_meta_adapter_inbound.py` linha a linha, não só o resumo do @dev.
- Confirmei especificamente: (a) `image` continua caindo no fallback antigo, sem alteração; (b) falha real do motor-agente (HTTP 500) continua com o fallback "problema técnico", AC2 preservado; (c) `sofia` com o mesmo tipo de mídia (sticker) continua chamando o motor-agente normalmente — guard não vaza pra fora do escopo Institucional/maria.

**7 checks:** code review OK, testes OK (cobertura nas 2 camadas, parse + dispatch ponta-a-ponta), AC atendido (texto revisado), sem regressão (verificado independentemente), performance OK (branch trivial, sem I/O), segurança OK (sem input novo/injeção), documentação OK (Dev Agent Record, File List, Change Log completos).

**Achado CONCERNS (processo, não funcional):** o @dev editou diretamente o Acceptance Criteria (AC1) da story — por `story-lifecycle.md`, isso é território do @po, não do @dev, mesmo vindo de instrução direta do Junior em tempo real. O @dev já sinalizou isso no próprio Change Log antes desta revisão, então não foi omitido. Recomendo o @po formalizar/ratificar a mudança de AC1 antes de tratar a Task 2 como definitivamente encerrada — não bloqueia push, é pendência de governança.

**Próximo passo sugerido:** @po ratifica o AC1, ou usuário decide seguir direto pro @devops (push) e resolver a formalização depois.
