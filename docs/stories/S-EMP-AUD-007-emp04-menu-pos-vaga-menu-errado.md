# S-EMP-AUD-007 — `menu_pos_vaga` reinterpreta resposta contra menu errado (EMP-04)

**Status:** Draft
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/007-emp04-menu-pos-vaga-menu-errado.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 007" — confirmado em `worker/empregabilidade_engine.py:1076-1082` (menu mostrado) e `:1101-1102` (dispatch errado)
**Prioridade:** P1 | **Esforço:** S | **Risco:** BAIXO-MED
**Ordem de execução proposta:** Bloco 2 (junto com 004, 005, 006) — independentes entre si e dos blocos 1/3/4. Sugestão de sequência (não bloqueante): implementar antes do Plano 012, que mexe em código próximo (`_listar_vagas_para_acao`), pra evitar conflito de merge.

## Contexto

Depois de criar uma vaga, a etapa vira `menu_pos_vaga` (menu de 4 opções, "3 = Encerrar"), mas o dispatch dessa etapa redireciona para o handler de `menu_empresa_acoes`, onde "3 = Editar uma vaga". Uma empresa que responde "3" querendo encerrar acaba, sem saber, no fluxo de edição.

## Dependência real

**Bloqueada pelo Passo 0 (commit dos testes locais) — já resolvido em 2026-07-29** (commit `3ab3b96`). Teste vermelho commitado: `TestMenuPosVagaReinterpretaResposta` em `worker/tests/test_empregabilidade_engine.py`.

## Acceptance Criteria

- [ ] `test_resposta_3_para_encerrar_e_reinterpretada_como_editar_vaga` passa
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano — branch `if etapa == "menu_pos_vaga"` (`:1101`). Não inclui o handler de `menu_empresa_acoes` em si.

## Test plan

Teste já escrito e commitado.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 007. Passo 0 já resolvido.
- v0.2 (2026-07-29): @po validou — NO-GO (6/10). Permanece em Draft. Pendências: (1) restatar Escopo diretamente na story; (2) "Valor de negócio" ausente — adicionar (empresa que responde "3" pra encerrar para de cair sem saber no fluxo de edição). Ponto forte: teste vermelho já commitado, dependência de merge com o Plano 012 já mapeada.
