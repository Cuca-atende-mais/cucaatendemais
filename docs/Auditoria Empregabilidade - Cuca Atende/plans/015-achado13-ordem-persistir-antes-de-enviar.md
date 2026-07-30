# Plan 015: 2 pontos gravam estado antes de enviar mensagem — inverter para enviar-antes-de-persistir (achado #13)

> **Executor instructions**: Este plano tinha uma decisão de produto em
> aberto — **resolvida pelo sócio em 2026-07-29: inverter para o "Jeito A"
> (enviar antes de persistir, padrão do resto do arquivo)**. Não é mais
> necessário levantar a pergunta com ninguém; siga direto para o Step 2
> (inverter).
>
> **Drift check (run first)**: confirme que `:1826-1832` e `:1962-1972`
> ainda têm os comentários citados abaixo antes de prosseguir — se o código
> mudou desde então, reconfirme os números de linha antes de editar.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: MÉDIO — inverte a ordem em 2 fluxos reais (candidatura sem prefill de nome; escolha de unidade sem unidade fixa); mitigado por teste de falha de envio nos 2 pontos.
- **Depends on**: none (decisão de produto já tomada, ver acima)
- **Category**: bug — decisão do sócio: tratar como bug e corrigir, alinhando com o padrão do resto do arquivo
- **Decisão do sócio (2026-07-29)**: inverter para enviar-antes-de-persistir nos 2 pontos, com teste de falha de envio cobrindo os 2.
- **Planned at**: commit `bc6284d`, 2026-07-29 (decisão de inversão registrada em 2026-07-29)

## Why isto é diferente dos outros planos

A auditoria de 17/07 registrou: "2 pontos gravam estado **antes** de enviar mensagem — se o envio falhar, próxima mensagem do usuário cai no handler errado", classificado como **bug**, citando que "o resto do arquivo faz enviar-depois-persistir; esses 2 são exceção".

Ao conferir os 2 pontos ao vivo pra esta consolidação, encontrei em **ambos** um comentário explícito do desenvolvedor original explicando a ordem invertida como escolha deliberada — não um descuido:

```python
# :1826 — Salva estado antes de enviar para não ficar preso se envio falhar
# :1962 — Salva o estado ANTES de enviar a mensagem — evita ficar preso em listou_vagas
#         se o envio falhar de forma intermitente
```

Ou seja: **as duas ordens têm um modo de falha, só que diferentes**:
- **Enviar-depois-persistir** (padrão do resto do arquivo): se o envio falha, o estado nunca avança — usuário fica "preso" na etapa anterior, mas nada de errado é registrado; ele pode tentar de novo e a próxima mensagem cai no handler certo (mesma etapa de antes).
- **Persistir-depois-enviar** (os 2 pontos deste achado): se o envio falha, o estado já avançou mas o usuário nunca recebeu a pergunta/menu correspondente — a próxima mensagem dele (que não sabe que deveria responder a algo específico) é interpretada como se fosse resposta à etapa nova, o que pode gerar um resultado errado ou confuso.

O comentário do código sugere que o autor considerou o modo de falha do padrão do resto do arquivo (usuário "preso", tendo que reenviar) **pior** do que o risco deste achado (mensagem interpretada no contexto errado) — pelo menos nesses 2 pontos específicos, que são etapas de navegação/redirecionamento (não escrita irreversível como cancelamento/cadastro).

## Decisão do sócio (2026-07-29) — resolvida

O sócio decidiu: a ordem persistir-antes-de-enviar nesses 2 pontos, apesar de deliberada, cria um problema pior na prática (mensagem interpretada no contexto errado) do que o modo de falha do padrão do resto do arquivo (usuário "preso", tendo que reenviar). **Inverter para o Jeito A (enviar antes de persistir)**, com teste cobrindo explicitamente o cenário de falha de envio nos 2 pontos — ver "Steps"/"Test plan" abaixo.

## Current state

`worker/empregabilidade_engine.py:1820-1833` (dentro do fluxo de candidatura, unidade→coleta de nome):
```python
                if nome_prefill:
                    await _enviar_link_candidatura(...)
                else:
                    # Salva estado antes de enviar para não ficar preso se envio falhar
                    _set_fluxo(conversa_id, {
                        **novo_fluxo,
                        "etapa": "coletando_nome_candidato",
                        "banco_talentos": False,
                    })
                    await e("Para finalizar sua candidatura, preciso do seu *nome completo*:")
                return
```

`:1955-1972` (fluxo de escolha de unidade, vaga sem unidade fixa):
```python
            for idx_u, u in enumerate(unidades_disponiveis, start=1):
                linhas_unid.append(f"*{idx_u}.* {u['nome']}")
            # Salva o estado ANTES de enviar a mensagem — evita ficar preso em listou_vagas
            # se o envio falhar de forma intermitente
            _set_fluxo(conversa_id, {
                **fluxo,
                "etapa": "aguardando_escolha_unidade",
                ...
            })
            await e("\n".join(linhas_unid))
            return
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |

## Scope

`worker/empregabilidade_engine.py:1820-1833` e `:1955-1972` — trocar a ordem pra enviar primeiro, persistir depois (padrão do resto do arquivo), com tratamento de falha de envio explícito (o que fazer se `await e(...)` falhar e o estado nunca avançar — hoje o resto do arquivo não trata isso explicitamente também, então pode não haver mudança nenhuma além de mover a ordem).

## Git workflow

- Branch: `fix/achado13-ordem-persistir-enviar`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Trocar a ordem nos 2 pontos

Mover a chamada de `_set_fluxo` pra depois do `await e(...)`/`await _enviar(...)` correspondente, igual ao padrão do resto do arquivo. Adicionar teste cobrindo o caso de falha de envio (mock de `_enviar`/`e` retornando `False` ou levantando exceção) confirmando que o estado não avança quando o envio falha — mesmo comportamento do resto do arquivo.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

## Test plan

2 testes (1 por ponto, `:1820-1833` e `:1955-1972`) simulando falha no envio (mock de `_enviar` retornando `False` ou levantando exceção) e confirmando que o estado não avança de forma inconsistente quando o envio falha.

## Done criteria

- [ ] Ordem trocada nos 2 pontos (enviar antes de persistir)
- [ ] Teste de falha de envio nos 2 pontos, confirmando que o estado não avança quando o envio falha
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0
- [ ] `plans/README.md` atualizado

## STOP conditions

- Os números de linha citados (`:1826-1832`, `:1962-1972`) não baterem com o código ao vivo — reconfirme antes de editar (o drift check no topo já cobre isso).

## Maintenance notes

- Este achado é um bom lembrete de que nem toda inconsistência de padrão é um bug — às vezes é uma exceção deliberada mal documentada. Vale, na decisão final, deixar um comentário bom o suficiente pra próxima pessoa não reabrir a mesma dúvida.
