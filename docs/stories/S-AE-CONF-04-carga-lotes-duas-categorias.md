# S-AE-CONF-04 — Carregar cada lote de leads com as duas categorias

**Status:** InReview | **Prioridade:** P0 | **Esforço:** M | **Risco:** MÉDIO — dado real em produção
**Epic:** Confirmação de presença — Simulado Academia Enem 2026
**Objetivo único da epic:** mandar o convite, receber o sim/não, e devolver a planilha de respostas
para a Academia Enem. Nada além disso.
**Depende de:** nada. **Bloqueia:** o envio **e** o porteiro (S-AE-CONF-03). **Deploy:** nenhum — é dado.
**Repete a cada lote** que a Academia Enem mandar.

## O que é

A Academia Enem manda planilhas em levas. A primeira já foi tratada: **621 contatos válidos**, com o
número no formato que a Meta exige. Vão vir mais até o dia da prova.

Cada lead recebe **duas categorias**:

| Categoria | Para que serve | Muda a cada lote? |
|---|---|---|
| **Do evento** (ex.: Simulado Enem 2026) | O porteiro usa para reconhecer quem é da campanha | não — é a mesma sempre |
| **Do lote** (ex.: Lote 1, Lote 2…) | O envio usa para mandar só para o lote novo | sim |

É isso que resolve o "não mandar de novo para quem já recebeu", **sem programar nada**: cada envio
mira só a categoria do lote novo.

## Acceptance Criteria

**AC1** — Categoria do evento criada uma vez e reaproveitada em todos os lotes.

**AC2** — Categoria própria para cada lote.

**AC3** — Antes de cadastrar, conferir se o telefone já existe: já existe → aproveita a pessoa; não
existe → cria. Ninguém duplicado.

**AC4** — Todo lead do lote fica nas **duas** categorias.

**AC5** — Quem está bloqueado ou pediu para não receber mensagem **não entra**. Vale mesmo com pressa.

**AC6** — Ao final, informar: quantos entraram novos, quantos já existiam, quantos ficaram de fora e
por quê. Esse total é o tamanho real do envio.

**AC7** — Saber desfazer: como remover o que este lote criou, caso o envio seja cancelado.

## Observação

Os telefones do primeiro lote já foram conferidos: 2 ficaram de fora — um número que não é celular e
um repetido em duas pessoas. Estão separados à parte.

---

# Atualização v0.2 (17/09) — o que mudou depois da S-AE-CONF-03

A CONF-03 foi implementada e mergeada. Ao investigar o banco de produção para ela, apareceram
**quatro coisas que esta story não sabia** e que mudam como a carga tem que ser feita. Cada uma com
o que toca, o que quebra e como checar.

## 1. A tela de upload da Academia Enem NÃO serve para esta carga

`cuca-portal/src/app/api/academia-enem/leads/upload/route.ts` tem três buracos para o que a AC3/AC4
pedem:

| O que a tela faz | O que quebra aqui |
|---|---|
| Só tagueia os leads **recém-criados** (passo 8 usa `inseridos`) | Quem já existe na base **fica sem categoria** — a AC4 ("todo lead do lote nas duas categorias") não acontece, e o porteiro nunca reconhece essa pessoa |
| Não mexe em `opt_in` de quem já existe | Ver item 2 — essas pessoas **não recebem o convite** |
| Dedup só por DDI (`com`/`sem` o 55) | Não cobre o **nono dígito**: quem está na base como 12 dígitos e vem na planilha com 13 vira **cadastro novo duplicado** — exatamente o defeito de 17/09 |

**Decisão:** a carga do primeiro lote é feita pelo **@dev, via SQL**, não pela tela. É o que o
Junior já tinha definido ("eu envio para o @dev e ele cria o lote... tudo manualmente nessa
etapa"). A tela continua existindo e não é alterada por esta story.

## 2. `opt_in` é `false` por padrão — e o disparo filtra por `opt_in = true`

Verificado em produção: `leads.opt_in` tem **default `false`**, e **4.689 dos 5.200 leads** estão
com `opt_in = false`. A RPC que monta o público do disparo
(`buscar_leads_por_categoria`) filtra `opt_in = true AND bloqueado = false`.

**O que isso quebra:** um dos 621 que já exista na base com `opt_in = false` fica na categoria,
aparece na conferência, e **simplesmente não recebe o convite** — o disparo o ignora em silêncio.
Sem convite não há entrega comprovada, e sem entrega o porteiro (AC2 da CONF-03) nunca vai anotar a
resposta dele. A pessoa some da planilha sem ninguém perceber.

**E cuidado com a leitura ingênua da AC5:** `opt_in = false` **não** quer dizer "pediu para não
receber". Na esmagadora maioria é só o default nunca preenchido. Quem de fato pediu está em
`historico_opt_in` — hoje são **7 pessoas**, não 4.689.

## 3. O evento do simulado ainda aponta para a categoria de teste

`eventos_pontuais` `697646e3…` ("Academia Enem - Simulado", `data_evento = 2026-09-20`) está com
`categorias_alvo = ['dd709269…']`, que é a categoria **`Valmir — Teste Solo`** usada no teste de
17/09.

**O que isso quebra:** disparar sem trocar isso manda o convite para 1 pessoa (o teste), não para os
621 — e o disparo fecha como "concluído", sem erro nenhum.

## 4. O porteiro está no ar, desligado, esperando esta story

A configuração `academia_enem_confirmacao` já existe em `configuracoes`, com o `evento_id` e o
fechamento preenchidos, e **`categoria_evento_id` nulo de propósito**. Enquanto estiver nulo, o
porteiro não anota nada.

## Acceptance Criteria — atualizados

**AC1** — Categoria do evento chamada **`simulado 01`**, criada uma vez e reaproveitada em todos os
lotes (nome definido pelo Junior em 17/09).

**AC2** — Categoria própria para cada lote (`Lote 1`, `Lote 2`…), separada da do evento.

**AC3** — Antes de cadastrar, conferir se o telefone já existe **nas duas escritas possíveis** (com
e sem o nono dígito) — a mesma regra que o porteiro usa
(`worker/academia_enem_porteiro.py: variantes_telefone`). Já existe → **aproveita a pessoa**; não
existe → cria. Ninguém duplicado.

**AC4** — Todo lead do lote fica nas **duas** categorias — **inclusive os que já existiam**. É a
diferença entre o porteiro reconhecer a pessoa ou não.

**AC5** — Fica de fora quem está **bloqueado** ou quem tem **opt-out real registrado em
`historico_opt_in`** (7 pessoas hoje). `opt_in = false` sozinho **não** é motivo de exclusão — é só
o default do banco.

**AC5.1 (nova)** — Todo lead do lote termina com **`opt_in = true`**, exceto os excluídos pela AC5.
Sem isso o disparo não alcança a pessoa e o porteiro nunca vê a resposta dela.

**AC6** — Ao final, informar: quantos entraram novos, quantos já existiam, quantos ficaram de fora e
por quê, e **quantos tiveram `opt_in` corrigido**. Esse total é o tamanho real do envio — e tem que
bater com o `total_destinatarios` do disparo.

**AC6.1 (nova)** — Conferir o número **antes de disparar**: rodar a mesma consulta que o disparo usa
(`buscar_leads_por_categoria` com a categoria do lote) e comparar com o total esperado. Se der
menos, alguém ficou fora silenciosamente — investigar antes, não depois.

**AC7** — Saber desfazer: como remover o que este lote criou, caso o envio seja cancelado. Inclui as
duas categorias e o `opt_in` de quem foi corrigido.

**AC8 (nova)** — Depois da carga, e **antes do disparo**, deixar o ambiente pronto:
1. `eventos_pontuais.categorias_alvo` do evento `697646e3…` passa a apontar para a **categoria do
   Lote 1** (hoje aponta para a categoria de teste).
2. `configuracoes.academia_enem_confirmacao.categoria_evento_id` recebe o id de **`simulado 01`** —
   é isso que **liga o porteiro**.
3. Depois que o disparo for criado, registrar `lotes: {"<disparo_id>": "Lote 1"}` na mesma
   configuração — é de lá que sai o nome do lote na planilha.

## Ordem de execução (importa)

1. Criar `simulado 01` e `Lote 1`.
2. Carregar os 621 (dedup pelas duas escritas, `opt_in`, duas categorias).
3. Conferir o total pela consulta do disparo (AC6.1).
4. Apontar o evento para a categoria do Lote 1.
5. Ligar o porteiro (`categoria_evento_id`).
6. Disparar.
7. Registrar o `disparo_id` no mapa de lotes.

Ligar o porteiro **antes** da carga não causa dano (ele não acha ninguém), mas ligar **depois** do
disparo, sim: as respostas que chegarem no meio-tempo não são anotadas — e as primeiras chegam em
segundos.

## PO Validation — @po (Pax) · 2026-09-17

**Veredito: GO — 9/10. Status `Draft` → `Ready`.** A v0.2 mudou a natureza da story: o que era
"cadastrar uma planilha" virou "carregar dado real de produção com três armadilhas conhecidas". Cada
uma está documentada com o que quebra e como checar — que é exatamente o que a regra de análise de
impacto exige.

| # | Ponto | Resultado |
|---|---|---|
| 1 | Título claro | ✅ |
| 2 | Descrição completa | ✅ Os 4 achados da v0.2 explicam o porquê de cada mudança |
| 3 | ACs testáveis | ✅ AC6.1 é o teste que fecha a story: o número tem que bater antes de disparar |
| 4 | Escopo IN/OUT | ✅ A tela de upload não é alterada — dito explicitamente |
| 5 | Dependências | ✅ Ordem de execução numerada, com o porquê da ordem |
| 6 | Complexidade | ⚠️ Ver achado 1 |
| 7 | Valor de negócio | ✅ Bloqueia o envio e o porteiro ao mesmo tempo |
| 8 | Riscos documentados | ✅ Os três modos de falha silenciosa estão nomeados |
| 9 | Critério de pronto | ✅ AC6 + AC6.1 |
| 10 | Alinhamento com a epic | ✅ |

### O achado que mais importa — e que ninguém tinha visto

**`opt_in = false` em 4.689 dos 5.200 leads, com a RPC do disparo filtrando `opt_in = true`.** Sem a
AC5.1, uma parte dos 621 ficaria na categoria, apareceria na conferência, **não receberia o
convite**, e — por tabela — nunca entraria na planilha, porque o porteiro exige entrega comprovada.
Falha silenciosa em três camadas. Essa AC sozinha justifica a revalidação.

E a precisão da AC5 é igualmente importante no sentido contrário: ler `opt_in = false` como "pediu
para sair" excluiria quase todo mundo. Quem pediu de verdade são **7 pessoas**, em
`historico_opt_in`.

### Achado 1 (NÃO BLOQUEANTE) — o esforço não é mais "P"

A story ainda diz **Esforço: P**, de quando era "subir planilha pela tela". Agora é carga por SQL,
com dedup por duas escritas de telefone, correção de `opt_in`, duas categorias para novos e
existentes, conferência do público e plano de desfazer. Isso é **M**, e o @sm deve ajustar o
cabeçalho — não bloqueia o @dev começar.

### Achado 2 (NÃO BLOQUEANTE, mas confirmar antes de carregar) — de onde vem a planilha

A story diz "621 contatos válidos, já tratados", mas não diz **onde o arquivo está**. O @dev precisa
do arquivo em mãos antes de escrever qualquer SQL. Também vale confirmar se são os mesmos 621 de
antes ou uma lista atualizada — passou quase um mês.

### Ponto de atenção para o @dev (não é AC, é cautela)

É **produção, com 5.200 leads reais e nenhum ambiente de teste**. Antes de qualquer `UPDATE` ou
`INSERT`, rodar a versão `SELECT` da mesma consulta e conferir o número de linhas afetadas. A AC7
(desfazer) tem que estar escrita **antes** de executar, não depois — plano de rollback escrito
depois do estrago não é plano.

## Dev Agent Record — @dev (Dex) · 2026-09-17

**Carga do Lote 1 executada em produção (`cuca`), por SQL, a partir de
`docs/contatos-edital-857-telefone.csv`.**

### Números (AC6)

| | |
|---|---|
| Linhas no arquivo | 623 |
| Telefones únicos | **622** (1 duplicado dentro do próprio arquivo: `85988082688`) |
| Já existiam na base | 6 |
| **Leads criados** | **616** |
| `opt_in` corrigido | **6** (todos os preexistentes estavam `false`) |
| Bloqueados / com opt-out real | **0** |
| Nas duas categorias | **622 + 622** |

### Conferência antes do disparo (AC6.1)

Rodei **a mesma função que o disparo usa** — `buscar_leads_por_categoria` — e não uma consulta
parecida:

```
Lote 1      → 622
simulado 01 → 622
```

Bate com o esperado. Se os 6 preexistentes não tivessem tido o `opt_in` corrigido, este número
seria **616** e ninguém perceberia: eles continuariam na categoria, visíveis na conferência, e
simplesmente não receberiam o convite.

### Identificadores criados

| O quê | Id |
|---|---|
| Categoria do evento `simulado 01` | `562260bb-49bc-41bb-987c-58fd01d79f67` |
| Categoria `Lote 1` (filha da anterior) | `e4fb9024-6442-4c2b-a7c7-70c1d7bf5863` |

### AC8 — ambiente preparado

1. ✅ `eventos_pontuais.categorias_alvo` do evento `697646e3…` passou da categoria de teste
   (`Valmir — Teste Solo`) para **`Lote 1`**. Sem isso o disparo iria para 1 pessoa e fecharia como
   concluído.
2. ✅ **Porteiro LIGADO** — `categoria_evento_id` preenchido na configuração.
3. ⏳ `lotes: {"<disparo_id>": "Lote 1"}` — só depois que o disparo existir.

**Ligar o porteiro agora é seguro:** ninguém tem entrega comprovada ainda, então toda resposta cai
no caminho `sem_entrega` (logado, não anotado). Ligar **depois** do disparo é que perderia as
primeiras respostas.

### Desfazer (AC7)

Script pronto, fora do git (contém referência a dado real):
`scratchpad/DESFAZER-lote1.sql`. Ordem: desligar o porteiro → devolver o evento para a categoria de
teste → apagar as duas categorias de `lead_interesses` → apagar os 616 leads criados (ids
guardados). Os **6 preexistentes não devem ser apagados**; só o `opt_in` deles voltaria a `false`.

### Achado para o Junior decidir (não bloqueia)

**Um telefone do arquivo não é celular:** `88587148446` → `5588587148446`
(LAYS DE FÁTIMA GONÇALVES DOS SANTOS). Depois do DDD 88, o número começa com **5**, e celular
brasileiro começa com 9. A observação original da story dizia que "um número que não é celular"
tinha sido separado — mas ele **está** no arquivo e foi carregado. Provavelmente é erro de
digitação. A Meta vai recusar a entrega e ele entra na conta de erros do disparo. Vale conferir o
número certo com a Academia Enem, ou tirar da categoria antes de disparar.

### Aviso sobre o arquivo

`docs/contatos-edital-857-telefone.csv` tem **nome e telefone de 623 pessoas reais**. Está
**fora do git** e deve continuar assim — não commitar. Pelo mesmo motivo, o SQL da carga ficou no
scratchpad e não virou arquivo de migration.

## QA Results — @qa (Quinn) · 2026-09-17

**Veredito: PASS.** A carga está correta, conferida contra o arquivo original — não contra os
números que o @dev relatou. **Liberado para disparar**, com uma recomendação forte antes (achado 2).

### Como conferi

Reli o CSV por conta própria e comparei conjunto a conjunto com o banco, em vez de reconferir a
contagem do @dev:

| Verificação | Resultado |
|---|---|
| Telefones únicos no arquivo | **622** (confere) |
| Pessoas do arquivo com **exatamente 1** cadastro | **622 de 622** — nenhum duplicado criado |
| Pessoas do arquivo fora de `simulado 01` | **0** |
| Pessoas do arquivo fora de `Lote 1` | **0** |
| Linhas na categoria do evento | **622** — nenhum estranho entrou junto |
| Com `opt_in = true` | **622** |
| Bloqueados | **0** |
| Nomes vazios | **0** |
| Acentuação | ✅ "JOÃO GUILHERME", "LAYS DE FÁTIMA GONÇALVES" — sem mojibake (o CSV tinha BOM) |
| Total de leads | 5.200 → **5.816** (exatamente +616) |
| Público pela função do disparo | **622** |

O ponto mais importante é o segundo: **cada pessoa do arquivo tem um cadastro só**. Era aqui que o
defeito do nono dígito reapareceria, e não reapareceu.

### Achado 1 (informativo) — o disparo de teste conta como convite

O disparo `9e280445…` (o teste de 17/09, 1 destinatário) pertence ao mesmo `evento_id`. Pela regra
da CONF-03, entrega dele **conta** como convite da campanha. Não causa problema — o único lead dele
não está em `simulado 01` —, mas é bom saber que o histórico do teste faz parte do universo da
campanha.

### Achado 2 (recomendação forte) — dá para testar o porteiro de ponta a ponta AGORA, sem disparar nada

O lead do Junior (`7572570a…`, `5585991733321`) **já tem entrega comprovada** (`lido`) de um disparo
do evento, e **tem o cadastro duplicado** (`d2eaba6b…`, `558591733321`) onde a Meta entrega as
respostas. Só falta uma coisa para o porteiro reconhecê-lo: **ele não está na categoria
`simulado 01`**.

Colocar esse lead na categoria do evento (uma linha) transforma o caso real de 17/09 — o mesmo que
originou toda a story — em **teste completo de produção, sem mandar uma única mensagem nova**: o
Junior responde a mensagem do template que já está no WhatsApp dele (a janela de 24h vai até
~01:22 de 18/09, e os botões continuam clicáveis), e dá para conferir na hora se a linha apareceu
em `confirmacoes_simulado_ae`, **no cadastro convidado e não no duplicado**.

**Recomendo fazer isso antes de disparar para os 622.** É a diferença entre descobrir um problema
com 1 pessoa ou com 622 — e leva minutos.

### Achado 3 (decisão do Junior, já levantado pelo @dev) — o número que não é celular

`5588587148446` (LAYS DE FÁTIMA GONÇALVES DOS SANTOS) continua na categoria. Vai falhar na entrega
e entrar na conta de erros. Sem risco técnico; é decisão de operação.

### Estado do ambiente, conferido

- `eventos_pontuais.categorias_alvo` → `Lote 1` ✅
- `configuracoes.academia_enem_confirmacao.categoria_evento_id` → `simulado 01` ✅ (**porteiro ligado**)
- `confirmacoes_simulado_ae` → **0 linhas**, como esperado antes do disparo
- `lotes` na configuração → vazio, pendente do `disparo_id` (AC8 item 3)

## Change Log

| Data | Versão | Descrição | Autor |
|---|---|---|---|
| 2026-09-16 | 0.1 | Draft inicial | @sm (River) |
| 2026-09-17 | 0.2 | Atualizada com o que a CONF-03 revelou: tela de upload não serve, `opt_in` default false, evento apontando para categoria de teste, ordem de execução, AC5.1/AC6.1/AC8 | @sm (River) |
| 2026-09-17 | 0.3 | Validação @po: **GO 9/10** — status `Draft` → **`Ready`**; 2 achados não bloqueantes (esforço P→M, origem da planilha) | @po (Pax) |
| 2026-09-17 | 0.4 | Carga do Lote 1 executada: 616 leads criados, 622 nas duas categorias, 6 `opt_in` corrigidos; evento apontando para o Lote 1 e **porteiro ligado**. Status → **`Ready for Review`** | @dev (Dex) |
| 2026-09-17 | 0.5 | QA: **PASS** — carga conferida contra o arquivo original (622 pessoas, 1 cadastro cada, 0 fora das categorias). Recomendação: testar o porteiro com o lead do Junior antes de disparar | @qa (Quinn) |
