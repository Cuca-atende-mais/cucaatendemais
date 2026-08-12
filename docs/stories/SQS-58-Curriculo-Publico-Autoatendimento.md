# SQS-58 — Currículo por autoatendimento (link público seguro)

## Status

Ready — ⛔ **bloqueada para início** até SQS-57 estar `Done` (dependência técnica, não de validação)

**Prioridade:** Média-Alta
**Tipo:** Nova Funcionalidade
**Módulo:** Empregabilidade
**Estimativa:** **M-L** (formulário público + rota de escrita com service role + rate-limit + rota de
download com token + fail-closed). É a story de **maior risco de PII** do épico — o peso está na
segurança, não no volume de código
**Depende de:** SQS-57 (geração de PDF + `skills_jsonb`) — **bloqueante**
**Épico:** [EPIC-EMP-VOL — Empregabilidade em Alto Volume](EPIC-EMP-VOL-Empregabilidade-Alto-Volume.md)
(criado por @pm e **ratificado pelo Junior** em 2026-08-11)

## Executor Assignment

```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - teste de link assinado: expirado, adulterado, parâmetro trocado (deve recusar nos 3)
  - teste de rate-limit por telefone
  - teste de download: token reusado deve falhar
  - mcp supabase execute_sql (confirmar que talent_bank/curriculos recebem escrita só via rota validada)
  - verificar que /empregabilidade/print/[id] segue FORA da whitelist do middleware
  - confirmar EMPREGABILIDADE_LINK_SECRET setada nos dois serviços antes do fail-closed
  - npm run lint && npm run typecheck
```

## 🤖 CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI is not enabled in `core-config.yaml`.
> Quality validation will use manual review process only.
> To enable, set `coderabbit_integration.enabled: true` in core-config.yaml

## Story

**Como** candidato sem currículo pronto,
**quero** montar o meu pelo celular a partir de um link que o CUCA me manda no WhatsApp,
**para que** eu consiga me candidatar sem precisar ir presencialmente pedir ajuda à equipe.

**Como** equipe de Empregabilidade,
**quero** que o candidato monte o próprio currículo,
**para que** eu pare de digitar currículo um a um e o banco de talentos cresça sozinho.

**Como** responsável pelos dados do CUCA,
**quero** que esse acesso público seja limitado no tempo, amarrado a um telefone verificado e sem URL
permanente,
**para que** não se repita a exposição de currículos ocorrida em 2026-08-05.

---

## Objetivo

Permitir que o próprio candidato monte seu currículo, sem criar login, a partir de um link seguro.
Ao salvar, o currículo entra no banco de talentos (estruturado + PDF, concorrendo na triagem da IA) e
o candidato recebe o PDF para guardar no celular.

---

## Contexto

Hoje só a equipe do CUCA monta currículo, pelo dashboard. A demanda é abrir isso ao público sem
sacrificar segurança — e sem exigir cadastro/senha, que afastaria o público-alvo.

**O mecanismo de segurança já existe e está ativo:** `lib/empregabilidade/link-assinado.ts` implementa
HMAC-SHA256 + expiração (`exp`) + comparação *timing-safe* + canonicalização de parâmetros. Já é usado
em 4 fluxos públicos (vaga nova, edição, candidatura, seleção). **Verificado em produção:** dos links
de portal enviados nos últimos 90 dias, 2 de 2 carregam `sig=` — o segredo está configurado e o
mecanismo não é código morto.

---

## Decisão de arquitetura — link emitido pelo bot, não link solto

Os 4 links assinados existentes funcionam porque **amarram a um id que o bot já conhece**
(`empresa_id`, `vaga_id`). Um link de "criar currículo" não tem entidade prévia — então HMAC sozinho
apenas *time-boxa* uma URL que qualquer pessoa pode repassar, sem impedir enchimento do banco de
talentos com lixo.

**O autenticador já existe e não está sendo usado: o WhatsApp.** O número chega verificado pela Meta.

```
candidato fala com o bot → cria/recupera a linha do candidato
                         → bot devolve link assinado, TTL curto, amarrado àquele id
                         → identidade = telefone verificado, sem login
```

É o mesmo padrão já em produção para empresas. Uma variante aberta (QR em cartaz na unidade) é
**fase 2**, com rate-limit e proteção anti-bot próprios — não entra nesta story.

---

## Acceptance Criteria

- [ ] AC1 — O bot emite link assinado, com TTL curto, amarrado ao candidato identificado pelo telefone verificado
- [ ] AC2 — Formulário público com os mesmos campos do "Criar Currículo" interno
- [ ] AC3 — Link expirado/adulterado → recusa explícita, sem vazar dado
- [ ] AC4 — Ao salvar: cria/atualiza `talent_bank` + `curriculos`, gera PDF e popula `skills_jsonb` (via SQS-57)
- [ ] AC5 — O candidato recebe o PDF para download em arquivo real (funciona no celular)
- [ ] AC6 — O download usa **token assinado de uso único e TTL curto** — **não** reabrir `/empregabilidade/print/[id]`
- [ ] AC7 — Rate-limit por telefone para impedir criação em massa
- [ ] AC8 — O currículo criado concorre normalmente na triagem da IA
- [ ] AC9 — Fluxo interno de "Criar Currículo" segue funcionando sem alteração
- [ ] AC10 — `link-assinado.ts` passa a ser **fail-closed**

---

## ⚠️ ANÁLISE DE IMPACTO — por item

### Item 1 — 🔴 A RPC atual NÃO pode ser reusada em contexto público

- **Toca:** gravação do currículo.
- **Constatação:** `salvar_curriculo_estruturado` é `SECURITY DEFINER` mas valida
  `has_permission('empreg_curriculos','create'/'update')` **do usuário chamador**. Um candidato
  anônimo não tem permissão → a chamada levanta exceção `42501`.
- **Consequência:** chamar essa RPC do formulário público **não funciona**. E afrouxar a permissão
  dela seria abrir escrita de currículo para qualquer sessão — inaceitável.
- **Caminho correto:** rota de API com service role que **primeiro** valida o link assinado e só então
  grava — exatamente o padrão de `api/empregabilidade/candidaturas/route.ts`.
- **Impacto no fluxo interno:** nenhum. A RPC permanece como está, servindo o dashboard.

### Item 2 — Rota pública de escrita em `talent_bank` / `curriculos`

- **Consome hoje:** tabelas que só recebem escrita autenticada.
- **Impacto real:** passa a existir um caminho de escrita alcançável de fora. Sem rate-limit, é porta
  de entrada para poluir o banco de talentos — o que degradaria a triagem da IA (item que a SQS-57
  acabou de consertar).
- **De-risk:** rate-limit por telefone (AC7) + link amarrado a id conhecido (AC1). As duas coisas
  juntas, não uma só.

### Item 3 — 🔴 Rota de download do PDF

- **Toca:** entrega do PDF ao candidato.
- **Histórico que não pode se repetir:** `/empregabilidade/print/[id]` **foi removido da whitelist
  pública em 2026-08-05** após incidente documentado em
  `docs/qa/DIAGNOSTICO-exposicao-anon-curriculos-2026-08-05.md` — estava público somado a policy
  `USING (true)` em `curriculos`, expondo dados pessoais na internet aberta.
- **Impacto real:** um `/print/{uuid}` estável e público **recria exatamente aquele vazamento**.
- **De-risk:** token assinado de uso único, TTL curto, emitido no momento do salvamento. Nunca URL
  estável por id. A rota antiga permanece fora da whitelist.

### Item 4 — `link-assinado.ts` fail-open → fail-closed

- **Toca:** `lib/empregabilidade/link-assinado.ts:30` — hoje `if (!SECRET) return { valido: true }`.
- **Consome hoje:** os 4 fluxos públicos já existentes.
- **Impacto real:** se a variável de ambiente sumir num redeploy, **toda** validação passa a aprovar
  tudo, silenciosamente. O segredo está setado hoje — isso não é garantia entre deploys.
- **⚠️ Atenção:** inverter para fail-closed **afeta os 4 fluxos existentes**, não só o novo. Se a env
  faltar, eles passam a recusar em vez de liberar. É o comportamento correto, mas é mudança de
  comportamento em produção — validar que a env está setada nos dois serviços antes de aplicar.

### Item 5 — Formulário público

- **Impacto real:** nenhum sobre o interno, desde que seja **página separada**, e não a de dashboard
  liberada no middleware. A whitelist em `lib/supabase/middleware.ts` tem comentário explícito
  alertando para esse erro exato (já cometido uma vez).

---

## Tasks

- [ ] T1 — Emissão do link assinado pelo bot (worker), TTL curto
- [ ] T2 — Página pública do formulário (fora do route group `(dashboard)`)
- [ ] T3 — Rota de API (service role) com validação de link + rate-limit
- [ ] T4 — Integração com a geração de PDF/skills da SQS-57
- [ ] T5 — Rota de download com token de uso único
- [ ] T6 — Fail-closed no `link-assinado.ts` + verificar env nos dois serviços
- [ ] T7 — Adicionar a rota pública à whitelist do middleware — **apenas** ela
- [ ] T8 — Testes: link expirado, link adulterado, rate-limit, download reusado

---

## Riscos

1. **Maior superfície de PII da story.** Currículo completo, de público que inclui menores de idade,
   gravável de fora. Cada AC de segurança aqui é requisito, não refinamento.
2. **Reincidência do incidente de agosto** se o download virar URL estável.
3. **Fail-closed** pode derrubar fluxos existentes se a env não estiver setada — verificar antes.

---

## Fora de escopo (explícito)

| Item | Motivo / onde vive |
|---|---|
| **Variante QR aberta** (cartaz na unidade, sem bot) | Fase 2. Sem telefone verificado, exige captcha + rate-limit próprio — risco diferente, decisão à parte |
| Geração de PDF e derivação de `skills_jsonb` | SQS-57 (dependência bloqueante) |
| Reabrir `/empregabilidade/print/[id]` ao público | **Proibido** — causou o incidente de 2026-08-05 |
| Afrouxar `has_permission` da RPC `salvar_curriculo_estruturado` | **Descartado** — abriria escrita de currículo para qualquer sessão |
| Login/cadastro do candidato | Contraria o objetivo (afastaria o público-alvo) |
| Edição posterior do currículo pelo candidato | Não solicitado; avaliar depois |

---

## Dev Notes

### Por que a RPC existente não serve (achado verificado)

`salvar_curriculo_estruturado` é `SECURITY DEFINER`, **mas** valida
`has_permission('empreg_curriculos','create'/'update')` **do usuário chamador** e levanta
`ERRCODE 42501` quando não há permissão. Candidato anônimo não tem nenhuma → a chamada falha.

**Caminho correto:** rota de API com service role que valida o link assinado **antes** de gravar.
Padrão idêntico ao já praticado em `api/empregabilidade/candidaturas/route.ts` (linhas 33-43:
`verificarLinkParams` + conferência de telefone antes de qualquer escrita).

### Mecanismo de link assinado — o que já existe

`cuca-portal/src/lib/empregabilidade/link-assinado.ts`:

| Recurso | Linha |
|---|---|
| HMAC-SHA256 sobre parâmetros canonicalizados | 40-41 |
| Expiração (`exp`) | 36-38 |
| Comparação *timing-safe* | 18-27 |
| **Fail-open a corrigir** (`if (!SECRET) return { valido: true }`) | **30** |

Emissão no worker: `_assinar_link_portal` (`worker/empregabilidade_engine.py:65`), TTL padrão 48h.
Para esta story o TTL deve ser **curto** — currículo carrega PII, o caso de uso é imediato.

### Onde tudo se conecta

| Necessidade | Peça existente |
|---|---|
| Criar a linha do candidato | RPC `criar_candidato_curriculo(nome, telefone, data_nascimento, area)` |
| Persistir dados | `talent_bank` + `curriculos.dados` (jsonb) |
| Gerar/armazenar PDF | SQS-57 (`uploadToR2`) |
| Whitelist de rotas públicas | `cuca-portal/src/lib/supabase/middleware.ts:46-49` — adicionar **apenas** a rota nova |
| Normalizar telefone | `normalizar_telefone` (campanhas_engine), já reusado na engine:1708 |

### Atenção no fail-closed (AC10)

Inverter a linha 30 **afeta os 4 fluxos públicos já em produção** (vaga nova, edição, candidatura,
seleção), não só o novo. Com a env ausente, eles passariam a **recusar** em vez de liberar. É o
comportamento correto, mas precisa de verificação prévia da variável nos dois serviços do EasyPanel —
não é mudança para aplicar às cegas.

---

## Dev Agent Record

### Agent Model Used
_A preencher pelo @dev._

### Debug Log References
_A preencher pelo @dev._

### Completion Notes List
_A preencher pelo @dev._

### File List
_A preencher pelo @dev._

---

## QA Results

_A preencher pelo @qa._

---

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-08-11 | @sm | Criação. Reordenada para depender da SQS-57 após decisão do Junior sobre gerar PDF |
| 2026-08-11 | @pm | Vinculada ao épico EPIC-EMP-VOL |
| 2026-08-11 | @sm | Correções de template (mesmas aplicadas em SQS-56/57): Status como seção, Executor Assignment, Story em Como/quero/para que, aviso de CodeRabbit desabilitado, estimativa M-L, Fora de escopo (inclui QR aberto como fase 2), Dev Notes, Dev Agent Record, QA Results |
| 2026-08-11 | @po | **Validação: GO (10/10)** — template completo, épico ratificado. Status `Draft` → `Ready`, porém **bloqueada para início** até SQS-57 concluir |
