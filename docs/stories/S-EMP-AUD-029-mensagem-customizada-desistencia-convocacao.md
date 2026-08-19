# S-EMP-AUD-029 — Desistir de uma convocação de seleção recebe a mesma despedida genérica de "terminei com sucesso"

**Status:** InReview
**Epic:** Auditoria Empregabilidade
**Origem:** `docs/Auditoria -19-08-26/2026-08-19-empregabilidade-conversas/plans/024-despedida-generica-desistencia-selecao.md`
(auditoria de conversas reais, 18-19/08) — reproduzido ao vivo em conversa real de outro lead
(`conversa 49a165ec-9807-4bab-9c8a-632bb6ea849e`, 19/08 12:03), confirmado ainda presente hoje por
leitura direta do código (`mensagem_customizada` não existe em `_encerrar_fluxo`/`_quer_sair_semantico`).
**Prioridade:** P3 — não é bug de dado (nenhuma `candidatura` é criada quando a pessoa desiste), é só
uma mensagem que confunde.
**Esforço:** S | **Risco:** BAIXO — mudança aditiva num único call site, parâmetro novo opcional com
default que preserva o comportamento em todo o resto do arquivo.

## Contexto

Reproduzido ao vivo, 19/08:

```
12:02:50 bot: "🎉 Você está convocado(a) para o processo seletivo LABISE SERVIÇOS LTDA!
               Cargo(s): COSTUREIRA...
               Para confirmar sua presença, digite seu nome completo:"
12:03:19 lead: "nao quero mais, obrigado"
12:03:32 bot: "Boa sorte! Fique de olho nas mensagens da equipe CUCA. 🤝
               Se precisar de mais alguma coisa, é só chamar. Até logo! 👋"
```

É a mesma despedida usada em **qualquer** encerramento de conversa no perfil público — inclusive
depois de um envio de currículo com sucesso. Emendada logo depois de "🎉 Você está convocado(a)!",
lê como se a desistência não tivesse sido ouvida, mesmo o sistema tendo processado a recusa
corretamente por trás (confirmado: nenhuma `candidaturas` foi criada pra esse lead).

`_encerrar_fluxo` (`worker/empregabilidade_engine.py:569-587`) tem despedida fixa por `perfil`, sem
jeito de customizar por contexto/etapa hoje. `_quer_sair_semantico` (`:911-933`), chamada em
`confirmando_presenca_nome` (`:2880-2930`, SQS-56), não passa nenhuma customização.

## Impacto (por item, conforme análise obrigatória do projeto)

| Toca | Consome hoje | Impacto observável | De-risk |
|---|---|---|---|
| `_encerrar_fluxo` | Todos os encerramentos de conversa do perfil público e empresa (múltiplos call sites) | Parâmetro novo opcional (`mensagem_customizada: str \| None = None`), sem valor muda 0 comportamento existente | Testar explicitamente que outro call site sem o parâmetro novo continua recebendo a mensagem genérica de sempre |
| `_quer_sair_semantico` | Chamada nas etapas de coleta de nome (mesma família de call sites da `S-EMP-AUD-024`/`028`) | Mesmo parâmetro repassado — aditivo | Idem acima |
| `confirmando_presenca_nome` (único call site que muda de fato) | Etapa SQS-56, único ponto que dispara esse texto específico | Passa a receber mensagem de desistência específica em vez da genérica | Teste de regressão do caso real (LABISE) |

## Valor de negócio

Evita a sensação de "ele não me ouviu" logo depois de uma recusa explícita — reduz confusão em
produção real, sem tocar em nenhuma lógica de dado (a recusa já é processada certo).

## Acceptance Criteria

1. `_encerrar_fluxo` e `_quer_sair_semantico` aceitam `mensagem_customizada: str | None = None`, sem
   quebrar nenhum call site existente.
2. `confirmando_presenca_nome` usa uma mensagem específica de desistência de convocação (não reaproveita
   "Boa sorte!"/🎉 logo depois de uma recusa).
3. Teste de regressão do caso real (LABISE, "não quero mais, obrigado") passa.
4. Nenhum outro call site de `_encerrar_fluxo`/`_quer_sair_semantico` muda de comportamento.
5. Suíte completa do worker sem regressão.

## Escopo

**In:** `_encerrar_fluxo`, `_quer_sair_semantico`, único call site em `confirmando_presenca_nome`.
**Out:** `confirmando_presenca_telefone` — usa helper diferente (`_escape_semantico_ou_none`,
compartilhado por 17 call sites), plausível que tenha o mesmo problema mas não confirmado com dado
real ainda; fica pra story própria se/quando reproduzido. Qualquer outro call site de
`_quer_sair_semantico`/`_encerrar_fluxo` fora desta etapa — a mensagem genérica é apropriada na
maioria dos outros contextos.

## Test plan

- Regressão do caso real: etapa `confirmando_presenca_nome`, "não quero mais, obrigado" → mensagem
  de desistência específica, sem "Boa sorte"/🎉.
- Sem regressão: outro call site sem `mensagem_customizada` continua recebendo o texto genérico.
- Estado limpo depois (`_set_fluxo_async(conversa_id, {})` continua sendo chamado).
- Suíte completa de `test_empregabilidade_engine.py` sem regressão.

## Dev Agent Record

**Linhas reconfirmadas via grep antes de editar** (drift do @po já esperado): `_encerrar_fluxo`
em `:576`, `_quer_sair_semantico` em `:1504`, call site `confirmando_presenca_nome` em `:3441` —
bateram exatamente com a validação do @po.

**Implementação:**
- `_encerrar_fluxo` (`worker/empregabilidade_engine.py:576`): novo parâmetro
  `mensagem_customizada: str | None = None`, usado no lugar da despedida padrão quando presente
  (checado antes do `if perfil == "empresa"`, então funciona pra qualquer perfil).
- `_quer_sair_semantico` (`:1504`): mesmo parâmetro novo, repassado direto pra `_encerrar_fluxo`.
- Único call site alterado de fato: `confirmando_presenca_nome` (`:3441`) — passa uma mensagem
  específica de desistência de convocação em vez de deixar cair na genérica.
- Os outros 11 call sites de `_encerrar_fluxo` e os outros 3 de `_quer_sair_semantico` não foram
  tocados — parâmetro é opcional com default `None`, comportamento idêntico ao anterior.

**Testes (`worker/tests/test_empregabilidade_engine.py`):**
- Novo: `test_confirmando_presenca_nome_desistencia_recebe_mensagem_especifica` — regressão exata
  do caso real (`49a165ec`, "não quero mais, obrigado"): confirma que a mensagem NÃO contém "Boa
  sorte"/🎉 e contém confirmação explícita de registro da desistência; `estado == {}` confirma que
  `_encerrar_fluxo` seguiu limpando o fluxo normalmente.
- Reforçado: `test_quer_sair_explicito_encerra_em_vez_de_aceitar_como_nome` (já existente, etapa
  `coletando_nome_candidato`) — adicionada asserção explícita de que a despedida genérica ("Boa
  sorte") continua sendo enviada nesse call site, que não passa `mensagem_customizada` (AC4).

**Validação:** suíte completa de `test_empregabilidade_engine.py` — **156 passed** (154 anteriores
+ 2 novos). Suíte geral do worker (`--ignore=test_main_retomar_disparo.py`, módulo `openai` ausente
no venv local, falha de ambiente pré-existente) — as 5 falhas em `test_meta_adapter_outbound.py`
(`ModuleNotFoundError: No module named 'worker'`) foram confirmadas pré-existentes via
`git stash`/rerun antes desta mudança (mesmas 5 falhas sem tocar nada). Nenhuma delas relacionada a
este código.

**Escopo respeitado:** `confirmando_presenca_telefone` (out de escopo, helper diferente) não foi
tocado, conforme a story.

**File List:**
- `worker/empregabilidade_engine.py`
- `worker/tests/test_empregabilidade_engine.py`

## QA Results

**Veredito: PASS**

1. **Code review** — mudança mínima e aditiva; parâmetro novo com default `None` em ambas as
   funções; único ponto de uso real é o call site pretendido. Docstrings atualizadas com contexto
   da story. Sem code smell.
2. **Testes** — reconfirmados de forma independente: `156 passed` rodando a suíte completa de
   `test_empregabilidade_engine.py`. Teste de regressão do caso real inspecionado linha a linha.
3. **Acceptance Criteria** — AC1 (parâmetro opcional em ambas funções) ✅; AC2 (mensagem específica
   no call site) ✅; AC3 (regressão do caso real LABISE) ✅; AC4 (outro call site sem regressão,
   reforçado com asserção explícita) ✅; AC5 (suíte completa sem regressão) ✅.
4. **Regressão** — confirmado via `git diff HEAD^ HEAD` que só os 2 pontos esperados
   (`_encerrar_fluxo` dentro de `_quer_sair_semantico`, e o call site de `confirmando_presenca_nome`)
   foram alterados; os outros 11 call sites de `_encerrar_fluxo` e os outros 3 de
   `_quer_sair_semantico` (linhas 3217/3261/3378, etapas fora de escopo) permanecem intocados.
   **Teste empírico de causalidade:** reverti temporariamente `empregabilidade_engine.py` pro
   estado pré-fix (`git show HEAD^:...`) mantendo os testes novos — o teste de regressão falhou
   exatamente como esperado (`'boa sorte' is contained here`); restaurei e a suíte voltou a 156
   passed. Prova que o teste testa o comportamento real, não é um passa-sempre.
5. **Performance** — string estática, zero chamada de rede/IA adicional; sem impacto de latência.
6. **Segurança** — `mensagem_customizada` é sempre uma string literal definida no código
   (`mensagem_desistencia_convocacao`), nunca dado do usuário — sem superfície de injeção.
7. **Documentação** — Dev Agent Record completo, File List correta, Change Log com histórico
   completo da story.

Nenhum achado. Pronto pro @devops abrir o PR.

## Change Log

- v0.1 (2026-08-19): Story criada por @sm a partir do Plano 024 da auditoria, reconfirmada com
  evidência ao vivo (conversa real de outro lead, `49a165ec`, LABISE) durante levantamento desta
  sessão.
- v0.2 (2026-08-19): @po validou — **GO (9/10)**. Mudança aditiva, escopo mínimo (1 call site real),
  risco baixo bem justificado, AC direto e testável. Único ponto sem nota máxima: as linhas citadas
  pra `_encerrar_fluxo`/`_quer_sair_semantico`/`confirmando_presenca_nome` (569-587/911-933/2880-2930)
  já tiveram bastante drift desde a auditoria original (confirmado que as 3 funções existem e o
  comportamento bate, hoje em `:576`/`:1504`/`:3441` — o arquivo cresceu muito nesta sessão com os
  passos da S-EMP-AUD-023). @dev deve reconfirmar via grep antes de editar, não confiar nos números
  citados. Status Draft → Ready.
- v0.3 (2026-08-19): @dev implementou — parâmetro `mensagem_customizada` opcional em
  `_encerrar_fluxo`/`_quer_sair_semantico`, mensagem específica no call site de
  `confirmando_presenca_nome`. 2 testes novos/reforçados, 156 passed sem regressão. Status Ready →
  InReview. Pronto pro @qa.
- v0.4 (2026-08-19): @qa revisou — **PASS**. Todos os 7 checks ok, todos os AC confirmados, teste
  empírico de causalidade confirmou que o teste de regressão falha sem o fix e passa com ele. Sem
  achados. Status permanece InReview — pronto pro @devops abrir o PR.
