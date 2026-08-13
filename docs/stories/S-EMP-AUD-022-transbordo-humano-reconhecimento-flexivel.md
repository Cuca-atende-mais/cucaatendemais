# S-EMP-AUD-022 — Transbordo humano reconhece pedidos flexíveis + oferece proativamente após falhas repetidas

**Status:** Review
**Epic:** Auditoria Empregabilidade (2026-07-29, leva 12-13/08)
**Origem:** `docs/2026-08-13/022-transbordo-humano-reconhecimento-flexivel.md` (confirmado ao vivo contra
`origin/main`, commit `c5ac2db`, em 2026-08-13)
**Verificação cruzada:** confirmado ao vivo pelo @dev em 2026-08-13 — `_CONTAINS_HANDOVER`
(`:3072-3083`), `_processar_mensagem_empregabilidade_locked` (`:3027`), `_acionar_transbordo_empregabilidade`
(`:375`), `_escape_semantico_ou_none` (`:565`) todos batem exatamente com o "Current state" do plano
**Prioridade:** P1 | **Esforço:** M | **Risco:** MÉDIO — toca o contrato do classificador semântico
(17 call sites no arquivo) e introduz mecanismo de estado novo (contador de falhas por etapa)
**Ordem de execução proposta:** **2ª de 3** (020 → 022 → 021) — decisão do Junior. Coordenar com
S-EMP-AUD-021: este plano precisa que seu campo (`quer_atendente_humano`) fique **antes**, no
classificador, do `quer_voltar` que o 021 vai adicionar depois — pedir atendente é mais prioritário
que só voltar um passo.

## Contexto

"Falar com atendendte" (erro de digitação real, do próprio time testando) não bate com nenhuma das
~25 frases exatas de `_CONTAINS_HANDOVER`, nem é reconhecido pelo classificador semântico — que hoje
só sabe responder `quer_sair` (despedida) e `mudou_de_assunto` (troca de assunto), nenhuma categoria
para "quer falar com humano". O pedido é **ignorado em silêncio**: a conversa não muda de status
(`awaiting_human`), nenhum erro aparece, o bot simplesmente responde a mensagem padrão da etapa como
se nada tivesse sido dito. Confirmado com conversa real do próprio time em produção.

O que **já está correto e não precisa mudar**: o contato de transbordo (`transbordo_humano`, ativo pra
Empregabilidade) e o template Meta aprovado (`empregabilidade_transbordo_v1`) — confirmados ao vivo no
banco. `_acionar_transbordo_empregabilidade` também já trata falha de notificação corretamente. O
problema é 100% de reconhecimento do pedido, não de infraestrutura de transbordo.

**Decisão de produto já tomada** (nesta mesma investigação, com o Junior): **não** virar "falar com
atendente" em opção fixa/visível no menu principal — risco de virar saída fácil pra frustração pequena
e sobrecarregar o único contato humano configurado hoje. Este plano cobre só os 2 itens que sobraram
dessa decisão: reconhecimento mais flexível quando a pessoa já tenta pedir, e o bot oferecendo
proativamente depois de falhar em ajudar 2 vezes seguidas.

## Valor de negócio

Pedido explícito de ajuda humana sendo ignorado é mais grave que fricção de navegação — a pessoa fica
sem nenhum recurso, mesmo tendo pedido ajuda de forma clara (só com um erro de digitação).

## Dependência real

Nenhuma dependência dura. Sequenciada como 2ª (depois de S-EMP-AUD-020, antes de S-EMP-AUD-021) por
decisão do Junior — os três tocam `_escape_semantico_ou_none`/o mesmo classificador semântico; rodar a
suíte completa entre cada um reduz risco de conflito de merge.

## Acceptance Criteria

- [x] Novo campo `quer_atendente_humano` no contrato do classificador (`avaliar_mensagem_contextual`/
      `_chamar_gpt_contextual`), reconhecendo pedidos mesmo com erro de digitação ou frase diferente do
      padrão
- [x] `_escape_semantico_ou_none` consome esse campo e aciona `_acionar_transbordo_empregabilidade`
      imediatamente (sem pedir confirmação), em **qualquer etapa** — checagem **antes** do bloco de
      `quer_voltar` que o S-EMP-AUD-021 vai adicionar depois
- [x] Contador de falhas por etapa (`_LIMIAR_FALHAS_OFERTA_ATENDENTE = 2`) aplicado a
      `listou_categorias`, `listando_cargos_selecao` e `aguardando_escolha_unidade` — 2 falhas seguidas
      na mesma etapa oferece transbordo proativamente, em vez de repetir a mesma pergunta pela 3ª vez
- [x] Novo estado `oferecendo_atendente_humano` — "sim" aciona transbordo; "não" volta pra etapa
      anterior com o contador zerado
- [x] Nenhuma opção fixa/visível de "falar com atendente" adicionada ao menu principal (decisão de
      produto já tomada, fora de escopo)
- [x] `_acionar_transbordo_empregabilidade` **não é alterado** (já funciona corretamente)
- [x] `python -c "import empregabilidade_engine; import intencao_detector"` exits 0
- [x] Teste de regressão reproduzindo a conversa real (`6a9af3ca-...`) passa
- [x] `python -m pytest tests/test_empregabilidade_engine.py -v` exits 0, sem regressão nos outros 16
      call sites de `_escape_semantico_ou_none`

## Escopo

**In:** `quer_atendente_humano` no classificador + consumo em `_escape_semantico_ou_none`; contador de
falhas + oferta proativa nas 3 etapas citadas; novo estado `oferecendo_atendente_humano`.

**Out:** opção fixa no menu principal (decisão de produto já descartada); contador de falhas em
`listou_vagas` (não tem fallback dedicado próprio, cai num fallthrough diferente) ou em qualquer etapa
do fluxo de empresa; mudar `_acionar_transbordo_empregabilidade` em si.

## Test plan

Ver "Test plan" do plano de origem — 5 casos: reconhecimento flexível aciona transbordo; contador de
falhas atinge o limiar; reset do contador ao mudar de etapa; resposta "sim" na oferta; resposta "não"
na oferta.

## Change Log

- v0.1 (2026-08-13): Story criada por @sm a partir do Plano 022, a pedido do Junior — ordem de
  execução definida: 020 → 022 → 021.
- v0.2 (2026-08-13): @po validou — GO direto (10/10). Contexto distingue claramente o que já
  funciona (contato/template de transbordo) do que falta (reconhecimento); decisão de produto já
  tomada (sem opção fixa no menu) citada e respeitada no escopo; AC cobre os 3 mecanismos (campo no
  classificador, contador de falhas, novo estado) com testes de regressão nomeados; dependência de
  ordem com S-EMP-AUD-021 (campo antes de `quer_voltar`) documentada nos dois lados. Status Draft →
  Ready.
- v1.0 (2026-08-13): @dev implementou `quer_atendente_humano`, escape semântico com transbordo
  imediato, oferta proativa após 2 falhas nas 3 etapas-alvo e estado `oferecendo_atendente_humano`.
  Status Ready -> Review.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `python3 -m py_compile worker/intencao_detector.py worker/empregabilidade_engine.py worker/tests/test_intencao_detector.py worker/tests/test_empregabilidade_engine.py`
- `SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=dummy python3 -c "import sys; sys.path.insert(0, 'worker'); import empregabilidade_engine; import intencao_detector"`
- `python3 -m pytest worker/tests/test_intencao_detector.py worker/tests/test_empregabilidade_engine.py::TestTransbordoHumanoFlexivelAud022 -q`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `python3 -m pytest worker/tests/test_empregabilidade_engine.py -v`
- `python3 -m pytest worker/tests/test_intencao_detector.py -q`

### Completion Notes

- Adicionado `quer_atendente_humano` ao contrato do classificador contextual, incluindo fallback seguro e prompt com exemplos de typos.
- `_escape_semantico_ou_none` agora prioriza pedido humano e chama `_acionar_transbordo_empregabilidade` sem confirmação.
- Criado contador por etapa com limiar 2 para `listou_categorias`, `listando_cargos_selecao` e `aguardando_escolha_unidade`.
- Criado estado `oferecendo_atendente_humano`: `sim` aciona transbordo e `não` restaura a etapa anterior com contador limpo.
- Nenhuma opção fixa de atendente foi adicionada ao menu principal; `_acionar_transbordo_empregabilidade` não foi alterado.

### File List

- `worker/intencao_detector.py`
- `worker/empregabilidade_engine.py`
- `worker/tests/test_intencao_detector.py`
- `worker/tests/test_empregabilidade_engine.py`
- `docs/stories/S-EMP-AUD-022-transbordo-humano-reconhecimento-flexivel.md`
