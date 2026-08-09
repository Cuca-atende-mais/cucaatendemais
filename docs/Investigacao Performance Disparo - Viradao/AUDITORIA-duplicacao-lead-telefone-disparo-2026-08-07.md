# Auditoria — duplicação de lead por telefone sem o 9º dígito, no caminho inbound da Meta

**Natureza:** achado novo, investigado ao vivo a partir da análise de respostas ao disparo "Aviso Programação Ago/2026" (500 números, 07/08/2026), não de uma varredura completa do repositório.
**Gatilho:** ao analisar as poucas respostas reais recebidas no dia do disparo, o usuário notou que o bot tratava quem respondia como se fosse a primeira interação de sempre — inclusive ignorando reclamações concretas ("o link não está funcionando").
**Método:** consulta direta ao banco de produção via MCP Supabase (`leads`, `conversas`, `mensagens`, `logs_disparo`), leitura de código (`worker/meta_adapter_inbound.py`, `worker/meta_adapter_outbound.py`, `worker/campanhas_engine.py`), `git log`/`grep` para confirmar que a normalização já existe em outros dois arquivos.

---

## Resumo executivo

**Todo lead que recebe um disparo e depois responde pelo WhatsApp corre o risco real de virar um cadastro novo e "estranho" aos olhos do bot — não por falha de NLU, mas porque o número de telefone que a Meta manda no webhook às vezes não bate com o número salvo.** Números de celular brasileiros podem chegar sem o 9º dígito (`558586902920`) mesmo quando o lead já está cadastrado com ele (`5585986902920`, formato usado na importação de CSV e no envio de campanhas). O caminho de recebimento de mensagens (`worker/meta_adapter_inbound.py`) nunca normaliza esse número antes de gravar — faz um `upsert` direto por `telefone`, que não encontra o cadastro existente e **cria um novo do zero**.

O mais notável: **o projeto já resolve esse exato problema em dois lugares — só não no que mais importa.** `worker/campanhas_engine.py:22` (`_normalizar_numero_meta`) e `worker/meta_adapter_outbound.py:13` (`_normalizar_telefone_br`) implementam, de forma independente, a mesma lógica testada ("celular BR com 12 dígitos e sem o 9 na posição certa → insere o 9"). O caminho de **envio** já está certo. O caminho de **recebimento** nunca chama nenhuma das duas.

**Impacto medido em produção, ~24h após o disparo de 500 números:** 28 pares de leads duplicados no total (mesmo telefone, com/sem o 9), **24 criados só no dia do disparo** — ou seja, praticamente todo mundo que respondeu caiu nisso. O bug já existe desde pelo menos 06/07/2026.

Plano de correção completo em [`009-normalizar-telefone-inbound-meta.md`](009-normalizar-telefone-inbound-meta.md) — esforço pequeno (S), reaproveita função já testada. Plano de decisão + migração para os 28 pares já existentes em [`010-merge-leads-duplicados-nono-digito.md`](010-merge-leads-duplicados-nono-digito.md) — precisa de decisão de produto antes de rodar em cima de gente real.

---

## 1. Como o achado apareceu

Durante a análise de respostas ao disparo de 07/08 (ver painel produzido nessa sessão), uma lead chamada "Célia" respondeu e recebeu do bot uma saudação genérica de primeiro contato, sem nenhuma referência ao disparo que tinha acabado de receber. Ao investigar o cadastro dela, apareceram **dois registros**:

| | Criado em | Telefone | Nome | `opt_in` |
|---|---|---|---|---|
| Original (recebeu o disparo) | 06/08, importado via CSV (`origem = csv_leads_quentes_2026_08`) | `5585986902920` (com o 9) | Célia Maria Gonçalves **Miranda** | `true` |
| Novo (criado no instante em que ela respondeu) | 07/08 21:05:03 | `558586902920` (sem o 9) | Célia Maria Gonçalves **Mir** | `false` |

O segundo registro foi criado **154 milissegundos antes** da própria mensagem dela ser salva (`leads.created_at = 21:05:03.152451`, `mensagens.created_at = 21:05:03.728355`) — ou seja, nasceu no exato momento do processamento do webhook, não por importação.

## 2. Causa raiz — `worker/meta_adapter_inbound.py:225` (linha mudou desde a auditoria; conteúdo/lógica igual)

```python
msg = messages[0]
telefone: str = msg.get("from", "")
```

Esse `telefone` cru vira `contrato_v2["telefone"]` (linha 205) e é usado, sem nenhuma transformação, em todo o resto da função — inclusive no upsert que cria/atualiza o lead:

```python
# worker/meta_adapter_inbound.py:580-588
lead_result = supabase.table("leads").upsert(
    {"telefone": telefone, "nome": push_name, "updated_at": "now()"},
    on_conflict="telefone",
).execute()
lead_id: str = lead_result.data[0]["id"]
_fresh = supabase.table("leads").select("bloqueado").eq("id", lead_id).single().execute()
bloqueado: bool = (_fresh.data or {}).get("bloqueado", False)
```

`on_conflict="telefone"` só funciona se a string bater **exatamente**. A Meta normaliza o `wa_id`/`from` de números brasileiros de forma inconsistente com o formato usado internamente pelo projeto — o resultado é que o `upsert` não encontra o lead de `5585986902920` quando a Meta manda `558586902920`, e cria um segundo registro.

## 3. O projeto já resolveu isso — duas vezes — só não aqui

```python
# worker/meta_adapter_outbound.py:13-25 (usado ao ENVIAR mensagem)
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

```python
# worker/campanhas_engine.py:11-27 (usado ao DISPARAR campanha)
def normalizar_telefone(tel: str) -> str:
    """Normaliza o telefone: só dígitos com DDI. ..."""
    digits = re.sub(r'\D', '', tel)
    if len(digits) in (10, 11) and not digits.startswith('55'):
        return '55' + digits
    return digits

def _normalizar_numero_meta(tel: str) -> str:
    """Normaliza para o formato Meta: DDI 55 + nono dígito BR se ausente."""
    digits = normalizar_telefone(tel)
    if len(digits) == 12 and digits.startswith('55') and digits[4] != '9':
        digits = digits[:4] + '9' + digits[4:]
    return digits
```

`_normalizar_telefone_br` (`meta_adapter_outbound.py`) já tem 7 testes cobrindo os casos de borda (`worker/tests/test_meta_adapter_outbound.py:29-57`, classe `TestNormalizarTelefoneBr`). É por isso que os leads importados via CSV e as mensagens enviadas pelo bot sempre chegam com o 9 — o caminho de saída já normaliza. O caminho de entrada (`meta_adapter_inbound.py`) não importa nenhuma das duas funções — confirmado (`grep "^import\|^from" worker/meta_adapter_inbound.py`, nenhuma referência a `normalizar`).

## 4. Impacto medido em produção (consulta 2026-08-08 ~00h UTC)

```sql
select count(*) as total_pares_duplicados,
       count(*) filter (where b.created_at >= '2026-08-07') as pares_criados_hoje
from leads a
join leads b on b.telefone = regexp_replace(a.telefone, '^(55\d{2})9', '\1')
where a.telefone ~ '^55\d{2}9\d{8}$';
```

| | Valor |
|---|---|
| Pares duplicados no total | **28** |
| Pares criados no dia do disparo (07/08) | **24** |
| Ocorrência mais antiga encontrada | 06/07/2026 (inclui um par com o telefone do próprio Valmir Junior) |

### 4.1. Perda de contexto — exemplos reais capturados

**Lead "Holam" (Omar Aly Mohamed Hosny Fathallah), duplicado de `5585997226110`/`558597226110`:**
```
Holam: Boa tarde
Holam: O link não está funcionando
Bot:   Olá! Seja muito bem-vindo(a) à Rede CUCA! 🎉  Em que posso te ajudar? 😊
```
A reclamação concreta foi ignorada — o bot respondeu como se fosse o primeiro contato de sempre.

**Lead "Silvia" (Silvia Helena Rebouças Freire), duplicado de `5585988740833`/`558588740833`:**
```
Silvia: Obrigada
Bot:    Fico feliz em ter ajudado! Se precisar de mais alguma coisa, é só chamar aqui. 😊 Até mais!
Silvia: Não está abrindo
Bot:    Fico feliz em ter ajudado! Se precisar de mais alguma coisa, é só chamar aqui. 😊 Até mais!
```
A segunda mensagem da Silvia é ignorada — o bot repete a despedida anterior palavra por palavra. (Isto pode ser um sintoma separado, de estado de conversa "encerrada" não reavaliando mensagem nova — não investigado a fundo nesta auditoria, registrado como candidato a investigação futura, não coberto pelos planos 009/010.)

### 4.2. `opt_in` nasce invertido

O `upsert` do inbound (`meta_adapter_inbound.py:581-585`) só envia `telefone`, `nome` e `updated_at` — `opt_in` fica no valor padrão da coluna, que é `false`. Ou seja: **toda pessoa que acabou de demonstrar interesse respondendo a uma campanha nasce marcada como "não pode receber campanha futura"** no cadastro que efetivamente tem a conversa. O cadastro correto (`opt_in=true`) fica órfão, sem histórico nenhum.

### 4.3. Risco estrutural lateral — bypass de bloqueio (não confirmado em incidente real)

O mesmo `telefone` não normalizado é usado no check de bloqueio (`meta_adapter_inbound.py:587-594`):
```python
if bloqueado:
    logger.info(f"[meta-inbound] Lead {telefone} está bloqueado — mensagem ignorada")
    return
```
Cruzando os 28 pares com `bloqueado=true` em qualquer um dos dois lados, **nenhum caso real foi encontrado hoje** — mas o mecanismo de falha é idêntico ao da duplicação (mesma chave não normalizada). Se um lead for bloqueado sob um formato de número e responder no outro formato, o `upsert` cria/encontra um registro diferente com `bloqueado=false`, e a mensagem não seria descartada. Registrado como risco estrutural a fechar junto com o Plano 009, não como incidente confirmado.

**Correção (2026-08-09):** existe uma segunda checagem com a mesma vulnerabilidade — `numeros_bloqueados_permanente` (`meta_adapter_inbound.py:698-704`, adicionada 2026-08-01 para o caso WEBLOCACAO/MKL IT SOLUTIONS), rodada antes do upsert, também com `telefone` cru. Como ambas usam a mesma variável (`contrato_v2["telefone"]`), o fix do Plano 009 fecha as duas de uma vez — mas o impacto real é maior do que este achado descrevia: um bloqueio *permanente* (caso de abuso confirmado) é mais crítico que uma flag comum de `leads.bloqueado`.

### 4.4. Enriquecimento de CRM fica preso no registro errado

`unidade_cuca`, `tags`, `equipamentos_principais`, `atividades_principais`, `origem` e todo o histórico de conversa anterior pertencem ao registro antigo/correto — o registro novo/duplicado nasce em branco. Qualquer atendimento humano futuro que abra o cadastro errado perde esse contexto por completo.

## 5. Achado secundário — possível link quebrado no disparo (verificação manual, não é bug de código)

Três pessoas diferentes, entre as ~10 respostas reais do dia, reclamaram de não conseguir abrir algo:

- Silvia: "Não está abrindo"
- Holam/Omar: "O link não está funcionando"
- Lia: "não consegui acessar o site" / "E nem ver o post que você mandou" / "Falhou"

3 de ~10 respostas reais mencionando problema de acesso é uma proporção alta para coincidência. **Recomendação:** verificar manualmente, em navegador mobile, se `https://portaldajuventude.fortaleza.ce.gov.br/portal-web/#/1` (o link usado no disparo) está funcionando normalmente. Não há evidência de que isso tenha relação de causa com os achados 1-4 desta auditoria — é um item de verificação de produto/conteúdo, não um plano de código.

## 6. Confirmação adicional — o HTTP 400 do achado #1 de 26/07 continua reproduzindo

Na mesma leitura de conversas, a lead "Lia" mandou uma imagem e recebeu:
```
Bot: Ih, deu um problema técnico aqui do meu lado 😅 Pode mandar de novo pra mim?
```
Este é o mesmo sintoma do achado #1 de `docs/qa/RELATORIO-10-panorama-disparo-corrida-juventude-2026-07-26.md`, cujo Plano 002 (log de diagnóstico do `telefone` vazio no HTTP 400 do motor-agente) já está **DONE** (PR #58, mergeado 27/07) — mas o plano só instrumentou logging, não corrigiu a causa raiz, que ainda não estava fechada. A ocorrência de hoje deve ter gerado um log de diagnóstico novo — vale checar o Sentry/logs do motor-agente em torno de 2026-08-07 20:22 UTC para tentar fechar a causa exata, em vez de abrir um achado novo aqui.

## 7. Recomendação

1. [`009-normalizar-telefone-inbound-meta.md`](009-normalizar-telefone-inbound-meta.md) — aplicar `_normalizar_telefone_br` (já existente e testada em `meta_adapter_outbound.py`) no início de `build_contrato_v2`, fechando a causa raiz para todo lead novo a partir de agora. Esforço pequeno, sem migration.
2. [`010-merge-leads-duplicados-nono-digito.md`](010-merge-leads-duplicados-nono-digito.md) — decisão de produto + migração para os 28 pares já existentes (qual registro "vence", o que fazer com o histórico de conversa do registro errado). Precisa de decisão do Junior/Valmir antes de rodar contra dados reais — não é só técnico.
3. Verificar manualmente o link do disparo (achado #5) — item de produto, sem plano de código associado.
4. Checar os logs de diagnóstico do Plano 002 em torno da ocorrência de hoje (achado #6) para tentar fechar, de vez, a causa raiz do HTTP 400 documentado desde 26/07.
