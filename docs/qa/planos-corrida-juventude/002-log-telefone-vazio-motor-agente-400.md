# Plan 002: Logar o `telefone` enviado quando o motor-agente rejeita a requisição com HTTP 400

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes de seguir pro próximo
> passo. Se algo na seção "STOP conditions" acontecer, pare e reporte — não
> improvise. Ao terminar, atualize a linha de status deste plano em
> `plans/README.md`.
>
> **Drift check (rodar primeiro)**: `git diff --stat 256d547..HEAD -- worker/meta_adapter_inbound.py worker/tests/test_meta_adapter_inbound.py`
> Se `worker/meta_adapter_inbound.py` mudou desde que este plano foi escrito,
> compare o trecho da seção "Estado atual" contra o código ao vivo antes de
> prosseguir; se não bater, trate como STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (instrumentação/observabilidade — não é uma correção)
- **Planned at**: commit `256d547`, 2026-07-25

## Why this matters

Durante um disparo em massa de 724 leads (24/07/2026), **32 de ~69 chamadas do worker ao `motor-agente` falharam com HTTP 400** (`"telefone e agente_tipo sao obrigatorios"`) — 46% de taxa de falha, afetando 30 pessoas reais que só receberam a mensagem de fallback genérica ("Ih, deu um problema técnico...") em vez de resposta de verdade. Relato completo com toda a evidência (logs da Supabase edge-function e edge-function-runtime cruzados por timestamp, hipóteses já descartadas por leitura de código) em `docs/qa/INVESTIGACAO-comportamento-conversas-disparo-corrida-2026-07-25.md`.

**A causa raiz não foi confirmada, mas a investigação avançou bastante desde a 1ª versão deste plano.** Achados atualizados (26/07):
- Cruzando `leads.created_at` com o horário exato de cada falha: **27 dos 32 casos têm entre 11 e 12,5 segundos** entre "lead criado pela 1ª vez" e "falha" — bate com o debounce (10s) + processamento. **A falha está concentrada na 1ª mensagem de um lead recém-criado no banco.**
- Conferido 12h+ depois do disparo (tráfego normal, sem nenhum disparo em massa rolando): o bug **continua acontecendo**, com o mesmo padrão de ~11-13s — descarta qualquer explicação ligada a volume/carga do disparo em massa.
- Contradição honesta: leads que **não** falharam (ex.: Esmael, Rafa na 1ª mensagem, Evelyn) também têm o lead criado a milissegundos da 1ª mensagem — "ser lead novo" não é 100% determinístico, é mais uma correlação forte (~75-80% de falha nesse caminho específico) do que uma regra sem exceção.
- Já descartado por leitura de código: corrida no debounce, estado compartilhado no FastAPI, tipo de mensagem não suportado, **e triggers de banco em `leads`/`conversas`/`mensagens`** (`information_schema.triggers` retornou vazio pras 3 tabelas — confirmado, não é isso).

Dado que a causa raiz exata ainda depende de dado ao vivo que falta, e que o padrão aponta fortemente pro caminho de criação de lead/conversa, este plano agora tem **2 pontos de instrumentação**, não 1: (a) o log de falha original (telefone/conversa_id) e (b) um log novo indicando se o lead/conversa eram novos ou já existiam nesta chamada — juntos, a próxima ocorrência real deve fechar a causa de vez.

Não há acesso a SSH/`docker logs` do host pra reconstruir isso depois do fato (testado: console do EasyPanel é só um shell dentro do próprio container, sem acesso ao Docker — `docker: not found`) — por isso a instrumentação embutida é o caminho, não investigação forense posterior.

## Estado atual

Arquivo relevante: `worker/meta_adapter_inbound.py`, função `_chamar_motor_agente` (linha 292) — chama a edge function `motor-agente` e trata a resposta.

Trecho atual, linhas 323-355:

```python
    body = {
        "mensagem":    contrato_v2["mensagem"],
        "midia_url":   contrato_v2.get("midia_url"),
        "midia_tipo":  contrato_v2.get("midia_tipo"),
        "telefone":    contrato_v2["telefone"],
        "canal_origem": contrato_v2["canal_origem"],
        "agente_tipo": contrato_v2["agente_tipo"],
        "unidade_cuca": contrato_v2.get("unidade_cuca"),
        "conversa_id": conversa_id,
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{supabase_url}/functions/v1/motor-agente",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
    except Exception as exc:
        logger.error("[meta-inbound] Erro de rede ao chamar motor-agente: %s", type(exc).__name__)
        return None

    if not resp.is_success:
        logger.error(
            "[meta-inbound] motor-agente HTTP %s para agente=%s: %s",
            resp.status_code,
            contrato_v2.get("agente_tipo"),
            resp.text[:200],
        )
        return None
```

O log de falha (linha ~349-354) já existe e já dispara pra qualquer HTTP não-2xx — mas não inclui `telefone` nem `conversa_id`, exatamente os 2 dados que faltam pra diagnosticar o achado #1 (o próprio erro retornado pela Meta/motor-agente, `resp.text[:200]`, é literalmente `{"error": "telefone e agente_tipo sao obrigatorios"}` — sem saber qual telefone foi mandado, não dá pra saber se o problema é o valor estar vazio, truncado, ou qualquer outra coisa).

**Ponto de inserção (Step 1)**: dentro do bloco `if not resp.is_success:` já existente — não é um log novo do zero, é adicionar 2 campos ao log que já dispara nesse ponto.

**Segundo trecho relevante — criação de lead/conversa** (`worker/meta_adapter_inbound.py`, dentro de `processar_webhook_meta`, linhas 610-649):

```python
    # ── DB A: upsert Lead por telefone ────────────────────────────────────
    try:
        lead_result = supabase.table("leads").upsert(
            {"telefone": telefone, "nome": push_name, "updated_at": "now()"},
            on_conflict="telefone",
        ).execute()
        lead_id: str = lead_result.data[0]["id"]
        _fresh = supabase.table("leads").select("bloqueado").eq("id", lead_id).single().execute()
        bloqueado: bool = (_fresh.data or {}).get("bloqueado", False)
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao gerenciar Lead: {exc}")
        return

    if bloqueado:
        logger.info(f"[meta-inbound] Lead {telefone} está bloqueado — mensagem ignorada")
        return

    # ── DB B: recuperar ou criar Conversa por (lead_id, origem_id) ──────
    try:
        supabase.table("conversas").upsert(
            {
                "lead_id":    lead_id,
                "origem_id":  phone_number_id,
                "canal_ativo": "meta",
                "agente_tipo": agente_tipo,
                "updated_at": "now()",
            },
            on_conflict="lead_id,origem_id",
        ).execute()

        conv_fresh = supabase.table("conversas").select("id, status").match(
            {"lead_id": lead_id, "origem_id": phone_number_id}
        ).execute()
        conversa_id: str = conv_fresh.data[0]["id"]
        conversa_status = conv_fresh.data[0].get("status")
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao gerenciar Conversa: {exc}")
        return
```

**Ponto de inserção (Step 2, novo)**: logo depois de `lead_id`/`conversa_id` estarem resolvidos (antes do bloco "DB C"), adicionar 1 log INFO que diz se o lead e a conversa foram criados agora ou já existiam — pra correlacionar com o log de falha do Step 1 via `conversa_id` (que aparece nos dois).

## Comandos que você vai precisar

| Finalidade | Comando (de dentro de `worker/`) | Esperado no sucesso |
|---|---|---|
| Rodar a suíte completa do worker | `pytest tests/` | todos passam — anote o número exato observado antes de mexer em qualquer coisa (baseline) |
| Rodar só o arquivo deste módulo | `pytest tests/test_meta_adapter_inbound.py -v` | todos passam, incluindo o teste novo deste plano |
| Checar sintaxe | `python -c "import ast; ast.parse(open('meta_adapter_inbound.py').read())"` | sem erro |

## Scope

**Em escopo (únicos arquivos a modificar)**:
- `worker/meta_adapter_inbound.py`
- `worker/tests/test_meta_adapter_inbound.py`

**Fora de escopo (não tocar, mesmo parecendo relacionado)**:
- Qualquer tentativa de corrigir a causa raiz do `telefone` vazio — **ainda não está confirmada**, corrigir às cegas seria chute. Este plano é só o log que vai revelar a causa na próxima ocorrência.
- `supabase/functions/motor-agente/index.ts` — a validação que rejeita a requisição (`if (!telefone || !agente_tipo) return ...400`) está correta e não deve mudar; é o worker que precisa logar o que manda, não a edge function relaxar a validação.
- Qualquer outro log/print no arquivo — só o bloco `if not resp.is_success:` está em escopo.

## Git workflow

- Branch: `fix/log-telefone-vazio-motor-agente-400` (ou o padrão já observado no repo — ver `git log --oneline -10`, ex.: `fix/...`).
- Commit único, seguindo o estilo do repo: `fix(worker): loga telefone/conversa_id quando motor-agente rejeita requisicao com 400`
- Não dar push nem abrir PR a menos que instruído explicitamente.

## Steps

### Step 1: Adicionar `telefone` e `conversa_id` ao log de falha existente

Em `worker/meta_adapter_inbound.py`, dentro de `_chamar_motor_agente`, troque o bloco:

```python
    if not resp.is_success:
        logger.error(
            "[meta-inbound] motor-agente HTTP %s para agente=%s: %s",
            resp.status_code,
            contrato_v2.get("agente_tipo"),
            resp.text[:200],
        )
        return None
```

por:

```python
    if not resp.is_success:
        logger.error(
            "[meta-inbound] motor-agente HTTP %s para agente=%s conversa_id=%s telefone=%r: %s",
            resp.status_code,
            contrato_v2.get("agente_tipo"),
            conversa_id,
            contrato_v2.get("telefone"),
            resp.text[:200],
        )
        return None
```

Notas:
- Use `contrato_v2.get("telefone")` (não `contrato_v2["telefone"]`) por segurança — se a causa raiz for exatamente a chave estar ausente do dict (não só vazia), `.get()` não quebra o próprio log tentando diagnosticar o problema.
- `%r` (não `%s`) pro telefone — se o valor for `None` em vez de string vazia `""`, isso aparece diferente no log (`None` vs `''`), e essa distinção pode ser exatamente a pista que falta.
- `conversa_id` já está disponível como parâmetro da função (linha 294) — não precisa buscar em lugar nenhum.

**Verify**: `python -c "import ast; ast.parse(open('meta_adapter_inbound.py').read())"` (de dentro de `worker/`) → sem erro de sintaxe.

### Step 2 (novo): logar se o lead/conversa foram criados agora ou já existiam

Em `worker/meta_adapter_inbound.py`, dentro de `processar_webhook_meta`:

1. Troque o select de `conv_fresh` pra incluir `created_at, updated_at`:

```python
        conv_fresh = supabase.table("conversas").select("id, status, created_at, updated_at").match(
            {"lead_id": lead_id, "origem_id": phone_number_id}
        ).execute()
```

2. Logo depois do bloco "DB B" (depois de `conversa_status = conv_fresh.data[0].get("status")`, antes do comentário `# ── DB C:`), adicione:

```python
    # Achado 2026-07-25/26: 27 de 32 casos de HTTP 400 do motor-agente (telefone
    # vazio) aconteceram entre 11-12,5s da criação do lead — correlação forte com
    # "1ª mensagem de lead novo", mas não 100% determinística (alguns leads novos
    # não falharam). Log temporário pra fechar a causa exata na próxima ocorrência
    # real — remover quando o achado #1 (docs/qa/INVESTIGACAO-comportamento-
    # conversas-disparo-corrida-2026-07-25.md) estiver resolvido.
    try:
        lead_criado_agora = lead_result.data[0].get("created_at") == lead_result.data[0].get("updated_at")
        conversa_criada_agora = conv_fresh.data[0].get("created_at") == conv_fresh.data[0].get("updated_at")
        logger.info(
            "[meta-inbound][DIAG-achado1] conversa_id=%s lead_id=%s lead_novo=%s conversa_nova=%s",
            conversa_id, lead_id, lead_criado_agora, conversa_criada_agora,
        )
    except (IndexError, KeyError, AttributeError) as exc:
        logger.warning("[meta-inbound][DIAG-achado1] Erro ao calcular lead_novo/conversa_nova: %s", exc)
```

Notas:
- Comparar `created_at == updated_at` é uma aproximação (ambos vêm de `now()` no mesmo INSERT quando a linha é nova; num UPDATE via upsert, só `updated_at` muda) — não precisa ser exato ao milissegundo, é só pra classificar "novo" vs "já existia".
- Esse log dispara em **toda mensagem recebida**, não só nas que falham depois — isso é proposital (precisa correlacionar com o log de falha do Step 1 via `conversa_id`, que só existe quando a chamada falha). Adiciona volume de log, mas é o único jeito de saber "esse lead era novo" pros casos que **não** falharam também (pra comparar taxa de falha entre novo/existente de verdade, não só nos casos que já falharam).
- Tag `[DIAG-achado1]` de propósito, pra dar pra filtrar/remover fácil quando o achado #1 for resolvido (ver Maintenance notes).

**Verify**: `python -c "import ast; ast.parse(open('meta_adapter_inbound.py').read())"` (de dentro de `worker/`) → sem erro de sintaxe.

### Step 3: Teste — confirma que o log de falha inclui os campos novos

Em `worker/tests/test_meta_adapter_inbound.py`, adicione um teste que força uma resposta HTTP 400 do motor-agente e verifica que o log capturado contém `telefone` e `conversa_id`. Use `caplog` (fixture nativa do pytest) pra capturar o log, e mocke `httpx.AsyncClient` do jeito que os outros testes desse arquivo já fazem pra chamadas de rede (procure por testes existentes de `_chamar_motor_agente` no mesmo arquivo pra copiar o padrão exato de mock do cliente HTTP assíncrono — não invente um novo padrão de mock).

Estrutura esperada do teste (ajuste os detalhes de mock pro padrão real já usado no arquivo):

```python
import logging

async def test_log_de_falha_400_inclui_telefone_e_conversa_id(monkeypatch, caplog):
    """Achado 2026-07-25: 46% das chamadas ao motor-agente falharam com HTTP 400
    ("telefone e agente_tipo sao obrigatorios") durante um disparo em massa, e não
    havia como saber qual telefone foi enviado — este teste trava que o campo
    aparece no log de erro a partir de agora."""
    contrato_v2 = {
        "mensagem": "oi", "telefone": "", "canal_origem": "123",
        "agente_tipo": "Institucional", "midia_url": None, "midia_tipo": "text",
    }
    # mock do httpx.AsyncClient retornando um response 400 — seguir o padrão
    # de mock já usado nos outros testes de _chamar_motor_agente neste arquivo
    ...
    with caplog.at_level(logging.ERROR):
        resultado = await meta_adapter_inbound._chamar_motor_agente(
            contrato_v2, "conversa-teste-123", supabase=MagicMock()
        )
    assert resultado is None
    assert "conversa-teste-123" in caplog.text
    assert "telefone=" in caplog.text
```

**Verify**: `pytest tests/test_meta_adapter_inbound.py -v` (de dentro de `worker/`) → o teste novo passa.

### Step 4 (novo): teste — confirma o log de `lead_novo`/`conversa_nova`

Em `worker/tests/test_meta_adapter_inbound.py`, adicione um teste que simula um webhook completo com um lead **novo** (mock do select de `leads`/`conversas` devolvendo `created_at == updated_at`) e confirma que o log `[DIAG-achado1]` aparece com `lead_novo=True`. Siga o padrão de mock de webhook completo já usado pelos testes existentes de `processar_webhook_meta` no mesmo arquivo.

```python
async def test_log_diagnostico_indica_lead_novo(monkeypatch, caplog):
    """Achado 2026-07-25/26: 27 de 32 falhas do achado #1 aconteceram ~11-12s após
    o lead ser criado — este log deixa explícito se o lead/conversa eram novos,
    pra correlacionar com o log de falha do Step 1 na próxima ocorrência real."""
    ...
    with caplog.at_level(logging.INFO):
        await meta_adapter_inbound.processar_webhook_meta(payload_bytes)
    assert "DIAG-achado1" in caplog.text
    assert "lead_novo=True" in caplog.text
```

**Verify**: `pytest tests/test_meta_adapter_inbound.py -v` (de dentro de `worker/`) → o teste novo passa.

### Step 5: Mutation check manual (confirmar que os testes não são decorativos)

- Reverta temporariamente o Step 1 (volte o log pro formato antigo, sem `conversa_id`/`telefone`) e rode o teste do Step 3 de novo — deve **falhar**.
- Reverta temporariamente o Step 2 (remova o bloco de log `[DIAG-achado1]`) e rode o teste do Step 4 de novo — deve **falhar**.
- Restaure os dois e confirme que ambos voltam a passar.

**Verify**: cada um revertido individualmente → FALHA no teste correspondente. Ambos restaurados → PASSA nos dois.

### Step 6: Suíte completa

**Verify**: `pytest tests/` (de dentro de `worker/`) → mesmo número de `passed` que a baseline anotada no Step 0 do plano, mais os 2 testes novos, 0 falhas.

## Test plan

- `test_log_de_falha_400_inclui_telefone_e_conversa_id` — cobre o cenário do Step 1 (HTTP 400 do motor-agente), confirma que `telefone` e `conversa_id` aparecem no log de erro.
- `test_log_diagnostico_indica_lead_novo` — cobre o cenário do Step 2, confirma que o log `[DIAG-achado1]` aparece com `lead_novo`/`conversa_nova` corretos.
- Padrão estrutural a seguir: os testes existentes de `_chamar_motor_agente` e de `processar_webhook_meta` completo no mesmo arquivo — copiar os mocks, não reinventar.
- Verificação final: `pytest tests/` → todos passam, incluindo os 2 novos.

## Done criteria

Machine-checkable. TODAS precisam valer:

- [ ] `pytest tests/` (de dentro de `worker/`) sai com exit 0
- [ ] Os 2 testes novos existem em `worker/tests/test_meta_adapter_inbound.py` e passam
- [ ] `grep -n "telefone=" worker/meta_adapter_inbound.py` retorna pelo menos 1 ocorrência dentro de `_chamar_motor_agente`
- [ ] `grep -n "DIAG-achado1" worker/meta_adapter_inbound.py` retorna pelo menos 2 ocorrências (log de sucesso + log de erro do `except`)
- [ ] Nenhum arquivo fora da lista de escopo foi modificado (`git status`)
- [ ] `plans/README.md` — linha de status do Plan 002 atualizada para DONE

## STOP conditions

Pare e reporte (não improvise) se:

- O trecho em "Estado atual" não bater com o código ao vivo em `_chamar_motor_agente` ou `processar_webhook_meta` (arquivo mudou desde que este plano foi escrito).
- Não existir nenhum teste prévio de `_chamar_motor_agente`/`processar_webhook_meta` completo no arquivo de teste pra copiar o padrão de mock — nesse caso, pare e pergunte antes de inventar um padrão novo.
- `lead_result.data[0]` ou `conv_fresh.data[0]` não incluírem `created_at`/`updated_at` de verdade (ex.: se o cliente supabase-py não devolver representação completa por padrão) — nesse caso a comparação do Step 2 sempre daria `False`/erro; confirme isso rodando contra um mock realista antes de assumir que funciona.
- Um teste falhar 2 vezes seguidas depois de uma tentativa razoável de ajuste.

## Maintenance notes

- Esses logs são temporários, marcados com a tag `[DIAG-achado1]` de propósito — quando a causa raiz do achado #1 for confirmada e corrigida, remover o bloco do Step 2 (e considerar se o log do Step 1 continua valendo a pena manter permanentemente, já que é mais barato e genericamente útil).
- Quando a próxima ocorrência real acontecer, cruzar os dois logs pelo `conversa_id`: se `lead_novo=True`/`conversa_nova=True` aparecer sempre que a falha do Step 1 disparar (e nunca quando não falha), a causa fica confirmada; se aparecer misturado (como já é o caso parcial — ~75-80%, não 100%), o próximo passo é olhar o que mais difere entre os casos que falham e os que não falham dentro do subconjunto "lead novo".
- Quem revisar o PR deve conferir que o log do Step 2 não quebra o fluxo normal mesmo se `created_at`/`updated_at` vierem ausentes por algum motivo (daí o `try/except` around o cálculo).
- Não usar esses logs como solução definitiva — existem pra permitir um plano de correção real na próxima vez que o achado #1 se repetir, com o dado que faltou desta vez.
