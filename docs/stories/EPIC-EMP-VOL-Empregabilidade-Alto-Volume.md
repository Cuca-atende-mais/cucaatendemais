# EPIC EMP-VOL — Empregabilidade em Alto Volume

> **Status:** ✅ **Ratificado pelo Junior em 2026-08-11**
> **Autor:** @pm (Morgan)
> **Módulo:** Empregabilidade
> **Tipo:** Brownfield (módulo em produção)
> **Origem:** demandas levantadas pela equipe de Empregabilidade na apresentação de 2026-08

---

## 1. Visão Geral

O módulo de Empregabilidade foi construído para o atendimento **caso a caso**: uma vaga, um
candidato, um currículo, um e-mail. Em produção ele funciona — mas cada demanda trazida pela equipe
na apresentação de agosto é a mesma falha vista de um ângulo diferente: **o módulo não escala quando
o volume sobe**.

Este épico agrupa as correções que tiram os gargalos manuais do caminho da equipe.

### Princípio fundamental

> **O que funciona hoje não muda.** Toda story aqui é aditiva ou condicionada a um novo tipo de
> vaga/fluxo. Vaga normal, candidatura com currículo, convite pós-seleção e triagem por OCR
> permanecem intocados. Nenhuma story deste épico pode alterar comportamento de vaga normal.

---

## 2. Motivação — o mesmo problema, quatro sintomas

| Sintoma relatado pela equipe | Causa raiz | Custo hoje |
|---|---|---|
| Mutirões de seleção não cabem no formulário de vaga | Modelo assume 1 vaga = 1 cargo = 1 candidato por vez | Equipe cria vaga a vaga, ou não usa o sistema |
| "Não tem como enviar currículo em lote" | Só existe envio individual ligado na tela | Colaborador envia um por um |
| Currículo montado na plataforma vai sem anexo para a empresa | Não existe geração de PDF; só arquivo enviado tem URL | Empresa recebe candidato sem documento |
| Equipe digita currículo de cada candidato | Não existe autoatendimento | Gargalo humano puro |
| Empresa não devolve quem foi selecionado | Cultura da empresa + acionamento manual | Colaborador corre atrás por fora do sistema |

**Objetivo de negócio:** reduzir trabalho manual repetitivo da equipe e fechar o ciclo de retorno com
a empresa, sem aumentar risco sobre dados pessoais.

---

## 3. Decisões de arquitetura já tomadas (levantamento 2026-08-11)

Registradas aqui porque valem para **todas** as stories do épico:

| # | Decisão | Justificativa |
|---|---|---|
| 1 | Lista de presença vive em `candidaturas`, não em tabela nova | O pipeline de feedback já lê `candidaturas`; tabela paralela obrigaria duplicar feedback, convocação e banco de talentos |
| 2 | Fluxo de presença **nunca** grava `convite_enviado` nem `selecionado` | É o que impede os interceptadores de SIM/NÃO pós-seleção de capturarem a confirmação feita na candidatura |
| 3 | Sem status novo em `candidaturas` | Evita migration na CHECK constraint e contaminação de contadores; `confirmacao_presenca` carrega o estado |
| 4 | Currículo estruturado passa a gerar **PDF real** armazenado no R2 | Sem isso a empresa recebe candidato sem anexo, e `window.print()` é inviável no celular |
| 5 | Link público é **emitido pelo bot** (telefone verificado), não link solto | HMAC sozinho só time-boxa uma URL repassável; o WhatsApp já entrega identidade verificada |
| 6 | Download de currículo por **token de uso único**, nunca URL estável por id | Reincidiria o incidente de exposição de currículos de 2026-08-05 |

---

## 4. Stories do épico

| Story | Escopo | Estimativa | Depende de | Status |
|---|---|---|---|---|
| **SQS-56** | Seleção sem coleta prévia de currículo (+ menu Seleções, lista de presença, CRUD manual) | L | SQS-49 (em produção) | Draft |
| **SQS-57** | Currículo estruturado: geração de PDF + entrada na triagem por skills | M | — (fundação) | Draft |
| **SQS-58** | Currículo por autoatendimento via link público seguro | M-L | **SQS-57 (bloqueante)** | Draft |
| **SQS-59** | Envio de currículos em lote para a empresa | S-M | SQS-57 (para anexar CV da plataforma) | ⚠️ **não escrita** — pendente de decisão do Junior sobre estratégia de anexos |

### Ordem de execução recomendada

```
SQS-57 (fundação) ──→ SQS-58
                 └──→ SQS-59
SQS-56 (independente, pode correr em paralelo)
```

**SQS-57 primeiro, sem exceção.** Ela conserta um furo que já existe (currículo sem anexo) e impede
que a SQS-58 nasça reproduzindo o mesmo defeito em escala maior.

---

## 5. Regras transversais (valem para todas as stories)

1. **Nenhuma story altera comportamento de vaga normal.** Colunas novas são aditivas com default que
   preserva o estado atual; ramos novos ficam atrás de flag.
2. **Análise de impacto por item é bloqueante** para aprovação de qualquer story
   (`.claude/rules/impact-analysis-mandatory.md`) — rastreada até o consumidor real, não em bloco.
3. **Migrations são idempotentes e retrocompatíveis**, aplicadas pelo @dev via MCP conforme
   `.claude/rules/cuca-deploy-environments.md`.
4. **PII é requisito, não refinamento.** O módulo lida com dados de menores de idade e já teve um
   incidente de exposição (`docs/qa/DIAGNOSTICO-exposicao-anon-curriculos-2026-08-05.md`). Qualquer
   rota pública nova exige link assinado + rate-limit, e nenhuma URL estável por id.
5. **Envio proativo pela Meta exige template aprovado.** Mensagens dentro da janela de 24h (candidato
   em conversa) podem ser texto livre — a distinção precisa estar explícita em cada story.

---

## 6. Riscos do épico

| Risco | Mitigação | Rollback |
|---|---|---|
| Quebrar a máquina de estados do WhatsApp (3.372 linhas, produção) | Ramos novos isolados por flag; `pytest` do worker cobre os interceptadores existentes | Reverter o commit; nenhuma coluna nova precisa ser removida (são aditivas) |
| Reincidir a exposição de currículos | Token de uso único; `/print/[id]` permanece fora da whitelist pública | Remover a rota nova da whitelist do middleware |
| Ranqueamento da IA mudar sem aviso | Efeito medido: só 6 linhas afetadas hoje; comunicar antes | `skills_jsonb` pode ser limpo por linha |
| Poluição do banco de talentos via rota pública | Rate-limit por telefone + link amarrado a id conhecido | Desativar a rota pública (feature isolada) |

---

## 7. Definição de Pronto (nível épico)

- [ ] As 4 stories em `Done`, cada uma com QA gate `PASS`
- [ ] Nenhuma regressão em vaga normal, comprovada por `pytest` do worker + validação em staging
- [ ] Equipe de Empregabilidade avisada sobre as 2 mudanças de tela: seleções saem da lista de Vagas
      (SQS-56 AC16) e ranqueamento pode incluir candidatos novos (SQS-57)
- [ ] Nenhuma URL pública estável servindo dado pessoal

---

## 8. Pendências para o Junior

1. ~~Ratificar este épico~~ — ✅ ratificado em 2026-08-11.
2. **Decidir a estratégia de anexos da SQS-59** (links assinados / manter 5 / zip / vários e-mails).
   Sem isso a story não é escrita.

---

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-08-11 | @pm | Criação. Agrupa SQS-56/57/58 (escritas) + SQS-59 (pendente). Enquadramento por causa raiz comum: o módulo não escala em alto volume |
