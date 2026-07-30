# S-EMP-AUD-005 — `_quer_encerrar` por substring encerra conversa por engano (EMP-02 / achado #8)

**Status:** Draft
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/005-emp02-quer-encerrar-substring-sem-limite.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 005" — inclui 1 risco adicional sobre cobertura de teste, ler antes de fechar a story como pronta
**Prioridade:** P1 | **Esforço:** S | **Risco:** MED
**Ordem de execução proposta:** Bloco 2 (junto com 004, 006, 007) — independentes entre si e dos blocos 1/3/4

## Contexto

`_quer_encerrar` (`worker/empregabilidade_engine.py:191-193`) casa qualquer palavra de `_PALAVRAS_ENCERRAR` como substring solta, em qualquer lugar da mensagem — "muito **obrigado**! mas ainda tenho uma dúvida" encerra a conversa na hora. Chamada em 3 fluxos (candidato, empresa, público).

## Dependência real

**Bloqueada pelo Passo 0 (commit dos testes locais) — já resolvido em 2026-07-29** (commit `3ab3b96`). Teste vermelho commitado: `TestQuerEncerrarSubstringSemLimiteDePalavra` em `worker/tests/test_empregabilidade_engine.py`.

## Atenção no momento de implementar (achado da verificação da equipe, não do plano original)

O fix recomendado (seguir o padrão de `_quer_banco_talentos`: remover o trecho que deu match e decidir pelo que sobra da frase) evita trocar o bug de falso-positivo por um de falso-negativo — se o fix virar simplesmente "só aceita a mensagem inteira", frases legítimas como "quero encerrar por favor" deixariam de encerrar. **O teste vermelho local só cobre a direção falso-positivo.** Adicionar ao menos 1 caso de teste confirmando que despedidas reais ("tchau", "obrigado, pode fechar") continuam encerrando depois do fix, antes de considerar a story pronta.

## Acceptance Criteria

- [ ] `test_obrigado_no_meio_de_pergunta_nao_deveria_encerrar_candidato` passa
- [ ] Novo teste (adicionado nesta story, não no plano original) confirma que despedidas reais continuam encerrando nos 3 fluxos
- [ ] Suíte completa passando (rodar a completa, não só o teste novo — risco MED por afetar 3 fluxos de uma vez)

## Escopo

Ver "Scope" do plano — correção na função raiz `_quer_encerrar`, sem necessidade de mexer nos 3 call sites.

## Test plan

Teste vermelho já commitado + o teste adicional de regressão pra direção falso-negativo (ver "Atenção" acima).

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 005, com a ressalva de cobertura de teste (achado da verificação da equipe) registrada. Passo 0 já resolvido.
