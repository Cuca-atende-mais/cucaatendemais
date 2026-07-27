# Plan 004: Corrigir corrida no caminho de INSERT do breadcrumb de disparo (achado #5 revisado)

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes de seguir pro próximo
> passo. Se algo na seção "STOP conditions" acontecer, pare e reporte — não
> improvise. Ao terminar, atualize a linha de status deste plano em
> `plans/README.md`.
>
> **Drift check (rodar primeiro)**: `git diff --stat 256d547..HEAD -- worker/campanhas_engine.py worker/tests/test_campanhas_engine.py`
> Se `worker/campanhas_engine.py` mudou desde que este plano foi escrito,
> compare o trecho da seção "Estado atual" contra o código ao vivo antes de
> prosseguir; se não bater, trate como STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (mas é uma continuação direta do Plan 001, já mergeado como PR #53/#54 — este plano corrige uma lacuna que sobrou naquele fix, não repete o trabalho)
- **Category**: bug (corrida de concorrência)
- **Planned at**: commit `256d547`, 2026-07-25

## Why this matters — isto NÃO é o achado #5 original, é uma causa raiz mais profunda encontrada durante esta investigação

O relatório `docs/qa/INVESTIGACAO-comportamento-conversas-disparo-corrida-2026-07-25.md` (achado #5) documentou um caso real (lead "Glauwênya de Francesco") que recebeu a resposta canned "De novo, foi mal! 😅" em reação a um agradecimento — atribuído, na hora, a "só existe 1 resposta enlatada de cortesia, sem variação". **Investigação adicional, feita depois do relatório, encontrou uma causa mais precisa e mais séria**, registrada aqui pela primeira vez:

1. O PR #53/#54 (Plan 001 deste mesmo diretório, já mergeado) corrigiu o `_gravar_breadcrumb_disparo` pra **mesclar** o `metadata` da conversa em vez de sobrescrever — mas o caminho de **criação** de uma conversa nova (quando o lead nunca tinha falado com o bot antes do disparo) continua usando um **`.insert()` simples, não atômico**, enquanto o caminho equivalente do fluxo inbound (`worker/meta_adapter_inbound.py:604-613`, já corrigido desde a S-WM-31) usa `.upsert(..., on_conflict="lead_id,origem_id")`.
2. Isso cria uma corrida real: se a resposta automática do WhatsApp Business do lead (comum em números comerciais — confirmado que uma fração real dos 724 destinatários desse disparo eram números comerciais, ver achado à parte no mesmo relatório) chega **quase ao mesmo tempo** que o `_gravar_breadcrumb_disparo` tenta gravar o breadcrumb pela primeira vez, os dois processos competem pra criar a MESMA linha `conversas` (mesma `lead_id`+`origem_id`). O fluxo inbound, sendo atômico, sempre vence sem erro. O `_gravar_breadcrumb_disparo`, quando perde a corrida, tenta um `INSERT` numa linha que já existe (constraint `UNIQUE(lead_id, origem_id)`, aplicada desde a S-WM-31) — a exceção é capturada silenciosamente pelo `except Exception as bc_err: logger.warning(...)` no chamador (`worker/campanhas_engine.py`, dentro de `_processar_item_disparo_interno`) e **o breadcrumb nunca é gravado**.
3. Confirmado no caso real da Glauwênya: sua conversa, consultada depois do incidente, tinha `metadata = {"conversa_engajada": true, "aguardando_unidade": false}` — **sem `ultimo_disparo`**, diferente de outros leads do mesmo disparo (ex.: outro lead do mesmo evento tinha `metadata.ultimo_disparo.id` corretamente gravado). O 1º evento da conversa dela, às 21:06:06, é literalmente a resposta automática de ausência do WhatsApp Business dela — exatamente o cenário de corrida descrito acima.
4. Isso importa mais do que "resposta sem variação" porque **existe um mecanismo já mergeado (PR #55, `deveReconhecerDisparoRecente`, `supabase/functions/motor-agente/index.ts:627`) que faz o bot reconhecer o disparo recente antes de cair na resposta canned de cortesia — mas ele só funciona se `metadata.ultimo_disparo` estiver presente**. Sem o breadcrumb (por causa desta corrida), o mecanismo do PR #55 não tem como ativar, e o lead cai na resposta genérica de qualquer jeito. Corrigir a corrida deste plano é o que faz o PR #55 funcionar pros leads que caem nesse cenário — **não é preciso mexer em nenhuma resposta canned pra resolver o achado #5**, a causa raiz está aqui.

## Estado atual

`worker/campanhas_engine.py`, função `_gravar_breadcrumb_disparo` (linha 63):

```python
def _gravar_breadcrumb_disparo(lead_id: str, origem_id: str, breadcrumb: dict) -> None:
    """
    Grava o breadcrumb do disparo na conversa do lead sem apagar o estado que o
    motor-agente gerencia em metadata (conversa_engajada, unidade_selecionada,
    aguardando_unidade — S-WM-31). Um upsert com "metadata" completo substitui a
    coluna inteira (Postgrest não faz merge de jsonb) — por isso lê o metadata
    atual e mescla em memória antes de escrever.

    Usa .limit(1) em vez do modo "single object" do Postgrest: com 0 linhas, esse
    modo devolve None como o próprio retorno de .execute() (não um objeto com
    .data=None) — acessar .data quebra com AttributeError, silenciosamente
    engolido pelo try/except do chamador. .limit(1).execute() sempre devolve um
    objeto com .data como lista.
    """
    existente = supabase.table("conversas").select("id, metadata").eq(
        "lead_id", lead_id
    ).eq("origem_id", origem_id).limit(1).execute()

    if existente.data:
        row = existente.data[0]
        metadata = row.get("metadata") or {}
        metadata.update(breadcrumb)
        supabase.table("conversas").update(
            {"metadata": metadata}
        ).eq("id", row["id"]).execute()
    else:
        supabase.table("conversas").insert({
            "lead_id": lead_id,
            "origem_id": origem_id,
            "agente_tipo": "Institucional",
            "canal_ativo": "meta",
            "status": "ativa",
            "metadata": breadcrumb,
        }).execute()
```

O ramo `else` (linha 89) é o problema: `SELECT` → "não achei" → `INSERT` simples não é atômico. Entre o `SELECT` e o `INSERT`, outra escrita (o upsert atômico do fluxo inbound) pode criar a mesma linha — o `INSERT` subsequente falha por violação de `UNIQUE(lead_id, origem_id)`.

**Exemplar do padrão correto, já usado no mesmo repositório** — `worker/meta_adapter_inbound.py:604-613`:
```python
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
```

## Comandos que você vai precisar

| Finalidade | Comando (de dentro de `worker/`) | Esperado no sucesso |
|---|---|---|
| Rodar a suíte completa do worker | `pytest tests/` | todos passam — anote a baseline antes de mexer |
| Rodar só o arquivo deste módulo | `pytest tests/test_campanhas_engine.py -v` | todos passam, incluindo os testes novos |
| Checar sintaxe | `python -c "import ast; ast.parse(open('campanhas_engine.py').read())"` | sem erro |

## Scope

**Em escopo (únicos arquivos a modificar)**:
- `worker/campanhas_engine.py`
- `worker/tests/test_campanhas_engine.py`

**Fora de escopo (não tocar, mesmo parecendo relacionado)**:
- `worker/meta_adapter_inbound.py` — já correto, é o exemplar a copiar, não precisa de mudança.
- `supabase/functions/motor-agente/index.ts` (`deveReconhecerDisparoRecente`, PR #55) — já correto e já testado; este plano só garante que ele *recebe* o dado que precisa.
- Qualquer mudança na resposta canned de cortesia/`evitarRepeticaoLiteral` — depois desta correção, o cenário documentado no achado #5 deve passar a ser coberto pelo mecanismo do PR #55 (reconhece o disparo em vez de cair na cortesia genérica); se ainda assim sobrar algum caso de resposta repetida sem `ultimo_disparo` disponível (cortesia genuína, sem disparo recente nenhum), isso é comportamento correto do `evitarRepeticaoLiteral`, não um bug.
- Não trocar o `.select(...).limit(1)` do ramo `if existente.data:` (linha 77-87) — esse ramo já está correto (mescla metadata em memória, só atualiza `status` quando a conversa é nova). O problema é só a falta de atomicidade entre esse `SELECT` e o `INSERT` do ramo `else`.

## Steps

### Step 1: Trocar o `INSERT` simples por um `upsert` atômico com merge de metadata preservado

O desafio: precisa continuar preservando o comportamento já corrigido pelo Plan 001 (merge de `metadata`, não sobrescrita) — um `upsert()` puro com `on_conflict` teria o MESMO problema original que o Plan 001 corrigiu (sobrescreve a coluna `metadata` inteira em caso de conflito). A correção certa aqui é usar o `upsert` só pra garantir a criação atômica da linha (resolvendo a corrida), e se ele cair no ramo de conflito (a linha já existia, criada pelo fluxo inbound entre o `SELECT` e agora), tratar isso como "a conversa já existe" e re-fazer o merge de metadata — não presumir que o upsert sozinho resolve o merge.

Abordagem recomendada — envolver a lógica existente numa segunda tentativa quando o `INSERT` falhar por conflito, em vez de reescrever tudo:

```python
def _gravar_breadcrumb_disparo(lead_id: str, origem_id: str, breadcrumb: dict) -> None:
    """
    ... (docstring existente mantida, adicionar:)

    Achado 2026-07-25: o ramo de criação (linha ~89 antes desta correção) usava
    INSERT simples, não atômico — se o fluxo inbound (upsert atômico,
    meta_adapter_inbound.py:604-613) criasse a mesma linha entre o SELECT e o
    INSERT deste ramo (corrida real: resposta automática de WhatsApp Business
    do lead chegando quase junto do disparo), o INSERT falhava por violação de
    UNIQUE(lead_id, origem_id), a exceção era engolida pelo try/except do
    chamador, e o breadcrumb nunca era gravado — visto em produção (lead real
    sem `ultimo_disparo` na metadata, apesar de ter recebido o disparo).
    Corrigido: se o INSERT falhar, tenta de novo como update (a linha existe
    agora, criada pela outra escrita) em vez de deixar a exceção subir.
    """
    existente = supabase.table("conversas").select("id, metadata").eq(
        "lead_id", lead_id
    ).eq("origem_id", origem_id).limit(1).execute()

    if existente.data:
        row = existente.data[0]
        metadata = row.get("metadata") or {}
        metadata.update(breadcrumb)
        supabase.table("conversas").update(
            {"metadata": metadata}
        ).eq("id", row["id"]).execute()
        return

    try:
        supabase.table("conversas").insert({
            "lead_id": lead_id,
            "origem_id": origem_id,
            "agente_tipo": "Institucional",
            "canal_ativo": "meta",
            "status": "ativa",
            "metadata": breadcrumb,
        }).execute()
    except Exception:
        # Corrida: outra escrita (fluxo inbound) criou a linha entre o SELECT
        # acima e este INSERT. Re-busca e mescla em vez de perder o breadcrumb.
        existente_retry = supabase.table("conversas").select("id, metadata").eq(
            "lead_id", lead_id
        ).eq("origem_id", origem_id).limit(1).execute()
        if not existente_retry.data:
            raise  # não era uma corrida — propaga o erro original de verdade
        row = existente_retry.data[0]
        metadata = row.get("metadata") or {}
        metadata.update(breadcrumb)
        supabase.table("conversas").update(
            {"metadata": metadata}
        ).eq("id", row["id"]).execute()
```

**Verify**: `python -c "import ast; ast.parse(open('campanhas_engine.py').read())"` (de dentro de `worker/`) → sem erro de sintaxe.

### Step 2: Teste — reproduz a corrida (insert falha por conflito) e confirma que o retry salva o breadcrumb

Em `worker/tests/test_campanhas_engine.py`, seguindo o mesmo padrão de mock já usado por `test_breadcrumb_cria_conversa_nova_quando_lead_nunca_falou_com_o_bot` (mockar `mock_sb.table.return_value...`), adicione:

```python
def test_breadcrumb_recupera_de_corrida_quando_insert_falha_por_conflito(monkeypatch):
    """Achado 2026-07-25: se o INSERT falhar (linha criada por outra escrita entre o
    SELECT e o INSERT — corrida real com o fluxo inbound), o breadcrumb precisa ser
    salvo via retry (update), não perdido silenciosamente."""
    mock_sb = MagicMock()

    # 1º select: não encontra a conversa (decide ir pro ramo de INSERT)
    primeiro_select = MagicMock(data=[])
    # INSERT falha (simula violação de UNIQUE — outra escrita venceu a corrida)
    mock_sb.table.return_value.insert.return_value.execute.side_effect = Exception(
        "duplicate key value violates unique constraint \"conversas_lead_id_origem_id_key\""
    )
    # 2º select (retry): agora encontra a linha, criada pela "outra escrita"
    segundo_select = MagicMock(data=[{"id": "conversa-race-1", "metadata": {"conversa_engajada": True}}])

    (mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value
        .limit.return_value.execute.side_effect) = [primeiro_select, segundo_select]

    monkeypatch.setattr(camp, "supabase", mock_sb)

    camp._gravar_breadcrumb_disparo(
        "lead-race", "phone-1", {"ultimo_disparo": {"tipo": "eventos_pontuais", "id": "evt-race"}}
    )

    update_call = mock_sb.table.return_value.update.call_args
    metadata_gravado = update_call.args[0]["metadata"]
    assert metadata_gravado["conversa_engajada"] is True
    assert metadata_gravado["ultimo_disparo"]["id"] == "evt-race"
```

Ajuste a sintaxe exata de `side_effect` em cadeia de mock se necessário (o importante é: 1º select vazio, insert lança exceção, 2º select encontra a linha, update é chamado com metadata mesclado).

**Verify**: `pytest tests/test_campanhas_engine.py -v` (de dentro de `worker/`) → o teste novo passa, junto com os 2 testes já existentes de `_gravar_breadcrumb_disparo` (que não podem regredir).

### Step 3: Mutation check manual

Reverta temporariamente o Step 1 (volte pro `INSERT` simples sem `try/except`/retry) e rode o teste do Step 2 de novo — deve **falhar** (a exceção simulada do insert sobe sem ser tratada, o teste não chega a verificar o `update`). Restaure e confirme que volta a passar.

**Verify**: revertido → FALHA (exceção não tratada ou update nunca chamado). Restaurado → PASSA.

### Step 4: Suíte completa

**Verify**: `pytest tests/` (de dentro de `worker/`) → mesmo número de `passed` que a baseline, mais o teste novo, 0 falhas. Os 2 testes existentes de `_gravar_breadcrumb_disparo` (`test_breadcrumb_preserva_metadata_existente_da_conversa_engajada`, `test_breadcrumb_cria_conversa_nova_quando_lead_nunca_falou_com_o_bot`) precisam continuar passando sem alteração.

## Test plan

- `test_breadcrumb_recupera_de_corrida_quando_insert_falha_por_conflito` — cobre o cenário real de corrida (visto em produção, lead Glauwênya).
- Os 2 testes já existentes de `_gravar_breadcrumb_disparo` continuam sendo a regressão a não quebrar (não precisam de mudança, mas rodam como parte da suíte).
- Padrão estrutural a seguir: os próprios testes já existentes de `_gravar_breadcrumb_disparo` no mesmo arquivo (mesmo estilo de mock, `monkeypatch.setattr(camp, "supabase", mock_sb)`).
- Verificação final: `pytest tests/` → todos passam.

## Done criteria

- [ ] `pytest tests/` sai com exit 0
- [ ] O teste novo existe em `worker/tests/test_campanhas_engine.py` e passa
- [ ] Os 2 testes existentes de `_gravar_breadcrumb_disparo` continuam passando sem modificação
- [ ] `grep -n "except Exception" worker/campanhas_engine.py` mostra o novo bloco de retry dentro de `_gravar_breadcrumb_disparo`
- [ ] Nenhum arquivo fora da lista de escopo foi modificado
- [ ] `plans/README.md` atualizado

## STOP conditions

- O trecho em "Estado atual" não bater com o código ao vivo (arquivo mudou desde que este plano foi escrito — especialmente se `_gravar_breadcrumb_disparo` já tiver sido alterado por outro PR nesse meio tempo).
- O `except Exception:` genérico proposto no Step 1 acabar mascarando outros tipos de erro que não são de conflito de constraint (ex.: erro de rede) — se durante os testes ficar claro que isso é um risco real (ex.: a suíte de testes de erro de rede de outras funções depende de distinguir tipos de exceção), pare e avalie se vale restringir pra um tipo de exceção mais específico (verificar se `postgrest-py`/`supabase-py` expõe uma exceção tipada pra violação de constraint, em vez de `Exception` genérica) antes de prosseguir.
- Um teste falhar 2 vezes seguidas depois de ajuste razoável.

## Maintenance notes

- Este plano fecha o loop com o PR #55 (`deveReconhecerDisparoRecente`) — depois desta correção, vale validar ao vivo (ou aguardar o próximo disparo em massa) se leads com resposta automática de WhatsApp Business passam a ter `ultimo_disparo` corretamente gravado e o bot passa a reconhecer o disparo recente em vez de cair na cortesia genérica.
- Se o volume de disparos crescer muito e esse tipo de corrida (insert vs. upsert atômico) aparecer em outro lugar do código, vale considerar migrar `_gravar_breadcrumb_disparo` pra uma função RPC atômica no Postgres (mesmo padrão de `claim_evento_pontual`), em vez de resolver corrida por corrida no lado Python — mas isso é fora de escopo deste plano (esforço L, não S).
