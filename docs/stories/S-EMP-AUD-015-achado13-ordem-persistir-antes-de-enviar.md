# S-EMP-AUD-015 — Ordem persistir-antes-de-enviar — inverter pro Jeito A (achado #13)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/015-achado13-ordem-persistir-antes-de-enviar.md`
**Prioridade:** P3 | **Esforço:** S | **Risco:** MED (muda comportamento de 2 fluxos reais)
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais

## Contexto

2 pontos (`worker/empregabilidade_engine.py:1820-1833` e `:1955-1972`) gravam estado **antes** de enviar a mensagem — se o envio falhar, a próxima mensagem do usuário cai no handler errado (a etapa já avançou, mas o usuário nunca recebeu a pergunta correspondente). Havia comentário no código defendendo essa ordem como deliberada, então o plano tinha decisão de produto em aberto — **não tem mais**.

## Decisão de produto aplicada (sócio, 2026-07-29)

**Inverter para o Jeito A: enviar antes de persistir**, alinhando com o padrão do resto do arquivo, com teste de falha de envio cobrindo os 2 pontos. Não é mais necessário levantar a pergunta — resolvida.

## Dependência real

Nenhuma.

## Acceptance Criteria

- [ ] Ordem trocada nos 2 pontos (`:1820-1833`, `:1955-1972`) — enviar antes de persistir
- [ ] Teste de falha de envio nos 2 pontos, confirmando que o estado não avança quando o envio falha
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano.

## Test plan

2 testes (1 por ponto) simulando falha de envio.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 015, já com a decisão do sócio (inverter pro Jeito A) incorporada — deixa de ser plano sem fix prescrito.
- v0.2 (2026-07-29): @po validou — GO (8/10). Status Draft → Ready. Ponto forte: decisão de produto que estava em aberto há 2 auditorias foi resolvida com justificativa registrada. Não bloqueante: "Valor de negócio" não está em seção própria.
