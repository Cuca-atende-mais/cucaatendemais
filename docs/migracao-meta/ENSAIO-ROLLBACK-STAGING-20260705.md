# Ensaio de Rollback em Staging (cuca-dev) — 2026-07-05

> **Autor:** @devops (Gage), com validação final de restore por Junior · **Data:** 2026-07-05 · **Ambiente:** staging/cuca-dev (`jmwokdcqxmojhvrkgpbd`). **Produção não foi tocada em nenhum momento.**
>
> Executa de verdade, contra o banco real de cuca-dev, o `PLANO-EXECUCAO-CUTOVER-MIGRATIONS.md` — não um teste genérico. Objetivo: provar (ou refutar) que o mecanismo de rollback do **Relatório 3** (backup → aplicar → restore) é confiável antes de confiar nele em produção.

## Veredito final: ✅ BEM-SUCEDIDO

O ciclo completo **backup → aplicação → restore** funcionou. O backup real (2,6MB, 1472 TOC entries) foi restaurado com sucesso; Junior confirmou via SQL direto que as contagens de `leads`/`conversas`/`mensagens` bateram com o esperado (considerando soft delete). Os 699 avisos do `pg_restore` são ruído esperado de infraestrutura Supabase (diferenças de superusuário entre ambiente de dump e de restore, não relacionados a integridade de dado) — não indicam falha.

**2 bugs reais foram encontrados e corrigidos** durante o ensaio — exatamente o tipo de lacuna que este exercício existe para pegar antes do cutover real. Nenhum dos dois invalida o veredito, mas ambos precisavam de correção no plano (ver seção "Achados").

---

## Linha do tempo real (timestamps UTC)

| Passo | Início | Fim | Duração | Resultado |
|---|---|---|---|---|
| 0. Pré-requisito: confirmar CLI relinkado para cuca-dev + validar integridade do backup | 21:11:32 | 21:11:57 | ~25s | ✅ `linked-project.json` confirmado `jmwokdcqxmojhvrkgpbd`/`cuca-dev`; `pg_restore -l` confirmou 1472 TOC entries, formato CUSTOM, Postgres 17.6 |
| 1. Tag do commit atual de `develop` | 21:14:14 | 21:14:16 | ~2s | ✅ `restore/pre-wm-meta-ensaio-20260705` criada e pushada, apontando `3ce87dc` |
| 2. Backup do banco | — | — | — | ✅ Já realizado por Junior antes do ensaio: `cuca-dev-backup-20260705-180715.dump`, 18:07:15 (horário local) |
| 3a. Verificações V1–V5 do plano, rodadas contra cuca-dev real | 21:14 | 21:15 | ~1min | ✅ Ver "Achados" — 1 bug de coluna encontrado e corrigido na hora |
| 3b. Aplicar migration #5 modificada (sem seed de teste) | 21:15 | 21:15 | <5s | ✅ `apply_migration` bem-sucedido, no-op esperado (tabela já existia) |
| 3c. Aplicar migration nova #22 (`cleanup_remove_debug_wamid_capture_rota`) | 21:15 | 21:15 | <5s | ✅ `apply_migration` bem-sucedido, no-op esperado (tabela não existia — ver "Achados") |
| 4. Deploy worker/portal em staging | — | — | — | ⚠️ Não automatizado nesta sessão — MCP do EasyPanel não estava conectado (ver "Lacunas") |
| 5. Smoke test (Institucional + Empregabilidade) | — | — | — | ⚠️ Não executado — dependia do passo 4 |
| 6. Restaurar backup (`pg_restore`) | 21:16:08 (1ª tentativa) | 21:16:09 | 0,7s | 🔴 Falhou por falta de senha do Postgres (não disponível no ambiente do agente) |
| 6 (retomada). Restore executado e confirmado por Junior | — | — | — | ✅ Confirmado por Junior: restore aplicado com sucesso, 699 avisos (ruído esperado), contagens de `leads`/`conversas`/`mensagens` batendo com soft delete considerado |
| 7. Confirmar paridade pós-restore | — | — | — | ✅ Confirmado por Junior via SQL direto — ver "Paridade" abaixo |

---

## Achados (2 bugs reais, corrigidos)

### 1. Bug de coluna na query V2 do plano — CORRIGIDO

A verificação V2 (antes da migration `seed_categoria_academia_enem_e_limpa_eventos_teste`) referenciava `eventos_pontuais.categoria_id` — **coluna que não existe**. O schema real usa `categorias_alvo` (jsonb). O erro só apareceu ao rodar a query de verdade contra cuca-dev (`ERROR: 42703: column "categoria_id" does not exist`), não teria sido pego numa revisão de texto do plano.

**Correção aplicada:** `PLANO-EXECUCAO-CUTOVER-MIGRATIONS.md`, seção V2, query corrigida para `categorias_alvo`. Rodada novamente com sucesso (0 linhas — esperado, o `DELETE` original já rodou em cuca-dev).

### 2. Ordem de aplicação real diverge da ordem por nome de arquivo — registrado como risco conhecido

Ao checar `list_migrations()` em cuca-dev antes de aplicar qualquer coisa, a ordem real de aplicação histórica das 3 migrations de debug wamid foi:

```
debug_wamid_capture_temporario        → aplicada em 20260704 03:13:02
debug_wamid_capture_rota_temporario   → aplicada em 20260704 03:43:54
wm17_remover_debug_wamid_capture      → aplicada em 20260704 04:41:04
```

Isso é o **inverso** do que os nomes de arquivo sugerem (`040000 → 043531 → 050000`, que implicaria criar → remover ambas → recriar a `rota`). Como `wm17_remover` dropa as duas tabelas e rodou **depois** da `rota` ter sido criada nesse ambiente, o resultado real em cuca-dev hoje é: **nenhuma das duas tabelas existe** — confirmado via `SELECT ... information_schema.tables`, retornou vazio.

**Isso não invalida a migration de limpeza nova (#22).** O Relatório 4 assumiu a ordem por *nome de arquivo* (que é o que `supabase db push` normalmente respeita), cenário em que a `rota` sobra órfã — daí o passo 22 continuar necessário para produção. O achado é um **alerta de risco**, não uma correção de rota: **se o mecanismo real de aplicação em produção não for estritamente ordenado por timestamp de arquivo** (por exemplo, aplicação manual fora de sequência, como parece ter acontecido aqui durante o desenvolvimento original), o comportamento observado pode divergir do que este ensaio mostrou. O passo 22 (`DROP TABLE IF EXISTS`) é seguro nos dois cenários (idempotente) — mas o mecanismo de aplicação em produção precisa ser confirmado com Junior antes do cutover (já registrado na seção 0 do plano).

**Correção aplicada:** nota de risco adicionada ao `PLANO-EXECUCAO-CUTOVER-MIGRATIONS.md`, logo após o checklist da seção 5.

---

## Paridade pós-restore

Confirmado por Junior via SQL direto contra cuca-dev após o restore: contagens de `leads`, `conversas` e `mensagens` batendo com o estado esperado do momento do backup (18:07:15), considerando que `leads.excluido` é soft delete (linhas não somem, só ficam marcadas). Os 2 registros de migration que este ensaio havia adicionado (`ensaio_wm19_create_meta_phone_numbers_sem_seed_teste` e `cleanup_remove_debug_wamid_capture_rota`, versões `20260705211524` e `20260705211532`) são exatamente o tipo de mudança que o restore deveria reverter — sua ausência confirmada no estado pós-restore é a evidência mais direta de que o restore realmente aconteceu, e não foi um no-op.

---

## Lacunas identificadas (não impedem o veredito, mas limitam o escopo do que foi provado)

1. **Deploy do worker/portal (passo 4) e smoke test (passo 5) não foram executados** — o MCP do EasyPanel não estava conectado nesta sessão. O ensaio provou o ciclo de **banco** (backup/aplicação/restore) de ponta a ponta, mas não o ciclo de **aplicação** (deploy de código + verificação funcional). Recomendo repetir esses 2 passos manualmente ou com o MCP do EasyPanel conectado antes de considerar o rollback 100% ensaiado.
2. **cuca-dev já continha todo o estado-alvo antes do ensaio** (é o ambiente de origem do desenvolvimento) — a "aplicação das migrations" testou principalmente **idempotência** (reaplicar sem erro nem duplicar dado), não uma aplicação a partir de um schema limpo equivalente ao de produção antes do cutover. Isso é uma limitação estrutural de usar cuca-dev para este tipo de ensaio, não uma falha do processo.
3. **A senha do Postgres não estava disponível ao agente** para rodar o `pg_restore` diretamente — Junior precisou rodar esse passo manualmente. Isso é esperado e correto (o agente não deveria ter acesso a essa credencial por padrão), mas significa que o "tempo de restore" registrado no plano de produção deve ser cronometrado por quem de fato tiver a senha no dia do cutover.

---

## Referências

- `PLANO-EXECUCAO-CUTOVER-MIGRATIONS.md` — plano executado neste ensaio (com as 2 correções acima já aplicadas)
- `RELATORIO-3-plano-de-rollback.md` — procedimento de rollback original que este ensaio valida
- `RELATORIO-4-auditoria-seguranca-migrations.md` — origem do achado sobre a tabela de debug órfã
