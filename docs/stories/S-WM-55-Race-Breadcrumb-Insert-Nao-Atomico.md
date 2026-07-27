# S-WM-55 — Corrigir corrida no caminho de INSERT do breadcrumb de disparo (achado #5 revisado)

## Status
Ready for Review

## Origem
Investigação "Corrida da Juventude" (disparo de 724 leads, 24/07/2026) — `docs/qa/DIAGNOSTICO-disparo-corrida-juventude-2026-07-27.md`, achado #3 (caso real confirmado: lead Glauwênya recebeu "De novo, foi mal!" em resposta a agradecimento). Plano técnico completo, com o diff exato do retry atômico, preservado integralmente em `docs/qa/planos-corrida-juventude/004-race-breadcrumb-insert-nao-atomico.md` — usar esse arquivo como referência técnica primária, não este resumo. Elaborado em 2026-07-25 (commit base `256d547`), continuação direta do PR #53/#54 (S-WM-31, já em produção). Formalizada em story por @sm em 2026-07-27, setup de teste ("Equipe Interna — QA") já criado e confirmado.

## Complexidade
**S** — 1 função (`_gravar_breadcrumb_disparo`), adiciona retry no ramo de INSERT.

## Prioridade
P2 — corrida de concorrência com causa raiz confirmada em produção (caso real, não hipotético). **Bloqueia a S-WM-56** (Plano 005) — precisa estar DONE antes dela.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd worker && pytest tests/test_campanhas_engine.py -v → todos passam, incluindo os 2 testes novos e os 2 já existentes de _gravar_breadcrumb_disparo sem alteração
  - cd worker && pytest tests/ -v → suíte completa sem regressão
  - grep -n "except APIError" worker/campanhas_engine.py → confirma o retry tipado (não "except Exception" genérico) dentro de _gravar_breadcrumb_disparo
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que o caminho de criação de conversa nova em `_gravar_breadcrumb_disparo` seja resiliente a uma corrida com o fluxo inbound,
**para que** o breadcrumb `ultimo_disparo` nunca seja perdido quando a auto-resposta do WhatsApp Business do lead chega quase ao mesmo tempo do disparo — sem esse campo, o mecanismo que já reconhece disparo recente (`deveReconhecerDisparoRecente`, PR #55, já em produção) não tem como agir, e o lead cai na resposta canned de cortesia genérica.

## Contexto e Problema — causa raiz mais profunda que o achado #5 original

O PR #53/#54 (S-WM-31, já mergeado) corrigiu `_gravar_breadcrumb_disparo` pra **mesclar** `metadata` em vez de sobrescrever — mas o caminho de **criação** de conversa nova continua usando um `.insert()` simples, **não atômico**, enquanto o caminho equivalente do fluxo inbound (`worker/meta_adapter_inbound.py:604-613`, já corrigido desde a S-WM-31) usa `.upsert(..., on_conflict="lead_id,origem_id")`.

Isso cria uma corrida real: se a auto-resposta do WhatsApp Business do lead (comum em números comerciais — confirmado que uma fração real dos 724 destinatários eram números comerciais) chega **quase ao mesmo tempo** que `_gravar_breadcrumb_disparo` tenta gravar o breadcrumb pela primeira vez, os dois processos competem pra criar a MESMA linha `conversas`. O fluxo inbound (atômico) sempre vence sem erro. `_gravar_breadcrumb_disparo`, quando perde a corrida, tenta um `INSERT` numa linha que já existe (`UNIQUE(lead_id, origem_id)`, desde a S-WM-31) — a exceção é engolida silenciosamente pelo `except Exception as bc_err: logger.warning(...)` do chamador, e **o breadcrumb nunca é gravado**.

Confirmado no caso real da Glauwênya: sua conversa tinha `metadata = {"conversa_engajada": true, "aguardando_unidade": false}` — **sem `ultimo_disparo`**. O 1º evento da conversa dela, minutos antes, é literalmente a resposta automática de ausência do WhatsApp Business dela — exatamente o cenário de corrida descrito. **Corrigir esta corrida é o que faz o PR #55 funcionar pros leads que caem nesse cenário — não é preciso mexer em nenhuma resposta canned.**

## Escopo

### IN
1. Em `worker/campanhas_engine.py::_gravar_breadcrumb_disparo`, no ramo `else` (hoje um `INSERT` simples): envolver em `try/except`; se o `INSERT` falhar por violação de `UNIQUE(lead_id, origem_id)` (a linha foi criada por outra escrita entre o `SELECT` e este `INSERT`), re-buscar a linha e refazer o merge de metadata via `UPDATE`, em vez de deixar a exceção subir para ser engolida pelo chamador. **Exceção tipada, não genérica** — `except APIError as exc:` (`from postgrest.exceptions import APIError`), checando `exc.code == "23505"` (SQLSTATE de `unique_violation`), não `except Exception:`. Ver Dev Notes para a investigação que confirmou essa API.
2. Se `exc.code != "23505"` (não é violação de UNIQUE) **ou** o retry também não encontrar a linha (`existente_retry.data` vazio), **re-propagar** a exceção original (`raise`) — não era corrida, é um erro real, não pode ser mascarado.
3. Teste reproduzindo a corrida (1º select vazio → insert lança `APIError(code=23505)` → 2º select encontra a linha → confirma que `update` é chamado com metadata mesclado).
4. Teste adicional confirmando que um `APIError` com código **diferente** de `23505` (ex.: `23502`, not-null violation) **não** é tratado como corrida — propaga sem chamar `update`, mesmo quando o retry select encontraria uma linha (cenário adversarial, não só "retry vazio").
5. Mutation check: reverter o retry inteiro, confirmar que o teste de corrida falha; reverter só a checagem de `.code` (voltar pra `except Exception:` genérico), confirmar que o teste de "não mascarar" falha; restaurar ambos, confirmar que passam.

### OUT
- `worker/meta_adapter_inbound.py` — já correto, é o exemplar a copiar, sem mudança.
- `supabase/functions/motor-agente/index.ts` (`deveReconhecerDisparoRecente`, PR #55) — já correto e testado; esta story só garante que ele *recebe* o dado que precisa.
- Qualquer mudança na resposta canned de cortesia/`evitarRepeticaoLiteral` — depois desta correção, o cenário do achado #5 passa a ser coberto pelo mecanismo do PR #55. Se ainda sobrar algum caso de repetição sem `ultimo_disparo` disponível (cortesia genuína, sem disparo recente nenhum), é comportamento correto, não bug.
- O ramo `if existente.data:` (já correto, mescla metadata em memória) — não trocar `.select(...).limit(1)`.

## Acceptance Criteria

1. **Given** o `INSERT` do ramo de criação falha com `APIError(code="23505")` (violação de `UNIQUE(lead_id, origem_id)`, corrida com o fluxo inbound), **when** `_gravar_breadcrumb_disparo` trata a exceção, **then** re-busca a linha e grava o breadcrumb via `UPDATE` com metadata mesclado — não perdido.
2. **Given** o `INSERT` falha com um `APIError` de código **diferente** de `23505` (erro real, não corrida) — inclusive quando o retry select encontraria uma linha por coincidência —, **when** processado, **then** a exceção é re-propagada **sem** chamar `update` — nunca mascarada como corrida.
3. **Given** o retry (para um `23505` genuíno) também não encontra nenhuma linha, **when** processado, **then** a exceção original é re-propagada.
4. **Given** o teste do cenário 1 revertido (retry removido) e o teste do cenário 2 com a checagem de `.code` removida (volta a `except Exception:` genérico), **when** cada um é rodado isoladamente, **then** falha — provando que a exceção tipada não é decorativa.
5. **Given** os 2 testes já existentes de `_gravar_breadcrumb_disparo`, **when** a suíte roda após esta mudança, **then** continuam passando sem modificação.
6. `pytest tests/` sai com exit 0, incluindo os 2 testes novos.
7. Nenhum arquivo fora de `worker/campanhas_engine.py` e `worker/tests/test_campanhas_engine.py` é modificado (exceto o stub de `postgrest` no arquivo de teste, necessário pela mesma limitação de ambiente já documentada pra `supabase`).

## Tasks / Subtasks

- [x] **Task 0 — Resolver o STOP condition do plano (exceção tipada), não deixar como ressalva** (AC: 1, 2)
  - [x] Investigado se `postgrest-py` expõe exceção tipada pra erro de API: confirmado `postgrest.exceptions.APIError` (achado no source real do pacote, instalado em outro projeto local — `postgrest` não está instalado neste ambiente de teste, mesma limitação já documentada pra `supabase`) — `.code` carrega o SQLSTATE do Postgres (`23505` = `unique_violation`). Levantada só em resposta HTTP não-2xx da API (nunca em erro de rede/timeout, que levanta exceção do `httpx` antes de chegar lá).
- [x] **Task 1 — Retry atômico no ramo de INSERT, com exceção tipada** (AC: 1, 2)
  - [x] Import `from postgrest.exceptions import APIError`.
  - [x] Envolver o `INSERT` em `try/except APIError as exc:`.
  - [x] Se `exc.code != "23505"`: `raise` (erro real, não mascarar). Senão, re-buscar e refazer merge via `UPDATE`; se não achar, `raise`.
- [x] **Task 2 — Testes + mutation check duplo** (AC: 3, 4, 6)
  - [x] Teste reproduzindo a corrida (`APIError(code="23505")`, 1º select vazio, 2º select encontra a linha).
  - [x] Teste adversarial: `APIError` com código diferente (`23502`), retry select ENCONTRA uma linha (não relacionada) — confirma que mesmo assim propaga, sem chamar `update`.
  - [x] Mutation check 1 (retry inteiro removido) → teste de corrida falhou; restaurado → passou.
  - [x] Mutation check 2 (`except APIError` + checagem de `.code` trocado por `except Exception:` genérico) → teste adversarial falhou (`DID NOT RAISE`, confirmando que mascararia o erro real); restaurado → passou.
- [x] **Task 3 — Fechamento** (AC: 5, 6, 7)
  - [x] Suíte completa: 144 passed (142 baseline + 2 novos), sem regressão nos 2 testes já existentes, 3 falhas pré-existentes (fora de escopo) inalteradas.
  - [x] File List e Change Log atualizados.
  - [x] Anunciado conclusão e recomendado @qa.

## Dev Notes

- Código antes/depois exato do retry, estrutura do teste de corrida e do mutation check: **`docs/qa/planos-corrida-juventude/004-race-breadcrumb-insert-nao-atomico.md`** — ler por completo antes de editar. O plano original propunha `except Exception:` genérico com uma ressalva de revisão; esta story resolveu essa ressalva na implementação (ver Task 0), não deixou como observação pendente.
- **Exceção tipada confirmada e usada:** `postgrest.exceptions.APIError` (`.code`, `.message`, `.hint`, `.details` — construtor recebe um dict). Levantada só por `.execute()` quando a resposta HTTP da API não é 2xx; erro de rede/timeout do `httpx` propaga como exceção do `httpx`, nunca chega a virar `APIError` — por isso o `except APIError` não mascara esses casos, eles continuam subindo pro `except Exception as bc_err: logger.warning(...)` do chamador, como já acontecia antes desta story.
- Depois desta correção, vale validar ao vivo (ou aguardar o próximo disparo em massa) se leads com resposta automática de WhatsApp Business passam a ter `ultimo_disparo` gravado e o bot passa a reconhecer o disparo recente.
- Se esse tipo de corrida (insert vs. upsert atômico) aparecer em outro lugar, considerar migrar `_gravar_breadcrumb_disparo` pra uma função RPC atômica no Postgres (mesmo padrão de `claim_evento_pontual`) — fora de escopo desta story.
- **Esta story BLOQUEIA a S-WM-56** (Plano 005): aquela adiciona um 3º chamador à mesma função cuja corrida esta story corrige — fazer 056 antes de 055 aumentaria a exposição à corrida em vez de reduzir. A S-WM-56 deve HALT se pega antes desta estar DONE.

### Testing
`cd worker && pytest tests/test_campanhas_engine.py -v` e depois `pytest tests/` (suíte completa).

## Dependências
Sem dependência técnica de entrada (é uma continuação direta da S-WM-31, já mergeada — não repete o trabalho dela). **Bloqueia a S-WM-56** — precisa estar DONE antes.

## Git workflow
Branch: `fix/race-breadcrumb-insert-nao-atomico`. Commit único, ex.: `fix(campanhas): corrige corrida no insert do breadcrumb de disparo via retry atomico`. Não dar push/PR sem autorização explícita.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-27 | 0.1 | Story criada a partir do Plano 004 (investigação "Corrida da Juventude", 2026-07-25). 4ª story da leva — sem dependência de entrada, mas bloqueia a S-WM-56 (precisa estar DONE antes dela). | @sm River |
| 2026-07-27 | 0.2 | Implementada em branch isolada `fix/race-breadcrumb-insert-nao-atomico` (a partir de `origin/main`, já com S-WM-52/53/54). Sem drift. STOP condition do plano (except genérico) resolvido na implementação, não deixado como ressalva: `postgrest.exceptions.APIError` confirmado no source real do pacote e usado com checagem de `.code`. 2 testes novos + 2 mutation checks. Suíte: 144/0/3(pré-existentes). Status Draft → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- Drift check (`git diff --stat 256d547..HEAD -- worker/campanhas_engine.py worker/tests/test_campanhas_engine.py`): vazio — sem drift. Bloco de `_gravar_breadcrumb_disparo` conferido linha a linha contra o "Estado atual" do plano — idêntico.
- Baseline: `pytest tests/test_campanhas_engine.py -q` → 17 passed. `pytest tests/ -q` → 142 passed, 3 failed (pré-existentes, já documentadas nas stories anteriores).
- **Investigação da exceção tipada (Task 0, resolvendo o STOP condition):** `postgrest` não está instalado neste ambiente (mesma limitação documentada em `test_campanhas_engine.py` pra `supabase` — tentativa anterior de instalar quebrou `httpx`). Localizei uma instalação real do pacote em outro projeto local (`postgrest==2.27.2`) e inspecionei `postgrest/exceptions.py` diretamente: `APIError(Exception)` com `.code`/`.message`/`.hint`/`.details`, construtor recebe um dict. Confirmei em `postgrest/_sync/request_builder.py` que `APIError` só é levantada quando `r.is_success` é `False` (resposta HTTP real da API, não erro de rede — `self.request.send()` levantaria uma exceção do `httpx` antes disso, nunca chegando a virar `APIError`). SQLSTATE `23505` = `unique_violation` é conhecimento estável do Postgres (não específico de versão do driver).
- Implementado: `from postgrest.exceptions import APIError` no topo de `campanhas_engine.py`; `except APIError as exc: if exc.code != "23505": raise` antes do retry.
- Testes novos: `test_breadcrumb_recupera_de_corrida_quando_insert_falha_por_conflito` (usa `APIError(code="23505")` real, não mais uma `Exception` genérica como o plano original ilustrava) e `test_breadcrumb_nao_mascara_erro_que_nao_e_violacao_de_unique` (código `23502`, cenário adversarial com retry select encontrando uma linha não-relacionada — desenhado especificamente pra discriminar entre `except APIError`+checagem de código vs. `except Exception:` genérico; minha 1ª versão desse teste não discriminava de verdade — corrigida depois do mutation check expor isso).
- Stub de `postgrest`/`postgrest.exceptions.APIError` adicionado em `test_campanhas_engine.py`, mesmo padrão do stub de `supabase` já existente no arquivo.
- Suíte pós-mudança: `pytest tests/test_campanhas_engine.py -q` → 19 passed (17 + 2 novos). `pytest tests/ -q` → 144 passed, mesmas 3 falhas pré-existentes.
- Mutation check 1 (retry inteiro removido, volta ao `INSERT` simples): `test_breadcrumb_recupera_de_corrida_quando_insert_falha_por_conflito` falhou (exceção sobe sem tratamento). Restaurado → passou.
- Mutation check 2 (`except APIError as exc: if exc.code != "23505": raise` trocado por `except Exception:` genérico, mantendo o resto do retry): `test_breadcrumb_nao_mascara_erro_que_nao_e_violacao_de_unique` falhou (`Failed: DID NOT RAISE` — o erro real de código `23502` foi silenciosamente "recuperado" via update na linha não-relacionada, exatamente o mascaramento que o STOP condition original temia). Restaurado → passou. Os 2 testes já existentes de `_gravar_breadcrumb_disparo` não precisaram de nenhuma mudança e continuaram passando durante todo o processo.
- `grep -n "except APIError"` → confirma o retry tipado; `except Exception` remanescente no arquivo é só em outras funções, fora de escopo.

### Completion Notes List
- Implementado além do que o texto literal do plano propunha (`except Exception:` genérico) porque o próprio plano listou isso como STOP condition a resolver, e a Junior pediu explicitamente pra resolver na implementação, não deixar como ressalva. A exceção tipada (`APIError` + `.code`) foi verificada contra o source real do pacote, não assumida por documentação/memória.
- O 1º desenho do teste adversarial (Task 2) não discriminava de verdade entre a implementação certa e a errada — o mutation check pegou isso (o teste "passava" mesmo com a proteção removida, por um motivo errado: o retry select vazio já re-propagava por outro caminho). Corrigido fazendo o retry select ENCONTRAR uma linha não-relacionada nesse cenário — só aí a diferença entre `except APIError`+código vs. `except Exception:` genérico fica observável no teste. Registrado aqui porque é um lembrete de que mutation check vale a pena rodar cedo, não só como formalidade no fim.
- Os 2 testes já existentes de `_gravar_breadcrumb_disparo` não foram modificados, conforme exigido.
- Nenhum arquivo fora de `worker/campanhas_engine.py` e `worker/tests/test_campanhas_engine.py` foi modificado.

### File List
- `worker/campanhas_engine.py` (modificado: import de `APIError`, retry tipado com checagem de `.code` em `_gravar_breadcrumb_disparo`)
- `worker/tests/test_campanhas_engine.py` (modificado: stub de `postgrest.exceptions.APIError` + 2 testes novos)

## QA Results
_A ser preenchido pelo @qa após a implementação._
