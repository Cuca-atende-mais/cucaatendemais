# Planos — Auditoria consolidada Empregabilidade (2026-07-29)

Gerados a partir de `docs/qa/AUDITORIA-empregabilidade-CONSOLIDADA-2026-07-29.md` (junção das
auditorias de 09/07 e 17/07). Numeração própria desta subpasta — não usar `plans/001`, `plans/002`
etc. da raiz, que pertencem à investigação da Corrida da Juventude (frente de trabalho diferente).

Todos os 20 achados da auditoria consolidada agora têm plano formal (001-019 — o achado #14 foi
fundido ao 008 por serem o mesmo trabalho, ver nota lá). Gerados em 2 rodadas: 001-003 (achados de
maior severidade, 2026-07-29 manhã) e 004-019 (restante, mesmo dia, "sequência lógica" pedida pelo
Junior — severidade + dependência, não a ordem crua da tabela da auditoria).

**Atualização 2026-07-29 (tarde):** os 19 planos foram formalizados em stories
(`docs/stories/S-EMP-AUD-001` a `019`), com 5 decisões de produto do sócio já aplicadas direto nos
planos (001, 002, 011, 014, 015 — ver notas abaixo) e verificação cruzada contra o código real em
`docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`. **Passo 0 concluído**: as 3 classes de teste + 1 teste novos da pasta local não commitada
(`testes-locais-nao-commitados/`, já removida do disco) foram levados pros arquivos committed de
`worker/tests/` (commit `3ab3b96` na branch `feat/painel-controle-pausa-limite`, cherry-picked para
`b2b9940` na branch `feat/auditoria-empregabilidade-p1`) — **a cópia local não foi copiada por
cima**: ela tinha perdido silenciosamente 1 asserção de um teste já existente
(`TestEscapeHatchNomeLivre`), preservada na mesclagem. É esse cuidado que torna seguro ter apagado
a pasta local. Resultado: 4 vermelhos (EMP-01 a EMP-04, planos 004-007), 52 verdes, confirmado
rodando a suíte nesta branch. **@po validou as 19 stories** (checklist de 10 pontos):
todas passaram para `Status: Ready` — 10 GO diretamente, 9 precisaram de 2 ajustes padronizados
(seção "Valor de negócio" + Escopo restatado na própria story) antes de fechar GO. Detalhe completo
em cada `Change Log` das stories.

## Ordem de execução & status

| Plano | Título | Prioridade | Esforço | Depende de | Status |
|-------|--------|------------|---------|------------|--------|
| 001   | Empresa deixa de ser "autenticada" só pelo CNPJ (SEC-01) — v2 + Step 5 (reversão automática de awaiting_human + aviso ao lead, decisão do sócio) | P1 | M | — | **Implementado** (2026-07-29) — Steps 1-2 já estavam implementados/aplicados; Steps 3-5 retomados após decisão do Junior e concluídos com endpoint + UI protegidos por `has_permission('empreg_vagas', 'update')`, 409 em conflito, reativação por telefone -> lead -> conversa e aviso automático ao lead. Recomendado @qa para o Bloco 1 inteiro (001 completo + 002 + 003). |
| 002   | Consulta de candidatura para de vazar dado de terceiro (SEC-02) — normalização dos 2 lados do telefone (decisão do sócio) | P1 | S | — | **Implementado** (2026-07-29), commit `d4d634d` — 6 testes, suíte verde |
| 003   | `aguardando_retorno_selecao` ganha handler síncrono (BUG-01) | P1 | S | — | **Implementado** (2026-07-29), commit `d4d634d` — 3 testes, suíte verde |
| 004   | Filtro de setor por substring esconde vagas já na 1ª mensagem (EMP-01) | P1 | S | — | Story validada (Ready) — `S-EMP-AUD-004`. Teste vermelho commitado. |
| 005   | `_quer_encerrar` por substring encerra conversa por engano (EMP-02 / #8) | P1 | S | — | Story validada (Ready) — `S-EMP-AUD-005`. Teste vermelho commitado. |
| 006   | Negação ignorada em `pos_candidatura` reabre busca de vagas (EMP-03) | P1 | S | — | Story validada (Ready) — `S-EMP-AUD-006`. Teste vermelho commitado. |
| 007   | `menu_pos_vaga` reinterpreta resposta contra menu errado (EMP-04) | P1 | S | — | Story validada (Ready) — `S-EMP-AUD-007`. Teste vermelho commitado. |
| 008   | Cobertura nos 3 fluxos de maior risco + mocks passam a verificar payload (TEST-01 + #14) | P1 | M | — | Story validada (Ready) — `S-EMP-AUD-008` |
| 009   | ~48 chamadas Supabase síncronas travam o event loop (BUG-02/PERF-01) | P1 | L | **008** | Story validada (Ready) — `S-EMP-AUD-009` |
| 010   | Links do portal sem assinatura nem expiração (achado #12) | P2 | M | — | Story validada (Ready) — `S-EMP-AUD-010` |
| 011   | `_set_fluxo` redundante + risco de lost-update contra o loop de notificação (achado #6) — trava vira `asyncio.Lock()` real (decisão do sócio) | P2 | M | recomendado após 009 | Story validada (Ready) — `S-EMP-AUD-011` |
| 012   | N+1 em 2 telas de listagem (achado #9) | P3 | S | — | Story validada (Ready) — `S-EMP-AUD-012` |
| 013   | Regex de número de vaga pode capturar dígito de CNPJ (achado #10) | P3 | S | — | Story validada (Ready) — `S-EMP-AUD-013` |
| 014   | Menu duplicado 10x (`:646` → "Cancelar uma vaga", decisão do sócio) + 7 tuplas de afirmativo inconsistentes (achado #11) | P3 | S/M | — | Story validada (Ready) — `S-EMP-AUD-014` |
| 015   | Ordem persistir-antes-de-enviar — inverter pro Jeito A (decisão do sócio, 2026-07-29) (achado #13) | P3 | S | — | Story validada (Ready) — `S-EMP-AUD-015`. Deixou de ser plano sem fix prescrito. |
| 016   | Loop de notificação: N+1 de lead + query externa sem `.limit()` (achado #15) | P3 | S/M | — | Story validada (Ready) — `S-EMP-AUD-016` |
| 017   | Cobertura dos 4 branches principais de `_rotear_por_intencao` (achado #16, escopo reduzido) | P3 | S | — | Story validada (Ready) — `S-EMP-AUD-017` |
| 018   | CNPJ sem mascaramento em log (achado #17) | P4 | S | — | Story validada (Ready) — `S-EMP-AUD-018` |
| 019   | Parâmetro `token` de `_enviar()` nunca usado (cosmético) | P5 | S | — | Story validada (Ready) — `S-EMP-AUD-019` |

**Ordem recomendada de execução** (severidade + dependência real, não a ordem numérica pura):
1. **001-003** — segurança/bug crítico, independentes entre si.
2. **004-007** — bugs confirmados e baratos (teste já commitado), independentes entre si e dos 001-003.
3. **008** — antes de qualquer coisa que toque muito código de produção depois dele.
4. **009** — só depois do 008 (hard dependency, declarada no próprio plano).
5. **010, 011** — podem entrar em paralelo com 004-009, sem dependência real entre si (011 recomenda esperar o 009, e tem um risco de compatibilidade adicional entre o `asyncio.Lock` do 011 e o `asyncio.to_thread` do 009 — ver nota no Plano 011; não é bloqueante, mas quem implementar precisa desenhar a integração).
6. **012-019** — severidade menor, qualquer ordem, nenhuma dependência entre eles (015 não depende mais de decisão de produto — já resolvida). Cortesia de merge, não bloqueante: 012 depois do 007 (tocam código próximo).

## Notas importantes antes de repassar pro @dev

- **Passo 0 concluído (2026-07-29, commit `3ab3b96`)**: testes vermelhos de 004-007 mesclados em `worker/tests/`, preservando uma asserção que a cópia local não commitada tinha perdido silenciosamente (`TestEscapeHatchNomeLivre`, último teste). Suíte roda: 4 vermelhos esperados (EMP-01 a EMP-04), 52 verdes.
- **004-007 e 017-019 referenciam testes/decisões específicas** — não são só "conserta isso", cada um tem o teste exato (já escrito e commitado, no caso de 004-007).
- **015 tem fix decidido pelo sócio (2026-07-29): inverter pro Jeito A** — deixou de ser "sem fix prescrito".
- **011 cita uma investigação sobre múltiplos processos gunicorn que não foi encontrada** (nem working tree, nem histórico do git) — decisão do sócio: não bloquear por isso, tratar "1 processo" (`Dockerfile: gunicorn -w 1`) como premissa válida por ora, mencionar no PR.
- **009 é o maior e mais arriscado** (Effort L, ~49 pontos espalhados) — só deve começar depois do 008 fechado, e mesmo assim em incrementos pequenos (o próprio plano detalha a ordem sugerida).
