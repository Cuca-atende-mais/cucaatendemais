# Plan 009: Normalizar telefone (9º dígito BR) no caminho inbound da Meta

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat bf8b152..HEAD -- worker/meta_adapter_inbound.py worker/meta_adapter_outbound.py`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED — muda a chave de identidade (`telefone`) usada para todo lead novo/existente que manda mensagem pelo caminho Meta inbound. Mitigado por: a função de normalização já existe, já é usada em produção no caminho outbound há semanas sem incidente, e já tem 7 testes de borda cobrindo os casos que importam. O risco real não é a lógica de normalização em si — é not applicar em todo lugar que precisa (ver Scope).
- **Depends on**: none
- **Category**: bug (identidade de lead quebrada por não-normalização de telefone)
- **Planned at**: commit `bf8b152`, 2026-08-08

## Why this matters

Números de celular brasileiros podem chegar da Meta, no campo `messages[].from` do webhook, **sem o 9º dígito** (`558586902920`) mesmo quando o lead já está cadastrado **com** o 9º dígito (`5585986902920` — formato usado na importação de CSV e no envio de campanhas, via `_normalizar_numero_meta`/`_normalizar_telefone_br` já existentes). `worker/meta_adapter_inbound.py` usa esse telefone cru, sem normalizar, como chave de `upsert` (`on_conflict="telefone"`) — quando os formatos não batem, o `upsert` não encontra o lead existente e **cria um cadastro novo, duplicado, em branco** (sem histórico, sem enriquecimento de CRM, com `opt_in=false`).

Medido em produção (2026-08-08): **28 pares de leads duplicados por essa causa, 24 criados num único dia** (07/08/2026, dia de um disparo de 500 números — praticamente todo mundo que respondeu caiu nisso). Consequência prática, confirmada em conversas reais: o bot trata quem acabou de responder a uma campanha como se fosse a primeira interação de sempre, porque literalmente é — para o sistema, é uma pessoa diferente. Ver `AUDITORIA-duplicacao-lead-telefone-disparo-2026-08-07.md` para os exemplos completos e o achado lateral sobre o check de `bloqueado` ter o mesmo problema.

Este plano fecha a causa raiz para **leads novos a partir de agora** reaproveitando uma função já escrita e testada — não escreve normalização nova. A limpeza dos 28 pares já existentes é um plano separado (`plans/010-merge-leads-duplicados-nono-digito.md`) porque envolve decisão de produto sobre dados reais de pessoas reais, não é só código.

## Current state

### O ponto único onde `telefone` nasce sem normalização

`worker/meta_adapter_inbound.py:186-214` (`build_contrato_v2`, a função que constrói o "Contrato v2" a partir do payload da Meta — `contrato_v2["telefone"]` é usado depois em TODO o resto do fluxo: upsert de lead, check de bloqueio, upsert de conversa, dispatch pro motor-agente, notificação de transbordo):

```python
async def build_contrato_v2(meta_payload: dict, instancia_data: dict) -> dict:
    entry = meta_payload.get("entry", [{}])[0]
    changes = entry.get("changes", [{}])[0]
    value = changes.get("value", {})
    messages = value.get("messages", [])

    if not messages:
        raise ValueError("Payload Meta sem messages[]")

    msg = messages[0]
    telefone: str = msg.get("from", "")          # ← hoje linha ~225 (era 195 quando o plano foi escrito), sem normalização
    wamid: str = msg.get("id", "")

    mensagem, midia_url, midia_tipo = await _parse_mensagem_meta(msg)

    _tz = timezone(timedelta(hours=-3))
    data_atual = datetime.now(_tz).strftime("%A, %d de %B de %Y, %H:%M")

    return {
        "canal_origem": instancia_data["canal_origem"],
        "telefone":     telefone,
        ...
    }
```

### A função já existe, já é testada, só está no arquivo errado para este uso

`worker/meta_adapter_outbound.py:13-25`:
```python
def _normalizar_telefone_br(telefone: str) -> str:
    """
    Adiciona o nono dígito em números celulares brasileiros se ausente.
    Formato entrada: 558581733321 (12 dígitos total, 8 na parte local)
    Formato saída:  5585981733321 (13 dígitos total, 9 na parte local)
    Só aplica se: começa com 55, tem 12 dígitos total,
    e o dígito após o DDD não é 9.
    """
    if (len(telefone) == 12 and
            telefone.startswith("55") and
            telefone[4] != "9"):
        return telefone[:4] + "9" + telefone[4:]
    return telefone
```
Testada em `worker/tests/test_meta_adapter_outbound.py:29-57` (classe `TestNormalizarTelefoneBr`, 7 casos: insere o 9 quando falta, não altera quando já tem, SP/RJ com 9, número não-BR, número curto — todos cobertos, não precisam ser reescritos).

`worker/meta_adapter_outbound.py` não importa nada de `worker/meta_adapter_inbound.py` (confirmado: `grep "^import\|^from" worker/meta_adapter_outbound.py` só retorna `logging`/`os`) — importar `_normalizar_telefone_br` de `meta_adapter_outbound` dentro de `meta_adapter_inbound` **não cria import circular**.

### Repo conventions to match

- Import de função entre os dois adapters: sem precedente direto (são módulos irmãos, não um importa do outro hoje) — siga o estilo de import relativo já usado no arquivo (`from collections.abc import ...`, imports no topo do arquivo, não inline).
- Docstrings e comentários em português, seguindo o resto do arquivo.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Sanity import | `cd worker && python -c "import meta_adapter_inbound"` | exit 0 |
| Testes do inbound | `cd worker && python -m pytest tests/test_meta_adapter_inbound.py -v` | all pass |
| Testes do outbound (garantir que nada quebrou lá) | `cd worker && python -m pytest tests/test_meta_adapter_outbound.py -v` | all pass |
| Suíte completa | `cd worker && python -m pytest tests/ -v` | all pass (mesmas exceções conhecidas já documentadas no Plano 007/008: 1 teste de timing instável, alguns skips) |

## Scope

**In scope**:
- `worker/meta_adapter_inbound.py` — importar `_normalizar_telefone_br` de `meta_adapter_outbound` e aplicá-la em `build_contrato_v2` (Step 1).
- `worker/tests/test_meta_adapter_inbound.py` — novos testes cobrindo o cenário de duplicação (Step 2).

**Out of scope** (não mexer, mesmo que pareça relacionado):
- `worker/meta_adapter_outbound.py` e `worker/campanhas_engine.py` — já corretos, não precisam de mudança. Não "unificar" as duas funções de normalização numa terceira localização neste plano — é um refactor válido, mas fora do escopo aqui (a duplicação de lógica entre as duas já existe hoje e não é este plano que introduz o problema).
- Qualquer lead já duplicado em produção — isso é `plans/010-merge-leads-duplicados-nono-digito.md`, não este plano. Este plano só impede *novas* duplicações.
- O check de `bloqueado` (`meta_adapter_inbound.py:587-594`) já fica correto automaticamente como efeito colateral deste fix (mesma variável `telefone` normalizada é usada nos dois lugares) — não precisa de mudança própria, só confirme no Step 3 que o comportamento esperado realmente se manifesta.
- O bug separado da Silvia (bot repete despedida idêntica ignorando mensagem nova) — não investigado a fundo, não é escopo deste plano.

## Git workflow

- Branch: `fix/normalizar-telefone-inbound-meta`
- Commit único ou por step, conventional-commits style, ex.: `fix(meta-inbound): normaliza 9º dígito BR antes de gravar lead`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Normalizar o telefone na origem (`build_contrato_v2`)

Em `worker/meta_adapter_inbound.py`, adicione o import no topo do arquivo (junto aos outros imports locais, se houver algum — caso contrário, junto aos imports de biblioteca padrão no topo):

```python
from meta_adapter_outbound import _normalizar_telefone_br
```

E altere a linha do `telefone` cru (hoje ~225; era 195 quando o plano foi escrito) de:
```python
    telefone: str = msg.get("from", "")
```
para:
```python
    telefone: str = _normalizar_telefone_br(msg.get("from", ""))
```

Nenhuma outra linha de `build_contrato_v2` muda — `telefone` continua fluindo pro resto do contrato exatamente como antes, só que agora normalizado.

**Verify**: `cd worker && python -c "import meta_adapter_inbound"` → exit 0 (confirma que o import não é circular e o módulo carrega).

### Step 2: Testes de regressão

Em `worker/tests/test_meta_adapter_inbound.py`, adicione uma classe nova (modelo: `TestParseMensagem`, já existente no mesmo arquivo, mesmo estilo de payload mínimo):

```python
class TestNormalizacaoTelefoneContratoV2:
    @pytest.mark.asyncio
    async def test_contrato_v2_normaliza_telefone_sem_nono_digito(self):
        """Telefone BR de 12 dígitos sem o 9 (formato que a Meta às vezes manda)
        deve virar 13 dígitos com o 9, batendo com o formato salvo na importação/campanha."""
        payload = _payload_texto(telefone="558586902920")  # sem o 9
        instancia_data = {
            "canal_origem": "institucional",
            "agente_tipo": "Institucional",
            "canal_tipo": "whatsapp",
            "unidade_cuca": None,
        }
        contrato = await build_contrato_v2(payload, instancia_data)
        assert contrato["telefone"] == "5585986902920"  # com o 9

    @pytest.mark.asyncio
    async def test_contrato_v2_nao_altera_telefone_ja_com_nono_digito(self):
        """Telefone que já chega com o 9 não deve ser alterado (idempotência)."""
        payload = _payload_texto(telefone="5585986902920")
        instancia_data = {
            "canal_origem": "institucional",
            "agente_tipo": "Institucional",
            "canal_tipo": "whatsapp",
            "unidade_cuca": None,
        }
        contrato = await build_contrato_v2(payload, instancia_data)
        assert contrato["telefone"] == "5585986902920"
```

Use `_payload_texto` (já definido em `worker/tests/test_meta_adapter_inbound.py:25`, aceita `telefone` como parâmetro) em vez de montar o payload à mão — confirme a assinatura exata dessa fixture antes de usar (`grep -n "def _payload_texto" worker/tests/test_meta_adapter_inbound.py`), o nome do parâmetro pode ser `telefone` ou `phone_number_id`/outro — ajuste a chamada para bater com a fixture real.

**Verify**: `cd worker && python -m pytest tests/test_meta_adapter_inbound.py -v -k NormalizacaoTelefone` → 2 passed.

### Step 3: Confirmar efeito colateral no check de `bloqueado` (sem escrever código novo)

Leia `worker/meta_adapter_inbound.py:708-720` após o Step 1 e confirme visualmente que `bloqueado` agora é calculado a partir do `telefone` já normalizado (é o mesmo `telefone` de `contrato_v2["telefone"]`, sem reatribuição no meio) — isso fecha o achado lateral #4.3 da auditoria (bypass de bloqueio) como efeito colateral do Step 1, sem precisar de mudança própria. Confirme também o check de `numeros_bloqueados_permanente` (`meta_adapter_inbound.py:698-704`, adicionado 2026-08-01), que usa o mesmo `telefone` e é fechado pela mesma correção. Não escreva um teste novo pra isso a menos que um teste existente já cubra o check de `bloqueado` e sirva de modelo — se não houver nenhum, registre a lacuna em "Maintenance notes" em vez de inventar um teste do zero fora do escopo original desta correção.

## Test plan

- `test_contrato_v2_normaliza_telefone_sem_nono_digito` — caso principal do bug (Step 2).
- `test_contrato_v2_nao_altera_telefone_ja_com_nono_digito` — idempotência, garante que leads que já chegam certos continuam certos (Step 2).
- Suíte completa do inbound e do outbound rodando limpa (nenhum teste existente deve mudar de resultado).
- Mutation check: reverta o Step 1 temporariamente (`telefone: str = msg.get("from", "")`), confirme que os 2 testes novos falham; restaure, confirme que voltam a passar.

**Verify**: `cd worker && python -m pytest tests/ -v` → all pass, incluindo os 2 testes novos.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "_normalizar_telefone_br(msg.get" worker/meta_adapter_inbound.py` — 1 match (Step 1)
- [ ] `grep -n "from meta_adapter_outbound import _normalizar_telefone_br" worker/meta_adapter_inbound.py` — 1 match (Step 1)
- [ ] `cd worker && python -m pytest tests/test_meta_adapter_inbound.py -v` — all pass, incluindo os 2 testes novos
- [ ] `cd worker && python -m pytest tests/test_meta_adapter_outbound.py -v` — all pass, sem regressão
- [ ] `cd worker && python -m pytest tests/ -v` — all pass (suíte completa)
- [ ] Nenhum arquivo fora do Scope foi modificado (`git status`)
- [ ] `plans/README.md` — linha de status do Plano 009 atualizada

## STOP conditions

Stop and report back (do not improvise) if:

- Importar `_normalizar_telefone_br` de `meta_adapter_outbound` dentro de `meta_adapter_inbound` gerar erro de import circular (não esperado, mas confirme antes de assumir) — nesse caso, extraia a função para um terceiro módulo compartilhado (ex.: `worker/telefone_utils.py`) em vez de forçar o import cruzado, e atualize os dois arquivos originais para importar dali.
- `_payload_texto` (fixture de teste) não aceitar um parâmetro de telefone customizável — nesse caso, pare e reporte em vez de reescrever a fixture (outros testes dependem dela).
- O código em `worker/meta_adapter_inbound.py:186-214`/`worker/meta_adapter_outbound.py:13-25` não bater com os trechos citados acima ("Current state") — drift desde que este plano foi escrito.
- Um passo de verificação falhar duas vezes após uma tentativa razoável de correção.

## Maintenance notes

- Depois deste plano, `_normalizar_numero_meta`/`normalizar_telefone` (`campanhas_engine.py`) e `_normalizar_telefone_br` (`meta_adapter_outbound.py`) continuam sendo duas implementações independentes da mesma ideia, em três arquivos usando duas delas. Não é um problema urgente, mas um candidato razoável a uma limpeza futura (extrair para `worker/telefone_utils.py` e importar nos três lugares) — não faça isso como parte deste plano, é um refactor separado.
- `plans/010-merge-leads-duplicados-nono-digito.md` depende deste plano estar em produção antes de rodar a migração de merge — senão, novos pares de duplicados continuariam sendo criados enquanto a limpeza dos antigos acontece.
- Se no futuro a Meta mudar de novo o comportamento de normalização de outros países (não só Brasil), esta correção não cobre esse caso — `_normalizar_telefone_br` é especificamente BR (`len==12`, `startswith("55")`).
