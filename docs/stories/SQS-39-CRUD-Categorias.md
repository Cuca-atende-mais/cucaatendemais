# Story: SQS-39 — CRUD de Categorias (Autonomia do RH)

**Epic:** Sprint 39 — Gestão Autônoma de Áreas de Interesse
**Status:** InProgress
**Agentes Envolvidos:** `@architect` (Design), `@dev` (Implementação)
**Dependências:** SQS-38 concluída; tabela `categorias_interesse` populada via seed

---

## Visão Geral

Ativar a tela de gestão de Áreas de Interesse (`categorias_interesse`) para que o RH gerencie, sem intervenção técnica, os **Eixos** (setores) e **Modalidades** (sinônimos/subáreas) usados pelo bot WhatsApp, pelo portal de vagas e pelo sistema de leads. O Worker Python já consome a tabela dinamicamente — qualquer alteração no portal é imediatamente refletida no bot.

---

## Critérios de Aceite (Acceptance Criteria)

- [x] **AC-01 — Listagem hierárquica:** A tela `/empregabilidade/categorias` lista os Eixos (categorias raiz com `pai_id = null`) e, ao expandir cada eixo, exibe suas Modalidades (subáreas com `pai_id = eixo.id`).

- [x] **AC-02 — Criar Eixo:** O RH pode criar um novo eixo (nome + ícone emoji + status ativo). Ordem calculada automaticamente.

- [x] **AC-03 — Criar Modalidade:** A partir do botão `+` em qualquer eixo (ou pelo modal com seleção de tipo), o RH pode criar uma modalidade vinculada a um eixo pai.

- [x] **AC-04 — Editar:** Qualquer eixo ou modalidade pode ser editado (nome, ícone, ativo) via botão de lápis.

- [x] **AC-05 — Excluir com proteção:** O DELETE é protegido: se o eixo tiver modalidades vinculadas, a API retorna 409 com mensagem amigável. Modalidades podem ser excluídas livremente. Confirmação via AlertDialog.

- [x] **AC-06 — API REST completa:** Rotas cobertas:
  - `GET /api/empregabilidade/categorias` — lista todas
  - `POST /api/empregabilidade/categorias` — cria (body: nome, icone, ativo, pai_id)
  - `PUT /api/empregabilidade/categorias/[id]` — atualiza
  - `DELETE /api/empregabilidade/categorias/[id]` — exclui (com proteção de filhos)

- [x] **AC-07 — Worker Python não precisa de ajuste:** O `category_extractor.py` já lê `categorias_interesse` em tempo real via Supabase. Qualquer eixo criado ou modalidade ativada pelo RH é automaticamente usada pelo bot na próxima execução.

- [x] **AC-08 — Correção da tela categorias_feedback:** A tela existente em `/categorias` (que gerencia `categorias_feedback`) recebeu o botão DELETE com confirmação (gap pré-existente corrigido).

---

## Escopo

**IN:**
- `cuca-portal/src/app/api/empregabilidade/categorias/route.ts` (GET + POST)
- `cuca-portal/src/app/api/empregabilidade/categorias/[id]/route.ts` (PUT + DELETE)
- `cuca-portal/src/app/(dashboard)/empregabilidade/categorias/page.tsx` (nova tela)
- `cuca-portal/src/components/ui/alert-dialog.tsx` (componente novo — Radix já instalado)
- `cuca-portal/src/app/(dashboard)/categorias/page.tsx` (fix DELETE ausente)

**OUT:**
- Worker Python (sem alterações necessárias)
- Tabela `categorias_feedback` (domínio diferente)
- Autenticação ou RLS

---

## Notas de Arquitetura

A tabela `categorias_interesse` tem estrutura auto-referencial:
```
id | nome | icone | ordem | ativo | pai_id (nullable FK → categorias_interesse.id)
```
- `pai_id = null` → Eixo (ex: "Comércio e Vendas 🛒")
- `pai_id = uuid` → Modalidade (ex: "Vendas", "Caixa", "Estoque")

O Worker Python (`category_extractor.py`) lê os eixos via `supabase.table("categorias_interesse").select("id, nome").is_("pai_id", "null")` e faz upsert de modalidades automaticamente por LLM. Portanto: **o RH gerencia os eixos pelo portal; o bot povoa as modalidades automaticamente**.

---

## Lista de Arquivos Modificados/Criados

- `cuca-portal/src/app/api/empregabilidade/categorias/route.ts` *(novo)*
- `cuca-portal/src/app/api/empregabilidade/categorias/[id]/route.ts` *(novo)*
- `cuca-portal/src/app/(dashboard)/empregabilidade/categorias/page.tsx` *(novo)*
- `cuca-portal/src/components/ui/alert-dialog.tsx` *(novo)*
- `cuca-portal/src/app/(dashboard)/categorias/page.tsx` *(modificado — DELETE adicionado)*

---

## Change Log

| Data | Agente | Ação |
|------|--------|------|
| 2026-04-04 | @architect/@dev | Story criada e implementação executada (YOLO mode) |
