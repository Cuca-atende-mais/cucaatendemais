# S-EMP-AUD-021 — "Voltar" real na navegação de vagas/seleções (passo atrás, não reset nem encerramento)

**Status:** Review
**Epic:** Auditoria Empregabilidade (2026-07-29, leva 12-13/08)
**Origem:** `docs/2026-08-13/021-navegacao-voltar-vagas-selecao.md` (confirmado ao vivo contra
`origin/main`, commit `cd48877`, em 2026-08-13, com conversa real travada como prova)
**Verificação cruzada:** confirmado ao vivo pelo @dev em 2026-08-13 — `listou_categorias` (`:2612`),
`listou_vagas` (`:2732`), `listando_cargos_selecao` (`:2360`), `aguardando_escolha_unidade` (`:2648`)
todos batem com o "Current state" do plano
**Prioridade:** P2 | **Esforço:** M | **Risco:** MÉDIO — toca 4 estados + extrai 2 telas pra funções
reusáveis + adiciona 1 campo novo ao contrato do classificador semântico (17 call sites, só 4 afetados)
**Ordem de execução proposta:** **3ª de 3** (020 → 022 → 021) — decisão do Junior. Depende de
S-EMP-AUD-022 estar mergeado antes: o campo `quer_voltar` que este plano adiciona ao classificador
precisa ficar **depois** de `quer_atendente_humano` (do 022) dentro de `_escape_semantico_ou_none` —
pedir atendente tem prioridade sobre só voltar um passo.

## Contexto

Quem navega vagas/seleções (`listou_categorias` → `listou_vagas` → `listando_cargos_selecao`/
`aguardando_escolha_unidade`) não tem nenhuma forma de voltar um passo preservando o progresso — só
`"menu"` (reseta tudo, perde a categoria já escolhida) ou uma despedida (encerra a conversa inteira).
Mesmo a única tela que já tenta um escape inteligente (`listando_cargos_selecao`, via
`_escape_semantico_ou_none`) falha na prática, porque o classificador semântico **não tem categoria**
pra "quero ver outras opções do mesmo assunto" — só sabe responder `quer_sair` (despedida) e
`mudou_de_assunto` (troca pra assunto **diferente**). "Quero ver outras vagas" não é nem uma coisa nem
outra por definição.

Confirmado com uma conversa real travada em produção no momento da investigação
(`conversa_id = bb65d04a-4aed-473a-a6f2-4eb88886da68`): lead disse a frase mais natural possível
("Quero ver outras vagas") depois de errar a escolha de cargo, e o bot repetiu "Não entendi. Digite o
número do cargo..." — sem reconhecer o pedido.

## Valor de negócio

Fricção de UX real e confirmada, não um bug de crash/segurança — afeta a percepção de qualidade do bot
pra todo mundo que só quer navegar/comparar vagas antes de se candidatar (não é uma minoria; é o
comportamento natural de quem está decidindo).

## Dependência real

Sequenciada como 3ª (depois de S-EMP-AUD-020 e S-EMP-AUD-022) por decisão do Junior — ver nota de
coordenação no topo sobre a ordem `quer_atendente_humano` → `quer_voltar` dentro do mesmo helper.

## Acceptance Criteria

- [x] `_mostrar_categorias`/`_mostrar_vagas_da_categoria` extraídas como funções reusáveis (mesmo
      padrão de `_mostrar_menu_opcoes`), usadas tanto na ida quanto na volta
- [x] Mapa `_ETAPA_ANTERIOR` ligando cada etapa da cadeia à etapa-pai + atalho determinístico
      ("voltar"/"volta") checado no topo de `_processar_publico`, sem custo de LLM
- [x] Novo campo `quer_voltar` no contrato do classificador semântico, consumido dentro de
      `_escape_semantico_ou_none`, condicionado a `etapa in _ETAPA_ANTERIOR` — **sem regressão** nos
      outros 16 call sites que não fazem parte desta cadeia de navegação
- [x] `aguardando_escolha_unidade` ganha escape (determinístico + semântico) que **hoje não tem
      nenhum**
- [x] `categoria_escolhida` guardada no fluxo ao transicionar `listou_categorias` → `listou_vagas`
      (necessário pra reconstruir a tela ao voltar)
- [x] Rodapé de descoberta ("Digite *voltar* para ver outras opções.") nas 2 telas extraídas e nos
      fallbacks de `listando_cargos_selecao`/`aguardando_escolha_unidade` — sem isso a correção existe
      mas fica invisível, mesmo problema que "menu" já tem hoje
- [x] Teste de regressão reproduzindo a conversa real (`bb65d04a-...`) passa
- [x] `python -c "import empregabilidade_engine; import intencao_detector"` exits 0
- [x] `python -m pytest tests/test_empregabilidade_engine.py -v` exits 0, sem regressão

## Escopo

**In:** as 4 etapas da cadeia de navegação (`listou_categorias`, `listou_vagas`,
`listando_cargos_selecao`, `aguardando_escolha_unidade`); `_ETAPA_ANTERIOR`; campo `quer_voltar` no
classificador.

**Out:** lógica de negócio de candidatura em si; S-EMP-AUD-020 (`aguardando_confirmacao_candidatura`,
estado fora desta cadeia); busca de vagas em linguagem 100% livre (decisão de produto maior, fora de
escopo); "voltar" no fluxo de empresa (cadastro de vaga/seleção) — problema não investigado nem
confirmado desse lado.

## Test plan

Ver "Test plan" do plano de origem — 5 casos: regressão da conversa real; atalho determinístico nas 4
etapas (sem chamar o classificador); `quer_voltar` semântico; não-regressão fora do mapa de navegação;
`aguardando_escolha_unidade` aceitando "voltar" pela primeira vez.

## Change Log

- v0.1 (2026-08-13): Story criada por @sm a partir do Plano 021, a pedido do Junior — ordem de
  execução definida: 020 → 022 → 021.
- v0.2 (2026-08-13): @po validou — GO direto (10/10). Conversa real travada em produção como prova
  do bug; AC detalha as 4 etapas afetadas, o novo estado e o rodapé de descoberta (sem o que a
  correção existiria mas ficaria invisível); escopo exclui explicitamente busca livre e fluxo de
  empresa (não investigados); dependência de ordem com S-EMP-AUD-022 (`quer_voltar` depois de
  `quer_atendente_humano`) documentada. Status Draft → Ready.
- v1.0 (2026-08-13): @dev implementou navegação real de voltar nas quatro etapas de vagas/seleções,
  adicionou `quer_voltar` ao classificador, extraiu renderização de categorias/vagas e cobriu a
  regressão `bb65d04a-...`. Status Ready -> Review.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `python3 -m py_compile worker/intencao_detector.py worker/empregabilidade_engine.py worker/tests/test_intencao_detector.py worker/tests/test_empregabilidade_engine.py`
- `SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=dummy python3 -c "import sys; sys.path.insert(0, 'worker'); import empregabilidade_engine; import intencao_detector"`
- `python3 -m pytest worker/tests/test_intencao_detector.py worker/tests/test_empregabilidade_engine.py::TestVoltarNavegacaoAud021 -q`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=dummy python -c "import sys; sys.path.insert(0, 'worker'); import empregabilidade_engine; import intencao_detector"`
- `python3 -m pytest worker/tests/test_empregabilidade_engine.py -v`
- `SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=dummy python -c "import empregabilidade_engine; import intencao_detector"` em `worker/`
- `python -m pytest tests/test_empregabilidade_engine.py -v` em `worker/`
- `git diff --check -- worker/empregabilidade_engine.py worker/intencao_detector.py worker/tests/test_empregabilidade_engine.py worker/tests/test_intencao_detector.py docs/stories/S-EMP-AUD-021-navegacao-voltar-vagas-selecao.md`

### Completion Notes

- Extraídas `_mostrar_categorias` e `_mostrar_vagas_da_categoria`, com rodapé de descoberta para `voltar`.
- Criado `_ETAPA_ANTERIOR` e navegação determinística `voltar`/`volta` nas 4 etapas da cadeia.
- Adicionado `quer_voltar` ao contrato semântico e consumido em `_escape_semantico_ou_none` depois de `quer_atendente_humano`.
- `aguardando_escolha_unidade` agora usa escape semântico antes do fallback/contador de falhas.
- `categoria_escolhida` é persistida ao abrir uma categoria para reconstruir a tela de vagas ao voltar.
- Adicionados testes para a conversa real `bb65d04a-...`, atalho determinístico, semântico em unidade, não-regressão fora do mapa e rodapé.

### File List

- `worker/intencao_detector.py`
- `worker/empregabilidade_engine.py`
- `worker/tests/test_intencao_detector.py`
- `worker/tests/test_empregabilidade_engine.py`
- `docs/stories/S-EMP-AUD-021-navegacao-voltar-vagas-selecao.md`

## QA Results

### Review Date

2026-08-13

### Reviewed By

Quinn (Test Architect & Quality Advisor)

### Gate Decision

PASS

### Summary

Implementação validada para S-EMP-AUD-021. A navegação `voltar` foi implementada nas quatro etapas
do fluxo público de vagas/seleções, com atalho determinístico sem LLM, suporte semântico via
`quer_voltar`, preservação da prioridade de `quer_atendente_humano`, telas reusáveis e rodapé de
descoberta. Não encontrei bloqueantes funcionais.

### Requirements Traceability

- AC1 — PASS: `_mostrar_categorias` e `_mostrar_vagas_da_categoria` existem e são usadas na ida e na volta.
- AC2 — PASS: `_ETAPA_ANTERIOR` cobre `listou_categorias`, `listou_vagas`, `listando_cargos_selecao` e `aguardando_escolha_unidade`; `voltar`/`volta` roda antes de LLM.
- AC3 — PASS: `quer_voltar` foi adicionado ao contrato semântico e só é consumido quando `etapa in _ETAPA_ANTERIOR`; `quer_atendente_humano` permanece prioritário.
- AC4 — PASS: `aguardando_escolha_unidade` chama `_escape_semantico_ou_none` antes do fallback/contador.
- AC5 — PASS: `categoria_escolhida` é persistida ao transicionar de categoria para vagas.
- AC6 — PASS: rodapé `Digite *voltar* para ver outras opções.` presente nas telas extraídas e nos fallbacks de cargo/unidade.
- AC7 — PASS: regressão `bb65d04a-...` coberta por teste.
- AC8 — PASS: import literal de `empregabilidade_engine` e `intencao_detector` passa.
- AC9 — PASS: suíte verbosa de `tests/test_empregabilidade_engine.py` passa sem regressão.

### Evidence

- `git diff --check -- worker/empregabilidade_engine.py worker/intencao_detector.py worker/tests/test_empregabilidade_engine.py worker/tests/test_intencao_detector.py docs/stories/S-EMP-AUD-021-navegacao-voltar-vagas-selecao.md` — passed
- `python3 -m pytest worker/tests/test_intencao_detector.py worker/tests/test_empregabilidade_engine.py::TestVoltarNavegacaoAud021 -q` — 42 passed
- `npm run lint` — passed
- `npm run typecheck` — passed
- `npm test` — 94 passed, 2 warnings
- `npm run build` — passed
- `SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=dummy python -c "import empregabilidade_engine; import intencao_detector"` em `worker/` — passed
- `python -m pytest tests/test_empregabilidade_engine.py -v` em `worker/` — 94 passed, 2 warnings

### Risk Assessment

- Functional regression risk: Low. Mudança fica limitada à cadeia pública de navegação e o teste cobre não-interceptação fora do mapa.
- UX risk: Low. O rodapé torna a nova ação descobrível sem adicionar opção fixa ao menu principal.
- Operational risk: Low. Sem migração, sem novo serviço e sem alteração de infraestrutura.

### Residual Notes

- CodeRabbit não está disponível no PATH deste ambiente (`command -v coderabbit` sem resultado), então não foi executado localmente.
- Os 2 warnings de `datetime.utcnow()` são pré-existentes em testes de cancelamento e não impactam o escopo da S-EMP-AUD-021.
