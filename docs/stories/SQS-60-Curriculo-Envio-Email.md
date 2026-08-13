# SQS-60 — Envio do currículo por email (opt-in do candidato)

## Status

InReview

**Prioridade:** Média
**Tipo:** Nova Funcionalidade
**Módulo:** Empregabilidade
**Estimativa:** P (Resend já é dependência do projeto e já tem padrão de uso com anexo)
**Depende de:** SQS-58 (currículo público)
**Épico:** EPIC-EMP-VOL — Empregabilidade em Alto Volume

## Story

**Como** candidato que montou o currículo pelo link público,
**quero** poder pedir que meu currículo também chegue no meu email,
**para que** eu tenha uma cópia guardada em outro lugar além do WhatsApp/celular.

## Objetivo

Adicionar ao formulário público um checkbox opt-in ("quero receber meu currículo por email"). Só
quando marcado, o campo de email vira **obrigatório** e aparece. Ao salvar, dispara um email com o
PDF anexado, usando Resend (já em uso no projeto).

## Decisões confirmadas (Junior, 2026-08-13)

- Template do email: @dev escreve seguindo o tom institucional já usado (`enviar-cv/route.ts`) —
  **revisão acontece no PR**, não antes.
- Reenvio: dispara **só na primeira vez** que o candidato marca o checkbox e salva. Edições
  seguintes do currículo (mesmo com o checkbox continuando marcado) **não** reenviam email
  automaticamente.

## Acceptance Criteria

- [x] AC1 — Checkbox "Quero receber meu currículo por email" no formulário público, fora da seção
      de dados de contato (posição a definir na implementação — perto do "Texto de Apresentação"
      ou dados pessoais) — **implementado logo abaixo do campo E-mail**, dentro da seção Dados
      Pessoais (mais perto do campo que ele afeta do que da Apresentação)
- [x] AC2 — Campo de email só é exigido (obrigatório, com validação de formato) quando o checkbox
      está marcado. Desmarcado, o campo continua opcional (o `CvDados.email` já existe e é livre)
- [x] AC3 — Ao salvar com o checkbox marcado **pela primeira vez**, dispara email via Resend com o
      PDF do currículo anexado, template simples (nome do candidato, confirmação de recebimento
      pelo banco de talentos, sem prometer prazo)
- [x] AC4 — Em edições seguintes do mesmo currículo (checkbox continua marcado), **não** reenvia
      email — flag `talent_bank.email_enviado_em` (migration aplicada em produção)
- [x] AC5 — Falha no envio do email não pode quebrar o salvamento do currículo (mesmo princípio de
      resiliência do PDF/DOCX — best-effort, log de erro)
- [x] AC6 — Rate-limit por telefone (já existe, SQS-58 AC7) cobre também esse novo caminho — a
      rota de email não é um endpoint separado, roda dentro do mesmo `POST /curriculo/publico` já
      protegido pelo rate-limit existente (não precisou de um rate-limit dedicado)

## ⚠️ Análise de impacto — por item

### Item 1 — Novo campo obrigatório condicional

- **Toca:** formulário público (`page.tsx`), validação client-side e server-side (`route.ts`
  público).
- **Depende de:** nada quebra — `CvDados.email` já existe no tipo, só passa a ser
  condicionalmente obrigatório.
- **Impacto real:** nenhum sobre quem não marcar o checkbox — fluxo idêntico ao de hoje.

### Item 2 — Envio de email via Resend

- **Toca:** rota `POST /api/empregabilidade/curriculo/publico` (SQS-58) ou uma sub-rota dedicada.
- **Consome hoje:** `RESEND_API_KEY` já configurada em produção (usada por `enviar-cv/route.ts`,
  `enviar-cv-lote/route.ts`) — reaproveitar a mesma configuração, não criar uma nova.
- **Impacto real:** nenhum sobre os outros usos do Resend (é uma chamada adicional, mesmo
  remetente/domínio verificado).
- **De-risk:** seguir exatamente o padrão de anexo em Buffer já usado em `enviar-cv/route.ts`
  (fetch do PDF → Buffer → `attachments`), não inventar mecanismo novo.

### Item 3 — Rastrear "primeira vez" pra não reenviar em edição

- **Toca:** schema — precisa de uma coluna nova (`talent_bank.email_enviado_em timestamptz` ou
  equivalente) via migration idempotente.
- **Impacto real:** nenhum sobre dados existentes (coluna nova, nullable, default null).
- **De-risk:** `execute_sql` antes de aplicar, confirmar que não há coluna com nome parecido já
  fazendo algo diferente.

## Fora de escopo (explícito)

| Item | Motivo |
|---|---|
| Reenvio manual pelo candidato (botão "reenviar email") | Não solicitado — se precisar depois, o candidato edita o currículo (não reenvia) ou pede pela equipe CUCA |
| Emails de acompanhamento futuros (ex: quando uma vaga compatível aparecer) | Fora do escopo desta story — é sobre a confirmação inicial |
| Envio por email pro formulário interno do dashboard | Não pedido — o item era só pro fluxo público |

## Riscos

1. **Email como vetor de PII adicional.** O formulário público já lida com dado sensível
   (currículo completo, pode incluir menor de idade — mesmo risco da SQS-58); email é mais um
   campo de PII coletado condicionalmente. Mitigação: só coleta/usa quando o candidato opta
   explicitamente (AC1/AC2), nunca por padrão.
2. **Domínio de envio não verificado no Resend rejeita silenciosamente.** Se o domínio remetente
   não estiver com SPF/DKIM ok, o Resend pode aceitar a chamada e o email nunca chegar (cai em
   spam ou é descartado) sem erro visível pro candidato. Mitigação: AC5 (falha não quebra o
   salvamento) cobre o caso de erro *explícito*; recomendo @qa confirmar em produção com um envio
   real de teste, não só mockado.
3. **Coluna nova em `talent_bank` pode colidir com nome já usado em outro contexto.** Mitigação já
   descrita no Item 3 da análise de impacto (`execute_sql` antes de aplicar).

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-08-13 | @sm | Criação a partir de pedido do Junior pós-demo com sócio/gestores |
| 2026-08-13 | @po | **Validação: GO (9/10)** — 10 pontos ok, exceto Riscos (ausente na versão inicial, adicionado nesta validação). Status `Draft` → `Ready` |
| 2026-08-13 | @dev | Implementado: migration `talent_bank.email_enviado_em` aplicada em produção via MCP (`execute_sql` confirmou ausência de coluna colidente antes de aplicar); checkbox + validação condicional no formulário público; envio via Resend (mesmo remetente/domínio de `enviar-cv/route.ts`) dentro da própria rota `/curriculo/publico`, sem rota nova — best-effort, nunca derruba o salvamento. `eslint`/`tsc` limpos. Status `Ready` → `InReview` |

## File List

- `supabase/migrations/20260813000000_sqs60_curriculo_email_enviado.sql` (novo, aplicado em produção)
- `cuca-portal/src/app/api/empregabilidade/curriculo/publico/route.ts`
- `cuca-portal/src/app/empregabilidade/curriculo/page.tsx`

## QA Results

### Review em 2026-08-13 — @qa Quinn

**Gate:** PASS COM CONCERNS

**7 checks:**

1. **Code review** — implementação enxuta, reaproveita a rota existente em vez de criar uma nova
   (AC6 fica trivialmente atendido — mesmo rate-limit). Comentários explicam as decisões (opt-in
   fora do `CvDados`, best-effort). OK.
2. **Testes** — `eslint`/`tsc` conferidos de novo nesta revisão, limpos (mesmos 4 erros
   pré-existentes do projeto, não relacionados). Sem suíte automatizada pra esta rota, mesmo
   padrão já aceito nas stories anteriores (`ouvidoria/insights`, `gerar-apresentacao` etc.).
3. **Acceptance Criteria** — AC1-AC6 verificados por leitura de código. AC1 tem um desvio
   documentado e razoável (checkbox abaixo do campo E-mail, não perto da Apresentação como o
   rascunho original sugeria) — mais intuitivo, não é motivo de reprovação.
4. **Regressão** — `talent` agora seleciona `email_enviado_em` além de `id`; não haveria impacto
   em nenhum outro consumidor dessa query (é local à função, não exportada). O bloco de email é
   aditivo, dentro de um `if` que só roda quando `receber_email === true` — candidatos que não
   marcam o checkbox têm o mesmo comportamento de antes, confirmado por leitura do fluxo.
5. **Performance** — best-effort, não bloqueia a resposta em caso de erro. Adiciona 1 fetch (baixar
   o PDF recém-gerado) + 1 chamada Resend + 1 update síncronos ao tempo de resposta do submit
   quando o checkbox está marcado — aceitável, mesmo princípio já aceito na SQS-63 (decisão de
   gerar tudo no submit).
6. **Segurança** — nenhuma superfície pública nova (mesma rota, mesma validação de link/rate-limit
   de antes). E-mail só é usado quando o próprio candidato informa e opta.
   **Achado CONCERNS, não-bloqueante:** existe uma corrida (TOCTOU) entre a leitura de
   `email_enviado_em` (início da função) e o update que a marca (depois do envio) — dois submits
   quase simultâneos do mesmo currículo (ex.: duplo clique que escapasse do `disabled={saving}` do
   botão, ou duas abas abertas) poderiam, em teoria, os dois lerem `null` e os dois enviarem
   email. Efeito prático é baixo (candidato recebe o mesmo email 2x, não é dado incorreto nem
   duplicação de registro) — não bloqueia, mas registro a sugestão de trocar o
   `select` + `update` separados por um único `UPDATE talent_bank SET email_enviado_em = now()
   WHERE id = $1 AND email_enviado_em IS NULL RETURNING id` (update condicional atômico) se algum
   dia isso incomodar de verdade.
7. **Documentação** — story atualizada (ACs, File List, Change Log).

**Sobre o teste de envio real (Risco #2 da própria story):** não executei um envio real de teste
nesta revisão — disparar um email de produção é uma ação com efeito colateral real (usa cota do
Resend, chega numa caixa de entrada de verdade) e não é algo que eu decida sozinho sem pedir.
Recomendo que você (ou quem for testar manualmente a SQS-58/60 depois do merge) marque o checkbox
com um email de teste real e confirme que a mensagem chega (não cai em spam) — é o jeito mais
direto de fechar esse risco, mais confiável que eu simular por fora.

**Decisão:** aprovar para seguir ao @devops. Nenhum achado é bloqueante.
