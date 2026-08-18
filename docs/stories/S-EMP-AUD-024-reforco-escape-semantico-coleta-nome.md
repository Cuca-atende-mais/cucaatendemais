# S-EMP-AUD-024 — Reforça detecção de "quero ver vagas"/mudança de rota nas etapas de coleta de nome

**Status:** Ready
**Epic:** Auditoria Empregabilidade
**Origem:** demanda direta do Junior, 2026-08-18 ("ENCONTRAR ROTA") — confirmado por leitura de
código, não é impressão
**Prioridade:** P1 | **Esforço:** P | **Risco:** BAIXO — reusa mecanismo já existente e testado
(`_escape_semantico_ou_none`), só estende a etapas que hoje não o chamam

## Contexto

`_escape_semantico_ou_none` (`worker/empregabilidade_engine.py:627-675`) já existe, já detecta
`mudou_de_assunto` via classificador semântico (`intencao_detector.avaliar_mensagem_contextual`) e já
reroteia com confirmação. **Mas 4 etapas não a chamam** — usam só `_quer_sair_semantico` (detecção de
despedida, não de troca de assunto):

- `coletando_nome_candidato`
- `coletando_nome_curriculo_publico`
- `coletando_nome_terceiro`
- `confirmando_presenca_nome`

Nessas 4, qualquer texto — inclusive "quero ver vagas" — é tratado como o **nome** informado, porque a
lógica original (S-WM-20 Task 5, categoria b) parte da premissa "qualquer texto é um nome válido, não
dá pra usar `mudou_de_assunto` (falso-positivo alto em nomes incomuns)". Essa premissa está certa para
nomes ambíguos ("Vitória", "Aurora"), mas não cobre frases claramente não-nome como "quero ver vagas".

Comparar com `confirmando_terceiro`, que **já** chama `_escape_semantico_ou_none` completo e não sofre
desse problema — o padrão certo já existe no mesmo arquivo, só não foi replicado pras 4 etapas acima.

## Impacto (por item)

| Toca | Consome hoje | Impacto observável | De-risk |
|---|---|---|---|
| 4 handlers de coleta de nome | Cada handler roda 1x por mensagem recebida nessas etapas | Ligar `_escape_semantico_ou_none` reintroduz o risco que S-WM-20 Task 5 já mitigou: nome incomum classificado como "mudou de assunto" por engano | **Não trocar `_quer_sair_semantico` por `_escape_semantico_ou_none` cru** — usar só o sub-sinal `mudou_de_assunto` do classificador com um threshold de confiança adequado, ou aceitar só frases de alta precisão (ex.: mesma lista de padrões literais já usada em `listou_vagas` — "ver vagas", "outras vagas" — como fast-path antes de cair no classificador) |
| Classificador (`intencao_detector.py`) | 17+ call sites já existentes (por `S-EMP-AUD-022`) | Sem mudança de contrato — só mais call sites usando o campo que já existe | Nenhum |
| Testes existentes (`test_nome_incomum_nao_e_confundido_com_saida`) | Garante que nome incomum não é tratado como saída | Precisa de teste irmão: nome incomum também não deve ser tratado como troca de rota | Adicionar caso de teste específico antes de marcar pronto |

## Valor de negócio

Fecha um ponto de perda direto: lead que já está no fluxo de banco de talentos mas muda de ideia hoje
não tem saída sem digitar "sair" e recomeçar do zero.

## Acceptance Criteria

1. Nas 4 etapas listadas, frases de alta precisão ("quero ver vagas", "voltar", "outras vagas", "sou
   empresa") são reconhecidas como troca de rota, não engolidas como nome.
2. Nomes incomuns continuam sendo aceitos normalmente (regressão coberta por teste).
3. Falar com atendente continua funcionando nessas etapas (já parcialmente coberto, confirmar).

## Escopo

**In:** as 4 etapas listadas.
**Out:** mudar a lógica de `confirmando_terceiro` (já correta); mudar o classificador em si.

## Test plan

- Para cada uma das 4 etapas: "quero ver vagas" reroteia corretamente.
- Nome incomum ("Xisto Wenceslau" — já existe teste) continua funcionando.
- "Quero falar com atendente" continua funcionando nas 4 etapas.

## Change Log

- v0.1 (2026-08-18): Story criada por @sm a partir de demanda direta do Junior — análise de impacto
  levantada por @dev (achado: gap real em 4 etapas específicas, confirmado por leitura de código).
- v0.2 (2026-08-18): @po validou — **GO (9/10)**. Achado confirmado por leitura de código real (não
  suposição), risco baixo por reaproveitar mecanismo já testado, escopo claro (as 4 etapas nomeadas,
  nada além), de-risk explícito contra o risco óbvio (reintroduzir falso-positivo em nome incomum, já
  mitigado uma vez por S-WM-20 Task 5 — não pode regredir). Único ponto sem nota máxima: a solução
  técnica final (fast-path de frases literais vs. sub-sinal do classificador com threshold) é
  apresentada como 2 opções no de-risk, não como decisão fechada — aceitável, é detalhe de
  implementação que o @dev pode decidir dentro do escopo, não muda o resultado observável pro usuário.
  **Sequenciamento:** deve ser implementada antes ou junto da S-EMP-AUD-023 (que depende deste
  reforço nas etapas novas que ela cria). Status Draft → Ready.
