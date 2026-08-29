# S-EMP-AUD-033 — Expira etapa/contador de conversa dormente após inatividade

**Status:** Done
**Epic:** Auditoria Empregabilidade
**Origem:** Auditoria `AUDITORIA-empregabilidade-2026-08-27.md` (achado BUG-04) + Plano
`029-expirar-etapa-conversa-apos-inatividade.md`
**Prioridade:** P1 | **Esforço:** S/M | **Risco:** BAIXO/MÉDIO — muda comportamento de retomada
de conversa; precisa testar bem o caso "voltou rápido, deveria continuar de onde parou"
**Depende de:** nenhuma outra story desta leva. Complementa (não substitui) a S-EMP-AUD-032, que
é só mitigação temporária.

## Contexto

Conversa real (`211a15bc-0dc2-4b9f-acce-ffcde6e6245b`, lead "Lorena"): em 18/08 digitou um
número inválido na etapa `listou_categorias` (1ª falha registrada). Voltou só em 27/08 (**9 dias
depois**) com um simples "Olá" — e foi escalada pra atendente humano **11 segundos depois**, sem
o bot nunca mostrar o menu de novo. Causa raiz: nenhuma etapa/contador de conversa
(`conversas.metadata.empreg_fluxo`) tem qualquer noção de tempo — uma conversa "esquecida" há
semanas volta exatamente de onde parou, inclusive com o contador de falha já quase no limite.

Não há como saber quantas outras conversas dormentes no banco têm esse mesmo contador pendente —
só apareceu porque a Lorena voltou durante a janela da auditoria.

## Decisão de produto necessária antes de codar (Step 1 do plano original)

Duas perguntas que precisam de resposta do Junior/operador antes da implementação:

1. **Qual o limiar de inatividade?** Sugestão de partida da auditoria: **24h** — margem
   generosa pra alguém voltar no dia seguinte (ex. candidato que recebeu o link e volta pra
   confirmar), evitando o extremo de 9 dias visto no caso real.
2. **O que resetar quando o limiar é ultrapassado?** Só o contador de falhas (mínimo pra
   resolver o BUG-04), ou a etapa inteira volta pra `"inicio"`? O plano original recomenda reset
   total pra `"inicio"` — mais seguro contra dado desatualizado (vaga que fechou, cargo que não
   existe mais) — **exceto** para etapas com progresso claramente recuperável e ainda válido
   (ex. `aguardando_confirmacao_candidatura` com um link cujo `exp` na assinatura HMAC ainda não
   venceu).

Se ninguém souber responder com segurança a pergunta 1, usar **24h como default documentado
explicitamente como valor de partida**, não travar a implementação esperando resposta perfeita
(guidance do plano original).

## O que precisa ser implementado

1. **Confirmar a fonte de timestamp confiável** (`worker/empregabilidade_engine.py`): checar via
   query direta em produção se `conversas.ultima_mensagem_em` reflete de fato a última mensagem
   de conversas do canal Empregabilidade, ou se está desatualizada/nula:
   ```sql
   select id, ultima_mensagem_em, updated_at,
     (select max(created_at) from mensagens m where m.conversa_id = conversas.id) as ultima_msg_real
   from conversas where agente_tipo = 'Empregabilidade' order by updated_at desc limit 20;
   ```
   Se não bater de forma confiável, calcular o intervalo direto via
   `select max(created_at) from mensagens where conversa_id = ...` no próprio handler.

2. **Checagem de inatividade no ponto de entrada** — `_processar_mensagem_empregabilidade_locked`
   (`worker/empregabilidade_engine.py:4343+`), logo após carregar o fluxo: se o intervalo desde a
   última interação ultrapassar o limiar decidido, resetar o fluxo (conforme a decisão de produto
   acima) **antes** de rotear a mensagem por `etapa_atual`.

3. Nova função `_resetar_fluxo_por_inatividade` que implementa a decisão de produto (reset total
   vs. só contador vs. exceção para `aguardando_confirmacao_candidatura` com link ainda válido).

## Acceptance Criteria

1. Conversa com etapa parada há **mais** que o limiar decidido, retomada com qualquer mensagem →
   fluxo é resetado conforme a decisão de produto **antes** de processar a mensagem — não deve
   resultar em escalação imediata baseada em contador antigo.
2. Conversa com etapa parada há **menos** que o limiar → comportamento inalterado (não regredir
   o caso "voltou rápido, continua de onde parou").
3. Se a decisão de produto for "exceção para `aguardando_confirmacao_candidatura` com link ainda
   válido": esse caso específico não é resetado enquanto o `exp` da assinatura não vencer, mesmo
   passando do limiar geral.
4. Reprodução do caso real da Lorena (etapa `listou_categorias`, 1 falha, retomada após o limiar
   com mensagem genérica) resulta no bot mostrando o menu correspondente, não a oferta de
   atendente.

## Escopo

**In:** os 4 ACs acima, restritos a `worker/empregabilidade_engine.py`.
**Out:** mudar o valor de `_LIMIAR_FALHAS_OFERTA_ATENDENTE` em si (isso já foi tratado, se
aplicado, pela S-EMP-AUD-032 — não fundir as duas mudanças na mesma story); qualquer expiração de
dado fora do fluxo de conversa (links de candidatura já têm expiração própria via HMAC, não faz
parte desta story).

## ⚠️ Análise de impacto — por item

### Item 1 — Confirmar fonte de timestamp

- **Toca:** só leitura (query), nenhuma mudança de schema/dado nesta etapa.
- **Consome hoje:** decide se o Item 2 usa `conversas.ultima_mensagem_em` (barato) ou uma query
  em `mensagens` por conversa (mais caro, mas confiável).
- **Impacto observável:** nenhum ainda — é descoberta, não mudança.
- **De-risk:** rodar a query proposta em produção antes de decidir a implementação do Item 2.

### Item 2 — Checagem de inatividade no ponto de entrada

- **Toca:** `_processar_mensagem_empregabilidade_locked`, ponto de entrada de **toda** mensagem
  nova do canal Empregabilidade — mudança de alto tráfego.
- **Consome hoje:** todo lead que manda qualquer mensagem no canal Empregabilidade passa por essa
  função. Não há consumidor externo (é interno ao worker).
- **Impacto observável:** conversas retomadas depois do limiar têm o fluxo resetado antes de
  responder — muda a experiência de quem volta depois de muito tempo (positivo: não escala mais
  sem motivo; risco: se o reset for total, alguém que só queria "confirmar rápido" um progresso
  válido pode perder passos já dados, dependendo da decisão de produto do Step de exceção).
- **De-risk:** AC2 garante que o caso "voltou rápido" (dominante em volume) não muda. AC3 cobre a
  exceção de link ainda válido. Testes automatizados dos 2 cenários (expira / não expira) mais
  reprodução manual do caso real da Lorena.

### Item 3 — `_resetar_fluxo_por_inatividade` (nova função)

- **Toca:** função nova, sem substituir nada existente — chamada só quando o limiar é
  ultrapassado.
- **Consome hoje:** nenhum consumidor além do Item 2 (função nova, uso interno).
- **Impacto observável:** implementa a decisão de produto (Step 1) — o comportamento exato
  depende da resposta do Junior/operador antes de codar.
- **De-risk:** não implementar este item sem a decisão de produto documentada (ver seção acima) —
  usar 24h + reset total como default se não houver resposta, mas documentar explicitamente que é
  valor de partida.

## Test plan

- Teste automatizado: fluxo numa das `_ETAPAS_OFERTA_ATENDENTE` com 1 falha registrada, última
  mensagem simulada além do limiar decidido, mensagem genérica nova → não deve escalar
  imediatamente.
- Teste automatizado (não regredir): mesma etapa/falha, última mensagem **dentro** do limiar,
  mensagem inválida nova → **deve** escalar normalmente (comportamento correto de hoje).
- Se a exceção do AC3 for implementada: teste com `aguardando_confirmacao_candidatura` e link
  ainda válido, além do limiar geral → não reseta.
- Reprodução manual/dirigida do caso real da Lorena (`211a15bc-0dc2-4b9f-acce-ffcde6e6245b`) em
  ambiente de teste, não produção.

## File List

- `worker/empregabilidade_engine.py`:
  - `_ETAPAS_EXPIRAM_POR_INATIVIDADE` (nova constante, `_ETAPAS_OFERTA_ATENDENTE` +
    `aguardando_confirmacao_candidatura`) e `_LIMIAR_INATIVIDADE_HORAS = 24`.
  - `_link_candidatura_ainda_valido` (nova função) — confere só o `exp` do link HMAC.
  - `_parse_timestamp_pg` (nova função) — parseia o formato de timestamp do PostgREST.
  - `_obter_ultima_interacao_anterior` (nova função) — consulta `mensagens`, retorna a penúltima
    (a mais recente é sempre a mensagem que disparou o processamento atual).
  - `_resetar_fluxo_por_inatividade` (nova função) — implementa a decisão do Junior.
  - `_processar_mensagem_empregabilidade_locked` — checagem de inatividade logo após carregar o
    fluxo, antes de qualquer roteamento.
  - `from urllib.parse import urlencode, urlparse, parse_qs` (import ampliado).
- `worker/tests/test_empregabilidade_engine.py` — 16 testes novos: `TestParseTimestampPgAud033`
  (3), `TestLinkCandidaturaAindaValidoAud033` (4), `TestResetarFluxoPorInatividadeAud033` (4),
  `TestObterUltimaInteracaoAnteriorAud033` (2), `TestExpiracaoNoPontoDeEntradaAud033` (3, inclui
  a reprodução do caso real da Lorena).

## Change Log

- v0.1 (2026-08-28): @sm cria a story a partir do Plano 029 da auditoria
  `AUDITORIA-empregabilidade-2026-08-27.md`. Decisão de produto (limiar de tempo + escopo do
  reset) registrada como pendência explícita — não bloqueia a criação da story, mas bloqueia o
  início da implementação (Item 3) até resposta do Junior/operador. Status: Draft — aguardando
  validação do @po e resposta às perguntas de produto.
- v0.2 (2026-08-28): @po valida — **GO** (9/10 no checklist de validação de story; o ponto único
  não pleno é AC3, condicional a uma decisão de produto ainda em aberto — não é defeito de
  redação da story, é uma dependência real e já sinalizada nela mesma). Status: Draft →
  **Ready**. **Ressalva de processo:** Ready aqui significa "pronta pra entrar na fila do @dev",
  não "pronta pra codar sem checkpoint" — o @dev não deve iniciar o Item 3 (função
  `_resetar_fluxo_por_inatividade`) sem antes confirmar com o Junior o limiar de inatividade e o
  escopo do reset, exatamente como a própria story já instrui na seção "Decisão de produto
  necessária antes de codar".
- v0.3 (2026-08-28): @dev roda o Item 1 (investigação da fonte de timestamp, Step 2 do plano
  original) direto em produção (`svzkrkfzpiqcesloukgb`, read-only via MCP):
  ```sql
  select id, ultima_mensagem_em, updated_at,
    (select max(created_at) from mensagens m where m.conversa_id = conversas.id) as ultima_msg_real
  from conversas where agente_tipo = 'Empregabilidade' order by updated_at desc limit 20;
  ```
  **Resultado: `ultima_mensagem_em` é `null` em 100% das 20 conversas mais recentes do canal** —
  confirma a suspeita já registrada no plano original (a 1ª rodada da auditoria também tinha visto
  isso). **Decisão técnica já tomada por essa evidência:** não usar essa coluna — o cálculo de
  inatividade vai precisar de `select max(created_at) from mensagens where conversa_id = ...`
  direto (o `updated_at` de `conversas` chegou perto de `ultima_msg_real` nesta amostra, mas não é
  uma garantia — pode ser tocado por outras escritas na linha além de mensagem nova — por isso não
  vira a fonte oficial só por bater aqui). Item 1 do plano de implementação concluído. **Item 3
  segue bloqueado** — não implementado nesta sessão, aguardando resposta do Junior às 2 perguntas
  de produto (limiar de inatividade + o que resetar). Status: Ready → **InProgress** (parcial).
- v0.4 (2026-08-28): Junior responde as 2 perguntas de produto — **24h de limiar; reset total nas
  5 etapas de `_ETAPAS_OFERTA_ATENDENTE`, com exceção pra `aguardando_confirmacao_candidatura`
  enquanto o link ainda for válido** (a estrutura de duas partes que o @dev tinha proposto na
  pergunta, confirmada). @dev implementa o Item 3:
  - `_LIMIAR_INATIVIDADE_HORAS = 24` e `_ETAPAS_EXPIRAM_POR_INATIVIDADE` (as 5 + a etapa do link).
  - `_link_candidatura_ainda_valido` — confere só o `exp` do link HMAC (`_assinar_link_portal`),
    sem revalidar assinatura (isso já acontece no portal quando o candidato abre o link).
  - `_obter_ultima_interacao_anterior` — via `mensagens` (não `ultima_mensagem_em`, conforme
    v0.3), pegando a PENÚLTIMA mensagem (a mais recente já é sempre a mensagem que disparou este
    próprio processamento — confirmado lendo `meta_adapter_inbound.py`: a mensagem inbound é
    inserida em `mensagens` **antes** de `processar_mensagem_empregabilidade` ser chamado).
  - `_resetar_fluxo_por_inatividade` — implementa a decisão exata do Junior.
  - Checagem plugada em `_processar_mensagem_empregabilidade_locked`, logo após carregar o fluxo,
    só quando `etapa_salva in _ETAPAS_EXPIRAM_POR_INATIVIDADE` (fora dessas 6 etapas, nem chega a
    consultar `mensagens` — testado explicitamente).
  - **16 testes novos**, incluindo reprodução ponta a ponta do caso real da Lorena (9 dias de
    inatividade, mesma etapa/contador do caso da auditoria — confirma que a mensagem de retorno
    não escala mais) e o caso "não regride" (dentro do limiar, comportamento idêntico a hoje).
  - Suíte completa (`test_empregabilidade_engine.py` + `test_meta_adapter_inbound.py`): **272
    passed** (256 anteriores + 16 novos), zero falhas novas. `python -m py_compile` limpo.
  - Status: InProgress → **InReview** (aguardando @qa).
- v0.5 (2026-08-28): @qa revisou — **CONCERNS** (aprovado, com 1 achado não-bloqueante). Ver
  "QA Results" abaixo. Status: InReview → **Ready for Review** (pronta pro @devops, aguardando
  decisão do Junior).

## QA Results

### Review em 2026-08-28 — @qa Quinn

**Gate: CONCERNS** (aprovado — nenhum achado bloqueia, mas 1 ponto deveria ser considerado)

**7 checks:**

1. **Code review** — implementação limpa e bem documentada; cada função nova tem comentário
   explicando o "porquê", cita a story e a evidência de produção que embasou a decisão (ex.
   `_obter_ultima_interacao_anterior` explica exatamente por que pega a PENÚLTIMA mensagem, com
   referência ao ponto exato do `meta_adapter_inbound.py` que confirma a ordem de inserção).
   Reaproveita infraestrutura existente (`_assinar_link_portal`/`exp`, `_fluxo_lock_context`
   reentrante, `_supabase_to_thread`) em vez de inventar mecanismo novo. OK.
2. **Testes** — 16 testes novos, cobertura genuinamente boa: funções puras isoladas
   (`_parse_timestamp_pg`, `_link_candidatura_ainda_valido`, `_resetar_fluxo_por_inatividade`)
   testadas em unidade nos 4 cenários relevantes cada; `_obter_ultima_interacao_anterior` testada
   com mock de `mensagens`; e — o mais importante — a reprodução ponta a ponta do caso real da
   Lorena através do entry point público (`processar_mensagem_empregabilidade`), não só de
   funções internas. **Achado MEDIUM, não-bloqueante:** a exceção de `aguardando_confirmacao_candidatura`
   (link ainda válido) só tem teste na função pura (`_resetar_fluxo_por_inatividade`) — não há um
   teste ponta a ponta equivalente ao da Lorena para esse caminho específico (ex.: candidato com
   link válido, retomando depois de 30h, confirmando que a etapa **não** é resetada e o fluxo real
   segue esperando a confirmação). A lógica está coberta em unidade, mas a integração completa
   desse caminho específico fica sem prova automatizada — o caminho mais comum (as 5 etapas de
   oferta) tem prova ponta a ponta, esse não.
3. **Acceptance Criteria** — AC1 (reset antes de rotear) e AC4 (reprodução do caso real)
   confirmados pelo teste `test_reproducao_caso_real_lorena_etapa_dormente_9_dias_nao_escala`. AC2
   (não regride dentro do limiar) confirmado por `test_etapa_parada_ha_menos_de_24h_...`. AC3
   (exceção do link válido) confirmado em unidade (achado 2 acima) — comportamento correto por
   leitura de código, mas sem a mesma prova ponta a ponta dos outros ACs.
4. **Regressão** — rodei a suíte de forma independente: 272 testes, 0 falhas (256 + 16). Tracing
   manual: `_set_fluxo_async` dentro do bloco novo reentra em `_fluxo_lock_context`, que já é
   reentrante por design (`_FLUXO_LOCKS_HELD` contextvar) — sem risco de deadlock. Confirmei que
   nenhuma das 6 etapas cobertas colide com `_ETAPAS_EMPRESA`/`_ETAPAS_CANDIDATO` (só existem no
   perfil público). `python -m py_compile` limpo.
5. **Performance — achado LOW, informativo, não-bloqueante.** A checagem adiciona 1 query de
   leitura (`mensagens`, indexada por `conversa_id` — confirmei o índice
   `idx_mensagens_conversa_id` em produção) + potencialmente 1 escrita (`_set_fluxo_async`) a
   **toda** mensagem que chega numa das 6 etapas cobertas — inclui `aguardando_confirmacao_candidatura`,
   que a própria auditoria já identificou como a etapa de maior tráfego (23% dos candidatos do
   dia ficam parados nela). Custo por chamada é baixo (índice existe, `limit(2)`), mas é tráfego
   novo constante numa etapa já sabidamente concorrida — não bloqueia, só registro pra
   observação se o volume crescer.
6. **Segurança** — `_link_candidatura_ainda_valido` só lê o `exp` da URL, não expõe nem loga o
   link completo; não reimplementa nem enfraquece a validação HMAC real (que continua acontecendo
   no portal). Sem superfície nova.
7. **Documentação** — story exemplar: decisão de produto documentada com a pergunta exata feita
   ao Junior e a resposta literal recebida, investigação de banco documentada com a query e o
   resultado, File List detalhado por função. Facilita muito uma auditoria futura. OK.

**Resumo:** aprovado para seguir. O achado 2 (cobertura ponta a ponta da exceção do link válido)
é uma lacuna real de teste, não um bug — a lógica está correta e testada em unidade, só falta a
mesma prova de integração que os outros 3 ACs já têm. Fica a critério do Junior decidir se isso
vira ajuste antes do push ou fica documentado como débito, dado que a S-EMP-AUD-033 já é a 3ª
story consecutiva desta leva a fechar com esse tipo de achado não-bloqueante.

- v0.6 (2026-08-28): @devops abriu o PR #140 (`fix/s-emp-aud-033-expira-etapa-conversa-inatividade`
  → `main`). Junior aprovou, mergeou, confirmou o redeploy do `cuca-worker` no EasyPanel **com
  sucesso**. Achado do @qa (falta teste ponta a ponta pra exceção do link válido) fica registrado
  como débito conhecido, não tratado nesta versão. Status: Ready for Review → **Done**.
