# S-EMP-AUD-014 — Menu duplicado 10x (1 já divergiu) + 7 tuplas de afirmativo inconsistentes (achado #11)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/014-achado11-menu-duplicado-e-afirmativo-inconsistente.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 014" — divergência de `:646` confirmada ao vivo
**Prioridade:** P3 | **Esforço:** S/M | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais

## Contexto

O menu de 4 opções (`1️⃣ Cadastrar nova vaga / 2️⃣ Consultar status de uma vaga / 3️⃣ Editar uma vaga / 4️⃣ Cancelar uma vaga`) está copiado como string literal em 10 lugares — 1 cópia (`:646`) já divergiu, dizendo "4️⃣ Encerrar" em vez de "4️⃣ Cancelar uma vaga". Também há 7 tuplas de afirmativo ("sim"/"quero"/etc.) diferentes entre si sem documentação do motivo.

## Decisão de produto aplicada (sócio, 2026-07-29)

`:646` vira `"4️⃣ Cancelar uma vaga"`, alinhado com as outras 9 — não era intencional. **Não é mais pergunta em aberto.** Consolidar as 10 ocorrências (incluindo a antiga `:646`) em `_MENU_ACOES_EMPRESA`.

## Valor de negócio

Fecha 1 divergência de texto real (empresa vendo "Encerrar" em vez de "Cancelar uma vaga" numa etapa) e, ao consolidar as 10 cópias numa constante única, evita que uma 11ª divergência apareça no futuro sem ninguém perceber.

## Dependência real

Nenhuma.

## Acceptance Criteria

- [ ] `_MENU_ACOES_EMPRESA` criada e usada nas 10 ocorrências, incluindo `:646` já alinhado como "Cancelar uma vaga"
- [ ] Teste de regressão confirmando que a etapa antes divergente em `:646` agora envia "Cancelar uma vaga"
- [ ] 7 tuplas de afirmativo revisadas — consolidadas onde forem genuinamente idênticas, documentadas onde diferirem por motivo real
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 014, com a decisão do sócio sobre `:646` já incorporada (não é mais pergunta em aberto).
- v0.2 (2026-07-29): @po validou — GO (7/10). Status Draft → Ready. Ponto forte: divergência de produto resolvida e registrada com evidência (linha exata).
- v0.3 (2026-07-29): @po adicionou "Valor de negócio" explícito.
