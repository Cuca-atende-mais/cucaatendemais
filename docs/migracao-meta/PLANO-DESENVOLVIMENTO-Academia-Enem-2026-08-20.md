# Plano de Desenvolvimento — Academia Enem (Migração Meta Direta)

> Autor: @sm (River). Data: 2026-08-20. Consolida as decisões desta sessão (planejamento + rascunho + validação @po de todas as stories) num único documento de referência, para orientar a sequência de implementação do @dev.
>
> **Não substitui** as stories individuais em `docs/stories/S-AE-*.md` — cada uma tem os critérios de aceite, dependências e análise de impacto completos. Este documento é o mapa de conjunto.

---

## 1. Contexto — o que está mudando e por quê

A Academia Enem foi construída em junho/2026 como um módulo **isolado**, usando uma API paga à parte (AuctaFlux) e tabelas próprias (`ae_conversas`, `ae_mensagens`, `ae_instancias`), para não mexer no sistema antigo (uazapi) enquanto ele ainda atendia os outros módulos. Esse sistema antigo já foi desligado — a premissa que justificava o isolamento não existe mais.

**Decisão do Junior (2026-08-20):** abandonar o AuctaFlux. A Academia Enem passa a usar o **mesmo mecanismo Meta oficial** que Institucional e Empregabilidade já usam — banco de dados compartilhado (`conversas`, `mensagens`, `meta_phone_numbers`, `meta_templates`, `transbordo_humano`, `leads`) — mas com **credenciais Meta isoladas** num serviço próprio no EasyPanel (`cuca-academia-enem`), porque a Academia Enem usa uma **conta/Business Manager diferente** da "Ivida" (a dos outros 4 módulos), administrada por gestores externos ligados à Prefeitura.

Além disso, o Junior definiu 3 características próprias do módulo, diferentes do que os outros canais têm:
- **Disparo de avisos próprio e separado** (não usa a fila do Institucional/Divulgação).
- **Cadastro de leads próprio**, incluindo upload de planilha com dedup automático e CRUD completo.
- **RBAC fechado por padrão** — só o perfil Developer (Junior e sócio) tem acesso automático; todo o resto precisa de permissão concedida explicitamente.

---

## 2. O que já está pronto (produção, de antes desta sessão)

Estas 5 stories já foram implementadas, revisadas e **estão em produção** — e, por não tocarem nas tabelas `ae_conversas`/`ae_mensagens` (o que estava isolado), **não precisam de nenhuma alteração** por causa da migração:

| Story | Entrega | Status |
|---|---|---|
| [S-AE-00](../stories/S-AE-00-Fundacao-Modulo.md) | Fundação do módulo — menu, shell, navegação | Em produção |
| [S-AE-05](../stories/S-AE-05-RAG-Academia-Enem.md) | RAG próprio — upload de documento/texto, indexação, base de conhecimento Enem-only | Em produção |
| [S-AE-07](../stories/S-AE-07-Import-Presenca-Tabular.md) | Importação da planilha de presença (frequência nos encontros) | Em produção |
| [S-AE-08](../stories/S-AE-08-Filtro-Leads-Tag-Matricula.md) | Filtro/marcação de leads matriculados na Academia Enem | Em produção (**vai ser expandida pela S-AE-13**) |
| [S-AE-11](../stories/S-AE-11-KPIs-Presenca.md) | Dashboard de KPIs de presença/assiduidade | Em produção |

## 3. O que foi rascunhado/reescrito nesta sessão — pronto para o @dev (Status: Ready)

| Story | Entrega | Depende de |
|---|---|---|
| [S-AE-01](../stories/S-AE-01-RBAC-Granular.md) | Catálogo RBAC transversal (10 recursos) + regra de bypass só para Developer | S-AE-00 |
| [S-AE-02](../stories/S-AE-02-Infraestrutura-Meta-Direta.md) | Serviço `cuca-academia-enem` no EasyPanel + credenciais Meta + cadastro do número/templates | — (bloqueia quase tudo abaixo) |
| [S-AE-03](../stories/S-AE-03-Painel-Atendimento.md) | Painel de atendimento (chat), reaproveitando tabelas/componentes compartilhados | S-AE-02 |
| [S-AE-04](../stories/S-AE-04-Automacao-Entrada-Humanizada.md) | Automação de entrada (saudação humanizada + coleta de nome, sem menu) | S-AE-02 |
| [S-AE-06](../stories/S-AE-06-Transbordo.md) | Transbordo para atendente humano, reaproveitando `transbordo_humano` | S-AE-02, S-AE-04 |
| [S-AE-09](../stories/S-AE-09-Disparo-Validador-Template.md) | Disparo de avisos **próprio e separado**, com IA validadora de conformidade Meta | S-AE-02, S-AE-08, S-AE-11, S-AE-13 |
| [S-AE-10](../stories/S-AE-10-Classificador-Disparo-RAG.md) | Roteamento de dúvida do lead (aviso vs. RAG via motor-agente), regra "nunca inventa" | S-AE-04, S-AE-05, S-AE-06, S-AE-09 |
| [S-AE-13](../stories/S-AE-13-Upload-Planilha-Leads.md) | Upload de planilha de leads (sem OCR/IA) **+ CRUD/status próprio** (expande a tela da S-AE-08) | S-AE-00, S-AE-01, S-AE-08 |
| [S-WM-67](../stories/S-WM-67-Correcao-Teto-Diario-Envio-Meta.md) | Correção do teto diário de envio Meta — **cross-módulo**, aplicada a todos os canais | — (independente) |

## 4. Pendente de teste ao vivo (depois do número pareado)

| Story | Entrega |
|---|---|
| [S-AE-12](../stories/S-AE-12-Teste-E2E-Pos-Pareamento.md) | Teste de ponta a ponta com o número real — última etapa, confirma tudo funcionando junto |

---

## 5. Sequência de desenvolvimento recomendada

A ideia é começar pelo que **não depende do token da Meta** (que ainda está com o sócio), deixando pra depois só o que realmente precisa do número pareado.

```
Fase 0 — Infraestrutura (você, em paralelo, sem bloquear o @dev)
  S-AE-02: EasyPanel já criado, Verify Token e App Secret já configurados.
           Falta: META_SYSTEM_USER_TOKEN (sócio) + testes via curl.

Fase 1 — Independentes, sem esperar o token
  1. S-WM-67 — correção do teto diário (código isolado, cross-módulo)
  2. S-AE-13 — estrutura própria de leads (upload + CRUD/status)

Fase 2 — Backend do módulo (código pronto; teste real fica pra Fase 4)
  3. S-AE-03 — painel de atendimento
  4. S-AE-04 — automação de entrada (engine)
  5. S-AE-06 — transbordo (depende do S-AE-04)

Fase 3 — Disparo e integração final
  6. S-AE-09 — disparo próprio (depende de leads prontos + teto corrigido)
  7. S-AE-10 — classificador/RAG (integrador final — depende de tudo acima)

Fase 4 — Conclusão, só quando o token chegar
  8. S-AE-02 (fechamento) — testes reais via curl no serviço já configurado
  9. S-AE-12 — teste de ponta a ponta com o número pareado
```

**Por que essa ordem:** as fases 1-3 entregam código completo e testável (com dados simulados) sem nenhuma dependência do token do sócio — só a **verificação ao vivo final** de cada uma fica pendente até o número estar pareado, igual já aconteceu com a S-AE-03/S-AE-04 na primeira leva de implementação (junho/2026). Isso evita o @dev ficar parado esperando o sócio.

---

## 6. Pendências externas (fora do controle de qualquer agente)

- **`META_SYSTEM_USER_TOKEN`** — aguardando o sócio criar no Business Manager da Academia Enem e liberar para o Junior.
- Depois disso: colar no EasyPanel, redeploy, rodar os 3 testes de conexão (healthcheck, handshake do webhook, envio via curl) — já documentado na S-AE-02.

## 7. Regras que valem para todas as stories acima

- Cada story segue o pipeline `@dev → @qa → @devops`, com HALT entre etapas — nenhuma pulada.
- Toda mudança em código/tabela **compartilhada** (ex.: S-WM-67, S-AE-03/04 tocando `conversas`/`mensagens`) precisa da análise de impacto item a item, já embutida em cada story (regra `.claude/rules/impact-analysis-mandatory.md`).
- Nenhum teste em navegador/localhost sem autorização explícita (regra `.claude/rules/qa-testes-sem-navegador-ao-vivo.md`).
- RBAC: todo recurso novo (`ae_infra_meta`, `ae_leads_upload`, `ae_disparo`, etc.) precisa entrar no catálogo da S-AE-01 e ficar fechado por padrão — só Developer (Junior/sócio) com acesso automático.

---

## Referências

- `docs/migracao-meta/PLANO-Academia-Enem-Migracao-Meta-Direta.md` — levantamento técnico original (01/08/2026) que fundamentou a decisão de migração.
- `docs/stories/EPIC-Academia-Enem.md` — épico original do módulo (histórico, arquitetura AuctaFlux — desatualizado pela decisão de 2026-08-20).
- PR já mergeado desta sessão: [#111](https://github.com/Cuca-atende-mais/cucaatendemais/pull/111) (rename RBAC `ae_instancia`→`ae_infra_meta` + as 9 stories rascunhadas/reescritas).
