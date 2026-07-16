# Planos de implementação — `motor-agente`

Gerado pela skill `improve` em 2026-07-16, a partir da auditoria de `supabase/functions/motor-agente/index.ts` (commit `bf8b152`). Escopo: correctness, security, performance, test coverage e tech debt de um único arquivo — não cobre dependências/migrations, DX além do typecheck, docs ou direção/features.

**Todos os 17 achados vetados viraram plano.** Cada plano é auto-contido (código atual citado, comandos de verificação, critérios de "pronto" checáveis por máquina, condições de STOP) para o Claude Code do Valmir executar sem esta conversa como contexto. Ver também [`docs/qa/AUDITORIA-motor-agente-2026-07-16.md`](../docs/qa/AUDITORIA-motor-agente-2026-07-16.md) para o diagnóstico completo por trás de cada plano.

## Ordem de execução & status

| Plano | Título | Prioridade | Esforço | Risco | Depende de | Status |
|---|---|---|---|---|---|---|
| [001](001-typecheck-database-generic.md) | Restaurar `deno check` funcional (gerar tipos do Supabase) | P1 | M | LOW | — | TODO |
| [002](002-sec01-conversa-id-ownership-check.md) | Impedir `conversa_id` de outro lead (ownership check) | P1 | S | LOW | — | TODO |
| [003](003-sec02-ssrf-midia-url.md) | Allowlist/remoção do SSRF em `transcreverAudio` — **tem pergunta em aberto pro Valmir** | P2 | S | LOW | leia 002 primeiro | TODO |
| [004](004-bug01-ambiguidade-anti-repeticao.md) | Anti-repetição na resposta de ambiguidade de unidade | P2 | S | LOW | — | TODO |
| [005](005-bug02-lead-lookup-error-handling.md) | Diferenciar erro técnico de "lead bloqueado" | P2 | S | LOW | — | TODO |
| [006](006-perf02-paralelizar-queries-independentes.md) | Paralelizar 3 pares de queries independentes | P2 | S | LOW/MED | — | TODO |
| [007](007-td02-unificar-mapa-unidades.md) | Unificar `UNIDADES_MAP`/`nomesUnidades` duplicados | P3 | S | LOW | — | TODO |
| [008](008-test02-cobertura-transcricao-audio.md) | Cobertura de teste p/ transcrição de áudio — **condicional ao 003** | P3 | S | LOW | 003 | TODO |
| [009](009-bug04-retry-gerarembedding.md) | Retry/backoff em `gerarEmbedding` | P2 | M | LOW | — | TODO |
| [010](010-test01-cobertura-branches-erro-handler.md) | Cobertura de teste p/ branches de erro do `handler()` | P2 | M | LOW | — (pré-requisito do 017) | TODO |
| [011](011-sec04-nao-expor-erro-upstream.md) | Não expor texto de erro upstream (OpenAI) na resposta HTTP | P3 | S | LOW | — | TODO |
| [012](012-td03-extrair-montagem-contexto-rag.md) | Extrair formatação de chunks RAG (duplicada 4x) | P3 | M | LOW/MED | — | TODO |
| [013](013-bug03-erro-lookup-conversa-cria-orfa.md) | Erro no lookup de `conversa_id` não deve criar conversa órfã | P2 | S/M | MED | leia 002 primeiro | TODO |
| [014](014-perf03-batch-insert-partes-mensagem.md) | Avaliar batch dos inserts de partes de mensagem | P3 | S | MED | — | TODO |
| [015](015-sec03-sanitizar-nome-lead-prompt.md) | Endurecer isolamento de `lead.nome` no prompt | P3 | S/M | LOW | — | TODO |
| [016](016-bug05-investigar-corrida-conversa-duplicada.md) | *(investigar)* Corrida pode duplicar `conversas` no caminho legado | P3 | M | MED se agir | — | TODO |
| [017](017-td01-extrair-secoes-handler.md) | *(plano em estágios)* Extrair seções do `handler()` de ~540 linhas | P3 | L | HIGH | **010 obrigatório** | TODO |

## Ordem recomendada de execução

1. **001** primeiro — restaura a rede de segurança de tipos para todos os demais.
2. **002** — segurança crítica com reachability confirmada.
3. **004, 005, 006, 007, 009, 011** — independentes entre si, baixo risco, podem rodar em qualquer ordem/paralelo.
4. **003** — depois de ler 002 (mesmo argumento de reachability). Responde a pergunta em aberto antes.
5. **008** — só depois de 003 decidido (pode virar REJECTED se 003 escolheu remover o código).
6. **013** — depois de 002 (mesma região de código).
7. **010** — cobertura de teste do `handler()`, prepara o terreno para 017.
8. **012** — extração de duplicação RAG, pode rodar a qualquer momento independente dos demais.
9. **014, 015, 016** — baixa prioridade, avaliar caso a caso (016 é investigação, pode não virar fix).
10. **017** — só depois de 010 concluído. É um plano em estágios, não uma sessão única — não tentar fazer tudo de uma vez.

## Notas de dependência

- 002 e 003 compartilham o mesmo argumento de reachability (anon key pública + sem `verify_jwt` override).
- 008 é condicional ao resultado de 003 (pode virar REJECTED).
- 013 toca a mesma região de código que 002 — aplicar 002 primeiro evita conflito de merge.
- 017 (estágio 1) se apoia na extração de formatação do 012, mas não depende estritamente dele — pode rodar em paralelo.
- 017 requer 010 concluído como pré-requisito de segurança (characterization tests antes de refatorar uma função com histórico real de regressões).

## Achados considerados e rejeitados

- **`buscarAtividadeEspecifica` sem `.limit()`** (`index.ts:846`) — decisão documentada de propósito no próprio código (`index.ts:835-837`): buscar todos os chunks evita truncar atividades espalhadas em chunks não-contíguos (S-WM-34/VAL-09). Não é achado, não re-auditar.

## Status values

TODO | IN PROGRESS | DONE | BLOCKED (com motivo em uma linha) | REJECTED (com justificativa em uma linha — achado corrigido independentemente ou abordagem abandonada)
