# S-EMP-AUD-026 — Notificações proativas do loop não são gravadas no portal (falta conversa_id/lead_id)

**Status:** InReview
**Epic:** Auditoria Empregabilidade
**Origem:** demanda direta do Junior, 2026-08-18 ("ACOMPANHAMENTO TOTAL DO PROCESSO") — causa raiz
confirmada com certeza por leitura de código, não é achado provável
**Prioridade:** **P0** | **Esforço:** P | **Risco:** BAIXO — correção mecânica (passar 2 kwargs que já
existem como variáveis locais), sem mudança de lógica de negócio

## Contexto

Relato do Junior: atendente no portal não vê, na conversa, as mensagens finais da automação — nem a
confirmação de vaga/seleção criada (visão empresa), nem a confirmação de currículo/candidatura enviada
(visão candidato).

**Causa raiz confirmada:** `_enviar` (`worker/empregabilidade_engine.py:246-273`) só grava a mensagem
em `mensagens` **se `conversa_id` for passado**:

```python
if ok and conversa_id:
    ...insert em mensagens...
```

`_empregabilidade_notify_tick` (`worker/empregabilidade_engine.py:3872-4060` — o loop proativo que
roda a cada 20s e dispara essas confirmações) chama `_enviar(instance_name, token, phone, texto)` em
**6 pontos**, em **nenhum** passando `conversa_id`/`lead_id` — mesmo essas duas variáveis já estando
disponíveis no escopo local de cada chamada:

1. Vaga criada com sucesso (`:3934`)
2. Processo seletivo criado com sucesso (`:3962`)
3. Edição de vaga confirmada (`:3990`)
4. Currículo salvo no banco de talentos (`:4022`)
5. Candidatura recebida com sucesso (`:4041`)
6. Oferta de nova candidatura (`:4048`)

A mensagem **é enviada normalmente pelo WhatsApp** (o lead/empresa recebe certinho) — só não é
persistida em `mensagens`, então **nunca aparece no portal**. Não é bug de query/filtro do portal (o
componente de chat já busca sem filtro de `remetente`, confirmado em
`cuca-portal/src/components/chat/chat-window.tsx:147-167`).

Essa única causa explica os dois relatos do Junior (empresa e candidato) — mesma função, mesmo bug,
replicado 6 vezes.

## Impacto (por item)

| Toca | Consome hoje | Impacto observável | De-risk |
|---|---|---|---|
| 6 chamadas de `_enviar` em `_empregabilidade_notify_tick` | Portal (visualização de conversa), nada mais — `_enviar` sem `conversa_id` só pula o insert, não quebra o envio | Mensagens passam a aparecer no portal — mudança 100% aditiva, sem side-effect negativo esperado | Nenhum de-risk adicional necessário — `conversa_id`/`lead_id` já são exatamente os mesmos valores usados em `_set_fluxo_async` logo abaixo de cada chamada, já validados como corretos no escopo |
| Volume de `mensagens` gravadas | Tabela `mensagens`, consumida pelo portal e por qualquer relatório futuro | Aumento pequeno e esperado (6 mensagens automáticas a mais por evento de conclusão) — nenhum índice/paginação afetado (portal já limita a 200 mais recentes) | Nenhum |
| Realtime do portal | `chat-window.tsx:78-107`, assina INSERT em `mensagens` filtrado por `conversa_id` | Passa a receber esses 6 tipos de evento em tempo real também — comportamento correto e esperado, mesmo canal já usado pras outras mensagens do bot | Nenhum |

## Valor de negócio

**P0** — atendente sem visibilidade completa da conversa é falha operacional direta, não só UX:
impede acompanhar se o processo realmente terminou sem abrir o WhatsApp em paralelo.

## Acceptance Criteria

1. As 6 mensagens do loop proativo passam a ser gravadas em `mensagens` com `conversa_id`/`lead_id`
   corretos.
2. Aparecem no portal, tanto no carregamento inicial (`fetchMessages`) quanto via realtime, sem
   recarregar a página.
3. Nenhuma mudança no texto ou timing das mensagens — só a persistência.
4. Nenhuma regressão no fluxo de avanço de etapa (`_set_fluxo_async` continua condicionado a `_ok`
   como já é hoje).

## Escopo

**In:** as 6 chamadas em `_empregabilidade_notify_tick`.
**Out:** qualquer outra função de envio do arquivo (já passam `conversa_id` corretamente, confirmar
como parte do QA, não mudar).

## Test plan

- Para cada uma das 6 mensagens: mock de `_enviar`, assert que é chamado com `conversa_id=` e
  `lead_id=` não-vazios.
- Teste de integração/manual (autorizado pelo Junior): disparar cada fluxo e confirmar no portal.

## Dev Agent Record

### File List

- `worker/empregabilidade_engine.py` — as 6 chamadas de `_enviar` em `_empregabilidade_notify_tick`
  passam a receber `conversa_id=conversa_id, lead_id=lead_id`.
- `worker/tests/test_empregabilidade_engine.py` — 6 testes novos em `TestBloco6NotifyLoop`, um por
  ponto de disparo (vaga criada, seleção criada, edição confirmada, banco de talentos confirmado,
  candidatura recebida — cobrindo as 2 mensagens desse último), todos asserindo `conversa_id`/
  `lead_id` não-vazios passados ao `_enviar`.

### Completion Notes

- AC #1 e #3 e #4: cobertos por teste automatizado (99/99 em
  `test_empregabilidade_engine.py`, incluindo os 6 novos).
- AC #2 (aparecer no portal via realtime): validação manual, fora do alcance de teste automatizado —
  pendente de confirmação em produção/staging quando autorizado.
- Suíte completa do worker: 277 passed, 5 failed — as 5 falhas são de ambiente, pré-existentes e
  não relacionadas a este arquivo (`test_meta_adapter_outbound.py`, erro de import de
  `worker.main`/módulo ausente), confirmadas como tal antes desta mudança.

## Change Log

- v0.1 (2026-08-18): Story criada por @sm a partir de demanda direta do Junior — causa raiz
  confirmada por @dev com leitura de código, alta confiança.
- v0.2 (2026-08-18): @po validou — **GO direto (10/10)**. Melhor story do lote: causa raiz confirmada
  com certeza (não "achado provável"), fix mecânico de baixíssimo risco (2 kwargs que já existem como
  variável local, em 6 pontos), explica os 2 relatos do Junior com uma única causa, zero mudança de
  comportamento de negócio. P0 justificado — é falha operacional ativa, não só melhoria. Nenhuma
  observação. Priorizar esta antes das demais do lote. Status Draft → Ready.
- v0.3 (2026-08-18): @dev implementou — 6 chamadas de `_enviar` corrigidas com `conversa_id`/
  `lead_id`, 6 testes de regressão adicionados, suíte completa validada (277 passed, 5 falhas de
  ambiente pré-existentes não relacionadas). Status Ready → InReview, aguardando @qa.
