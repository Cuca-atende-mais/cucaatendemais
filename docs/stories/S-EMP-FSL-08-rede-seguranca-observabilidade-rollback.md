# S-EMP-FSL-08 — Rede de segurança: observabilidade + validação do rollback

**Status:** Ready for Review — revalidado, PASS
**Epic:** Fluxo do candidato 100% no WhatsApp (sem link)
**Origem:** `PLANO-EXECUCAO-fluxo-sem-link.md` (FSL-08), sessão 2026-08-29.
**Prioridade:** P1 (gate final antes de ligar pra valer) | **Esforço:** M | **Risco:** BAIXO —
aditivo (log) + validação; não muda comportamento.
**Depende de:** todas as anteriores (FSL-01..07).

## Contexto

Antes de ligar o fluxo novo pra todo mundo (rollout de uma vez, decisão 7), precisa existir:
(a) como enxergar o fluxo funcionando ou falhando em produção, e (b) a prova de que o botão do
menu Developer volta pro link antigo de verdade, sem resíduo.

Reaproveita o Sentry que a S-EMP-AUD-034 plugou no portal, e estende observabilidade ao caminho
worker→portal.

## O que precisa ser implementado

1. **Observabilidade nos pontos críticos do fluxo novo:**
   - Falha da chamada worker→portal (upload/candidatura) — com contexto (conversa, vaga, etapa),
     sem dado pessoal cru (mesma cautela da S-EMP-AUD-034: extensão, não nome de arquivo).
   - Retomada após a mensagem "estou finalizando" (decisão 8) — registrar sucesso/falha do retry.
   - Corte de idade → banco (quantas vezes acontece).
2. **Validação do rollback:**
   - Com o botão desligado no meio de qualquer etapa, confirmar que a próxima mensagem do lead cai
     no fluxo do link antigo, sem estado órfão que quebre a conversa.
   - Confirmar que nenhuma conversa fica "presa" numa etapa nova órfã quando o botão desliga.
3. **Validação guiada ponta a ponta (com autorização do Junior — regra
   `qa-testes-sem-navegador-ao-vivo.md`):**
   - Reproduzir os casos reais da auditoria: Isabel/farmácia (renumeração), Ana Vitória/idade
     (corte → banco), e o novo caso mãe-com-2-filhos (chave própria, FSL-05).

## Acceptance Criteria

1. Falhas do caminho worker→portal aparecem no Sentry com contexto suficiente pra diagnosticar,
   sem dado pessoal cru.
2. O retry da decisão 8 é observável (deu certo depois? falhou de vez?).
3. Desligar o botão no meio de uma conversa em etapa nova não quebra a conversa — ela volta pro
   fluxo do link na mensagem seguinte, sem estado órfão.
4. Os 3 casos reais reproduzidos ponta a ponta com o resultado esperado (com autorização do Junior
   pra teste ao vivo).

## Escopo

**In:** observabilidade do fluxo novo, prova do rollback, validação guiada dos casos reais. **Out:**
qualquer nova funcionalidade de conversa (isso é FSL-01..07).

## ⚠️ Análise de impacto — por item

### Item 1 — Observabilidade
- **Toca:** pontos de erro do worker e do portal no caminho novo. Aditivo (log).
- **Impacto observável:** nenhum pro lead; a equipe passa a ver o fluxo novo em produção.
- **De-risk:** confirmar que nenhum log carrega nome de arquivo/dado pessoal cru (padrão
  S-EMP-AUD-034).

### Item 2 — Rollback
- **Toca:** o roteamento gateado pelo botão. Não muda código de fluxo — testa o desligamento.
- **Impacto observável:** garante que o "plano B" existe de verdade.
- **De-risk:** o cenário mais traiçoeiro é uma conversa **no meio de uma etapa nova** quando o
  botão desliga — testar exatamente isso (não só "desligado desde o começo"). A etapa nova órfã
  deve ser tratada como conversa a reiniciar no fluxo antigo, não travar.

### Item 3 — Validação guiada
- **Toca:** nada de código; é verificação.
- **De-risk:** só com autorização explícita do Junior pra teste ao vivo.

## Test plan

- Simular falha worker→portal → evento no Sentry com contexto, sem dado cru.
- Simular retry (sucesso e falha) → ambos observáveis.
- Ligar o botão, iniciar uma conversa até uma etapa nova, **desligar o botão**, mandar próxima
  mensagem → cai no fluxo do link sem quebrar.
- Validação guiada dos 3 casos reais (com autorização).

## Done criteria

- [x] Falhas do fluxo novo observáveis no Sentry (sem dado cru) *(via `logger.error`/`.warning` —
  o worker já tem `LoggingIntegration(event_level=ERROR)` plugada em `main.py`; todo
  `logger.error` já virava evento Sentry automaticamente, só faltavam os pontos de log)*
- [x] Retry da decisão 8 observável (sucesso e falha)
- [x] Rollback no meio de etapa nova não quebra conversa
- [ ] 3 casos reais validados ponta a ponta (com autorização) *(pendente — exige autorização do
  Junior pra teste ao vivo, `qa-testes-sem-navegador-ao-vivo.md`; não bloqueia o código)*

## Dev Agent Record

### Decisões-chave

1. **Sentry já estava plugado no worker** — achado ao investigar: `main.py` já inicializa
   `sentry_sdk` com `LoggingIntegration(level=WARNING, event_level=ERROR)`. Isso significa que
   **todo `logger.error(...)` já virava evento Sentry automaticamente**, sem eu precisar integrar
   nada novo — só faltava o código realmente logar nos pontos certos, o que era o buraco real
   (nenhum ponto do fluxo sem link logava nada antes desta story).
2. **`_com_decisao8` extraído e compartilhado** — antes, `_finalizar_candidatura_chat` e
   `_finalizar_banco_talentos_chat` tinham cada uma sua própria closure local idêntica pra
   decisão 8. Virou uma função de módulo (com `e`/`holding_msg`/`contexto` como parâmetros),
   eliminando a duplicação **e** ganhando a observabilidade do retry (sucesso/falha) num único
   lugar — as duas chamadoras herdam de graça, sem repetir a lógica de log 2x.
3. **Contexto SEM dado pessoal, sempre.** Todo log novo carrega só chaves técnicas: `conversa_id`,
   `vaga_id`, `fase`/`etapa`, `idade` (número, não data de nascimento completa), e a `motivo`
   (mensagem de erro do PRÓPRIO portal, ex.: "Esta vaga exige idade mínima de 18 anos" — não é
   dado do lead). Nunca nome, telefone ou conteúdo de arquivo — mesma cautela da S-EMP-AUD-034.
   Testei isso explicitamente (não só documentei): os testes de observabilidade afirmam que nomes
   de teste como "Fulano de Tal"/"Ana" NÃO aparecem no `caplog.text`.
4. **Corte de idade → banco, 1 log em 1 lugar só** — como `_aplicar_data_nascimento_ou_ofertar_banco`
   já é o ponto único que decide isso (compartilhado por FSL-04 e FSL-06), o log de contagem
   entrou lá — não precisou duplicar em `coletando_data_nascimento` E
   `confirmando_reaproveitamento_dados` separadamente.
5. **Rollback: achado real, não só "confirmar que funciona".** Investigando a AC3, descobri que
   as etapas novas (`coletando_data_nascimento` etc.) **não re-checam o flag sozinhas** — só o
   ponto de entrada (`_finalizar_candidatura_self`) checa. Ou seja, sem código novo, desligar o
   botão no meio de uma coleta **não teria efeito nenhum** até a conversa terminar ou expirar por
   inatividade (até 24h depois) — não é o "plano B imediato" que o plano promete. Implementei um
   guard no ponto de entrada único (`processar_mensagem_empregabilidade`, mesmo lugar do reset por
   inatividade S-EMP-AUD-033): se a etapa salva é uma das de coleta no chat E o flag está
   desligado agora, reinicia pro fluxo do link — e a MESMA mensagem que chegou continua sendo
   processada contra o novo estado (sem round-trip perdido, sem o lead precisar mandar de novo).
6. **STOP condition não disparou** — o rollback não deixa nenhuma etapa nova órfã; testei
   explicitamente com flag ligado (não interfere) e desligado (reinicia e continua processando).

### File List

- `worker/empregabilidade_engine.py` — `_com_decisao8` extraído como função de módulo
  (compartilhada, observável); logs em: upload/candidatura rejeitados (vaga e banco), corte de
  idade → banco; guard de rollback em `_processar_mensagem_empregabilidade_locked`.
- `worker/tests/test_empregabilidade_engine.py` — 9 testes novos (rollback com flag on/off/etapa
  fora do escopo, retry esgotado/recuperado/sem-retry, corte de idade, rejeições de vaga/banco) —
  todos confirmando ausência de dado pessoal no log.

### Validação executada

- `pytest` engine + inbound + portal_client + academia_enem + intencao_detector → **441 passed**
  (9 novos, zero regressão).
- `py_compile` OK.
- Grep confirma: todos os logs novos carregam só `conversa_id`/`vaga_id`/`fase`/`idade`/`motivo`
  (string de erro do portal) — nunca nome, telefone ou conteúdo de arquivo.

### Pendente pro @qa / validação guiada (não bloqueia o código)

- Os 3 casos reais (Isabel/farmácia, Ana Vitória/idade, mãe-com-2-filhos) exigem autorização
  explícita do Junior pra teste ao vivo — não posso rodar sem essa autorização
  (`qa-testes-sem-navegador-ao-vivo.md`). O comportamento de cada um já está coberto por teste
  automatizado equivalente ao longo das stories anteriores (renumeração é comportamento normal do
  chat; corte de idade é a FSL-04; a mãe-com-2-filhos deixou de existir como caso, já que a FSL-05
  eliminou candidatura de terceiro).

## QA Results (@qa — Quinn)

**Veredito: PASS COM CONCERNS** (2026-08-29). Os dois achados do @dev (Sentry já plugado; o
rollback não funcionava de verdade) são exatamente o tipo de coisa que essa story deveria
descobrir — bom trabalho de investigação, não só "implementar o óbvio". Achei 1 ponto que vale
registrar, mas não bloqueia.

### 7 quality checks

1. **Code review — CONCERNS (1 ponto).** O guard do rollback (`processar_mensagem_empregabilidade`,
   linha ~5247) reusa `_fluxo_sem_link_ativo()` — a mesma função **fail-closed** (retorna `False`
   em qualquer exceção, inclusive falha transiente de rede/Supabase) que já é usada pra decidir
   se uma candidatura NOVA entra no chat. Isso é a escolha certa lá (falha transiente → cai pro
   link, caminho já provado, sem prejuízo real). Mas reaplicada aqui, no meio de uma conversa **já
   em andamento**, o mesmo fail-closed tem uma consequência mais séria: uma falha transiente de
   consulta faria o código entender "flag desligado" por engano e **descartar nome/data/PCD já
   coletados**, mandando o lead pro "inicio" sem o admin ter realmente desligado nada. Não é o
   cenário "botão desligado de propósito" que a story pede pra proteger — é um falso positivo.
   Baixa probabilidade (falha transiente de Supabase), degradação graciosa (o lead só recomeça,
   não trava), mas é uma assimetria de risco que vale registrar: a MESMA função fail-closed serve
   dois papéis com consequências bem diferentes (decidir se começa vs. decidir se descarta
   progresso já feito).
2. **Testes — PASS.** 441 passed, 9 novos. Gostei que os testes de observabilidade verificam a
   AUSÊNCIA de dado pessoal no `caplog.text` de forma ativa (`assert "Fulano de Tal" not in
   caplog.text`), não só a presença do que deveria estar lá — é o tipo de teste que realmente
   pega uma regressão de vazamento de dado, não só documenta a intenção.
3. **Acceptance Criteria — 3/4 explícitos + 1 pendente de autorização.** AC1 (falhas observáveis,
   sem dado cru) ✓ — validei que o Sentry realmente já captura `logger.error` (`main.py`,
   `LoggingIntegration(event_level=ERROR)`), então a alegação do @dev não é só uma suposição; AC2
   (retry observável) ✓; AC3 (rollback não quebra) ✓, com a ressalva do item 1 acima; AC4
   (validação guiada) segue pendente de autorização, como já esperado — não é uma lacuna do
   trabalho, é uma dependência externa que a story já tinha marcado assim.
4. **Regressão — PASS.** A extração do `_com_decisao8` compartilhado não quebrou nenhum teste
   existente das 2 funções que o usam — reflete que a interface (comportamento observável) ficou
   idêntica, só a implementação foi consolidada.
5. **Performance — PASS.** Uma consulta a mais por mensagem, e só quando a etapa já é uma das 6
   etapas especiais — não é o caminho comum.
6. **Segurança/LGPD — PASS.** Verifiquei eu mesmo, com grep direto (não só confiando no teste),
   que nenhum log novo carrega nome/telefone/conteúdo de arquivo — só IDs técnicos, idade
   (número) e mensagens de erro do próprio portal.
7. **Docs — PASS.** Os dois achados (Sentry já plugado; rollback não funcionava) estão registrados
   com o raciocínio completo, não só o resultado — dá pra entender o "porquê" sem reler o código.

### Recomendação sobre o CONCERNS

Não bloqueia — é baixa probabilidade e a degradação é graciosa (recomeçar, não travar), dentro do
espírito "BAIXO risco" que a própria story já classificou. Registro como observação pro backlog:
se quiser blindar esse caso específico, a saída seria uma variante fail-**open** do check só pra
esse guard de rollback (ou cachear o resultado da 1ª leitura do flag por requisição), sem mudar o
comportamento fail-closed do ponto de entrada. Não fiz essa mudança porque não foi pedida e mudaria
o comportamento da função compartilhada sem sinal claro de que vale o risco — fica registrado pra
você decidir se quer.

## Fix do CONCERNS (@dev — pós-gate)

- **`_fluxo_sem_link_ativo` ganhou `fail_default: bool = False`** — comportamento em ERRO agora é
  configurável (o comportamento em "linha lida, valor explícito" não muda: continua igual pros
  dois casos). Fail-closed (padrão, `False`) continua valendo nos 2 pontos de entrada
  (`_finalizar_candidatura_self`, `oferta_banco_idade_fsl`) — falha transiente aí só cai pro link
  já provado, sem perda real.
- **Guard do rollback passou a usar `fail_default=True`** — uma falha transiente na leitura do
  flag agora é tratada como "ainda ligado", não "desligado por engano". O pior caso vira "não
  reiniciou desta vez" (a próxima mensagem tenta de novo), em vez de "descartou nome/data/PCD já
  coletados sem o admin ter desligado nada de verdade".
- **4 testes novos:** erro → fail-closed por padrão; erro → fail-open quando pedido; flag
  **realmente** desligado não é ignorado por `fail_default=True` (só o comportamento em ERRO
  muda, nunca o valor real lido); e o cenário completo do achado — falha transiente durante uma
  coleta em andamento não reinicia a conversa nem descarta o progresso.
- Suíte combinada → **445 passed** (4 novos), zero regressão. `py_compile` OK.

## QA Results (revalidação — @qa Quinn)

**Veredito: PASS.** O CONCERNS foi resolvido corretamente, não só "silenciado".

- **Confirmei que o fail-closed original permanece intacto** nos 2 pontos de entrada (`:3589` e
  `:5056`, ambos sem argumento, herdando `fail_default=False`) — o fix não introduziu uma
  regressão de risco no caminho que já estava certo (uma falha transiente virando "assume
  ligado" ali SIM seria um problema novo, já que decidiria abrir uma coleta nova indevidamente).
- **O guard do rollback (`:5264`) é o único que passa `fail_default=True`** — exatamente o ponto
  cirúrgico que o achado apontava, nenhum outro lugar foi tocado.
- **Gostei do teste `test_flag_realmente_desligado_fail_open_nao_interfere`** — prova que
  `fail_default=True` só muda o comportamento em ERRO, nunca reinterpreta um flag realmente lido
  como "false" — sem isso, seria fácil confundir "fail-open em erro" com "ignora o flag real",
  que seria um bug bem mais sério (o botão deixaria de funcionar de verdade).
- **445 testes, zero regressão.** `py_compile` OK.

Sem novos CONCERNS. Story pronta pra `Done`.

## Change Log

- 2026-08-29 — @qa (Quinn): revalidação — PASS. Fail-closed original intacto nos 2 pontos de
  entrada; fail-open aplicado só no guard do rollback, cirurgicamente. Teste que separa "erro" de
  "flag real desligado" confirma que a mudança não abre brecha pro botão ser ignorado. 445
  testes, zero regressão.
- 2026-08-29 — @dev (Dex): fix do CONCERNS do @qa — `_fluxo_sem_link_ativo` ganhou
  `fail_default` configurável; guard do rollback usa fail-open (`fail_default=True`), preservando
  fail-closed nos pontos de entrada. 4 testes novos provando os 2 comportamentos + o cenário do
  achado. 445 testes, zero regressão. Ready → Ready for Review.
- 2026-08-29 — @qa (Quinn): gate PASS COM CONCERNS — validei que o Sentry já captura `logger.error`
  de fato (não só a alegação); confirmei por grep independente a ausência de dado pessoal em todo
  log novo. 1 CONCERNS não-bloqueante: o guard do rollback reusa a mesma função fail-closed do
  ponto de entrada, o que pode descartar progresso já coletado numa falha transiente (não um
  desligamento real do botão) — baixa probabilidade, degradação graciosa, registrado pro backlog.
  441 testes.
- 2026-08-29 — @dev (Dex): FSL-08 — observabilidade real (Sentry já estava plugado, só faltava
  logar); `_com_decisao8` extraído e compartilhado com observabilidade do retry; rede de
  segurança do rollback implementada de verdade (achado: etapas novas não re-checavam o flag —
  corrigido no ponto de entrada único). 9 testes novos, 441 no total, zero regressão. Ready →
  Ready for Review.

## STOP conditions

- O rollback deixar conversas presas em etapa nova órfã → parar; o desligamento tem que ser seguro
  a qualquer momento, é o requisito central do plano. *(Não ocorreu — testado explicitamente com
  flag ligado e desligado, em ambos os casos a conversa segue processável.)*
