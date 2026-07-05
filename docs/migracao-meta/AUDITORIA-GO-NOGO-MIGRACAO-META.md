# Auditoria Formal GO/NO-GO — Migração Meta (S-WM-13 a S-WM-20 + S-WM-19)

> **Autor:** @po (Pax) · **Data:** 2026-07-05 · **Natureza:** auditoria de processo e qualidade, baseada nos Relatórios 1-4, no Plano de Execução, no Ensaio de Rollback, no Checklist de env vars, e em leitura direta de todas as stories + consultas reais ao banco de cuca-dev. **Nada aplicado em produção.**

## Veredito final: ✅ GO

> **Atualizado em 2026-07-05** após confirmação do Junior sobre o achado nº3 (Acesso CUCA) — veredito original era 🟡 GO COM RESSALVAS. Ver "Justificativa do veredito" e o Change Log desta auditoria para o histórico completo da reavaliação.

O código Meta em si (schema, migrations, rollback, env vars) já foi auditado e ensaiado com sucesso nos documentos anteriores. Esta auditoria de processo encontrou 4 lacunas reais, nenhuma condicionando o cutover: gap documental da S-WM-17 (rastreabilidade de evidência, não funcionalidade); Ouvidoria dormente (nunca funcionou, não é regressão); Acesso CUCA sem template aprovado, mas **confirmado pelo Junior sem uso real em produção hoje** (não é regressão ativa); e S-WM-15, que fica **fora do escopo desta promoção** (não commitada, não viaja no merge) e será tratada separadamente. Todos os 4 viram débito de backlog, sem prazo bloqueante.

---

## 1. Status real de QA — todas as stories da migração Meta

| Story | Status (campo real do arquivo) | Último veredito @qa | Commitada em `origin/develop`? |
|---|:---:|:---:|:---:|
| S-WM-13 (Gestão Dinâmica de Templates) | Ready for Review | PASS com CONCERNS | ✅ |
| S-WM-14 (Corpo de Texto Editável) | Ready for Review | PASS com CONCERNS | ✅ |
| **S-WM-15 (Paridade Ambiente `net.http_post`)** | **Ready** (nunca saiu do estágio inicial) | **Nunca revisada — QA Results = placeholder "Pendente, Draft"** | ❌ **Não commitada** (arquivos untracked) |
| S-WM-16 (CRUD Seguro Números/Templates) | **Done** | CONCERNS (aprovado) | ✅ |
| S-WM-17 (Dupla Gravação Motor-Agente) | InReview (nunca fechada) | CONCERNS (aprovado para push) | ✅ |
| S-WM-18 (Divulgação UAZAPI→Meta) | **Done** | CONCERNS (aprovado, 2 gates) | ✅ |
| S-WM-19 (Consolidação Débitos Técnicos) | Ready for Review (nunca fechada) | CONCERNS (aprovado) | ✅ |
| S-WM-20 (Refatoração NLU Empregabilidade) | InProgress (nunca fechada) | **PASS** (último gate, após 2 ciclos de CONCERNS→fix) | ✅ |

**Nenhuma story está em FAIL.** Nenhum achado de @qa em qualquer story foi classificado CRITICAL ou HIGH sem correção. Mas **5 das 8 stories nunca chegaram a "Done"** apesar de terem sido aprovadas para push — um gap de bookkeeping do processo (`story-lifecycle.md` exige a transição formal), não necessariamente um risco técnico.

---

## 2. Achado crítico de escopo — S-WM-15 não está na promoção, mas tem um blocker real

S-WM-15 é a única story da lista que:
1. **Nunca foi revisada por @qa** (`## QA Results` literalmente contém `_Pendente — story ainda em Draft, aguardando validação @po._`), apesar de ter 5 de 7 tasks concluídas e migrations **já aplicadas de verdade em cuca-dev** (confirmado via `list_migrations()`: `wm15_parametrizar_net_http_post`, `wm15_habilitar_pg_net`, `wm15_trigger_indexar_documento_config_table`).
2. **Não está commitada em nenhum branch** — os 3 arquivos de migration existem só localmente, untracked (`git log --all` para os 3 arquivos retorna vazio). Ou seja: **cuca-dev tem uma migration aplicada que não existe em nenhum lugar do git** — schema drift real entre o banco compartilhado e o repositório.
3. Documenta um **blocker técnico não resolvido (Task 4)**: `ALTER DATABASE`/`ALTER ROLE ... SET app.supabase_url` falha com `permission denied` — o role `postgres` do Supabase não tem superuser real. Resultado: das 4 funções de trigger que dependem de `current_setting('app.supabase_url')`, **só 1 (`trigger_indexar_documento`) tem um mecanismo alternativo funcional** (lookup na tabela `configuracoes`, aceito por Junior como divergência pontual e temporária). As outras 3 (`chamar_alerta_acesso_cuca`, `chamar_alerta_institucional`, e implicitamente `notify_candidatura_criada`) ficariam com a URL **NULL** se essa migration fosse promovida como está — uma regressão real, não hipotética, porque hoje em produção essas funções ainda usam URL hardcoded e funcionam.

**Conclusão prática:** como esses 3 arquivos nunca foram commitados, **eles não fazem parte do `main..develop` que será promovido** — confirmado via `git diff main origin/develop -- <os 3 arquivos>` (vazio). Isso **não bloqueia o cutover atual**. Mas é um achado que precisa virar ação: (a) decidir o mecanismo definitivo antes de S-WM-15 ser promovida no futuro, (b) resolver o schema drift em cuca-dev (commitar os arquivos ou reverter as migrations lá), (c) rodar `*qa-gate` nessa story antes dela avançar — ela pulou a etapa de QA inteira, violação do pipeline `@dev → @qa → @devops`.

---

## 3. Código alterado nunca exercitado com tráfego real

### 3a. Ouvidoria (worker) — nunca funcionou, não é regressão

```sql
SELECT nome, automacoes, status, ativo FROM meta_templates;
-- 6 linhas: só "Empregabilidade" e "Institucional" (Convite, Transbordo, Pontual).
-- ZERO templates para "Ouvidoria" ou "Acesso CUCA".
```

Confirmado no próprio texto da **S-WM-09** (a story que criou `_notificar_transbordo`, 2026-06-29): *"O transbordo existe em duas camadas — ambas incompletas: `conversas.status` nunca é setado... `human_handover_contacts` nunca é consultada."* Ou seja, **notificação de transbordo via WhatsApp nunca existiu para nenhum módulo antes desta story** — não é uma migração de algo que funcionava, é uma funcionalidade nova, incompleta para Ouvidoria por falta de template aprovado. **Não é regressão.** Não bloqueia o cutover.

### 3a-bis. 🔴 Acesso CUCA (edge function `alertas-institucionais`) — achado elevado: risco real de regressão silenciosa em produção

Diferente de Ouvidoria, este caminho **migrou um mecanismo que já funcionava**. A própria **S-WM-11** (2026-06-29, "Migrar Edge Function alertas-institucionais para Meta") descreve o estado anterior: *"Com UAZAPI desligado, todos os alertas somem silenciosamente"* — confirmando que os 3 tipos de alerta desta função (handover, aprovação de evento, **Acesso CUCA**) **funcionavam via UAZAPI antes do desligamento**. A própria story já registrou, na época, o prerequisito de produção:

> *"Templates Meta necessários para produção (AC3 — WAIVED aguardando aprovação): 4 templates precisam ser criados/aprovados no WABA Manager: `cuca_alerta_evento_pontual`, `cuca_alerta_handover`, `cuca_alerta_acesso_n1`, `cuca_alerta_acesso_n2`."*

**O que mudou desde então:** `cuca_alerta_evento_pontual` e `cuca_alerta_handover` (Institucional) **foram resolvidos** — confirmado na consulta acima, existem como `institucional_programacao_pontual_v1` e `institucional_transbordo_v1`, ambos `status='aprovado'`. **`cuca_alerta_acesso_n1`/`n2` (Acesso CUCA) nunca foram criados** — zero linhas para essa automação, confirmado tanto no banco quanto no comentário do próprio código (`alertas-institucionais/index.ts`): *"Nenhum template 'Acesso CUCA'+'Transbordo' existe hoje — pula graciosamente."*

**Por que isso é diferente de Ouvidoria:** o sunset do UAZAPI (`worker/uazapi_manager.py`, `worker/institucional_engine.py` deletados, confirmado no Relatório 1) **está no mesmo `main..develop` que será promovido**. Isso significa que, no momento exato do cutover, **Acesso CUCA perde o canal que funcionava (UAZAPI) sem ganhar o substituto (falta o template Meta)** — uma regressão silenciosa real, não hipotética, para quem depende hoje dessa notificação (coordenadores/secretaria aprovando solicitações de acesso via `solicitacoes_acesso.status IN ('aguardando_aprovacao_tecnica', 'aguardando_aprovacao_secretaria')`). Sem a notificação, o fluxo de aprovação pode ficar parado sem que ninguém perceba.

**Isto não é um achado novo** — é um prerequisito já documentado pela própria S-WM-11 há uma semana, que nunca foi fechado nem voltou a aparecer em nenhum gate de qualidade desde então.

> **Atualização (2026-07-05, confirmação do Junior):** Acesso CUCA **não está em uso real em produção hoje** — não há usuário dependendo desse canal, apesar do texto da S-WM-11 sugerir o contrário. Esta é informação de estado de produção que nenhum agente tem como verificar de forma independente (regra NON-NEGOTIABLE de acesso), então a confirmação do Junior é a fonte de verdade aqui. **Rebaixado de "decisão obrigatória antes do cutover" para débito de acompanhamento, sem prazo bloqueante** — a criar/aprovar os templates de Acesso CUCA depois da entrega de Institucional + Empregabilidade em produção, sem urgência.

### 3b. Código morto confirmado por @qa (S-WM-20)

Dispatch de `menu_inicial` dentro de `processar_mensagem_empregabilidade` — confirmado por @qa como **"código morto inalcançável"** (nenhum código define mais essa etapa). Achado positivo (não é risco vivo), mas registrado como candidato a limpeza futura.

### 3c. Contraste — o que FOI exercitado com tráfego real (evidência positiva)

Para calibrar o achado acima: Institucional e Empregabilidade **têm** evidência de envio real confirmada em staging — S-WM-18's 4ª fila de smoke test (`disparo_id 39452999-...`, `total_enviados=1`) e S-WM-17's validação com 3 conversas reais distintas. O gap de tráfego real é **específico de Ouvidoria/Acesso CUCA**, não um problema geral da migração.

---

## 4. Auditoria cruzada — achados de @qa revisados por @dev (e vice-versa)?

| Story | @qa encontrou algo que exigia ação do @dev? | @dev resolveu? |
|---|---|:---:|
| S-WM-16, S-WM-18, S-WM-19, S-WM-20 (Tasks 1-3 e migração das 2 etapas) | Sim, em múltiplas rodadas | ✅ Sim — cada achado teve um ciclo fix→re-gate documentado, com @qa provando empiricamente (revertendo a correção) que os testes pegam a regressão, não apenas confiando no relato do @dev |
| **S-WM-17** | Sim — "IDs citados como evidência (`a7ed60aa...`, `0abd167a...`) não existem no cuca-dev... recomendo ao @dev corrigir" | ❌ **Não.** Change Log da story termina no próprio comentário do @qa — nenhuma entrada seguinte de @dev trata o achado. Story segue em `InReview`. |

**1 lacuna real de auditoria cruzada encontrada: S-WM-17.** Não é um risco funcional (o próprio @qa confirmou a correção com IDs reais diferentes, validando os 6 ACs de forma independente) — é um gap de **rastreabilidade documental** (Artigo IV da Constitution, No Invention) que ficou aberto. Recomendo fechar antes do merge para produção: @dev corrige o Dev Agent Record com IDs reais ou remove a citação específica.

---

## 5. Checklist objetivo GO/NO-GO — cada item com evidência real

| # | Item | Evidência | Status |
|---|---|---|:---:|
| 1 | Nenhuma story em FAIL | Tabela da seção 1 — todos os vereditos são PASS ou CONCERNS | ✅ |
| 2 | Nenhum achado CRITICAL/HIGH sem correção | Revisão de todos os `QA Results` das 8 stories | ✅ |
| 3 | Migrations de produção auditadas e classificadas por risco | `RELATORIO-4-auditoria-seguranca-migrations.md` — 22 migrations, tri-lista SEGURA/VERIFICAR/NÃO-APLICAR | ✅ |
| 4 | Ordem de aplicação de migrations resolvida | `PLANO-EXECUCAO-CUTOVER-MIGRATIONS.md` — lista única ordenada, 2 achados corrigidos | ✅ |
| 5 | Rollback testado de ponta a ponta (não só documentado) | `ENSAIO-ROLLBACK-STAGING-20260705.md` — veredito BEM-SUCEDIDO, backup/restore reais confirmados | ✅ |
| 6 | Variáveis de ambiente de produção confirmadas | `CHECKLIST-VARS-PRODUCAO-CUCA-WORKER.md` — 3 variáveis, grep exaustivo, 1 correção (`META_TEMPLATES_APROVADOS` excluída) | ✅ |
| 7 | Código dormente/sem tráfego real identificado | Seção 3 — Ouvidoria: nunca funcionou, não é regressão. Acesso CUCA: sem template aprovado, mas **confirmado pelo Junior sem uso real em produção hoje** — não é regressão ativa | ✅ **Débito registrado, sem prazo bloqueante** |
| 8 | Achados de @qa todos fechados pelo @dev | Seção 4 — S-WM-17 tem 1 achado aberto (não funcional, documental) | ⚠️ **1 pendência não-bloqueante** |
| 9 | Todas as stories fecharam o pipeline `@dev→@qa→@devops` sem pular etapa | S-WM-15 pulou @qa inteiramente | 🔴 **Violação confirmada — mas fora do escopo de promoção atual** |
| 10 | Schema de cuca-dev consistente com o git (sem drift) | S-WM-15: 3 migrations aplicadas em cuca-dev, zero commits correspondentes | 🔴 **Drift confirmado — fora do escopo de promoção atual** |

---

## Justificativa do veredito (revisado 2026-07-05, pós-confirmação do Junior)

**Reavaliação: o veredito muda de GO COM RESSALVAS para GO.**

O único item que condicionava o "COM RESSALVAS" — Acesso CUCA como regressão silenciosa ativa — deixou de existir com a confirmação do Junior de que esse canal não tem uso real em produção hoje. Refazendo a contagem do que resta:

- **Nada no escopo real de promoção (`main..develop`, 22 migrations + código Meta) tem achado bloqueante não resolvido.** Os 4 relatórios anteriores + o ensaio + o checklist de env vars já cobriram e resolveram os riscos técnicos de schema, ordem de aplicação, rollback e configuração.
- **Ouvidoria (item 7) nunca funcionou** — não é regressão, é feature incompleta pré-existente.
- **Acesso CUCA (item 7) confirmado sem uso real em produção** — deixa de ser condição do veredito, vira débito de backlog sem prazo.
- **O achado documental da S-WM-17 (item 8) é real, mas não afeta funcionalidade** — é rastreabilidade de evidência (Artigo IV), não comportamento do sistema em produção.
- **Os itens 9-10 (S-WM-15) não fazem parte desta promoção** — confirmado via `git diff main origin/develop`, a story não viaja no merge. Não é um item deste cutover.

Com isso, **nenhum item remanescente condiciona ou atrasa o cutover** — os 2 que sobram (S-WM-17 documental, templates de Acesso CUCA/Ouvidoria) são débitos de acompanhamento normais, não ressalvas que a decisão de ir para produção dependa. É essa distinção — "tem item que precisa de resposta antes de marcar data" vs. "tem item para o backlog" — que separa GO COM RESSALVAS de GO puro, e o segundo é o que se aplica agora.

### Débitos para acompanhar (backlog, sem prazo bloqueante)

1. Criar/aprovar templates Meta para Acesso CUCA e Ouvidoria (sem urgência — confirmado sem uso real hoje; agendar após a entrega de Institucional + Empregabilidade em produção).
2. Fechar o achado documental da S-WM-17 (Dev Agent Record com IDs rastreáveis).
3. Tratar S-WM-15 como item separado: resolver o mecanismo de `app.supabase_url`, resolver o drift em cuca-dev, rodar `*qa-gate` — antes de cogitar promovê-la (não é pré-requisito deste cutover).
4. Fechar formalmente o status das stories que seguem em Ready for Review/InReview/InProgress apesar de aprovadas para push (bookkeeping de processo).

### Change Log desta auditoria

| Data | Agente | Ação |
|---|---|---|
| 2026-07-05 | @po (Pax) | Auditoria formal produzida — veredito inicial GO COM RESSALVAS, com Acesso CUCA como decisão obrigatória antes do cutover. |
| 2026-07-05 | @po (Pax) | Junior confirmou que Acesso CUCA não tem uso real em produção hoje — informação de estado de produção que nenhum agente verifica de forma independente. Reclassificado de "decisão obrigatória" para "débito de backlog, sem prazo". **Veredito atualizado: GO.** |

---

## Referências

- `RELATORIO-1-diff-codigo-main-vs-develop.md`, `RELATORIO-2-diff-variaveis-ambiente.md`, `RELATORIO-3-plano-de-rollback.md`, `RELATORIO-4-auditoria-seguranca-migrations.md`
- `PLANO-EXECUCAO-CUTOVER-MIGRATIONS.md`, `ENSAIO-ROLLBACK-STAGING-20260705.md`, `CHECKLIST-VARS-PRODUCAO-CUCA-WORKER.md`
- `docs/stories/S-WM-13` a `S-WM-20`, `S-WM-19` (lidas na íntegra para esta auditoria)
