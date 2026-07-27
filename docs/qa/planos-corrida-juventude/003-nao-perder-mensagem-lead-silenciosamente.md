# Plan 003: Não continuar o dispatch em silêncio quando o insert da mensagem do lead falha

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

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (a escolha de comportamento importa — ver "Why this matters" e a decisão pedida no Step 1)
- **Depends on**: none
- **Category**: bug (resiliência)
- **Planned at**: commit `256d547`, 2026-07-25

## Why this matters

`worker/meta_adapter_inbound.py`, dentro de `processar_webhook_meta`, insere a mensagem do lead em `mensagens` **antes** de agendar a resposta da IA. Se esse insert falhar, o código atual só loga o erro e **continua** o processamento como se a mensagem tivesse sido salva — o dispatch pro motor-agente é agendado normalmente. Resultado possível: a mensagem original do lead nunca fica registrada no histórico (sem alertar ninguém), mesmo o sistema tentando responder a ela. Achado #2 do relatório `docs/qa/INVESTIGACAO-comportamento-conversas-disparo-corrida-2026-07-25.md` (encontrado lendo o código durante a investigação de outro achado — não foi confirmado que aconteceu nos casos reais documentados lá, é uma lacuna de resiliência real, separada).

**Trade-off que este plano pede pra você decidir com cuidado, não assumir:** interromper o processamento (`return` logo após a falha) significa que o lead **não recebe nenhuma resposta** — nem a mensagem de fallback técnico, nada. Isso pode ser pior do que a situação atual (responder sem o registro persistido). A alternativa é manter o fluxo mas tornar a falha **visível/rastreável** de verdade, não só um `logger.error` que ninguém olha em tempo real. Este plano pede a 2ª abordagem como padrão, mas documenta a 1ª como alternativa caso a pessoa que revisar prefira.

## Estado atual

Arquivo: `worker/meta_adapter_inbound.py`, dentro de `processar_webhook_meta` (começa linha ~558), bloco "DB C" (linhas 654-673 na versão atual):

```python
    # ── DB C: inserir Mensagem inbound e incrementar não lidas ──────────
    try:
        supabase.table("mensagens").insert({
            "conversa_id": conversa_id,
            "lead_id": lead_id,
            "tipo": midia_tipo,
            # AUD-14: mídia sem legenda (imagem) ou áudio sem transcrição chegam com
            # mensagem="" — gravar string vazia no histórico polui o painel do colaborador
            # com turnos de usuário vazios e sem rastreabilidade do que o lead realmente
            # mandou. `mensagem` (o texto real, se houver) segue intacto pro motor-agente
            # via contrato_v2["mensagem"] — só o registro no histórico ganha um texto
            # descritivo mínimo quando não há texto nenhum.
            "conteudo": mensagem or _texto_historico_para_midia_vazia(midia_tipo),
            "remetente": "lead",
            "created_at": "now()",
            "wamid": contrato_v2.get("wamid") or None,
        }).execute()
        supabase.rpc("increment_nao_lidas", {"conv_id": conversa_id}).execute()
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao salvar Mensagem: {exc}")
        # sem `return` aqui — processamento continua pro dispatch mesmo se isso falhou
```

Repare o padrão já usado em blocos vizinhos deste MESMO arquivo pra decisões parecidas (interromper vs. continuar): o bloco anterior, "DB A" (upsert de Lead, ~linha 605-620), **interrompe** com `return` se falhar — porque sem o lead persistido, não há como continuar (não tem `lead_id`). Já "DB B" (conversa) também interrompe. O padrão do arquivo até aqui é: **falhas em escrita que são pré-requisito de dados pra continuar → `return`**. A mensagem em si não é tecnicamente um pré-requisito de dado pra continuar (o dispatch usa `contrato_v2["mensagem"]`, que já foi montado antes, independente do insert) — é só o REGISTRO no histórico que se perde. Isso é o motivo pelo qual o comportamento aqui foi deliberadamente diferente (não interromper) — mas sem nenhuma forma de alerta, é uma falha completamente silenciosa hoje.

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
- Os blocos "DB A" (Lead) e "DB B" (Conversa) — já interrompem corretamente com `return`, não precisam de mudança.
- Qualquer sistema de alerta externo (Sentry, Slack, etc.) — se o repo já tiver Sentry configurado (`sentry-sdk` aparece no `requirements.txt`), verificar se já está inicializado neste arquivo/módulo antes de decidir se usa; se não houver nenhum uso de Sentry em `worker/`, não introduza a dependência agora — use só `logger.error`/`logger.critical` com mais contexto, é o que já existe no arquivo.

## Steps

### Step 1: Decidir e implementar o tratamento (leia o trade-off antes de escrever código)

**Abordagem recomendada por este plano** (mas o executor deve avaliar contra o que já existe no arquivo antes de aplicar cegamente): manter o fluxo (não fazer `return`), mas:
1. Subir o nível do log de `error` pra `critical` (ou manter `error`, mas adicionar um marcador textual fácil de buscar/alertar, tipo `"[meta-inbound][DATA-LOSS]"`) — pra diferenciar isso de outros `logger.error` genéricos do arquivo, que hoje são todos do mesmo nível.
2. Incluir no log o `conversa_id`, `lead_id` e o próprio `mensagem`/`midia_tipo` que não foi salvo — se o histórico não vai ter o registro, o log precisa ser autossuficiente pra alguém reconstruir manualmente o que aconteceu, se precisar.

Trecho a substituir:

```python
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao salvar Mensagem: {exc}")
```

por:

```python
    except Exception as exc:
        logger.critical(
            "[meta-inbound][DATA-LOSS] Falha ao salvar Mensagem do lead — conteudo perdido do "
            "historico, dispatch vai continuar mesmo assim. conversa_id=%s lead_id=%s "
            "midia_tipo=%s mensagem=%r erro=%s",
            conversa_id, lead_id, midia_tipo, mensagem, exc,
        )
```

Não adicione `return` — a decisão deste plano é manter o comportamento de tentar responder mesmo sem o registro salvo (evita o lead ficar sem nenhuma resposta), só tornando a falha visível. **Se, ao revisar isto, você (ou quem revisar o PR) achar que interromper é mais seguro, documente essa mudança de decisão explicitamente no PR — não troque silenciosamente sem registrar o motivo.**

**Verify**: `python -c "import ast; ast.parse(open('meta_adapter_inbound.py').read())"` (de dentro de `worker/`) → sem erro de sintaxe.

### Step 2: Teste — confirma o log de nível `critical` com os dados certos

Em `worker/tests/test_meta_adapter_inbound.py`, adicione um teste que força uma exceção no insert de `mensagens` (mock do `supabase.table("mensagens").insert(...).execute()` levantando exceção) e confirma:
1. O processamento **continua** (o dispatch ainda é agendado/chamado — não houve `return` antecipado).
2. O log em nível `CRITICAL` contém `conversa_id` e `lead_id`.

Siga o padrão de mock de `supabase` já usado nos outros testes deste arquivo pra `processar_webhook_meta` (procure um teste existente que já mocka o webhook completo, incluindo o insert de `mensagens`, e adapte pra forçar a falha só nesse insert específico).

```python
async def test_falha_ao_salvar_mensagem_continua_processamento_com_log_critico(monkeypatch, caplog):
    """Achado #2 (2026-07-25): insert de mensagens falhando não pode ser 100% silencioso —
    trava que, quando falha, sobe pra CRITICAL com conversa_id/lead_id pra dar pra rastrear
    manualmente, mesmo sem interromper o dispatch."""
    ...
    with caplog.at_level(logging.CRITICAL):
        await meta_adapter_inbound.processar_webhook_meta(payload_bytes)
    assert any(r.levelname == "CRITICAL" for r in caplog.records)
    assert "DATA-LOSS" in caplog.text
```

**Verify**: `pytest tests/test_meta_adapter_inbound.py -v` (de dentro de `worker/`) → o teste novo passa.

### Step 3: Mutation check manual

Reverta temporariamente o Step 1 (volte pro `logger.error` original, sem o marcador `DATA-LOSS`) e rode o teste do Step 2 de novo — deve **falhar** (não acha `"DATA-LOSS"` no log, ou não acha nenhum record `CRITICAL`). Restaure e confirme que volta a passar.

**Verify**: revertido → FALHA. Restaurado → PASSA.

### Step 4: Suíte completa

**Verify**: `pytest tests/` (de dentro de `worker/`) → mesmo número de `passed` que a baseline, mais o teste novo, 0 falhas.

## Test plan

- `test_falha_ao_salvar_mensagem_continua_processamento_com_log_critico` — cobre o cenário exato do achado #2.
- Padrão estrutural a seguir: testes existentes de `processar_webhook_meta` no mesmo arquivo (já devem ter um mock completo de webhook Meta — reaproveitar, não recriar do zero).
- Verificação final: `pytest tests/` → todos passam, incluindo o novo.

## Done criteria

- [ ] `pytest tests/` sai com exit 0
- [ ] O teste novo existe e passa
- [ ] `grep -n "DATA-LOSS" worker/meta_adapter_inbound.py` retorna pelo menos 1 ocorrência
- [ ] Nenhum arquivo fora da lista de escopo foi modificado
- [ ] `plans/README.md` atualizado

## STOP conditions

- O trecho em "Estado atual" não bater com o código ao vivo (arquivo mudou).
- Não existir nenhum teste prévio de `processar_webhook_meta` completo pra copiar o padrão de mock — pare e pergunte antes de inventar um payload Meta mockado do zero.
- Um teste falhar 2 vezes seguidas depois de ajuste razoável.
- Se, durante a implementação, ficar claro que interromper (`return`) seria claramente mais seguro que continuar — pare e traga essa recomendação de volta em vez de decidir sozinho (é uma decisão de produto, não só técnica).

## Maintenance notes

- Se um dia este projeto adotar Sentry (ou similar) de forma mais ampla no worker, este `logger.critical` é o ponto natural pra também disparar um alerta externo — hoje fica só no log porque é o que já existe no arquivo.
- Revisor deve confirmar que o `return` não foi adicionado sem essa decisão estar documentada explicitamente no PR (ver Step 1).
