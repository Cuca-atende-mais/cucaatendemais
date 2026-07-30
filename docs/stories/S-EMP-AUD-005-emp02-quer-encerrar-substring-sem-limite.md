# S-EMP-AUD-005 — `_quer_encerrar` por substring encerra conversa por engano (EMP-02 / achado #8)

**Status:** Ready for Review
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/005-emp02-quer-encerrar-substring-sem-limite.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 005" — inclui 1 risco adicional sobre cobertura de teste, ler antes de fechar a story como pronta
**Prioridade:** P1 | **Esforço:** S | **Risco:** MED
**Ordem de execução proposta:** Bloco 2 (junto com 004, 006, 007) — independentes entre si e dos blocos 1/3/4

## Contexto

`_quer_encerrar` (`worker/empregabilidade_engine.py:191-193`) casa qualquer palavra de `_PALAVRAS_ENCERRAR` como substring solta, em qualquer lugar da mensagem — "muito **obrigado**! mas ainda tenho uma dúvida" encerra a conversa na hora. Chamada em 3 fluxos (candidato, empresa, público).

## Valor de negócio

Evita perder conversas reais (encerradas por engano) só por conter "obrigado"/"tchau" no meio da frase — reduz abandono de leads e empresas ativos no meio do fluxo.

## Dependência real

**Bloqueada pelo Passo 0 (commit dos testes locais) — já resolvido em 2026-07-29** (commit `3ab3b96`). Teste vermelho commitado: `TestQuerEncerrarSubstringSemLimiteDePalavra` em `worker/tests/test_empregabilidade_engine.py`.

## Atenção no momento de implementar (achado da verificação da equipe, não do plano original)

O fix recomendado (seguir o padrão de `_quer_banco_talentos`: remover o trecho que deu match e decidir pelo que sobra da frase) evita trocar o bug de falso-positivo por um de falso-negativo — se o fix virar simplesmente "só aceita a mensagem inteira", frases legítimas como "quero encerrar por favor" deixariam de encerrar. **O teste vermelho local só cobre a direção falso-positivo.** Adicionar ao menos 1 caso de teste confirmando que despedidas reais ("tchau", "obrigado, pode fechar") continuam encerrando depois do fix, antes de considerar a story pronta.

## Acceptance Criteria

- [x] `test_obrigado_no_meio_de_pergunta_nao_deveria_encerrar_candidato` passa
- [x] Novo teste (adicionado nesta story, não no plano original) confirma que despedidas reais continuam encerrando nos 3 fluxos
- [x] Suíte completa passando (rodar a completa, não só o teste novo — risco MED por afetar 3 fluxos de uma vez)

## Escopo

Ver "Scope" do plano — correção na função raiz `_quer_encerrar`, sem necessidade de mexer nos 3 call sites.

## Test plan

Teste vermelho já commitado + o teste adicional de regressão pra direção falso-negativo (ver "Atenção" acima).

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 005, com a ressalva de cobertura de teste (achado da verificação da equipe) registrada. Passo 0 já resolvido.
- v0.2 (2026-07-29): @po validou — GO (7/10). Status Draft → Ready. Ponto forte: risco de falso-negativo do próprio fix já identificado e com AC cobrindo.
- v0.3 (2026-07-29): @po adicionou seção "Valor de negócio" explícita.
- v0.4 (2026-07-30): @dev corrigiu `_quer_encerrar` e adicionou teste de despedida real nos 3 fluxos. Status Ready → Ready for Review.
- v0.5 (2026-07-30): @dev ajustou o achado MED da @qa: negação junto de termos fortes de fechamento não encerra mais o fluxo; testes de regressão adicionados.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` — passou: 72 passed.
- Pós-ajuste QA MED: `cd worker && ../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py::TestQuerEncerrarSubstringSemLimiteDePalavra -v` — passou: 3 passed.
- Pós-ajuste QA MED: `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` — passou: 73 passed.

### Completion Notes List

- `_quer_encerrar` não encerra mais por substring solta em mensagens com continuação.
- Despedidas claras continuam encerrando nos fluxos candidato, empresa e público.
- Desvio consciente em relação ao plano simplificado: mantida tolerância para frases claras como “quero encerrar por favor”, coberta por teste, em vez de aceitar somente igualdade literal da mensagem inteira.
- Achado MED da QA ajustado: `"não quero encerrar, quero consultar outra candidatura"` e `"não pode fechar ainda, tenho outra dúvida"` agora retornam `False`, enquanto `"quero encerrar por favor"` e `"obrigado, pode fechar"` seguem retornando `True`.

### File List

- `worker/empregabilidade_engine.py`
- `worker/tests/test_empregabilidade_engine.py`

## QA Results

### Review 2026-07-30 — @qa Quinn — Gate: CONCERNS

**Achado 1 — MED:** a correção fecha o caso `"muito obrigado, mas..."`, mas ainda mantém falso-positivo de encerramento quando a mensagem contém negação junto de termos fortes de fechamento. Em `worker/empregabilidade_engine.py:203-204`, qualquer match de `"encerrar"`, `"finalizar"`, `"pode fechar"` ou `"ok pode fechar"` retorna `True` imediatamente, antes de avaliar o restante da frase. Reproduzido com chamada direta: `_quer_encerrar("não quero encerrar, quero consultar outra candidatura") == True` e `_quer_encerrar("não pode fechar ainda, tenho outra dúvida") == True`. Isso ainda viola o objetivo da story: evitar encerramento indevido por frase embutida numa mensagem maior. Recomendação: aplicar o mesmo critério de “resto da frase” também para termos fortes, com tratamento explícito de negação/continuação antes de retornar `True`, e adicionar testes para esses dois exemplos.

**Evidência positiva:** os testes planejados passaram: `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` resultou em `72 passed`; o teste novo confirma que despedidas reais continuam encerrando nos 3 fluxos.

**Risco residual:** como `_quer_encerrar` é chamada no topo dos fluxos candidato, empresa e público, o falso-positivo ainda pode limpar o estado antes de handlers específicos ou escape semântico tratarem a intenção real do lead.
