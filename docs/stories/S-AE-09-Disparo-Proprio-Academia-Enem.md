# S-AE-09 — Disparo de Avisos Próprio da Academia Enem (com IA Validadora + Ciclo de Template Meta)

## Status
Ready

## ⚠️ Story reescrita em 2026-08-20 — mudança de provider e confirmação de escopo próprio
Provider trocado de AuctaFlux para Meta oficial direta (serviço `cuca-academia-enem`, S-AE-02). **Confirmado pelo Junior (2026-08-20): este módulo de disparo é PRÓPRIO e SEPARADO** — não reaproveita a fila/tela de `eventos_pontuais`/`disparos_divulgacao` do Institucional/Divulgação. Fica dentro do próprio menu "Academia Enem", com regras, filtros e KPIs distintos. Isso é uma decisão de produto do Junior, mesmo sendo diferente da recomendação original do levantamento técnico (que sugeria reaproveitar a fila do Institucional) — registrado aqui para rastreabilidade.

## Story
**Como** responsável pela Academia Enem,
**quero** criar minha própria mensagem de aviso, ter uma IA que a valide como template de "utilidade" da Meta antes do disparo, e disparar para o público certo dentro do próprio menu da Academia Enem,
**para que** os avisos saiam em conformidade (sem promoção/venda) e cheguem só a quem interessa, sem depender da tela/fila do Institucional.

## Contexto
Inspira-se na Divulgação (`cuca-portal/src/app/(dashboard)/divulgacao`, `worker/campanhas_engine.py`) como **referência de padrão de UX**, mas constrói uma fila e uma tela **próprias** da Academia Enem — decisão explícita do Junior de manter a base, o disparo, o RAG e os atendimentos da Academia Enem **distintos**, mesmo usando o mesmo banco de dados por baixo.

## Regras Meta (não inventar)
- Disparo proativo (fora da janela de 24h) só com template aprovado: envio via Graph API `POST /{phone_number_id}/messages` com `type=template`.
- Categoria exigida = `UTILITY` (sem promoção/venda).
- Ciclo assíncrono de aprovação de template pela própria Meta (`PENDING → APPROVED/REJECTED`), rastreado em `meta_templates.status`.
- Volume controlado por `messaging_limit_tier` do número da Academia Enem (ver S-WM-67 — correção do cálculo do teto diário, aplicada a todos os números, inclusive este).

## Escopo
### IN
- **Tela de criação de aviso PRÓPRIA** dentro do menu Academia Enem (rota protegida por `ae_disparo:create`).
- **IA validadora (pré-check):** classifica se o texto se enquadra como `UTILITY`. Se não conforme, bloqueia, explica o motivo e sugere correção.
- **Ciclo de template:** ao aprovar o texto, submeter à Meta (categoria `UTILITY`); rastrear status e exibir ao operador; só libera disparo quando `APPROVED`.
- **Seleção de público — fontes próprias da Academia Enem:** leads com tag "Academia Enem" (S-AE-08), segmento por frequência (S-AE-07/S-AE-11), e leads importados via planilha (S-AE-13, novo). Default: leads com tag Academia Enem.
- **Dedup por telefone normalizado** ao unir públicos de mais de uma fonte.
- **Fila e registro de envio PRÓPRIOS** da Academia Enem (tabela nova, ex. `disparos_academia_enem` — nome final a definir pelo @architect/@dev; não reaproveita `disparos_divulgacao`/`eventos_pontuais`), com status por lead, contagem de sucesso/erro, e breadcrumb do último aviso enviado por conversa (para o classificador S-AE-10 poder responder perguntas sobre o aviso).
- **KPIs próprios do módulo:** quantos avisos disparados, taxa de entrega/erro, próxima janela permitida.

### OUT
- Reaproveitamento de `eventos_pontuais`/`disparos_divulgacao` — explicitamente descartado nesta rodada por decisão de produto.
- Flyer/mídia — fora de escopo (só texto/template).
- Classificação da resposta do lead ao aviso (S-AE-10).

## Critérios de Aceite (Given/When/Then)
1. **Given** um texto com viés promocional, **when** o cliente submete, **then** a IA reprova, explica o motivo e sugere correção `UTILITY`.
2. **Given** um texto conforme, **when** aprovado, **then** é submetido à Meta e fica `PENDING`; a UI mostra o status.
3. **Given** template `PENDING`, **when** o cliente tenta disparar, **then** o disparo é bloqueado até `APPROVED`.
4. **Given** template `APPROVED` e um público selecionado, **when** dispara, **then** as mensagens saem via `meta_adapter_outbound` (Graph API, mesmo mecanismo dos outros canais) e o breadcrumb do aviso é gravado por conversa.
5. **Given** nenhum público escolhido, **then** o disparo usa o default (tag Academia Enem).
6. **Given** públicos de mais de uma fonte com sobreposição, **then** cada contato recebe uma única mensagem (dedup por telefone).
7. **Given** um usuário sem `ae_disparo:create`, **then** a tela/rota fica bloqueada.
8. **Given** o teto diário do número da Academia Enem (S-WM-67), **when** o disparo ultrapassaria o limite do dia, **then** o envio é contido/pausado, não silenciosamente ignorado.

## Dev Notes — análise de impacto (item por item)
1. **Toca:** envio via `meta_adapter_outbound` (mesma função Python já usada por Institucional/Empregabilidade para enviar template).
   **Depende disso hoje:** `campanhas_engine.py` (Institucional/Divulgação) e `empregabilidade_engine.py` já chamam essa função.
   **Impacto real:** nenhum — é reuso de leitura, sem alterar a função; o disparo da Academia Enem só passa a ser mais um chamador. Precisa confirmar a assinatura da função aceita o `phone_number_id` da Academia Enem sem hardcode de outro número.
2. **Toca:** tabela nova (`disparos_academia_enem` ou nome equivalente) — schema **novo**, não compartilhado.
   **Depende disso hoje:** nada — tabela nova, sem consumidor externo.
   **Impacto real:** nenhum em outros módulos. Isolamento correto por desenho (é exatamente o que o Junior pediu: fila própria).
3. **Toca:** teto diário de envio (S-WM-67) — código compartilhado (`_get_daily_limit_by_phone_sync`).
   **Depende disso hoje:** Institucional, Empregabilidade, Divulgação já usam esse cálculo.
   **Impacto real:** a correção (S-WM-67) é aplicada a todos os números — inclusive o da Academia Enem. Como o cálculo já é por `phone_number_id`, a Academia Enem ganha proteção própria sem risco de misturar teto com os outros canais.
   **De-risk:** ver S-WM-67 (story própria, cross-módulo).

## Tasks
- [ ] Migration da tabela própria de disparo da Academia Enem (nome a definir).
- [ ] Tela de criação de aviso (rota `ae_disparo:create`).
- [ ] IA validadora (pré-check `UTILITY`).
- [ ] Ciclo de submissão/rastreio de template Meta.
- [ ] Seleção de público (tag + frequência + planilha, com dedup).
- [ ] Envio via `meta_adapter_outbound` + breadcrumb por conversa.
- [ ] Tela de KPIs do módulo.

## Dependências
Depende de **S-AE-00** (fundação), **S-AE-02** (serviço/número Meta), **S-AE-08** (tag de leads), **S-AE-07/S-AE-11** (frequência), **S-AE-13** (leads via planilha). Consumida pelo breadcrumb usado em **S-AE-10**.

## Quality Gate
- Tipo: backend + IA + front. Agentes: @architect (schema da fila própria), @qa. CodeRabbit: foco em no-invention da IA validadora, dedup, e confirmação de que a fila própria não colide com `disparos_divulgacao`/`eventos_pontuais`.

## File List
_A preencher pelo @dev._

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação da story (Draft) |
| 2026-08-20 | @sm (River) | **Reescrita (decisão do Junior, migração Meta direta):** provider trocado para Meta oficial; **confirmado módulo de disparo próprio e separado** (não reaproveita fila do Institucional); nova tabela própria de fila; inclui fonte de público via planilha (S-AE-13) e nota de dependência do teto diário (S-WM-67). Status permanece Draft. |
| 2026-08-20 | @po (Pax) | **Validação (GO condicional, 7/10) → Status Draft→Ready.** Decisão de produto do Junior respeitada sem questionamento. Único ponto em aberto, não-bloqueante: o nome final da tabela própria de fila fica a critério do @architect/@dev na implementação — story já sinaliza isso explicitamente ("nome a definir"), não é uma lacuna escondida. |
