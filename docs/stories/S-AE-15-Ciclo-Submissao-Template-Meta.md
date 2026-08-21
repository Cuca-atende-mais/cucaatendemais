# S-AE-15 — Ciclo de Submissão e Rastreio de Template Meta (Academia Enem)

## Status
Ready

## Contexto (por que esta story existe)
Nasceu de um split da **S-AE-09** (2026-08-20, decisão do Junior) — ver Change Log da S-AE-09
para o histórico completo do achado. O @dev confirmou, via `grep -rn "message_templates"` em todo
o repositório, que **nunca existiu submissão programática de template à Meta** neste projeto:
todos os templates cadastrados até hoje (Institucional, Empregabilidade, Ouvidoria, Acesso CUCA)
foram criados **manualmente na Business Manager** e só *confirmados* via `GET
/{waba_id}/message_templates` antes de serem registrados em `meta_templates` por migration
manual. Esta story é, portanto, **integração nova** com a Graph API — não reuso de nada existente
— e precisa ser tratada com o rigor correspondente (não é "só mais um chamador" de uma função já
testada em produção).

## Story
**Como** responsável pela Academia Enem,
**quero** que o texto validado pela IA (S-AE-14) seja submetido automaticamente à Meta como
template `UTILITY`, e acompanhar o status de aprovação sem precisar entrar na Business Manager,
**para que** o ciclo de "escrever aviso → aprovar → disparar" fique inteiro dentro do portal.

## Regras Meta (não inventar — confirmar contra a documentação oficial da Graph API antes de
implementar, não assumir a partir de padrões de outras APIs)
- Submissão: `POST /{waba_id}/message_templates`, categoria `UTILITY`.
- Ciclo de status é **assíncrono** e controlado pela Meta: `PENDING → APPROVED` ou
  `PENDING → REJECTED` (com motivo). O tempo de aprovação não é controlado pelo Cuca.
- A Meta pode notificar mudança de status via **webhook de template status update** (evento
  `message_template_status_update` na assinatura do webhook) — **confirmar antes de implementar**
  se esse evento já está incluído na assinatura de webhook atual do app Meta da Academia Enem, ou
  se precisa ser habilitado. Se não for viável usar webhook, a alternativa é polling periódico via
  `GET /{waba_id}/message_templates` — **esta decisão (webhook vs. polling) é do @architect**,
  não deve ser assumida de antemão nesta story.

## Escopo
### IN
- Ao aprovar o texto na S-AE-14, submeter automaticamente (ou com confirmação explícita do
  operador) via `POST /{waba_id}/message_templates`.
- Registrar o template em `meta_templates` com `status='pendente'` assim que a submissão for
  aceita pela Meta (não confundir "Meta aceitou a submissão" com "Meta aprovou o conteúdo" — são
  eventos diferentes).
- Mecanismo de atualização de status (webhook ou polling, decisão do @architect) que reflete
  `PENDING → APPROVED/REJECTED` em `meta_templates.status`.
- Exibir o status atual ao operador na tela de disparo da Academia Enem (S-AE-09), incluindo o
  motivo em caso de `REJECTED`.
- Só liberar o template para uso em disparo (S-AE-09) quando `status='aprovado'`.

### OUT
- Validação de compliance do texto (S-AE-14, já feita antes de chegar aqui).
- Fila/envio/público (S-AE-09).
- Edição de template já aprovado (fora de escopo — um template aprovado é imutável na Meta;
  mudança de texto exige novo template).

## Critérios de Aceite (Given/When/Then)
1. **Given** um texto aprovado pela IA validadora (S-AE-14), **when** submetido, **then** a Meta
   aceita a submissão e o template fica `pendente` em `meta_templates`, associado ao
   `phone_number_id`/`waba_id` da Academia Enem.
2. **Given** um template `pendente`, **when** a Meta aprova, **then** o status em
   `meta_templates` reflete `aprovado` sem intervenção manual, e o template passa a aparecer como
   opção disponível na tela de disparo (S-AE-09).
3. **Given** um template `pendente`, **when** a Meta rejeita, **then** o status reflete
   `rejeitado` com o motivo visível ao operador (não só um log interno).
4. **Given** a submissão à Meta falhar (erro de rede/API, não rejeição de conteúdo), **then** o
   operador vê um erro claro e pode tentar novamente — sem criar um registro `pendente` fantasma
   em `meta_templates` que nunca foi de fato aceito pela Meta.
5. **Given** um usuário sem a mesma permissão de disparo da Academia Enem (`ae_disparo` ou
   equivalente — a definir se é a mesma permissão da S-AE-09 ou uma nova), **then** não consegue
   submeter template.

## Dev Notes — análise de impacto (item por item)
1. **Toca:** `meta_templates` — tabela compartilhada com Institucional/Empregabilidade/
   Ouvidoria/Acesso CUCA.
   **Depende disso hoje:** os 4 módulos já cadastrados leem essa tabela para escolher template de
   envio (`_notificar_transbordo`, `campanhas_engine.py`).
   **Impacto real:** um `INSERT`/`UPDATE` novo, restrito ao(s) `phone_number_ids`/`waba_ids` da
   Academia Enem, é aditivo — não deveria afetar templates de outros módulos, DESDE que a query
   de submissão/atualização sempre filtre pelo `phone_number_id`/`waba_id` certo (mesmo cuidado
   já aplicado na S-AE-06 para `transbordo_humano`).
   **De-risk concreto:** antes de implementar o mecanismo de atualização de status (webhook ou
   polling), confirmar que ele identifica de forma inequívoca A QUAL módulo/waba_id o evento de
   status pertence — um webhook de template status mal filtrado poderia, em tese, atualizar o
   status errado se dois módulos tiverem templates com nomes parecidos (mitigar filtrando sempre
   por `waba_id`, nunca só por nome de template).
2. **Toca:** webhook Meta (se a decisão do @architect for usar webhook de status de template, não
   polling) — pode exigir handler novo em `worker/main.py`/`meta_adapter_inbound.py`, ou pode ser
   um evento diferente do webhook de mensagens já existente (`/webhook/meta`) — **confirmar contra
   a documentação oficial antes de assumir que é o mesmo endpoint**.
   **Impacto real:** depende inteiramente da decisão de desenho do @architect — não estimar aqui.

## Tasks
- [ ] @architect: decidir webhook vs. polling para atualização de status, documentando o porquê.
- [ ] Função de submissão (`POST /{waba_id}/message_templates`), com tratamento de erro que não
  cria registro fantasma em falha de rede/API (AC4).
- [ ] Mecanismo de atualização de status (conforme decisão do @architect).
- [ ] UI: status visível + motivo de rejeição na tela de disparo (S-AE-09).
- [ ] RBAC de submissão (confirmar se reaproveita `ae_disparo` ou é permissão nova).
- [ ] Testes com mock da Graph API (sem depender de submissão real durante a suíte automatizada).

## Dependências
Depende de **S-AE-14** (texto validado antes de submeter) e **S-AE-02** (credenciais/`waba_id` da
Academia Enem). Libera templates para uso em **S-AE-09**.

## Quality Gate
- Tipo: backend (integração Graph API nova) + front. Agentes: @architect (decisão webhook vs.
  polling), @qa. CodeRabbit: foco em (a) filtro correto por `waba_id`/`phone_number_id` (evitar
  vazamento cruzado entre módulos), (b) sem registro fantasma em falha de submissão, (c)
  segurança da submissão (RBAC + validação de payload antes de enviar à Meta).

## File List
_A preencher pelo @dev._

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-08-20 | @sm (River) | Criação da story — extraída da S-AE-09 original por decisão do Junior (split de escopo, ver Change Log da S-AE-09). Status: Draft, aguardando @po. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 9/10) → Status Draft→Ready.** Boa prática destacada: a story explicitamente NÃO assume webhook vs. polling — deixa como decisão do @architect, a ser confirmada contra a documentação oficial da Meta, em vez de inventar o mecanismo. AC4 (sem registro fantasma em falha de submissão) e o de-risk do filtro por `waba_id` (não só nome de template) cobrem exatamente o risco de vazamento cruzado entre módulos que uma tabela compartilhada como `meta_templates` carrega. Ponto de atenção não-bloqueante: a Task 1 (@architect decide webhook vs. polling) é pré-requisito de fato para as demais Tasks — o Quality Gate já reflete isso corretamente (@architect + @qa). |
