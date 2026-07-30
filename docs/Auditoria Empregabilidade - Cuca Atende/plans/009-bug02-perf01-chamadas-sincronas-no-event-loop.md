# Plan 009: ~48 chamadas Supabase síncronas dentro de `async def` travam o event loop inteiro (BUG-02 / PERF-01)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7b0b326..HEAD -- worker/empregabilidade_engine.py worker/tests/test_empregabilidade_engine.py`
> Se `empregabilidade_engine.py` mudou desde que este plano foi escrito,
> reconte `grep -c "supabase\.table(" worker/empregabilidade_engine.py` e
> `grep -c "asyncio.to_thread" worker/empregabilidade_engine.py` antes de
> prosseguir — se os números não baterem (49 e 1, respectivamente, em
> 2026-07-29), trate como STOP condition e reavalie o escopo.
>
> **PRÉ-REQUISITO — não pule esta checagem**: este plano só deve começar
> depois do **Plan 008** (TEST-01 + achado #14) estar `Done`. A auditoria é
> explícita: refatorar ~49 pontos espalhados sem rede de testes é alto risco.
> Rode `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v`
> e confirme que os testes de `TestConfirmandoCancelamento`,
> `TestConfirmandoCadastro` e `TestConfirmacaoEntrevista` existem e passam
> antes de tocar em qualquer código de produção aqui.

## Status

- **Priority**: P1
- **Effort**: L — mecânico, mas espalhado por ~49 pontos em 9 funções `async def` + 6 helpers síncronos, num arquivo de quase 2800 linhas.
- **Risk**: MED-HIGH — sem mudar nenhum comportamento observável, mas toca praticamente toda função do arquivo. Mitigado por: (a) Plan 008 já dar cobertura aos 3 fluxos mais sensíveis antes de começar, (b) fazer em incrementos pequenos (1 função por commit), (c) rodar a suíte completa depois de cada incremento, não só no final.
- **Depends on**: **Plan 008** (TEST-01 + achado #14) — hard dependency, não recomendação opcional.
- **Category**: performance (bloqueio de event loop sob concorrência)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

`grep -c "asyncio.to_thread" worker/empregabilidade_engine.py` → **1**. `grep -c "supabase\.table(" worker/empregabilidade_engine.py` → **49** (confirmado ao vivo em 2026-07-29). O worker roda num único event loop atendendo **todas** as conversas simultâneas do canal Empregabilidade (empresa cadastrando vaga, candidato consultando status, público navegando — tudo no mesmo processo). Cada uma dessas ~48 chamadas bloqueantes ao Postgres (rede real, não CPU) trava o **processo inteiro** pela duração do round-trip — não só a conversa daquele usuário. Isso inclui o loop de notificação (`empregabilidade_notify_loop`, roda a cada 20s, `:2595-2799`), que já teria motivo de atraso próprio.

O próprio arquivo já tem 1 precedente correto de como resolver isso (`_enviar`, `:96-118`): envolve a chamada bloqueante num closure local e usa `await asyncio.to_thread(_inserir)`. `campanhas_engine.py` (arquivo irmão, mesmo worker) usa o mesmo princípio extensivamente, com funções `_xxx_sync` — mas lá em nível de módulo, não como closure local. Este plano segue o padrão **já existente neste arquivo** (`_enviar`), não importa o estilo de `campanhas_engine.py`, pra manter consistência com o que já está aqui.

## Current state

**Funções com chamadas síncronas inline** (confirmado ao vivo em 2026-07-29, via `awk` cruzando definições de função com `supabase.table(`):

| Função | Tipo | Observação |
|---|---|---|
| `_get_fluxo` (`:178-181`) | `def` (helper, chamado direto sem `await`) | Chamada em **toda** mensagem processada — maior frequência de todas |
| `_set_fluxo` (`:184-188`) | `def` (helper) | Idem — 2 selects + 1 update por chamada (ver achado #6, relacionado mas plano separado) |
| `_montar_historico` (linha a confirmar) | `def` (helper) | Usado pelo classificador semântico |
| `_log_intencao` (linha a confirmar) | `def` (helper) | Log de auditoria de intenção |
| `_get_meta_phone` (linha a confirmar) | `def` (helper) | Resolve telefone/token Meta por agente |
| `_ultima_mensagem_bot` (linha a confirmar) | `def` (helper) | Usado em algum ponto de contexto/histórico |
| `processar_mensagem_empregabilidade` | `async def` | Entry point — lê `conversas.metadata` e `candidaturas` inline (`:2166`, `:2227-2233`, `:2262-2265`) |
| `empregabilidade_notify_loop` | `async def` | Loop a cada 20s — já citado no achado #15 (N+1), plano separado, mas as leituras em si também precisam do wrap |
| `_rotear_por_intencao` | `async def` | |
| `_processar_publico` | `async def` | |
| `_processar_empresa` | `async def` | O maior — cobre `confirmando_cancelamento`, `confirmando_cadastro`, `menu_empresa_acoes`, etc. |
| `_processar_consulta_empresa` | `async def` | |
| `_processar_candidato` | `async def` | |
| `_listar_vagas_para_acao` | `async def` | |

Confirme os números de linha exatos de cada helper (`_montar_historico`, `_log_intencao`, `_get_meta_phone`, `_ultima_mensagem_bot`) e recontue `supabase.table(` dentro de cada função grande antes de editar — a tabela acima é um mapa de onde procurar, não um diff pronto (esforço L, ~49 pontos, não cabe todos os diffs neste documento sem ficar obsoleto rápido demais).

**Padrão de referência já existente e correto** (`_enviar`, `:96-118`):
```python
if ok and conversa_id:
    def _inserir():
        return supabase.table("mensagens").insert({...}).execute()
    try:
        await asyncio.to_thread(_inserir)
    except Exception as _e:
        logger.error(f"[_enviar] Falha ao gravar mensagem bot no DB: {_e}", exc_info=True)
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Contagem de progresso | `grep -c "asyncio.to_thread" worker/empregabilidade_engine.py` | sobe a cada incremento, de 1 até ~49 (aproximado — algumas chamadas podem ser agrupadas num só `to_thread` quando fazem sentido, ver Step 2) |
| Suíte completa (rodar após CADA função migrada, não só no final) | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass, sem exceção, a cada incremento |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: `worker/empregabilidade_engine.py` — todas as chamadas `supabase.table(` diretas dentro de contexto `async def`, envolvidas em `asyncio.to_thread` seguindo o padrão de `_enviar`.

**Out of scope**: mudar a lógica de negócio de qualquer branch (isso é refactor de forma, não de comportamento — se um teste do Plan 008 quebrar depois de uma mudança aqui, é sinal de erro na extração, não uma oportunidade de "aproveitar e already corrigir" outra coisa); achado #6 (`_set_fluxo` redundante — resolver o `to_thread` de `_set_fluxo` aqui, mas **não** eliminar o select redundante nem adicionar trava de concorrência, isso é o Plan do achado #6, separado); achado #15 (N+1 do loop de notificação — envolver as chamadas em `to_thread` aqui, mas não resolver o N+1 em si).

## Git workflow

- Branch: `perf/bug02-async-to-thread-empregabilidade`
- **Commits separados por função** (não um commit gigante) — facilita revisão e, se algo quebrar, isolar qual função foi a causa.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Helpers de módulo (`_get_fluxo`, `_set_fluxo`, `_montar_historico`, `_log_intencao`, `_get_meta_phone`, `_ultima_mensagem_bot`)

Estes já são funções `def` isoladas — não precisam de extração, só que os **call sites** (dentro de `async def`) passem a chamá-las via `asyncio.to_thread`. Exemplo pra `_get_fluxo`/`_set_fluxo` (os de maior frequência):

Antes (em qualquer `async def` que os chama hoje, ex. `_processar_empresa`):
```python
fluxo = _get_fluxo(conversa_id)
...
_set_fluxo(conversa_id, {...})
```
Depois:
```python
fluxo = await asyncio.to_thread(_get_fluxo, conversa_id)
...
await asyncio.to_thread(_set_fluxo, conversa_id, {...})
```
`grep -n "_get_fluxo(conversa_id)\|_set_fluxo(conversa_id" worker/empregabilidade_engine.py` lista **todos** os call sites que precisam dessa troca — são muitos (chamado em quase toda etapa). Fazer com find-and-replace assistido, mas **revisar cada ocorrência visualmente** (alguns podem estar dentro de list comprehension ou contexto onde `await` não é sintaticamente válido sem ajuste).

**Verify** (depois de migrar `_get_fluxo`/`_set_fluxo`): `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

Repetir o mesmo processo pra `_montar_historico`, `_log_intencao`, `_get_meta_phone`, `_ultima_mensagem_bot` — 1 de cada vez, suíte completa depois de cada um.

### Step 2: Chamadas inline dentro das 9 funções `async def`

Para cada função da tabela em "Current state", localizar cada `supabase.table(` inline e envolver num closure local + `asyncio.to_thread`, seguindo exatamente o padrão de `_enviar`. Quando 2+ chamadas em sequência formam uma unidade lógica (ex.: ler `vagas` e depois atualizar `vagas` no mesmo branch de `confirmando_cancelamento`), pode envolver as duas no mesmo closure (1 `to_thread` só) em vez de 2 separados — julgamento do executor, mas documentar a escolha no commit.

**Ordem sugerida** (menor risco → maior risco, aproveitando que os fluxos de maior risco já têm teste do Plan 008):
1. `_listar_vagas_para_acao` (função pequena, isolada)
2. `_processar_consulta_empresa`
3. `_processar_candidato`
4. `_processar_publico`
5. `_rotear_por_intencao`
6. `processar_mensagem_empregabilidade` (cuidado: é o entry point, tocado por praticamente todo teste do arquivo)
7. `_processar_empresa` (a maior — cobre `confirmando_cancelamento`/`confirmando_cadastro`, já com teste do Plan 008)
8. `empregabilidade_notify_loop` (roda em background — testar manualmente também, não só via pytest, já que não há teste algum hoje pra esse loop)

**Verify após CADA função**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, **antes de prosseguir pra próxima função da lista**.

### Step 3: Confirmação final

```bash
grep -c "asyncio.to_thread" worker/empregabilidade_engine.py   # deve ter subido de 1 pra próximo de 49 (menos alguns agrupamentos legítimos)
grep -n "supabase\.table(" worker/empregabilidade_engine.py    # cada ocorrência restante deve estar DENTRO de um closure já envolvido em to_thread, não mais direto num async def
```

## Test plan

Não há teste novo específico deste plano — o objetivo é que a suíte **inteira** (incluindo os 6 testes do Plan 008) continue passando sem nenhuma mudança de comportamento, função por função. Se quiser confiança extra de que o comportamento é idêntico byte-a-byte, comparar `git diff` de cada função migrada e confirmar que a única mudança estrutural é a extração pro closure + `to_thread` — nenhuma lógica de negócio deveria aparecer no diff.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, a cada incremento e no final.

## Done criteria

- [ ] Plan 008 confirmado `Done` antes de iniciar este
- [ ] Todos os 6 helpers de módulo (`_get_fluxo`, `_set_fluxo`, `_montar_historico`, `_log_intencao`, `_get_meta_phone`, `_ultima_mensagem_bot`) chamados via `asyncio.to_thread` em todos os call sites
- [ ] Todas as 9 funções `async def` da tabela em "Current state" sem nenhuma chamada `supabase.table(` direta fora de um closure envolvido em `asyncio.to_thread`
- [ ] `grep -c "asyncio.to_thread" worker/empregabilidade_engine.py` bem mais próximo de 49 do que de 1
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0 após cada função migrada e no final
- [ ] Commits separados por função (não 1 commit gigante)
- [ ] Nenhuma mudança de comportamento de negócio (só estrutural)
- [ ] `plans/README.md` atualizado

## STOP conditions

- Qualquer teste quebrar de um jeito que não seja obviamente um erro de sintaxe/extração (`await` faltando, argumento errado no closure) — pare e investigue antes de "ajustar o teste pra passar".
- Encontrar uma chamada síncrona que na verdade precisa rodar **antes** de outra de forma sequencial-dependente dentro do mesmo `to_thread` (ex.: ler um ID e usá-lo na escrita seguinte) — nesses casos, agrupar as 2 no mesmo closure é o comportamento correto, não split em 2 `to_thread` separados (evita 2 round-trips desnecessários e preserva a atomicidade lógica que talvez já exista).
- Descobrir uma 10ª função com chamada síncrona não listada na tabela de "Current state" — atualize a tabela e trate como parte do escopo, não como achado à parte.

## Maintenance notes

- Achado #6 (`_set_fluxo` refaz select redundante + risco de lost-update contra o loop de notificação) fica mais fácil de resolver depois deste plano (a chamada já estará isolada num `to_thread`), mas **não é resolvido por este plano** — é trabalho adicional, plano separado.
- Achado #15 (N+1 no loop de notificação) tem a mesma relação: este plano só embrulha as chamadas existentes em `to_thread`, não resolve o N+1 nem adiciona `.limit()`.
- Se o time quiser reduzir o Esforço L pra algo mais gerenciável, considerar dividir este plano em 2-3 PRs por conta própria (ex.: helpers de módulo primeiro, depois metade das funções `async def`, depois a outra metade) — a ordem sugerida no Step 2 já é compatível com esse split.
