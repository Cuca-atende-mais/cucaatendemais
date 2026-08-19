# S-EMP-AUD-030 — "Tem vaga de enfermeira?" cai num menu genérico em vez de resposta direta sobre o cargo

**Status:** InReview
**Epic:** Auditoria Empregabilidade
**Origem:** `docs/Auditoria -19-08-26/2026-08-19-empregabilidade-conversas/plans/023-cargo-especifico-mencionado-nao-respondido.md`
(auditoria de conversas reais, 18/08) — 2 conversas reais confirmadas (`8fc6dfd2`, `94dbad57`),
confirmado ainda presente hoje por leitura direta do código (`cargo_mencionado` não existe em
`intencao_detector.py` nem `empregabilidade_engine.py`).
**Prioridade:** P2 — não é travamento nem perda de dado, mas é um "não entendi" silencioso disfarçado
de resposta (o bot responde alguma coisa, só que a coisa errada — mais enganoso que um erro visível).
**Esforço:** M | **Risco:** MÉDIO — toca o contrato compartilhado do classificador semântico
(`_chamar_gpt_contextual`), usado em 16+ call sites, mas o campo novo só é **consumido** num único
lugar (`_rotear_por_intencao`) — raio de impacto de uso é pequeno, risco real é só o prompt maior
atrapalhar a extração dos campos já existentes.

## Contexto

Quando alguém pergunta por uma profissão/cargo específico ("tem vaga de enfermeira?", "vocês estão
precisando de estagiário?") na primeira mensagem, o classificador acerta a intenção
(`candidato_vaga`), mas o roteamento ignora a parte específica e mostra as 5 vagas mais recentes de
qualquer área — sem nunca dizer que não há vaga daquele tipo. Nos 2 casos reais observados, foi o
próprio Junior quem respondeu manualmente minutos depois, escrevendo à mão exatamente a frase que
esta story automatiza: *"No momento não há vagas para Enfermeira. Você se interessa a deixar seu
currículo no nosso Banco de Talentos?"*

**Por que não é o mesmo problema do filtro de setor**: `extrair_setor_da_mensagem`/`_SETOR_KEYWORDS`
é uma lista fixa de ~15 categorias amplas do portal (Serviços Gerais, Comércio, Logística...),
deliberadamente sem cobrir profissões específicas — já testado e documentado
(`test_setor_saude_nao_encontrado`). Cargo/profissão é texto livre, aberto; setor é categoria
fechada, controlada pelo portal. Esta story cria um mecanismo separado e complementar, não estende
o filtro de setor.

`_rotear_por_intencao` (`worker/empregabilidade_engine.py`), branch `elif intencao ==
"candidato_vaga":`, hoje só considera `setor_canonical`. Sem menção de setor reconhecida, cai direto
em `_buscar_vagas_recentes` (top 5 mais recentes, sem nenhum filtro) — é aí que a pergunta sobre
cargo específico se perde.

`vagas` (schema Supabase) tem `titulo` (nome do processo seletivo pra `selecao_evento`, majoritário
hoje) e `cargos_lista` (jsonb, onde o cargo real vive — `[{"titulo": ..., "quantidade": ...}]`).
Qualquer correção que só olhe `titulo` não encontraria a maior parte dos cargos reais de hoje —
precisa checar os dois.

## Impacto (por item, conforme análise obrigatória do projeto)

| Toca | Consome hoje | Impacto observável | De-risk |
|---|---|---|---|
| `_chamar_gpt_contextual` (prompt) | 16+ call sites do classificador semântico | Campo novo (`cargo_mencionado`) adicionado ao prompt — risco de atrapalhar extração dos outros 4 campos (`intencao`, `quer_sair`, `mudou_de_assunto`, `quer_voltar`, `nome`) | Rodar a suíte completa (não só os testes novos) antes de considerar pronto — mesma ressalva já aplicada nas stories 024/028 |
| `avaliar_mensagem_contextual` (contrato) | Default seguro precisa existir pra quem já mocka sem essa chave | Mock antigo sem `cargo_mencionado` não pode quebrar | Default `None` explícito, testado |
| `_rotear_por_intencao`, branch `candidato_vaga` | Hoje sem nenhum teste próprio (achado adicional da auditoria original) | Primeira cobertura real desse branch | Testes novos cobrindo achou/não achou cargo, mais o caminho de setor existente sem regressão |
| `vagas.cargos_lista` (schema real) | Busca precisa checar `titulo` **e** `cargos_lista` | Se o formato real divergir do assumido (`[{"titulo": ...}]`) pra algum subconjunto de vagas, a busca falha silenciosamente | Conferir contra dado real de produção antes de escrever a query de filtro (`select id, tipo, cargos_lista from vagas where status = 'aberta'`) |

## Valor de negócio

Fecha um "não entendi" disfarçado de resposta — em 2 dos 3 casos reais observados, foi o Junior quem
teve que responder manualmente. Automatiza exatamente essa resposta.

## Acceptance Criteria

1. `cargo_mencionado` novo no contrato do classificador — texto livre com a profissão/cargo
   mencionado, ou `null` se a mensagem não menciona nenhum cargo específico (não preenchido para
   pedidos genéricos como "vagas"/"emprego"/"trabalho").
2. No branch `candidato_vaga`, quando `cargo_mencionado` vier preenchido: busca vagas cujo `titulo`
   **ou** algum item de `cargos_lista` contenha o termo (substring case-insensitive, mesmo padrão do
   filtro de setor); se achar, mostra; se não achar, responde explicitamente "não temos vaga de X no
   momento" + oferece banco de talentos.
3. Sem `cargo_mencionado`, comportamento atual (setor/genérico) permanece idêntico.
4. Suíte completa (`test_intencao_detector.py` + `test_empregabilidade_engine.py`) sem regressão nos
   outros 15+ call sites do classificador.

## Escopo

**In:** campo novo no classificador + uso no branch `candidato_vaga`; busca cobrindo `titulo` e
`cargos_lista`; cobertura de teste do branch (hoje sem nenhuma).
**Out:** "É CLT?" (pergunta sobre campo de uma vaga já mostrada, 2ª mensagem dentro de `listou_vagas`
— mecanismo diferente, fica pra story própria); mostrar na listagem qual cargo específico bateu
(melhoria de UX legítima, não necessária pra fechar o achado); estender `_SETOR_KEYWORDS` (decisão de
produto já é não fazer isso).

## Test plan

- `cargo_mencionado` repassado corretamente quando o GPT retorna o campo; vira `None` quando ausente
  (mock antigo sem a chave não quebra).
- Achou cargo: mock de vaga com `cargos_lista` contendo o termo → lista a vaga certa, etapa vira
  `listou_vagas`.
- Não achou cargo — regressão dos 2 casos reais (enfermeira/estagiário): mensagem explícita de "não
  temos" + etapa vira oferta de banco de talentos.
- Sem cargo mencionado: comportamento idêntico ao atual (branch de setor/genérico intacto).
- Suíte completa sem regressão nos outros call sites do classificador.

## Dev Agent Record

**Linha reconfirmada via grep antes de editar:** branch `candidato_vaga` dentro de
`_rotear_por_intencao` em `:4656`, buscando hoje só `select("id, titulo, descricao")` sem
`cargos_lista` — bateu exatamente com o diagnóstico da story.

**Implementação:**
- `worker/intencao_detector.py`: `avaliar_mensagem_contextual` ganha campo novo
  `cargo_mencionado` no contrato de retorno (texto livre ou `None`) + instrução no prompt de
  `_chamar_gpt_contextual` pra identificar profissão/cargo específico vs. pedido genérico. Default
  `None` explícito — mock antigo sem a chave não quebra (validado com teste dedicado).
- `worker/empregabilidade_engine.py`, branch `candidato_vaga` de `_rotear_por_intencao`: quando
  `cargo_mencionado` vem preenchido, busca as até 50 vagas abertas mais recentes e filtra em Python
  por `titulo` OU `cargos_lista` (substring case-insensitive, mesmo padrão já usado pro filtro de
  setor) — checado **antes** do filtro de setor, por ser mais específico. Sem achado: mensagem
  explícita "não há vagas para X" + oferta de banco de talentos (reaproveitando a etapa
  `oferta_banco_talentos` já existente). Com achado: mesma UI de listagem numerada já usada nos
  outros 2 casos (setor/genérico), reaproveitando as chaves de fluxo corretas (`mapa_vagas`,
  `ultima_vaga_id`, etapa `listou_vagas`).
- Sem `cargo_mencionado` (`None` ou string vazia): cai direto no `if setor_canonical` já existente
  — nenhuma mudança de comportamento no caminho antigo.

**Testes:**
- `worker/tests/test_intencao_detector.py`: 2 testes novos (`cargo_mencionado` repassado quando a
  IA retorna; vira `None` quando ausente OU quando explicitamente `null`). Também precisei corrigir
  2 testes existentes que comparavam o dict de retorno por igualdade exata
  (`test_contextual_repassa_quer_sair_e_mudou_de_assunto`,
  `test_contextual_excecao_vira_default_seguro`) — adicionei `"cargo_mencionado": None` ao dict
  esperado, sem mudar o que estava sendo testado.
- `worker/tests/test_empregabilidade_engine.py` (`TestBloco6RotearPorIntencao`): 4 testes novos —
  achou por `titulo`; achou por `cargos_lista` (jsonb); não achou → mensagem explícita + banco de
  talentos (regressão dos 2 casos reais da auditoria, enfermeira/estagiário); sem
  `cargo_mencionado` → comportamento genérico intacto (reforça a regressão já coberta).

**Validação:** `test_empregabilidade_engine.py` + `test_intencao_detector.py` — **204 passed**
(164+36, era 160+34 antes). Suíte geral do worker (`--ignore=test_main_retomar_disparo.py`) — **348
passed**, mesmas 5 falhas pré-existentes de ambiente em `test_meta_adapter_outbound.py`, nenhuma
nova falha.

**Teste empírico de causalidade:** revertido temporariamente `empregabilidade_engine.py` E
`intencao_detector.py` pro estado pré-implementação (mantendo os testes) — os 5 testes novos
falharam exatamente como esperado (`KeyError: 'cargo_mencionado'` nos 2 de contrato, asserção de
conteúdo nos de roteamento); restaurado, suíte voltou a 204 passed.

**Escopo respeitado:** "É CLT?" e exibir o cargo casado na listagem não foram tocados, conforme
Out do Escopo.

**File List:**
- `worker/intencao_detector.py`
- `worker/empregabilidade_engine.py`
- `worker/tests/test_intencao_detector.py`
- `worker/tests/test_empregabilidade_engine.py`

## QA Results

**Veredito: PASS** (com 1 achado de hardening recomendado, não bloqueia)

1. **Code review** — mudança bem isolada, checada antes do filtro de setor por especificidade;
   reaproveita corretamente as chaves de fluxo (`mapa_vagas`, `ultima_vaga_id`,
   `oferta_banco_talentos`) já usadas pelos outros 2 caminhos do mesmo branch; `isinstance(item,
   dict)` defensivo ao iterar `cargos_lista` (jsonb pode conter formato inesperado).
2. **Testes** — reconfirmados de forma independente: **204 passed** em
   `test_empregabilidade_engine.py` + `test_intencao_detector.py`.
3. **Acceptance Criteria** — AC1 (campo novo, `None` em pedido genérico) ✅; AC2 (busca por
   `titulo` OU `cargos_lista`, achou/não achou) ✅; AC3 (sem cargo, comportamento atual intacto) ✅;
   AC4 (suíte completa sem regressão nos outros 15+ call sites do classificador) ✅.
4. **Regressão** — suíte geral do worker: **348 passed**, mesmas 5 falhas pré-existentes de
   ambiente, nenhuma nova. Os 2 testes existentes que o @dev precisou corrigir
   (`test_contextual_repassa_quer_sair_e_mudou_de_assunto`,
   `test_contextual_excecao_vira_default_seguro`) — confirmei que a correção foi só adicionar a
   chave nova ao dict esperado, sem alterar o que a asserção original verificava.
5. **Performance** — filtro em Python sobre até 50 vagas (mesmo limite já usado pro filtro de
   setor) — sem impacto de latência perceptível.
6. **Segurança** — sem SQL injection (filtro client-side, não interpolado em query); **achado de
   hardening (severidade baixa, não bloqueia):** `cargo_mencionado` é interpolado direto na
   mensagem exibida (`f"vagas de *{cargo_mencionado}*"`) sem cap de tamanho — o prompt instrui a IA
   a devolver "string curta", mas isso não é uma garantia server-side (mesma classe de risco já
   tratada com fail-safe de conteúdo na S-EMP-AUD-023 passo 4, ali para texto *sintetizado*; aqui é
   texto extraído/curto, risco bem menor, mas não nulo). Recomendo ao @dev adicionar um cap simples
   (ex.: 40-50 caracteres) como hardening numa próxima iteração — não é regressão nem quebra AC,
   registro apenas como melhoria defensiva.
7. **Documentação** — Dev Agent Record completo, File List correta, achado documentado acima.

**Teste empírico de causalidade** (refeito por mim, independente do @dev): revertidos
temporariamente `empregabilidade_engine.py` e `intencao_detector.py` pro estado pré-implementação
mantendo os testes — os 5 testes novos falharam exatamente como esperado (`KeyError:
'cargo_mencionado'` nos 2 de contrato); restaurado, suíte voltou a 204 passed.

Pronto pro @devops abrir o PR — a última das 3 stories desta auditoria.

## Change Log

- v0.1 (2026-08-19): Story criada por @sm a partir do Plano 023 da auditoria — 2 conversas reais de
  18/08 confirmadas, código atual conferido (campo não existe).
- v0.2 (2026-08-19): @po validou — **GO (8/10)**. Escopo bem isolado do filtro de setor (justificativa
  clara de por que não é o mesmo mecanismo), AC testáveis, achado real com evidência de produção.
  Confirmado por leitura direta do código atual que o branch `candidato_vaga`
  (`worker/empregabilidade_engine.py:4554`) hoje busca só `select("id, titulo, descricao")` — sem
  `cargos_lista` — batendo com o diagnóstico da story de que a busca por cargo específico precisa
  necessariamente checar as duas colunas, não é suposição. Dois pontos sem nota máxima: (1) mesma
  ressalva de drift de linha das outras 2 stories desta leva — @dev deve reconfirmar via grep; (2)
  risco MÉDIO real (prompt compartilhado por 16+ call sites) — recomendo @dev rodar a suíte completa
  de `test_intencao_detector.py` antes de cada commit intermediário, não só no final, dado o raio de
  impacto maior que as outras 2 stories desta leva. Status Draft → Ready.
- v0.3 (2026-08-19): @dev implementou — `cargo_mencionado` novo no contrato de
  `avaliar_mensagem_contextual`, uso no branch `candidato_vaga` (busca por `titulo` OU
  `cargos_lista`). 6 testes novos + 2 testes existentes corrigidos (comparação de dict exata).
  Suíte completa do worker rodada a cada etapa intermediária, conforme recomendado pelo @po — 204
  passed, 348 na suíte geral, sem regressão. Verificação empírica de causalidade confirmou que os
  testes falham sem a implementação. Status Ready → InReview. Pronto pro @qa.
- v0.4 (2026-08-19): @qa revisou — **PASS**. Todos os AC confirmados de forma independente (204
  passed), verificação empírica de causalidade reconfirmada por mim. 1 achado de hardening
  recomendado (sem cap de tamanho em `cargo_mencionado` antes de exibir na mensagem) — não bloqueia,
  registrado pro @dev considerar numa próxima iteração. Status permanece InReview — pronto pro
  @devops abrir o PR.
