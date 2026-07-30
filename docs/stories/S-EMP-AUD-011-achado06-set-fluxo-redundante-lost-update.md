# S-EMP-AUD-011 — `_set_fluxo` redundante + risco de lost-update contra o loop de notificação (achado #6)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/011-achado06-set-fluxo-redundante-lost-update.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 011"
**Prioridade:** P2 | **Esforço:** M | **Risco:** MED
**Ordem de execução proposta:** Bloco 5, **recomendado depois do Bloco 4 (Plano 009)** — não bloqueante, mas evita retrabalho de merge (ambos tocam `_set_fluxo`/`_get_fluxo`)

## Contexto

`_set_fluxo` sempre refaz um `select` redundante antes de gravar. Mais sério: `empregabilidade_notify_loop` (roda a cada 20s) pode sobrescrever uma escrita do dispatch normal feita entre a leitura e a escrita do loop (last-write-wins, sem verificação de versão).

## Decisão de produto aplicada (sócio, 2026-07-29)

**A trava deve ser um `asyncio.Lock()` real por `conversa_id` — não uma adaptação do mecanismo de debounce de `meta_adapter_inbound.py`.** Verificação da equipe confirmou que aquele mecanismo (`_DEBOUNCE_TASKS`, `_agendar_dispatch_debounced`) é debounce (adia processamento em rajada), não é lock de exclusão mútua — não protege contra a corrida descrita aqui.

## Valor de negócio

Evita perda silenciosa de estado de conversa real quando o loop de notificação e o dispatch normal escrevem ao mesmo tempo — hoje last-write-wins sem aviso, o que pode travar um usuário real numa etapa errada sem ninguém perceber.

## Dependência real

**Recomendado (não bloqueante) rodar depois do Plano 009** — ambos tocam o mesmo trecho (`_set_fluxo`/`_get_fluxo`), fazer nesta ordem evita retrabalho de merge.

**Risco de compatibilidade com o Plano 009 (registrar no PR):** `asyncio.Lock` é projetado pra coroutines no mesmo event loop — não é diretamente seguro dentro de código que roda via `asyncio.to_thread` (que o Plano 009 introduz nesse mesmo trecho). A integração entre a trava e o `to_thread` precisa ser desenhada explicitamente por quem implementar, não assumida como "encaixa direto" — ver detalhamento no plano.

**Gunicorn — decisão do sócio (2026-07-29):** a investigação sobre múltiplos processos gunicorn citada no plano original não foi encontrada (nem working tree, nem histórico do git). **Não bloquear esta story por isso** — a premissa documentada e verificável hoje (`Dockerfile`: `gunicorn -w 1`) é tratada como válida por ora. Mencionar essa dependência explicitamente no PR.

## Acceptance Criteria

- [ ] `asyncio.Lock()` real por `conversa_id` protegendo `_set_fluxo` e o trecho equivalente em `empregabilidade_notify_loop`
- [ ] Teste de concorrência real (`asyncio.gather()`, mesmo padrão de `test_campanhas_engine.py::_claim_retomada_sync`) provando que nenhuma escrita é perdida
- [ ] Dependência de "1 processo gunicorn" mencionada explicitamente no PR
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano — `_set_fluxo` (evitar select redundante) + trava por `conversa_id`. Fora de escopo: `asyncio.to_thread` (Plano 009).

## Test plan

Ver "Test plan" do plano — teste de corrida real via `asyncio.gather()`.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 011, com a correção pra `asyncio.Lock` real (decisão do sócio) e o risco de compatibilidade com o Plano 009 já incorporados.
- v0.2 (2026-07-29): @po validou — GO (9/10). Status Draft → Ready. Melhor story do lote em riscos: decisão de produto, risco de compatibilidade técnica com outra story e dependência de infra (gunicorn) todos documentados com evidência e decisão explícita.
- v0.3 (2026-07-29): @po adicionou "Valor de negócio" explícito.
