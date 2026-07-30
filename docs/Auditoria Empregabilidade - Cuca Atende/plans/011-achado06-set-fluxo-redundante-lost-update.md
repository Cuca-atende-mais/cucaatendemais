# Plan 011: `_set_fluxo` refaz select redundante + risco de lost-update contra o loop de notificação (achado #6)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7b0b326..HEAD -- worker/empregabilidade_engine.py`
> Confirme que `_get_fluxo`/`_set_fluxo` (`:178-188`) e `empregabilidade_notify_loop`
> (`:2595+`) ainda batem com a seção "Current state" antes de prosseguir.
>
> **Recomendado fazer depois do Plan 009** (BUG-02/PERF-01) — lá `_set_fluxo`/`_get_fluxo`
> já ficam envolvidos em `asyncio.to_thread`; fazer este plano depois evita
> retrabalho de merge entre os dois.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — muda a assinatura de uso de `_set_fluxo` (quem já tem o dict em mãos não precisa mais de select redundante) e introduz travamento por `conversa_id`; testar bem o caso concorrente (dispatch normal vs. loop de notificação escrevendo ao mesmo tempo).
- **Depends on**: recomendado após Plan 009 (não bloqueante, mas evita retrabalho)
- **Category**: perf + bug (redundância + corrida de escrita)
- **Confidence**: HIGH/MED (herdado da auditoria de 17/07, não re-verificado linha a linha nesta consolidação — mas os 3 pontos citados foram conferidos ao vivo agora)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

`_set_fluxo` (`worker/empregabilidade_engine.py:184-188`) sempre refaz um `select` em `conversas` antes de gravar, mesmo quando quem chama **já tem** o dict de metadata em mãos (ex.: todo call site que faz `_set_fluxo(conversa_id, {**fluxo, "etapa": "x"})` já tinha lido `fluxo` momentos antes via `_get_fluxo`). É 1 round-trip redundante em praticamente toda escrita de estado do arquivo inteiro.

Mais sério: `empregabilidade_notify_loop` (`:2595-2799`) roda a cada 20s **independente** do dispatch normal de mensagens, e também chama `_set_fluxo` com um dict montado a partir de uma leitura feita no **início daquela iteração do loop** (`:2611-2613`). Entre essa leitura e a escrita (que inclui um `await _enviar(...)` — uma chamada HTTP real no meio do caminho, `:2652-2664`), o usuário pode mandar uma mensagem que o dispatch normal processa e grava primeiro — e a escrita do loop de notificação, alguns milissegundos depois, **sobrescreve** essa mudança sem saber que ela existiu (last-write-wins, sem nenhuma verificação de versão/timestamp).

## Current state

`worker/empregabilidade_engine.py:178-188` (confirmado ao vivo):
```python
def _get_fluxo(conversa_id: str) -> dict:
    res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    return metadata.get("empreg_fluxo", {})


def _set_fluxo(conversa_id: str, fluxo: dict):
    res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    metadata["empreg_fluxo"] = fluxo
    supabase.table("conversas").update({"metadata": metadata}).eq("id", conversa_id).execute()
```

`empregabilidade_notify_loop` (`:2606-2674`, trecho relevante já lido nesta consolidação): lê `conversas` em lote a cada 20s, itera, e pra cada conversa elegível chama `_set_fluxo(conversa_id, {...})` depois de um `await _enviar(...)` no meio.

**Correção de desenho (decisão do sócio, 2026-07-29):** o mecanismo de `meta_adapter_inbound.py` citado acima (`_DEBOUNCE_TASKS`, `_agendar_dispatch_debounced`, em torno de `:471-540`) é **debounce, não é lock de exclusão mútua** — ele adia o processamento de mensagens em rajada pra uma única execução, mas não impede que o loop de notificação escreva por cima do fluxo no meio do processamento de uma mensagem inbound. Confirmado ao vivo (`docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção do Plano 011) — **não reaproveitar esse padrão**. A trava deste plano precisa ser um **`asyncio.Lock()` real por `conversa_id`** (dict `conversa_id -> asyncio.Lock`, criado sob demanda), não uma adaptação do debounce.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: `_set_fluxo` (aceitar `metadata` já em mãos quando disponível, evitando o select redundante); trava por `conversa_id` entre dispatch normal e `empregabilidade_notify_loop`.

**Out of scope**: `asyncio.to_thread` (Plan 009, separado — fazer este plano depois de lá evita conflito); qualquer mudança de comportamento visível pro usuário.

## Git workflow

- Branch: `fix/achado06-set-fluxo-lost-update`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `_set_fluxo` evita o select redundante quando possível

A maioria dos call sites já faz `{**fluxo, "etapa": "x", ...}` — ou seja, já parte do metadata mais recente lido. Mudar `_set_fluxo` pra opcionalmente pular o `select` quando o chamador sinalizar que o dict já reflete o estado mais recente **não é seguro fazer às cegas** (é exatamente esse "confiar no que já tenho em mãos" que causa lost-update se outra escrita aconteceu no meio). A forma correta de resolver os dois problemas ao mesmo tempo (redundância + corrida) é a trava do Step 2 — com a trava em vigor, aí sim fica seguro `_set_fluxo` não precisar reler antes de escrever, porque a trava garante que ninguém mais escreveu por baixo durante a janela.

### Step 2: Trava por `conversa_id` — `asyncio.Lock()` real, não debounce

Adicionar um dict de locks em memória (`_FLUXO_LOCKS: dict[str, asyncio.Lock] = {}`, criado sob demanda por `conversa_id`) protegendo a seção leitura-modificação-escrita de `_set_fluxo` e do trecho equivalente em `empregabilidade_notify_loop`. Com a trava, uma escrita do loop de notificação não pode intercalar com uma escrita do dispatch normal pra a mesma conversa — uma espera a outra terminar (`async with _FLUXO_LOCKS[conversa_id]:`), e a que espera relê o estado mais recente antes de aplicar sua própria mudança (evita perder a escrita concorrente). **Não é o mecanismo de debounce de `meta_adapter_inbound.py`** — é uma estrutura nova, específica deste plano.

**Risco de compatibilidade com o Plano 009 (registrar no PR, decisão do sócio 2026-07-29):** o Plano 009 (BUG-02/PERF-01) envolve as chamadas Supabase síncronas de `_set_fluxo`/`_get_fluxo` em `asyncio.to_thread`, rodando a leitura-modificação-escrita numa thread do threadpool. `asyncio.Lock` é projetado pra coroutines rodando no mesmo event loop — **não é diretamente seguro `await lock.acquire()` dentro do código que roda dentro de `asyncio.to_thread`** (o lock e o código protegido passam a rodar em contextos diferentes: o `Lock.acquire()` precisa ser aguardado na coroutine que chama, não dentro da função síncrona que vai pra thread). Se este plano for executado depois do 009 (ordem recomendada), a integração entre a trava e o `to_thread` precisa ser desenhada explicitamente — não é um "encaixa direto". Se a trava do 011 for implementada antes do 009 rodar, quem implementar o 009 depois precisa saber que existe uma seção crítica protegida por `asyncio.Lock` ali e ajustar o wrapping de `to_thread` para não quebrar essa garantia (ex.: manter a aquisição do lock na coroutine, e só a chamada Supabase de fato dentro do `to_thread`).

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Adicionar 1 teste simulando a corrida: dispatch normal e o trecho de `empregabilidade_notify_loop` tentando escrever "ao mesmo tempo" pra mesma `conversa_id` (mesmo padrão de teste de concorrência real via `asyncio.gather()` usado em `test_campanhas_engine.py` pra `_claim_retomada_sync`, S-WM-60) — confirmar que nenhuma escrita é perdida (o estado final reflete as duas mudanças, não só a última a "vencer" por acaso de timing).

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, incluindo o teste de corrida novo.

## Done criteria

- [ ] Trava por `conversa_id` protegendo `_set_fluxo` e o trecho equivalente de `empregabilidade_notify_loop`
- [ ] Teste de concorrência real prova que nenhuma escrita é perdida
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0
- [ ] Nenhuma mudança de comportamento visível pro usuário
- [ ] `plans/README.md` atualizado

## STOP conditions

- Não existir de fato um mecanismo de lock reaproveitável em `meta_adapter_inbound.py` (confirme antes de assumir) — nesse caso, desenhar um novo é escopo maior que o assumido aqui, reporte antes de prosseguir.
- Os números de linha citados não baterem com o código ao vivo.

## Maintenance notes

- **Esta trava é em memória (por processo) — depende de o worker rodar com 1 processo só.** O plano citava uma investigação (`docs/qa/INVESTIGACAO-worker-multiplos-processos-gunicorn-2026-07-23.md`) descrevendo 4 processos gunicorn simultâneos observados em produção em 14/07/2026. **Essa investigação não foi encontrada** — nem no working tree, nem no histórico do git (`git log --all --oneline --name-only -- '*gunicorn*'` retornou vazio) — não temos hoje como conferir os números citados. **Decisão do sócio (2026-07-29): não bloquear este plano por isso.** A premissa documentada e verificável hoje — `Dockerfile` do worker roda `gunicorn -w 1 -k uvicorn.workers.UvicornWorker` (1 processo) — é tratada como válida por ora. Se o worker vier a rodar com mais de 1 processo (mudança de infra, EasyPanel, etc.), uma trava em memória **não protege nada** — cada processo tem sua própria memória, o lock de um não é visto pelo outro, e o lost-update volta a ser possível. Mencionar essa dependência explicitamente no PR, e se a investigação de 23/07 aparecer (anotação pessoal, outro branch) revisitar esta premissa antes de assumir como definitiva.
