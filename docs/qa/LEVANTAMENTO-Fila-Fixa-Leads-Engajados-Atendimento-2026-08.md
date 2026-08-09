# Levantamento — Fila fixa de leads engajados no painel de Atendimento

Autor: @dev (Dex). Data: 2026-08-07. Baseado em leitura de código (`chat-sidebar.tsx`,
`meta_adapter_inbound.py`, `campanhas_engine.py`) + conferência ao vivo no banco `cuca`
(produção, read-only). Nenhuma implementação feita — é levantamento para o @sm fatiar em
story(ies), a pedido do Junior.

---

## 1. O pedido, resumido

O colaborador responsável por disparos/transbordo precisa enxergar, sem esforço, **todo lead
que já interagiu** com a automação (respondeu a um disparo, ou mandou mensagem por conta própria)
— porque a instrução de "fale com um atendente" é **propositalmente omitida** do prompt (se o
lead souber que pode pedir humano a qualquer momento, ele para de tentar resolver com a IA), então
o único jeito de pegar um lead travado é o colaborador **observar proativamente**, não esperar um
handover explícito.

Pedido concreto:
- Conversas com **pelo menos 1 mensagem do lead** ficam **fixas no topo**, numa seção separada do
  restante.
- Conversas sem nenhuma mensagem do lead (só receberam disparo, nunca responderam) seguem o fluxo
  normal, embaixo.
- No momento em que um lead manda a primeira mensagem, a conversa dele **migra** pra seção fixa.
- **Todas** as conversas engajadas ficam visíveis, sem limite de quantidade — com scroll dentro da
  seção fixa, não paginação/corte.

---

## 2. Achado crítico — por que isso é urgente, não só "seria bom ter"

`components/chat/chat-sidebar.tsx` (componente **compartilhado**, usado por Institucional,
Empregabilidade, Ouvidoria, Programação e Academia Enem — 5 páginas) hoje:

```ts
const PAGE_SIZE = 50;
...
.order('updated_at', { ascending: false })
.limit(PAGE_SIZE)
```

Busca só as **50 conversas mais recentes por `updated_at`**, sem nenhuma distinção entre "lead
respondeu" e "lead só recebeu mensagem nossa".

**O problema concreto, com números reais de hoje:** `worker/campanhas_engine.py::
_gravar_breadcrumb_disparo` cria uma linha em `conversas` (`status='ativa'`, `updated_at=now()`)
pra **cada lead que recebe um disparo**, mesmo que ele nunca responda — é assim que o breadcrumb
funciona hoje, e não há nada de errado nisso pro propósito original dele. O problema é que
`updated_at` desse INSERT é exatamente o `now()` do momento do envio, e o `chat-sidebar.tsx` ordena
só por isso.

**Consequência medida:** hoje há 365 conversas no banco, só 10 com interação real do lead. Depois
do disparo desta semana (~514 leads), o total de conversas deve saltar pra perto de 880 — e como o
sidebar só traz as 50 mais recentes por `updated_at`, **as 50 conversas visíveis logo após um
disparo em massa tendem a ser dominadas pelos últimos leads processados no loop de envio (que
nunca responderam ainda), não pelos que já respondeu**. Um lead que respondeu no início do disparo
pode ficar invisível, fora da lista, sem o colaborador nunca saber.

Isso não é hipotético: `nao_lidas` (badge de não lida) só sinaliza enquanto a conversa não foi
lida — se o colaborador já abriu e leu, ou se a conversa simplesmente não aparece na lista de 50,
não há nenhum outro sinal visual hoje.

**Achado colateral, mesma causa:** o `awaiting_human` já é fixado no topo hoje (T5,
`chat-sidebar.tsx:174-179`) — mas só cobre o handover **explícito**. Como a instrução de "fale com
humano" é deliberadamente omitida, hoje (2026-08-07) **0 conversas** estão em `awaiting_human` no
banco, apesar de haver 10 com interação real. O mecanismo de pin que já existe não resolve o
problema que o Junior está descrevendo — é um problema adjacente, não o mesmo.

---

## 3. Desenho proposto (para o @sm detalhar em AC)

### 3.1 Sinal de "interagiu" — não reaproveitar campo existente

Nem `status` nem `updated_at` servem (ambos contaminados por escritas do lado do disparo, não só
do lado do lead). Nem `nao_lidas` serve sozinho (reseta ao ler, e o pedido é "todas as que
interagiram", não "todas as não lidas").

**Proposta:** coluna nova em `conversas`, setada **uma única vez**, só pelo caminho **inbound**
(`meta_adapter_inbound.py`, nunca pelo caminho de disparo/breadcrumb):

```sql
ALTER TABLE conversas ADD COLUMN primeira_interacao_lead_em timestamptz;
```

Setar no upsert de `conversas` em `processar_webhook_meta` — só quando a conversa está sendo
criada de fato (`conversaGenuinamenteNova`, mecanismo que a S-WM-24/VAL-07 já usa) **ou** quando a
coluna ainda está `NULL` num upsert existente (cobre o caso de uma conversa criada primeiro pelo
disparo — sem inbound ainda — que só recebe a 1ª mensagem do lead depois).

**Backfill obrigatório na migration** (dado real já existe, não pode nascer com todo mundo "sem
interação"):
```sql
UPDATE conversas c SET primeira_interacao_lead_em = (
  SELECT min(created_at) FROM mensagens m WHERE m.conversa_id = c.id AND m.remetente = 'lead'
) WHERE EXISTS (SELECT 1 FROM mensagens m WHERE m.conversa_id = c.id AND m.remetente = 'lead');
```

### 3.2 Backend (query do sidebar)

`chat-sidebar.tsx` passa a fazer **2 buscas**, não 1:
- **Fixas:** `WHERE primeira_interacao_lead_em IS NOT NULL`, **sem** `.limit()` — ordenada por
  `awaiting_human` primeiro (mantém o pin existente), depois `updated_at desc` dentro da seção.
- **Normais:** `WHERE primeira_interacao_lead_em IS NULL`, mantém `.limit(PAGE_SIZE)` como hoje.

Volume atual (10 engajadas) não justifica paginação/virtualização na seção fixa — é lista simples
com `overflow-y-auto` própria. Se o volume crescer muito (milhares), isso pode precisar
revisão futura — não é o caso hoje.

### 3.3 Frontend

Duas seções visuais na sidebar: "Conversas ativas" (fixa, sempre visível, scroll próprio) acima de
"Aguardando primeiro contato" (fluxo normal, como hoje). Mesmo componente de linha de conversa
reaproveitado nos dois — só o agrupamento/cabeçalho de seção é novo.

### 3.4 Escopo — componente compartilhado, não por canal

Por estar em `chat-sidebar.tsx` (não em cada `page.tsx`), a mudança vale automaticamente pra
**Institucional, Empregabilidade, Ouvidoria e Programação** de uma vez — sem duplicar lógica por
canal. Academia Enem já importa o mesmo componente compartilhado (`academia-enem/mensagens/
page.tsx`) — os arquivos órfãos `ae-chat-sidebar.tsx`/`ae-chat-window.tsx` não são tocados nem
usados por essa mudança.

---

## 4. Análise de impacto, item por item (regra NON-NEGOTIABLE do projeto)

1. **Toca:** `conversas` (coluna nova + backfill), `meta_adapter_inbound.py` (grava o timestamp),
   `chat-sidebar.tsx` (query dupla + UI de 2 seções).
   **Depende disso hoje:** todo colaborador que usa qualquer um dos 5 painéis de atendimento
   listados na Seção 3.4.
   **Impacto observável:** positivo — nenhuma conversa muda de comportamento de IA/resposta, só a
   forma como aparece na lista lateral. Risco de regressão: se a query nova tiver bug, poderia
   esconder conversas que hoje aparecem — mitigar com teste de regressão comparando contagem
   total (fixas + normais = total antes da mudança).
2. **Toca:** RLS de `conversas` — coluna nova não muda nenhuma policy existente (não é campo
   sensível, é só timestamp). De-risk: `get_advisors` depois de aplicar, confirmar 0 novo achado.
3. **Toca:** volume de dado trafegado no realtime (`postgres_changes` em `conversas.*`) — já
   escuta a tabela inteira hoje, coluna nova não muda o volume de eventos, só o payload marginal.
   Sem impacto de performance esperado.
4. **Não toca:** motor-agente, lógica de resposta da IA, regra de handover (`awaiting_human`)
   continua exatamente como está — este levantamento não muda **quando** um lead vira
   `awaiting_human`, só melhora a visibilidade de quem já mandou mensagem, esteja ou não em
   handover.
5. **Não toca:** `worker/empregabilidade_engine.py` (fluxo de Julia) — mensagens de lead nesse
   canal já passam por um caminho de gravação de `mensagens` diferente; confirmar no @dev, ao
   implementar, se o mesmo padrão de "setar no upsert de conversas" se aplica lá ou se precisa de
   ponto de gravação próprio (não confirmado nesta rodada — ver Pergunta em Aberto #3).

---

## 5. Decisões do Junior (2026-08-07) — perguntas fechadas

1. **Ordenação dentro da seção fixa:** `awaiting_human` primeiro, depois `updated_at desc` — mesmo
   critério que o pin existente já usa. **Fechado.**
2. **Saída da fila fixa:** uma conversa fixada **não sai por resolução manual** — sai só quando as
   conversas forem resetadas, seja pelo cron de reset (ver Seção 5.1, achado novo) ou por reset
   manual. **Fechado — "marcar como resolvida" fica fora de escopo desta story.**
3. **Empregabilidade/Julia:** não se aplica por enquanto — sinal de "1ª interação" fica restrito
   ao caminho motor-agente (Institucional/Ouvidoria/Acesso), como já estava desenhado na Seção 3.
   **Fechado.**

### 5.1 Achado novo, motivado pela resposta #2 — o mecanismo de reset já existe, em 2 formas

Fui conferir o "cron que uma hora voltará a funcionar" que o Junior mencionou — é real, e o estado
dele agora explica exatamente por que a resposta #2 funciona sem trabalho extra:

- **`reset_automation_memory()`** (função já existente, `SECURITY DEFINER`): `DELETE FROM
  mensagens`, `DELETE FROM conversas`, `DELETE FROM logs_webhook` — **sem filtro, apaga tudo**.
  Hoje é acionado via **pg_cron job id 10** (`0 3 * * *`, todo dia às 3h), mas confirmado no banco
  agora: **`active = false`** — desligado. Isso bate exatamente com "o cron que uma hora voltará a
  funcionar": existe, está pronto, só não está ligado agora.
- **Reset manual já existe também**, sem precisar construir nada novo: endpoint
  `cuca-portal/src/app/api/developer/reset-automation-memory/route.ts` chama essa mesma RPC —
  ação de Developer no portal.

**Consequência pra este levantamento:** como `reset_automation_memory()` apaga a linha inteira de
`conversas`, a coluna nova (`primeira_interacao_lead_em`) some junto, automaticamente, sem
precisar de nenhuma lógica de "desfixar" própria. As 2 formas de reset que o Junior descreveu **já
existem hoje** — cron (desligado) e botão manual (Developer) — nenhuma delas precisa ser
construída nesta story.

**Achado colateral, registrado mas fora de escopo:** existe também o **pg_cron job id 9** (ativo,
a cada 30min): `UPDATE conversas SET status='encerrada' WHERE status='ativa' AND
agente_tipo='Institucional' AND updated_at < now() - interval '2 hours'` — encerra automaticamente
conversas inativas há 2h+, mas só muda `status`, **não apaga a linha nem o `primeira_interacao_lead_em`**.
Ou seja: uma conversa pode ficar com `status='encerrada'` e continuar fixa na seção — comportamento
consistente com a decisão #2 (só reset apaga, não o encerramento automático por inatividade).

**Pergunta que passa a ser só informativa, não bloqueante:** religar o job id 10
(`reset_automation_memory`) é decisão separada, de quando o Junior quiser — não faz parte desta
story, só registrado aqui pra quem for implementar não estranhar o job aparecer desligado.

---

## 6. Escopo sugerido pro @sm

**IN:** coluna + backfill, gravação no inbound (motor-agente/Institucional confirmado — Ouvidoria
e Acesso também passam por esse mesmo caminho, então ganham de graça), query de 2 seções no
`chat-sidebar.tsx`, UI de 2 seções com scroll próprio na fixa.

**OUT:** qualquer mudança em quando `awaiting_human` é setado (regra de handover não muda),
qualquer mudança nos componentes `ae-chat-*` (órfãos, fora de escopo), Empregabilidade/Julia
(decisão #3), conceito de "marcar como resolvida" (decisão #2 — só reset tira da fila, mecanismo
já existente, nada novo a construir), religar o cron `reset_automation_memory` (decisão
operacional separada, não desta story).
