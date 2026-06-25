# EPIC — Migração WhatsApp UAZAPI → Meta Cloud API

> **Status:** Em definição
> **Autor:** @sm (River)
> **Autoridade épica:** @pm (Morgan) — este documento é proposta de @sm; @pm/@po devem ratificar antes das stories posteriores.

---

## 1. Visão Geral

Migrar o canal de WhatsApp das automações do Cuca Atende Mais do UAZAPI (solução não-oficial via WhatsApp Web simulado) para a **Meta Cloud API** (canal oficial, BSP/WABA), tornando os envios conformes com as políticas da plataforma, eliminando riscos de banimento e habilitando recursos como templates aprovados e múltiplas WABAs.

### Princípio fundamental

Migração **incremental e paralela**: as duas camadas (UAZAPI e Meta) coexistem via adapter + feature flag por automação. O UAZAPI é removido apenas quando a Meta estiver 100% validada em produção. Rollback = reverter a flag.

---

## 2. Arquitetura Alvo

| Dimensão | Estado Atual | Estado Alvo |
|---|---|---|
| Canal de envio | UAZAPI (unoffical) | Meta Cloud API (oficial) |
| Autenticação | `token` por instância | `phone_number_id` + `WABA ID` |
| Roteamento entrada | `/webhook/{token}` | `/webhook/meta` (assinatura HMAC) |
| WABAs | 1 implícito | 3 (Programação+RAG, Empregabilidade, Serviço Cuca) |
| Feature flag | Inexistente / global | Por automação (`canal_flag` na instância) |

---

## 3. Automações no Escopo

| # | Automação | WABA Alvo | Estado |
|---|-----------|-----------|--------|
| 1 | Programação (Maria genérica) | Serviço Cuca ou Programação | A definir |
| 2 | RAG Programação | Programação+RAG | A definir |
| 3 | Empregabilidade (Julia) | Empregabilidade | A definir |
| 4 | Ouvidoria (Sofia) | Serviço Cuca | A definir |
| 5 | Acesso Cuca (Ana) | Serviço Cuca | A definir |

> Detalhamento por automação será feito após S-WM-00 documentar o contrato atual.

---

## 4. Stories

| Story | Título | Status |
|-------|--------|--------|
| S-WM-00 | Investigação: Contrato de Comunicação UAZAPI (Estado Atual) | Draft |
| S-WM-01 | Adapter Meta Cloud API — recepção de webhook (inbound) | Pendente S-WM-00 |
| S-WM-02 | Adapter Meta — envio de texto e mídia | Pendente S-WM-00 |
| S-WM-03 | Feature flag por automação + roteamento multi-WABA | Pendente S-WM-01+02 |
| S-WM-04..N | Migração por automação (uma story por canal) | Pendente S-WM-03 |

---

## Change Log

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-22 | @sm (River) | Criação do épico (Draft) |
