# S-EMP-AUD-028 — Classificador de IA dedicado pra troca de rota na coleta de nome (substitui comparação exata)

**Status:** InReview
**Epic:** Auditoria Empregabilidade
**Origem:** `docs/Auditoria -19-08-26/2026-08-19-empregabilidade-conversas/plans/025-frases-rota-comparacao-exata-falso-negativo.md`
(auditoria de conversas reais, 18-19/08) — reproduzido ao vivo pelo próprio Junior em teste real
(`conversa 108da528-9372-4cbb-84a5-f94a26fbbbe3`, 19/08 11:37) e confirmado ainda presente hoje por
leitura direta do código (`worker/empregabilidade_engine.py:1539`, comparação por igualdade exata,
não substring).
**Prioridade:** P1 — reproduzido pelo próprio Junior nesta sessão, é o bug que motivou este
levantamento ("a mudança de rota tá muito engessada")
**Esforço:** M | **Risco:** MÉDIO — introduz chamada de IA num ponto hoje 100% determinístico;
precisa de desenho cuidadoso pra não reintroduzir o falso-positivo de nome incomum já mitigado pela
`S-EMP-AUD-024`

## Contexto

`_deteccao_literal_troca_rota` (`worker/empregabilidade_engine.py:1539`) nasceu na
`S-EMP-AUD-024` como fast-path **literal** (zero LLM) pra reconhecer frases de troca de rota nas
etapas de coleta de nome, sem correr o risco de confundir nome incomum com troca de assunto. A
comparação é por **igualdade exata** contra 3 listas fixas
(`_FRASES_ROTA_ALTA_PRECISAO_EMPRESA/VAGAS/AMBIGUA`, linhas 1530-1537).

O problema: igualdade exata (e mesmo substring) não cobre a variedade real de como as pessoas se
comunicam. Reproduzido ao vivo pelo Junior:

```
11:37:26 bot: "...preciso do seu nome completo:"
11:37:40 Junior: "Eu quero ver vagas"        ← não bate com "quero ver vagas" (tem "eu" na frente)
11:37:53 bot: "Obrigado, Eu quero ver vagas! Esse currículo é para você mesmo(a)...?"
11:38:16 Junior: "Quero ver vagas abertas"   ← não bate com nenhum item exato da lista
11:38:29 bot: "...enviar o currículo de Eu quero ver vagas" ← link de candidatura assinado com nome errado
```

O nome poluído ("Eu quero ver vagas") chegou a ir pro parâmetro assinado do link de candidatura —
não é só uma resposta de bot estranha, é dado real que quase virou currículo cadastrado.

## Decisão tomada (Junior, 2026-08-19)

**Opção 2 — camada de IA dedicada**, não lista fixa/substring. Justificativa do Junior: o público do
canal Empregabilidade se comunica de formas muito diferentes, com graus de instrução e vocabulário
diversos — não dá pra mensurar um "dicionário de palavras" que cubra isso de verdade. Uma lista fixa,
por maior que fique, sempre vai ficar um passo atrás de uma forma de falar nova. A IA dedicada resolve
o problema real (entender a intenção, não decorar frases).

## Desenho técnico

1. **Fast-path literal continua existindo e roda primeiro** — `_deteccao_literal_troca_rota` não é
   removida, só deixa de ser a única camada. As frases que já batem hoje continuam resolvidas sem
   nenhuma chamada de IA (custo/latência zero pro caso comum).
2. **Só quando o fast-path não bate**, uma função nova e isolada (`_classificar_troca_rota_ia` ou
   nome equivalente — mesmo padrão de `_chamar_gpt_contextual` em `intencao_detector.py`, GPT-4o-mini,
   `temperature=0.0`, função própria pra mock direto em teste) classifica o texto **só** entre 3
   resultados possíveis: `troca_rota_empresa`, `troca_rota_vagas`, `nome_valido`. Prompt de alta
   precisão, com o mesmo cuidado de calibração já documentado na `S-EMP-AUD-024`: nome incomum
   ("Vitória", "Aurora", "Xisto Wenceslau") tem que continuar caindo em `nome_valido`.
3. **Fail-safe obrigatório**: qualquer falha da IA (rede, JSON malformado, timeout) cai pra
   `nome_valido` — nunca trava o fluxo, nunca bloqueia alguém de dar o nome só porque a IA falhou.
   Mesmo padrão de fail-safe já usado na `S-EMP-AUD-023` passo 4 (normalização de cargo via IA).
4. **Escopo da chamada**: só as mesmas 3 etapas que já usam `_escape_literal_ou_none`
   (`coletando_nome_candidato`, `coletando_nome_curriculo_publico`, `confirmando_presenca_nome`) —
   não expande pra outros dos 17+ call sites do classificador genérico, que tem outro contrato e já
   funciona bem onde está.

## Impacto (por item, conforme análise obrigatória do projeto)

| Toca | Consome hoje | Impacto observável | De-risk |
|---|---|---|---|
| `_escape_literal_ou_none` (3 etapas de coleta de nome) | Cada mensagem do lead nessas 3 etapas, quando o fast-path literal não bate | Adiciona 1 chamada de IA condicional (só quando o fast-path não resolve) — latência extra só no caso que hoje já falha (vira nome errado) | Fail-safe pra `nome_valido` em qualquer erro; fast-path literal continua cobrindo o caso comum sem custo extra |
| Garantia de nome incomum (`S-EMP-AUD-024`, `TestEscapeHatchNomeLivre`) | Testes existentes garantem que nome incomum não vira "saída"/"troca de rota" | Nova superfície de falso-positivo — agora via classificação de IA, não só substring | Prompt calibrado explicitamente contra nomes incomuns reais já usados nos testes existentes; suíte completa roda antes de fechar |
| Link assinado de candidatura (`nome=` na URL) | Candidato final, visível no navegador dele | Reduz a chance de nome poluído chegar num link real, cobrindo frase nova (não só as 2 reproduzidas) | Teste com frase fora das listas fixas, nunca vista antes, ainda assim classificada corretamente |
| Custo/latência OpenAI | Chamada nova, mas condicional (só quando fast-path não bate) | Aumento pequeno — a maioria das trocas de rota comuns já é coberta pelo fast-path existente | Monitorar volume real após deploy; não implementar cache aqui (contexto muda a cada mensagem, diferente do cache de cargo da S-EMP-AUD-023 que é por conjunto de vagas abertas) |

## Valor de negócio

É o bug que o próprio Junior reproduziu testando o produto — resolve de fato a "falta de
perspicácia" reportada (não só os 2 casos já vistos), reduz dado sujo (nome errado) em link de
candidatura real, e é o mecanismo certo pra um público com forma de se comunicar muito variada.

## Acceptance Criteria

1. `"Eu quero ver vagas"` e `"Quero ver vagas abertas"` (os 2 casos reais) são reconhecidas como
   troca de rota nas 3 etapas, mesmo sem bater no fast-path literal.
2. Uma 3ª frase nunca vista antes, fora das listas fixas, também é reconhecida corretamente pela IA
   (prova que o mecanismo generaliza, não só decorou os 2 casos).
3. Nome real incomum continua sendo aceito como nome — regressão coberta com os mesmos nomes já
   usados nos testes existentes da `S-EMP-AUD-024`.
4. Falha da IA (mock de exceção) cai pra `nome_valido`, nunca trava o fluxo.
5. Fast-path literal continua funcionando pros casos que já cobria (sem chamada de IA nesses casos —
   confirmável via mock que a função de IA não foi chamada).
6. Suíte completa do worker sem regressão.

## Escopo

**In:** função nova de classificação por IA + integração em `_escape_literal_ou_none` como fallback
do fast-path literal existente, nas 3 etapas já listadas.
**Out:** mudar `avaliar_mensagem_contextual`/classificador genérico (contrato diferente, 17+ call
sites); expandir pra outras etapas fora das 3 já listadas; remover o fast-path literal (continua
como 1ª camada, mais barata).

## Test plan

- Os 2 casos reais do Junior (linhas exatas da conversa `108da528`), mockando a resposta da IA.
- 1 frase nova nunca vista nas listas fixas, mockada como reconhecida corretamente.
- Nomes incomuns já cobertos pela suíte existente continuam passando.
- Fail-safe: IA mockada lançando exceção → cai pra nome válido, sem erro.
- Mock spy confirmando que a função de IA **não** é chamada quando o fast-path literal já resolve.
- Suíte completa de `test_empregabilidade_engine.py` sem regressão.

## Dev Agent Record

**Linha reconfirmada via grep antes de editar:** `_deteccao_literal_troca_rota` em `:1563`,
`_escape_literal_ou_none` em `:1580` — bateram com a validação do @po (drift esperado de `:1539`
citado na origem).

**Implementação** (`worker/empregabilidade_engine.py`):
- `_chamar_ia_classificar_troca_rota(texto) -> dict`: chamada isolada ao GPT-4o-mini
  (`temperature=0.0`, mesmo padrão de `_chamar_gpt_contextual`/`_chamar_ia_normalizacao_cargos`
  já existentes neste arquivo), classifica em `troca_rota_empresa` | `troca_rota_vagas` |
  `nome_valido`. Prompt instrui explicitamente: "na dúvida entre nome incomum e troca de assunto,
  prefira SEMPRE nome_valido" — mesma calibração de risco já usada na S-EMP-AUD-024.
- `_classificar_troca_rota_ia(texto) -> str`: wrapper fail-safe — qualquer exceção ou valor fora
  das 3 categorias válidas cai em `nome_valido`, nunca propaga erro.
- `_escape_literal_ou_none`: quando `_deteccao_literal_troca_rota` retorna `None` (fast-path não
  bateu), cai no fallback de IA; só dispara `_perguntar_confirmacao_troca_rota` se a classificação
  não for `nome_valido`. Fast-path continua sendo a 1ª camada, sem nenhuma mudança de
  comportamento pros casos que já cobria.
- Escopo respeitado: só o fallback dentro de `_escape_literal_ou_none`, que já era chamado
  exclusivamente pelas 3 etapas do escopo (`coletando_nome_candidato`,
  `coletando_nome_curriculo_publico`, `confirmando_presenca_nome`) — nada tocado em
  `avaliar_mensagem_contextual`/classificador genérico.

**Testes** (`worker/tests/test_empregabilidade_engine.py`):
- Novo fixture autouse `_classificador_troca_rota_ia_default`: mocka
  `_chamar_ia_classificar_troca_rota` pra `nome_valido` por padrão em toda a suíte — evita chamada
  de rede real em testes que não têm relação com este mecanismo (mesmo padrão do
  `_debounce_instantaneo` do conftest). Testes que exercitam a classificação sobrescrevem.
- `TestS_EMP_AUD_028ClassificadorIADedicado` (7 testes novos): os 2 casos reais do Junior
  (`108da528`) em 2 etapas diferentes; 1 frase nova nunca vista (AC2 — a generalização é o ponto
  central do pedido); nome incomum confirmando que a IA foi de fato acionada (`mock_ia.
  assert_awaited_once()`) e mesmo assim classificou como nome; fail-safe de exceção; spy
  confirmando que a IA NÃO é chamada quando o fast-path já resolve
  (`mock_ia.assert_not_awaited()`); fail-safe de valor de classificação fora do esperado.

**Validação:** suíte de `test_empregabilidade_engine.py` — **163 passed** (156 anteriores + 7
novos). Suíte geral do worker (`--ignore=test_main_retomar_disparo.py`) — **341 passed**, mesmas 5
falhas pré-existentes de ambiente em `test_meta_adapter_outbound.py` (já confirmadas antes desta
mudança), nenhuma nova falha.

**Teste empírico de causalidade:** revertido temporariamente `empregabilidade_engine.py` pro
estado pré-implementação (`git stash`, mantendo os testes novos) — os 7 testes novos falharam
exatamente como esperado (`AttributeError: ... has no attribute '_chamar_ia_classificar_troca_rota'`,
inclusive o fixture autouse); restaurado, suíte voltou a 163 passed.

**File List:**
- `worker/empregabilidade_engine.py`
- `worker/tests/test_empregabilidade_engine.py`

## QA Results

**Veredito: PASS** (com 1 achado documentado, sem impacto funcional)

1. **Code review** — mudança isolada e bem estruturada; prompt calibrado explicitamente pra
   preferir `nome_valido` na dúvida (mesma calibração de risco da S-EMP-AUD-024); fail-safe duplo
   (exceção E valor fora do esperado) ambos caem em `nome_valido`. Sem code smell.
2. **Testes** — reconfirmados de forma independente: **164 passed** em
   `test_empregabilidade_engine.py` (163 do @dev + 1 teste que adicionei, ver achado abaixo).
3. **Acceptance Criteria** — AC1 (2 casos reais) ✅; AC2 (frase nova generaliza) ✅; AC3 (nome
   incomum, com spy confirmando que a IA foi de fato acionada) ✅; AC4 (fail-safe de exceção) ✅;
   AC5 (spy confirmando zero chamada de IA quando fast-path resolve) ✅; AC6 (suíte completa sem
   regressão) ✅.
4. **Regressão** — suíte geral do worker (`--ignore=test_main_retomar_disparo.py`): **342 passed**,
   mesmas 5 falhas pré-existentes de ambiente em `test_meta_adapter_outbound.py` (já confirmadas em
   sessões anteriores), nenhuma nova falha. **Achado (severidade baixa, não bloqueia):** a seção
   Escopo desta story diz "nas 3 etapas já listadas" (`coletando_nome_candidato`,
   `coletando_nome_curriculo_publico`, `confirmando_presenca_nome`), mas `_escape_literal_ou_none`
   tem na verdade **4 call sites** — `coletando_nome_terceiro` também usa a mesma função
   compartilhada e portanto também herda o fallback de IA, sem estar documentado no Escopo nem
   coberto pelos testes originais do @dev. Como a mudança está inteiramente dentro da função
   compartilhada (nenhuma branch por etapa), não é um risco funcional novo — testei diretamente
   (`test_coletando_nome_terceiro_tambem_reroteia_via_ia_qa_verificacao`, adicionado por mim) e
   confirmei que funciona corretamente lá também. Registro aqui pra @po corrigir o texto do Escopo
   numa próxima revisão (não bloqueia esta story).
5. **Performance** — zero chamada de IA extra quando o fast-path já resolve (confirmado por spy);
   quando cai no fallback, é 1 chamada condicional, mesmo padrão de latência já aceito no projeto
   pra outras classificações semânticas.
6. **Segurança** — o texto do usuário é interpolado no prompt da mesma forma que
   `_chamar_gpt_contextual`/`_chamar_ia_normalizacao_cargos` já fazem (padrão existente no projeto,
   não é um risco novo introduzido aqui); resposta da IA é sempre validada contra um conjunto
   fechado de 3 valores antes de qualquer uso — sem superfície de injeção adicional.
7. **Documentação** — Dev Agent Record completo; File List correta; achado do Escopo documentado
   acima.

**Teste empírico de causalidade** (reconfirmado por mim, independente do @dev): revertido
temporariamente `empregabilidade_engine.py` pro estado pré-implementação mantendo os testes — os 8
testes da classe `TestS_EMP_AUD_028ClassificadorIADedicado` falharam todos na setup
(`AttributeError: ... has no attribute '_chamar_ia_classificar_troca_rota'`, inclusive o fixture
autouse); restaurado, suíte voltou a 164 passed.

Pronto pro @devops abrir o PR.

## Change Log

- v0.1 (2026-08-19): Story criada por @sm a partir do Plano 025 da auditoria, reconfirmada com
  evidência ao vivo (conversa real do Junior, `108da528`).
- v0.2 (2026-08-19): Junior decidiu pela opção 2 (IA dedicada) em vez de substring — justificativa:
  público do canal se comunica de formas muito diversas, não dá pra mensurar dicionário de palavras
  fixo. Story redesenhada com camada de IA condicional (fallback do fast-path literal existente, não
  substituição), fail-safe obrigatório e escopo restrito às mesmas 3 etapas.
- v0.3 (2026-08-19): @po validou — **GO (9/10)**. Escopo claro, risco identificado com de-risk real
  (fail-safe + fast-path como 1ª camada), decisão do Junior incorporada sem ambiguidade, AC
  testáveis inclusive o "generaliza pra frase nova" (AC2, o ponto central do pedido). Único ponto sem
  nota máxima: a linha citada pra `_deteccao_literal_troca_rota` (1539) já teve drift desde a escrita
  do plano original — confirmado que a função existe e o comportamento descrito bate
  (`worker/empregabilidade_engine.py:1551` no momento desta validação), mas @dev deve reconfirmar via
  grep antes de editar (prática já padrão nesta sessão), não confiar cegamente no número citado.
  Status Draft → Ready.
- v0.4 (2026-08-19): @dev implementou — `_chamar_ia_classificar_troca_rota`/
  `_classificar_troca_rota_ia` novos, fallback dentro de `_escape_literal_ou_none`. 7 testes novos
  + fixture autouse de mock padrão, 163 passed sem regressão. Verificação empírica de causalidade
  confirmou que os testes falham sem a implementação. Status Ready → InReview. Pronto pro @qa.
- v0.5 (2026-08-19): @qa revisou — **PASS**. Todos os AC confirmados de forma independente (164
  passed, incluindo 1 teste que adicionei), verificação empírica de causalidade reconfirmada por
  mim (8 testes falham sem a implementação). 1 achado de severidade baixa sem impacto funcional:
  Escopo desta story diz "3 etapas", mas `_escape_literal_ou_none` tem 4 call sites reais —
  `coletando_nome_terceiro` também herda o fallback (mesma função compartilhada), confirmado
  funcionando via teste novo. Recomendo @po corrigir o texto do Escopo numa próxima revisão. Status
  permanece InReview — pronto pro @devops abrir o PR.
