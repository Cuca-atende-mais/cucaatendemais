# S-EMP-AUD-032 — Paliativo: sobe limiar de falhas antes de oferecer atendente humano (2 → 3)

**Status:** Done
**Epic:** Auditoria Empregabilidade
**Origem:** Auditoria `AUDITORIA-empregabilidade-2026-08-27.md` (achado BUG-04) + Plano
`029-expirar-etapa-conversa-apos-inatividade.md`, análise do @dev em sessão de leitura da
auditoria (2026-08-28) — mitigação de baixo esforço enquanto a S-EMP-AUD-033 (solução completa)
não é implementada.
**Prioridade:** P2 (mitigação) | **Esforço:** XS (1 linha) | **Risco:** BAIXO — só afrouxa um
limiar já existente, não muda a lógica de decisão

> **Nota de escopo:** esta story é um **paliativo deliberado**, não a correção do achado BUG-04.
> A causa raiz (nenhuma etapa/contador expira com o tempo) só é resolvida pela
> **S-EMP-AUD-033**. Esta story existe pra reduzir o dano *enquanto* a S-EMP-AUD-033 não entra —
> se as duas forem implementadas próximas uma da outra, @po/Junior pode decidir pular esta e ir
> direto pra S-EMP-AUD-033.

## Contexto

A auditoria encontrou uma lead que deixou 1 tentativa inválida registrada numa etapa há 9 dias
e, ao voltar só com "Olá", foi escalada pra atendente humano 11 segundos depois — o bot nunca
mostrou o menu de novo. Causa: `_LIMIAR_FALHAS_OFERTA_ATENDENTE = 2`
(`worker/empregabilidade_engine.py:110`) conta falhas por etapa sem nenhuma noção de tempo — 1
falha de 9 dias atrás mais 1 falha "nova" (mesmo sendo uma mensagem sem relação nenhuma com a
etapa antiga) já bate o limiar.

A solução completa (expirar etapa/contador por inatividade) é maior e tem decisão de produto no
meio (limiar de tempo, o que resetar — ver S-EMP-AUD-033). Esta story cobre só a mitigação
imediata: qualquer cenário de "quase-limiar" (não só o de retorno tardio) fica com mais margem
até a solução completa chegar.

## O que precisa ser implementado

Alterar `worker/empregabilidade_engine.py:110`:

```python
_LIMIAR_FALHAS_OFERTA_ATENDENTE = 2
```
para
```python
_LIMIAR_FALHAS_OFERTA_ATENDENTE = 3
```

Nenhuma outra mudança de código. Não mexer em `_ETAPAS_OFERTA_ATENDENTE` (linha 111-118) nem em
`_registrar_falha_e_oferecer_atendente` (linha 714+) — a lógica continua a mesma, só o número
muda.

## Acceptance Criteria

1. `_LIMIAR_FALHAS_OFERTA_ATENDENTE` passa de `2` para `3`.
2. Testes existentes que dependem do valor `2` (buscar por
   `_LIMIAR_FALHAS_OFERTA_ATENDENTE` e por contagem literal de tentativas em
   `worker/tests/test_empregabilidade_engine.py`) são atualizados pra refletir o novo limiar —
   não podem quebrar silenciosamente nem ficar testando o valor antigo.
3. Suíte completa do worker roda sem falha nova.

## Escopo

**In:** o valor da constante + os testes que dependem dele.
**Out:** qualquer lógica de expiração por tempo (isso é a S-EMP-AUD-033); mudar
`_ETAPAS_OFERTA_ATENDENTE` (quais etapas contam falha) — fora de escopo, não foi pedido.

## ⚠️ Análise de impacto — por item

### Item único — subir o limiar de 2 para 3

- **Toca:** 1 constante, lida por `_registrar_falha_e_oferecer_atendente` (linha 714+), único
  ponto de decisão de "oferecer atendente humano por falhas repetidas".
- **Consome hoje:** todo o fluxo de Empregabilidade que passa pelas 5 etapas de
  `_ETAPAS_OFERTA_ATENDENTE` (`listou_categorias`, `listando_cargos_selecao`,
  `aguardando_escolha_unidade`, `listou_cargos_consolidados`, `listou_ocorrencias_cargo`) — não
  há consumidor externo (é lido só dentro do próprio arquivo).
- **Impacto observável:** leads passam a ter **1 tentativa inválida a mais**, dentro da mesma
  etapa, antes do bot oferecer atendente humano — em qualquer cenário, não só no de retorno após
  dias de inatividade (esse continua com o mesmo problema de fundo até a S-EMP-AUD-033, só que
  com 1 chance a mais de digitar algo válido antes de escalar). Não elimina o BUG-04, só reduz a
  frequência com que ele se manifesta como "morte súbita" logo na 2ª tentativa.
- **De-risk:** mudança de 1 valor, sem lógica nova — o teste automatizado (AC2) e a suíte
  completa (AC3) já cobrem o risco de regressão. Nenhum teste manual adicional necessário.

## Test plan

- Rodar `cd worker && pytest tests/test_empregabilidade_engine.py -v` e conferir que nenhum teste
  que dependia do limiar `2` quebrou (ou foi corretamente atualizado pro `3`).
- Reprodução manual (opcional, baixo valor dado o tamanho da mudança): simular 2 tentativas
  inválidas seguidas numa das 5 etapas — confirmar que o bot **não** oferece atendente ainda (só
  ofereceria na 3ª).

## File List (proposto)

- `worker/empregabilidade_engine.py` (linha 110)
- `worker/tests/test_empregabilidade_engine.py` (ajuste dos testes que dependem do limiar)

## Change Log

- v0.1 (2026-08-28): @sm cria a story a partir da auditoria `AUDITORIA-empregabilidade-2026-08-27.md`
  e da sugestão do @dev de mitigação imediata enquanto a solução completa (S-EMP-AUD-033) não
  entra. Status: Draft — aguardando validação do @po.
- v0.2 (2026-08-28): @po valida — **GO** (10/10 no checklist de validação de story). Status:
  Draft → **Ready**.
- v0.3 (2026-08-28): @dev implementa — `_LIMIAR_FALHAS_OFERTA_ATENDENTE` de `2` pra `3`
  (`worker/empregabilidade_engine.py:110-114`, comentário explica o motivo e referencia a
  S-EMP-AUD-033 como solução definitiva). Único teste que dependia do valor literal
  (`test_duas_falhas_na_mesma_etapa_oferecem_atendente`) renomeado pra
  `test_tres_falhas_na_mesma_etapa_oferecem_atendente` e estendido com uma 3ª rodada de
  mensagem inválida + asserção intermediária (`falhas_atendente_etapa == 2` ainda não escala).
  Suíte completa (`test_empregabilidade_engine.py` + `test_meta_adapter_inbound.py`, 256 testes)
  rodada sem falhas novas. Status: Ready → **InReview** (aguardando @qa).
- v0.4 (2026-08-28): @qa revisou — **PASS**. Ver "QA Results" abaixo. Status: InReview → **Ready
  for Review** (pronta pro @devops, aguardando decisão do Junior).

## QA Results

### Review em 2026-08-28 — @qa Quinn

**Gate: PASS**

**7 checks:**

1. **Code review** — diff mínimo e correto: 1 valor de constante + comentário explicando o
   motivo (referencia BUG-04 e S-EMP-AUD-033) + 1 teste estendido. Nada além do escopo da story.
2. **Testes** — grep por `_LIMIAR_FALHAS_OFERTA_ATENDENTE` e por "2 falhas"/"duas falhas"/"2
   tentativas" em todo `worker/*.py` e `worker/tests/*.py` confirma que só o teste já ajustado
   pelo @dev dependia do valor antigo. A única outra ocorrência de "2 tentativas" é sobre um
   mecanismo diferente (retry de envio de link, `empregabilidade_engine.py:3433`), não
   relacionada. O teste estendido cobre corretamente o novo comportamento: 2 falhas ainda não
   escalam (asserção intermediária nova), só a 3ª.
3. **Acceptance Criteria** — AC1 (constante 2→3) e AC2 (teste atualizado, sem depender do valor
   antigo) confirmados por leitura direta do diff. AC3 (suíte completa sem falha nova) — rodei de
   forma independente: `pytest tests/test_empregabilidade_engine.py tests/test_meta_adapter_inbound.py`,
   **256 passed**, mesmo baseline citado na S-EMP-AUD-031.
4. **Regressão** — `_registrar_falha_e_oferecer_atendente` (único ponto que lê a constante) não
   tem nenhuma outra lógica dependente do valor específico — é comparação genérica
   (`falhas >= _LIMIAR_FALHAS_OFERTA_ATENDENTE`). Sem efeito colateral em outras etapas ou fluxos.
5. **Performance** — nenhum impacto; é literal de comparação.
6. **Segurança** — sem superfície nova.
7. **Documentação** — story completa, mudança pequena mas com contexto e justificativa
   registrados no próprio código (comentário) e na story. OK.

**Resumo:** aprovado sem ressalvas — é a story mais simples da leva e entregou exatamente o que
prometeu, sem gerar nenhum achado novo.

- v0.5 (2026-08-28): @devops abriu o PR #139 (`fix/s-emp-aud-032-paliativo-limiar-falhas` →
  `main`). Junior aprovou, mergeou, confirmou o redeploy do `cuca-worker` no EasyPanel **com
  sucesso**. Status: InReview → **Done**.
