# S-AE-CONF-03 — Porteiro: identificar de quem veio a resposta e guardar

**Status:** Done | **Prioridade:** P0 | **Esforço:** M | **Risco:** MÉDIO
**Epic:** Confirmação de presença — Simulado Academia Enem 2026
**Objetivo único da epic:** mandar o convite, receber o sim/não, e devolver a planilha de respostas
para a Academia Enem. Nada além disso.
**Depende de:** S-AE-CONF-02 (ler o botão) e S-AE-CONF-04 (categoria criada).
**Deploy:** redeploy do `cuca-worker`.

## O que é

É o porteiro que o Junior descreveu: quando chega uma mensagem, olhar o crachá.

- **É lead da campanha?** → guarda a resposta dele na tabela de acompanhamento.
- **Veio de qualquer outro lugar?** → segue para o institucional, como sempre foi.

Hoje ninguém olha o crachá — toda mensagem entra igual.

## O crachá vem borrado — e é por isso que a AC2 mudou

Descoberto no teste real de 17/09 (ver `docs/academia-enem-confirmacao/ANALISE-teste-disparo-S-AE-CONF-02-2026-09-17.md`):

O convite saiu para `5585991733321`. A resposta voltou da Meta como `558591733321` — **o mesmo
celular, sem o nono dígito**. O sistema comparou os dois textos letra por letra, concluiu que eram
duas pessoas, e anotou a confirmação num cadastro que nunca tinha sido convidado.

Pela AC2 como estava escrita, esse cadastro não está na categoria e não tem registro de envio —
o porteiro faria "nada" e **uma confirmação real seria jogada fora**.

Conferido contra **400 envios reais**: para DDD 31 em diante (Fortaleza inclusa), a Meta devolve o
número **sem** o nono dígito em 100% dos casos. Para DDD 11 a 30, devolve **com**. Ou seja: não dá
para confiar no formato — só dá para ignorá-lo.

**Decisão do Junior (17/09): Caminho C** — resolver isso **só aqui dentro do porteiro**, sem mexer
na porta de entrada do sistema nem nos telefones já guardados. O que isso deixa por resolver está
na seção "O que esta story não resolve".

## Acceptance Criteria

**AC1** — Tabela de acompanhamento com: lote, lead, resposta (confirmou / não vai), como veio (botão
ou digitado), o que ele mandou, e quando.

O lead anotado é **o que recebeu o convite** — não o cadastro de onde a mensagem chegou, que pode
ser outro (ver AC2.2).

**De onde sai o lote (resposta do Junior, 17/09):** o lote é criado **manualmente** pelo @dev, a
partir da planilha que o Junior manda (é o fluxo da S-AE-CONF-04 — categoria de lote nova por leva).
Esta story não cria nem infere lote: ela só **anota qual foi**.

**Como o porteiro descobre qual lote anotar:** pelo **disparo que entregou o convite**, não pela
categoria em que a pessoa está. A consulta da AC2 item 2 já acha a linha de entrega em
`logs_disparo`, e essa linha carrega `disparo_id` (gravado em todo envio —
`worker/campanhas_engine.py:836`).

**Correção da v1.5 (verificada em produção):** a tabela `disparos` **não tem coluna `titulo`** — o
que ela tem é `evento_id`, `tipo`, `status`, `created_at`. Então o lote é identificado pelo
**`disparo_id`** em si, e o nome amigável ("Lote 1", "Lote 2") fica no mesmo lugar de configuração
da AC2.1, mapeado `disparo_id → nome do lote`. Cada lote é um disparo novo do mesmo evento, então a
correspondência é 1 para 1.

A `disparos` também **não guarda** as categorias que o disparo mirou (isso vive no evento e muda a
cada lote), por isso o lote não é recuperável depois pelo dado — o mapeamento tem que ser
registrado quando o lote é criado.

Isso vale mais que ler a categoria porque não depende de nenhuma garantia manual: se a pessoa tiver
entrega comprovada em mais de um disparo, **vale o mais recente**. Depende de uma convenção de
operação: **um disparo por lote, com título que identifique o lote** — é como já foi feito, mas
precisa continuar assim.

**AC2** — Na chegada da mensagem, o lead só é tratado como da campanha se as **duas** coisas forem
verdade:
1. pertence à **categoria do evento** — `simulado 01` (nome definido pelo Junior em 17/09; criada
   pela S-AE-CONF-04); **e**
2. existe **entrega comprovada de um disparo da campanha** para ele — não de um disparo qualquer.

Faltando qualquer uma, **não fazer nada** — comportamento exatamente igual ao de hoje.

**Por que o item 2 precisa dizer "da campanha" (achado 6 do @po, v1.2):** `logs_disparo` é
compartilhado com Institucional, Divulgação e Ouvidoria. Sem essa restrição, quem está na categoria
e recebeu **qualquer** disparo institucional entregue passaria no teste sem nunca ter visto o
convite — e o primeiro "sim" dele, sobre outro assunto, viraria confirmação de presença.

**Quais disparos são da campanha (resolvido em produção, v1.5):** a campanha é um **evento pontual**
— `eventos_pontuais` `697646e3-f558-4f4f-a187-f6242f190d5e`, "Academia Enem - Simulado",
`data_evento = 2026-09-20`. Todo disparo dela carrega `disparos.evento_id` apontando para esse
evento (confirmado no disparo de teste `9e280445…`).

Então a regra é simples e não precisa de lista mantida à mão:

```
entrega comprovada em logs_disparo, cujo disparo tenha evento_id = <evento do simulado>
```

O id do evento fica guardado junto da data de fechamento (AC2.1). Disparo de Divulgação,
Institucional ou Ouvidoria tem outro `evento_id` — ou nenhum — e nunca passa no teste.

**O que conta como "registro de envio" (resposta do Junior, 17/09): entrega comprovada pela Meta.**
Não basta ter saído — o porteiro ignora quem não tem entrega confirmada.

**A fonte é `logs_disparo` (ledger compartilhado), não `logs_disparo_academia_enem`** — correção da
v1.1, ver abaixo. O status é atualizado pelo webhook da Meta (`worker/meta_adapter_inbound.py`,
`_STATUS_MAP`), igual nos dois ledgers:

| status | significa | conta como convite entregue? |
|---|---|---|
| `entregue` / `lido` | a Meta confirmou a entrega | **sim** |
| `enviado` | aceito pela Meta, sem confirmação de entrega ainda | não |
| `falhou` / `aviso` / `apagada` | não chegou | não |

Isso resolve o caso de quem está na categoria mas **nunca recebeu** o convite — algo que vai
acontecer, já que a mensagem expira em 12 horas.

**Risco a tratar no desenvolvimento:** se o callback de `delivered` se perder, uma pessoa que
respondeu de verdade fica com status `enviado` e teria a resposta descartada. Por isso esse descarte
é **logado** (mesma regra da AC2.1): lead na categoria, resposta sim/não, sem entrega comprovada →
não anota, mas deixa rastro.

**AC2.1 — A campanha tem fim.** Só registrar resposta enquanto a campanha estiver aberta. Passado o
fechamento, o porteiro deixa de anotar e essas pessoas voltam a ser leads comuns.

Sem isso, os 621 ficariam marcados para sempre: em novembro, alguém que participou do simulado
pergunta de outra coisa, responde "sim", e entraria na planilha como confirmação de uma prova que já
aconteceu.

**Fechamento (resposta do Junior, 17/09):** `2026-09-20 12:00` (horário de Fortaleza, UTC-3).

**A data é um valor guardado e editável, nunca fixa no código.** A segunda rodada (S-AE-CONF-06) é
**27/09 e reusa a mesma categoria do evento** — quando ela entrar, o fechamento é só movido para a
nova data, sem redeploy do worker e sem mexer em categoria. Data fixa no código torna a S-AE-CONF-06
uma story de programação, que hoje ela não é ("Deploy: nenhum — é cadastro e operação").

**Resposta que chega depois do fechamento:** não anotar **e registrar no log** — mesmo princípio da
AC2.3. Descarte silencioso esconde exatamente o caso que a gente ia querer investigar.

**AC2.2 — Reconhecer a pessoa, não o texto do telefone.** As duas verificações da AC2 são feitas por
uma **chave normalizada**, nunca por comparação exata de telefone e nunca pelo cadastro de onde a
mensagem chegou:

```
chave = 55 + DDD + (os 8 últimos dígitos do número)
```

O nono dígito é **descartado dos dois lados** antes de comparar. Assim `5585991733321` (como foi
enviado) e `558591733321` (como a Meta devolveu) viram a mesma chave, e o porteiro acha a pessoa.

Vale para **as duas** verificações — quem está na categoria **e** quem tem registro de envio. Aplicar
em só uma delas não resolve: o porteiro continuaria errando na outra.

**Telefone fora do formato esperado** (comprimento diferente do previsto, DDI que não é 55): usar
**comparação exata**, nunca chave parcial. Melhor não achar a pessoa do que achar a errada.

**AC2.4 — Pessoa em mais de um lote (segunda rodada).** Não é decidido por código: vale o disparo
mais recente com entrega comprovada (regra da AC1). A limpeza de quem já recebeu no lote anterior é
**manual**, feita pelo @dev antes de subir o lote seguinte — decisão do Junior em 17/09, assumida
como remendo até o redesenho da estrutura.

> **Atenção ao lever escolhido — os dois não são equivalentes** (verificado no código, 17/09):
>
> - **`opt_in = false`** → só bloqueia **saída**. `campanhas_engine.py:168` filtra `opt_in = true`
>   nos disparos; a pessoa para de receber envio e **continua** sendo atendida e anotada.
> - **`bloqueado = true`** → bloqueia a **entrada**. `worker/meta_adapter_inbound.py:136` e `:1109`
>   descartam a mensagem recebida antes de qualquer processamento: o jovem **não recebe resposta do
>   institucional** (quebra a AC6) e **o porteiro nem roda** (a confirmação some).
>
> Para "não mandar de novo", o lever certo é **`opt_in = false`**. `bloqueado` fica reservado para
> quem de fato pediu para parar de receber mensagem.
>
> E importa **em qual cadastro**: como a Meta entrega a resposta no cadastro **sem o nono dígito**
> (o duplicado), bloquear o duplicado faz sumir toda resposta daquela pessoa. Bloquear o cadastro
> convidado é inofensivo para a entrada — mas também não é o que se quer.

**Decisão do Junior (17/09), confirmada:** usar **`opt_in = false`**, no **cadastro convidado**.
`bloqueado` não é usado para este fim.

**AC2.5 — Tirar do disparo não tira da escuta.** `opt_in = false` é só sobre **enviar**. O porteiro
**continua capturando resposta de todos os lotes já enviados**, inclusive de quem foi marcado para
não receber o lote novo — até o fechamento da campanha (AC2.1).

É o caso normal, não a exceção: o convite expira em 12 horas, mas a pessoa responde quando abre o
WhatsApp. Quando o segundo lote subir, ainda vão estar chegando respostas do primeiro. Ligar
`opt_in = false` ao anotar — ou filtrar a escuta pelo lote atual — jogaria essas respostas fora
exatamente na semana em que a planilha está sendo fechada.

**AC2.3 — Uma chave, uma pessoa.** Se duas chaves iguais apontarem para convidados diferentes dentro
da campanha, **não escolher no chute**: não anotar e registrar no log. É melhor faltar uma linha na
planilha do que anotar a confirmação na pessoa errada.

**AC3** — Entender as duas formas de resposta: **botão** e **texto digitado** ("sim", "confirmo",
"vou", "não", "não posso", "não vou"). Quando a frase tiver negação, ela **manda** — "não sei se
confirmo" não é confirmação.

**Decisão do Junior (17/09):** frase ambígua com negação vira **"não vai"** — não é descartada.

**AC4** — Mensagem que não é sim nem não (dúvida, agradecimento) **não vira resposta**. Não inventar.

**AC5** — Se a pessoa responder de novo, a **última resposta vale** — quem confirma e depois desiste
fica como "não vai". Sem duplicar a pessoa.

"A mesma pessoa" aqui é a **mesma chave da AC2.2**. Sem isso, a pessoa que responde de dois formatos
diferentes entraria duas vezes na planilha, com respostas que podem se contradizer.

**AC6** — O jovem continua recebendo resposta do institucional normalmente. Esta story **anota**, não
substitui o atendimento.

**Decisão do Junior (17/09, revisada no mesmo dia):** o texto fixo com horário foi **descartado** —
a AC6 fica como estava. **Confirmação e recusa recebem o mesmo tratamento:** o atendimento normal,
sem resposta especial da campanha. O porteiro **só anota**.

**O que isso aceita, de propósito:** a resposta que o Institucional deu em 17/09 a uma confirmação
de presença (*"Fico feliz em ter ajudado! ... Até mais!"*, com a conversa marcada como `encerrada`)
**continua acontecendo** — para quem confirma e para quem recusa. Não é defeito não visto: é custo
conhecido e aceito. A planilha sai certa, que é o objetivo da epic.

**AC7** — A pessoa continua identificada como da campanha enquanto estiver na categoria. Sair da
categoria é ação manual — ninguém sai sozinho.

## O que esta story não resolve (Caminho C — aceito pelo Junior em 17/09)

Estas coisas **continuam acontecendo** depois desta story, e isso é intencional:

- O cadastro duplicado **continua sendo criado** a cada resposta. O porteiro anota na pessoa certa,
  mas a pessoa segue com dois registros no banco.
- O histórico de conversa dela continua partido entre os dois cadastros.
- Os 10 pares já duplicados hoje continuam como estão.
- Na **segunda rodada de 27/09** (S-AE-CONF-06) o mesmo defeito reaparece — a chave vive só dentro do
  porteiro, não é reaproveitável fora dele.

Resolver de verdade seria o **Caminho A** (identificar a pessoa já na porta de entrada, para todos os
módulos). Fica registrado como dívida técnica, não como pendência desta story.

## O que pode dar errado

**Identificar errado.** O risco aqui não é quebrar, é anotar resposta de quem não era da campanha, ou
deixar de anotar quem era. Por isso a AC2 é a mais importante de testar: lead fora da categoria tem
que se comportar **exatamente** como hoje.

**A chave achatar demais.** Descartar o nono dígito junta números que só diferem nele — um fixo antigo
`7858-2810` e o celular `97858-2810` do mesmo DDD viram a mesma chave. Na base de leads são todos
celulares, então é improvável; a AC2.3 existe para esse caso não virar anotação errada.

**Peso por mensagem.** Toda mensagem do institucional passa a ter uma verificação a mais. Precisa ser
consulta rápida, com índice — e o índice precisa ser **sobre a chave**, não sobre o telefone cru, ou
a consulta varre a tabela inteira.

## PO Validation — @po (Pax) · 2026-09-17

**Veredito: GO CONDICIONAL — 7/10.** A story passa, mas **não vai para `Ready`** antes das 4
correções abaixo. Duas delas dependem de decisão do Junior, não do @sm.

### Checklist de 10 pontos

| # | Ponto | Resultado |
|---|---|---|
| 1 | Título claro e objetivo | ✅ |
| 2 | Descrição completa | ✅ Reforçada pelo caso real de 17/09 |
| 3 | ACs testáveis | ⚠️ AC2.1 e AC2 item 2 não são testáveis como estão (achados 1 e 2) |
| 4 | Escopo IN/OUT definido | ✅ A seção "O que esta story não resolve" é exemplar |
| 5 | Dependências mapeadas | ⚠️ Falta o elo evento↔lote↔disparo (achado 3) |
| 6 | Estimativa de complexidade | ✅ M — coerente |
| 7 | Valor de negócio | ✅ Sem esta story não há planilha |
| 8 | Riscos documentados | ✅ Inclusive o risco novo da chave |
| 9 | Critério de pronto | ⚠️ Não existe lista de cenários de teste (achado 4) |
| 10 | Alinhamento com a epic | ✅ |

### Achado 1 (BLOQUEANTE) — AC2.1 não diz onde está a data de fechamento

"Enquanto a campanha estiver aberta" e "passada a data da prova" não apontam para nenhum campo,
tabela ou configuração. O @dev não tem de onde ler isso, e o @qa não tem como testar. Agrava:
o template atual fala de **duas** datas (20 e 27) — "a data da prova" é ambígua por construção.

### Achado 2 (BLOQUEANTE) — "registro de envio naquele evento" não é verificável

`logs_disparo` guarda `disparo_id`, não evento. Não existe hoje um caminho definido de
disparo → campanha. Falta também dizer o que fazer com `status = 'falhou'`: em produção são
**118 registros**. Quem falhou tem registro de envio mas **nunca recebeu** o convite.

### Achado 3 (BLOQUEANTE) — AC1 pede "lote" sem dizer de onde ele sai

O lead fica em duas categorias (evento + lote, S-AE-CONF-04). A AC1 quer o lote na tabela, mas
nenhuma AC diz como derivá-lo — nem o que fazer quando a pessoa estiver em **mais de um** lote,
que é o cenário da segunda rodada (S-AE-CONF-06 AC2 mantém a mesma categoria de evento).

### Achado 4 (NÃO BLOQUEANTE) — falta a lista de cenários de teste

Story de risco MÉDIO cujo modo de falha é "anotar errado em silêncio" precisa de cenários
nomeados. No mínimo: resposta nos dois formatos de telefone; lead fora da categoria (tem que se
comportar igual a hoje); lead na categoria sem envio; resposta dupla (AC5); mensagem que não é
sim nem não (AC4); chave ambígua (AC2.3).

### Achado 5 (NÃO BLOQUEANTE, mas de produto) — a AC6 conserva um comportamento ruim

No teste de 17/09 o Institucional respondeu **"Fico feliz em ter ajudado! ... Até mais!"** a uma
confirmação de presença, e encerrou a conversa. A AC6 diz que o atendimento segue "normalmente" —
ou seja, esta story **preserva** essa resposta. A planilha sai certa e o objetivo da epic é
cumprido, mas 621 pessoas recebem uma despedida ao confirmar presença. Decisão do Junior, fora do
escopo desta story.

### Lacuna de borda na AC2.2 (incluir junto)

A chave `55 + DDD + 8 últimos` não diz o que fazer com número que não tenha esse formato
(comprimento diferente, DDI que não é 55). Regra a acrescentar: **formato inesperado → comparação
exata**, nunca chave parcial.

## Cenários de teste (Achado 4 — resposta do Junior, 17/09)

**Quem testa:** dois leads reais — **Valmir Junior** e **João Escorcio**. Em produção, no número da
Academia Enem, antes da carga dos 621.

O cadastro do Valmir já tem o **par duplicado** (com e sem o nono dígito) criado pelo teste de 17/09
— é ele que torna os cenários 1 e 9 testáveis de verdade, sem fabricar dado.

| # | Cenário | AC | Resultado esperado |
|---|---|---|---|
| 1 | Valmir recebe o convite e aperta **"Sim, eu vou!"** (telefone volta da Meta **sem** o 9) | AC1, AC2.2, AC3 | Anota no **cadastro convidado**, forma = botão, lote = título do disparo que entregou |
| 2 | João responde **digitando** "sim, vou" | AC3 | Anota, forma = digitado |
| 3 | João aperta **"Nao poderei comparecer"** | AC3, AC5 | Vira "não vai" — e a linha dele do cenário 2 é **substituída**, não duplicada |
| 4 | Valmir manda "qual o endereço?" | AC4 | **Não** vira resposta; atendimento normal responde |
| 5 | Valmir confirma e depois manda "não vou" | AC5 | Uma linha só, valendo a última ("não vai") |
| 6 | Número **fora** da campanha manda "sim" | AC2 | Nada anotado; comportamento **idêntico** ao de hoje |
| 7 | João na categoria, **sem entrega comprovada** (status `enviado` ou `falhou`), responde "sim" | AC2 | Não anota, **mas loga** |
| 8 | Mover a data de fechamento para o passado e responder | AC2.1 | Não anota, **mas loga** (é o teste que prova que a data é editável) |
| 9 | Os **dois cadastros do Valmir** (com e sem 9) na categoria e com entrega comprovada | AC2.3 | Não anota, **loga** a ambiguidade — nunca escolhe um dos dois |
| 10 | João com `opt_in = false` (marcado para não receber o lote novo) responde o convite do lote anterior | AC2.5 | **Continua** sendo anotado |
| 11 | Valmir confirma e João recusa | AC6 | Os dois recebem o **atendimento normal**, igual ao de hoje — o porteiro não muda a resposta de ninguém |

**Observação sobre o cenário 3 e frases ambíguas:** "não sei se confirmo" hoje cai na AC3 (negação
manda → "não vai"). Se o Junior preferir que frase ambígua não vire resposta nenhuma (AC4), é um
ajuste de uma linha — vale decidir antes do @dev começar.

## Correção v1.1 — a campanha NÃO roda no canal isolado da Academia Enem

Descoberto em 17/09, ao investigar a pergunta dos horários. **Isto invalida parte da v0.4 e o
veredito de `Ready`.**

O número próprio da Academia Enem **nunca foi pareado** — a migration de cadastro
(`20260820000000_ae_meta_phone_numbers_templates_seed.sql`) ainda está com
`SUBSTITUIR_PHONE_NUMBER_ID`. Sem esse número, nada entra no caminho isolado: o desvio em
`worker/meta_adapter_inbound.py:1025` só dispara quando `agente_tipo == "academia_enem"`.

O teste de 17/09 confirma na prática — o convite saiu pelo **módulo genérico de disparo**
(`disparos` + `logs_disparo`) e **quem respondeu foi o agente Institucional**.

**Consequência:** a v0.4 mandou o @dev procurar entrega comprovada em `logs_disparo_academia_enem`,
que terá **zero linhas** para os 621. A AC1 e a AC2 foram corrigidas para `logs_disparo` /
`disparos` / `disparo_id`.

O resto da regra **não muda**: os dois ledgers têm as mesmas colunas (`disparo_id`/`lead_id`/
`wamid`/`status`) e recebem a mesma atualização de status da Meta. "Entrega comprovada =
`entregue`/`lido`" e "lote = título do disparo que entregou" continuam valendo iguais.

**Confirmar antes do @dev começar:** de qual tela o envio dos 621 vai sair. Se for o módulo
Academia Enem do portal (que exige o número pareado), o ledger volta a ser
`logs_disparo_academia_enem` — é trocar o nome da tabela, nada mais.

## PO Revalidation — @po (Pax) · 2026-09-17 (v0.9)

**Veredito: GO — 9/10.** Os 3 achados bloqueantes da v0.3 estão fechados com resposta do Junior, e
os 2 não bloqueantes também. Status movido para **`Ready`**. Liberada para o @dev.

| # | Ponto | v0.3 | v0.9 |
|---|---|---|---|
| 1 | Título claro | ✅ | ✅ |
| 2 | Descrição completa | ✅ | ✅ |
| 3 | ACs testáveis | ⚠️ | ✅ Fechamento com data e hora; "registro de envio" com status nomeado |
| 4 | Escopo IN/OUT | ✅ | ✅ Reforçado (AC6 assume o custo do Achado 5) |
| 5 | Dependências mapeadas | ⚠️ | ✅ Elo lote↔disparo resolvido via `disparo_academia_enem_id` |
| 6 | Complexidade | ✅ | ✅ M mantido |
| 7 | Valor de negócio | ✅ | ✅ |
| 8 | Riscos documentados | ✅ | ✅ Mais o risco do callback de entrega perdido |
| 9 | Critério de pronto | ⚠️ | ✅ 11 cenários com leads nomeados |
| 10 | Alinhamento com a epic | ✅ | ✅ |

### Como cada achado foi fechado

| Achado | Status | Como |
|---|---|---|
| 1 — data de fechamento | ✅ Fechado | `2026-09-20 12:00` (Fortaleza), valor guardado e editável |
| 2 — "registro de envio" | ✅ Fechado | `logs_disparo_academia_enem`, entrega comprovada = `entregue`/`lido` |
| 3 — origem do lote | ✅ Fechado | Lote criado à mão (CONF-04); anotado a partir do disparo que entregou |
| 4 — cenários de teste | ✅ Fechado | 11 cenários, Valmir Junior e João Escorcio |
| 5 — despedida na confirmação | ✅ Fechado | Junior optou por manter o atendimento como está — custo aceito e escrito |

### O ponto que faltou para ser 10/10

**Onde mora a data de fechamento não está dito.** A AC2.1 impõe a restrição certa (editável **sem
redeploy**, o que exclui variável de ambiente e constante no código), mas não nomeia tabela nem
campo. Não bloqueia: é decisão de desenho do @dev, e o cenário 8 testa o resultado. Fica registrado
para o @dev escolher **explicitamente** e anotar no Dev Agent Record.

### Pendências que o @dev leva junto (nenhuma bloqueia o início)

1. **Nome exato da categoria do evento** — vem da S-AE-CONF-04. Confirmar antes de codar a AC2 item
   1; a análise de 17/09 mostrou duas candidatas (`Academia Enem` e `Envio ENEM`), ambas com 0 leads.
2. **Decisão de uma linha, do Junior:** "não sei se confirmo" hoje é classificado como **"não vai"**
   (AC3, negação manda). Se ele preferir tratar frase ambígua como "não vira resposta" (AC4), decidir
   antes de escrever o classificador.
3. **Os "118 falhou" do Achado 2 vieram da tabela errada** (`logs_disparo`). Reconferir os números no
   ledger certo (`logs_disparo_academia_enem`) antes do teste — pode mudar o tamanho do problema.
4. **Cosmético:** a AC2.4 aparece antes da AC2.3 no arquivo. Não altera comportamento; arrumar na
   próxima edição do @sm.

### Risco que sai desta validação assumido, não resolvido

A confirmação de presença continua recebendo despedida do Institucional, com a conversa marcada como
`encerrada` (observado em 17/09). Decisão do Junior, registrada na AC6. **O @qa não deve tratar isso
como achado novo** no gate — está aceito por escrito.

## PO Revalidation — @po (Pax) · 2026-09-17 (v1.1, após a correção da tabela)

**Veredito: GO CONDICIONAL — 8/10. Status segue `Draft`.** A correção da v1.1 está certa e era
necessária — mas ela **reabre** um achado que tinha sido fechado por um motivo que deixou de valer.
Falta **uma** correção, pequena e bem definida.

### Achado 6 (BLOQUEANTE) — com o ledger compartilhado, "teve entrega" não quer dizer "recebeu o convite"

Enquanto a fonte era `logs_disparo_academia_enem`, a AC2 item 2 podia ser simples: aquele ledger é
100% da Academia Enem, então qualquer linha de entrega ali **era** o convite. Foi por isso que eu
dei o elo "disparo → campanha" por resolvido na v0.9.

`logs_disparo` **não** é exclusivo. É o ledger de Institucional, Divulgação e Ouvidoria. Um lead da
categoria que recebeu **qualquer** disparo institucional entregue nos últimos meses passa na AC2
item 2 sem nunca ter visto o convite do simulado — e a primeira vez que ele mandar "sim" para outra
coisa, vira confirmação de presença na planilha.

É exatamente o modo de falha que a story diz ser o pior: **anotar errado, em silêncio**.

**Correção necessária (uma linha na AC2):** a entrega comprovada tem que ser **de um disparo da
campanha**, não de qualquer disparo. O caminho mais simples, sem tabela nova: guardar a lista de
`disparos.id` da campanha **no mesmo lugar onde já vai morar a data de fechamento** (AC2.1) — a
consulta passa a ser "entrega comprovada **em um desses disparos**". Alternativa equivalente:
identificar pelo `template_nome` do convite (`ae_simulado_v2` e o da segunda rodada), se o @dev achar
mais estável.

Ganho de brinde: isso também deixa a regra do lote (AC1) fechada — o título vem de um disparo que
comprovadamente é da campanha.

### Os outros pontos

| # | Ponto | v0.9 | v1.1 |
|---|---|---|---|
| 3 | ACs testáveis | ✅ | ⚠️ AC2 item 2 volta a não ser suficiente (achado 6) |
| 5 | Dependências mapeadas | ✅ | ✅ Corrigido para `disparos`/`logs_disparo`/`disparo_id` |

Todo o resto da v0.9 continua valendo sem mudança: fechamento, chave normalizada, AC2.3, AC2.4,
AC2.5, AC6 e os 11 cenários de teste.

### Correções às pendências que eu mesmo listei na v0.9

- **Pendência 3 cai:** eu tinha pedido para reconferir os "118 `falhou`" no ledger da Academia Enem.
  Com a v1.1, `logs_disparo` **é** a tabela certa — o número já estava certo desde a primeira
  validação.
- **Pendência 1 continua:** confirmar o nome exato da categoria do evento antes de codar a AC2.
- **Pendência 2 continua:** a decisão de uma linha sobre "não sei se confirmo".
- **Nova:** confirmar de qual tela sairá o envio dos 621 (a própria v1.1 já pede). Se for o módulo
  Academia Enem com número pareado, a AC2 troca de ledger — e o achado 6 **deixa de existir**, porque
  aquele ledger é exclusivo da campanha.

## PO Revalidation — @po (Pax) · 2026-09-17 (v1.3)

**Veredito: GO — 9/10. Status `Draft` → `Ready`. Liberada para o @dev.**

O achado 6 está fechado: a AC2 item 2 agora exige **entrega comprovada de um disparo da campanha**,
com o motivo escrito (o `logs_disparo` é compartilhado) e com o lugar onde a lista de disparos mora
— o mesmo da data de fechamento, o que evita inventar tabela nova.

Todos os 6 achados desta story estão fechados. O ponto que continua tirando o 10º é o mesmo da
v0.9: **onde exatamente mora a configuração** (data de fechamento + lista de disparos da campanha)
é decisão de desenho do @dev, com uma restrição já imposta pela AC2.1 — editável **sem redeploy**.
Anotar a escolha no Dev Agent Record.

### O que o @dev leva junto (nenhuma bloqueia o início)

1. Confirmar o **nome exato da categoria do evento** (vem da S-AE-CONF-04).
2. Confirmar **de qual tela sai o envio dos 621** — se for o módulo Academia Enem com número
   pareado, a AC2 troca de ledger e a restrição por disparo deixa de ser necessária.
3. Decisão de uma linha, do Junior, ainda em aberto: **"não sei se confirmo"** hoje vira "não vai"
   (AC3, negação manda). Se ele preferir tratar como "não vira resposta" (AC4), decidir antes de
   escrever o classificador.

## Dev Agent Record — @dev (Dex) · 2026-09-17

### File List

| Arquivo | O que é |
|---|---|
| `worker/academia_enem_porteiro.py` | **Novo.** O porteiro inteiro: chave por variantes, classificação, config, gate e gravação |
| `worker/meta_adapter_inbound.py` | Hook de 16 linhas, depois da gravação da mensagem e antes do dispatch |
| `worker/tests/test_academia_enem_porteiro.py` | **Novo.** 28 testes — os 11 cenários da story, bordas e o achado 1 do @qa |
| `cuca-portal/supabase/migrations/20260917120000_ae_conf_03_porteiro_confirmacoes.sql` | **Novo.** Tabela + índices + RLS + linha de configuração |

### Banco — aplicado direto em produção (`cuca`), conforme a regra de ambiente

- `confirmacoes_simulado_ae` criada, RLS **ligada**, leitura por `has_permission('campanhas','read')`
  (recurso confirmado como existente antes de aplicar).
- Índice único `(evento_id, lead_id)` — é ele que faz a AC5 ("a última resposta vale") sem duplicar.
- Linha em `configuracoes`, chave `academia_enem_confirmacao`, com o `evento_id` real do simulado
  (`697646e3…`) e `fechamento = 2026-09-20T12:00:00-03:00`.

> **O porteiro está DESLIGADO de propósito agora:** `categoria_evento_id` está `null`, porque a
> categoria `simulado 01` ainda não existe (é a S-AE-CONF-04). Sem ela, `carregar_config` devolve
> `None` no primeiro passo e nenhuma mensagem é tocada. **Ligar = preencher esse campo** — sem
> deploy, sem mexer em código. O mapa `lotes` (disparo_id → "Lote 1") também é preenchido ali, na
> hora de criar cada lote.

### Decisões de implementação

**Chave por variantes, não por coluna normalizada.** A AC2.2 pede chave normalizada com índice.
Implementei gerando as **duas escritas possíveis** do número (com e sem o nono dígito) e comparando
por igualdade exata — usa o índice que já existe em `leads.telefone`, não exige coluna nova nem
backfill em 2.139 leads, e dá o mesmo resultado. Continua fiel ao Caminho C: nada fora do porteiro
mudou.

A geração das variantes **não testa dígito nenhum** — foi exatamente aí que o
`_normalizar_telefone_br` errou (testava `telefone[4] != '9'`, e no caso de 17/09 o índice 4 já era
um 9, do antigo 9173-3321). De 13 dígitos, tira a posição 4; de 12, insere o 9. Fora desses dois
comprimentos, ou DDI diferente de 55: comparação exata, sem variante (AC2.2).

**Motivos de recusa distinguíveis no log:** `sem_categoria`, `sem_entrega`, `pos_fechamento`,
`chave_ambigua`. Os cenários 7, 8 e 9 do @qa checam coisas diferentes — um log genérico deixaria os
três indistinguíveis na hora de investigar.

**Ordem da verificação, por causa do peso por mensagem:** classificação (sem banco) → configuração
→ fechamento → só então as consultas de lead/categoria/entrega. Mensagem que não é sim nem não sai
**antes de qualquer SELECT**.

> **Corrigido em 17/09 (achado 1 do @qa):** a primeira versão lia a configuração antes de
> classificar, o que dava um SELECT por mensagem que entra no Institucional — ~460/dia, medidos em
> produção. Agora a classificação vem primeiro, e um teste garante isso: o `supabase` falso
> **conta as tabelas consultadas** e o teste exige que a lista fique vazia para "bom dia", "que
> horas começa?", "obrigado!" e mensagem vazia.
>
> **Achado 7 do @qa:** a primeira versão desse teste levantava `AssertionError` em vez de contar —
> e `carregar_config` engolia isso no seu próprio `try/except Exception`, então o teste passava com
> a ordem certa **e** com a errada. Conferido por mutação: revertendo a ordem do código, o teste
> novo **falha** (e volta a passar quando a ordem é restaurada).

**Best-effort de verdade:** o hook inteiro está dentro de `try/except` no inbound. Qualquer erro do
porteiro vira log e o atendimento segue — a AC6 é "nada muda", e vale inclusive quando o porteiro
quebra.

### Decisão do Junior sobre o achado 2 do @qa (17/09)

**`cancelar` continua nos padrões de negação do porteiro.** Quem mandar "cancelar" entra na planilha
como "não vai" e também é registrado como opt-out, e isso é o comportamento desejado — cancelar
inscrição é não comparecer. Não é pendência.

### Testes

- `pytest tests/test_academia_enem_porteiro.py` → **28 passando**.
- Suíte do worker: **730 passando**. As **5 falhas em `test_meta_adapter_outbound.py` são
  pré-existentes** — confirmei rodando com as minhas mudanças fora da árvore: mesmas 5 falhas.
  Os testes de inbound passam todos.

### O que NÃO foi feito (de propósito)

- `_normalizar_telefone_br` não foi tocada (seria o Caminho A, fora de escopo).
- Nada no caminho de resposta do Institucional foi alterado (AC6, depois que a AC6.1 caiu).
- Sem rotina de limpeza/retenção da tabela nova.
- **Sem commit e sem push** — etapa do @devops, ainda não autorizada.

### Para o @qa

- A tabela está **vazia** e o porteiro **desligado** (`categoria_evento_id` nulo) — é o estado
  esperado antes da S-AE-CONF-04.
- Os cenários 1, 3, 4, 6, 7, 8 e 9 estão cobertos por teste automatizado. Os cenários 2, 5, 10 e 11
  dependem de WhatsApp real, com os dois leads combinados.
- Vale conferir no banco: RLS ligada com policy efetiva, índice único presente, e que nenhuma
  tabela existente foi alterada por esta migration.

## QA Results — @qa (Quinn) · 2026-09-17

**Veredito: CONCERNS — aprovado com 2 observações.** Nada aqui bloqueia o avanço; as duas
observações são baratas de resolver e uma delas é decisão sua, não de código.

### Os 7 quality checks

| # | Check | Resultado |
|---|---|---|
| 1 | Code review | ✅ Módulo isolado, responsabilidade única, hook mínimo e dentro de `try/except` |
| 2 | Testes | ✅ 27 novos passando; 134 passando no conjunto porteiro + inbound + fila AE |
| 3 | Acceptance Criteria | ✅ AC1-AC7 implementadas (ver mapeamento abaixo) |
| 4 | Regressão | ✅ Nenhum caminho existente alterado; hook não tem `return` que interrompa o fluxo |
| 5 | Performance | ⚠️ Observação 1 |
| 6 | Segurança | ✅ RLS ligada com policy **efetiva**; sem policy de escrita (só service_role grava) |
| 7 | Documentação | ⚠️ Dev Notes descreve uma ordem de verificação que o código não segue (observação 1) |

### Banco conferido em produção (read-only)

- `confirmacoes_simulado_ae`: 14 colunas, 4 FKs (evento, lead convidado, lead respondente, disparo).
- **Índice único `(evento_id, lead_id)` presente** — é o que garante a AC5 estruturalmente.
- **RLS ligada**, policy de leitura `has_permission('campanhas','read')` — recurso `campanhas`
  existe de verdade na tabela `permissoes`, então a policy não é morta.
- Nenhuma tabela existente foi alterada pela migration. Tabela vazia, porteiro desligado
  (`categoria_evento_id` nulo) — estado esperado antes da S-AE-CONF-04.

### Observação 1 (CONCERNS) — a configuração é lida em toda mensagem, antes da classificação

O Dev Notes diz "classificação (sem banco) → fechamento (sem banco) → só então as consultas". O
código faz o contrário: `carregar_config` é a **primeira** linha de `registrar_resposta`, antes de
classificar. Resultado: **um SELECT em `configuracoes` para cada mensagem de lead que entra no
Institucional** — inclusive "bom dia", áudio e foto, que nunca virariam resposta.

Medido em produção: **3.208 mensagens de lead nos últimos 7 dias** (~460/dia). São ~460 consultas
por dia que não precisariam existir. Não derruba nada e nem chega perto de ser gargalo — mas a
story avisa explicitamente sobre "peso por mensagem", e a correção é trocar duas linhas de lugar
(classificar primeiro; se vier `None`, sair antes de tocar no banco).

Enquanto não for corrigido, vale ajustar o Dev Notes para descrever o que o código realmente faz —
documentação que descreve outra ordem é pior que documentação nenhuma na hora de investigar.

### Observação 2 (decisão do Junior, não é defeito) — "cancelar" vira "não vai" e também opt-out

O porteiro roda **antes** da checagem de opt-out, e a palavra `cancelar` está nas duas listas: nos
padrões de negação do porteiro e em `_PADROES_OPT_OUT` do inbound. Consequência: quem mandar
"cancelar" entra na planilha como **"não vai"** e, na mesma mensagem, é registrado como opt-out.

Pode estar certo — "cancelar inscrição" realmente é não comparecer. Mas alguém que só quer parar de
receber mensagem não necessariamente está dizendo que não vai à prova. Duas saídas, as duas
defensáveis: manter (uma recusa a mais na planilha, sem prejuízo real) ou tirar `cancelar` dos
padrões de negação do porteiro e deixar essa palavra só para o opt-out. É decisão de produto.

Conferi as outras sobreposições: "não quero mais receber", "parar de receber" e "remover meu
número" **não** são classificadas pelo porteiro — só `cancelar`.

### Mapeamento das ACs

| AC | Onde | Como conferi |
|---|---|---|
| AC1 | Tabela + `lote` vindo do mapa da config | Colunas conferidas no banco |
| AC2 | `registrar_resposta` — categoria **e** entrega comprovada de disparo do evento | Teste "entrega de disparo de outro módulo não conta" |
| AC2.1 | `campanha_aberta`, com fuso | Teste com 14:59 e 15:01 UTC na virada das 12:00 de Fortaleza |
| AC2.2 | `variantes_telefone`, sem testar dígito | Teste com os dois telefones reais de 17/09, nas duas direções |
| AC2.3 | Recusa quando há mais de um convidado | Teste do cenário 9 |
| AC2.4/2.5 | Entrega mais recente define o lote; `opt_in` não é consultado em lugar nenhum | Leitura do código |
| AC3/AC4 | `classificar_resposta`, negação antes de afirmação | 9 casos parametrizados, incluindo os rótulos exatos dos botões |
| AC5 | Upsert + índice único | Índice conferido no banco |
| AC6 | Hook sem `return`, dentro de `try/except` | Leitura do diff (16 linhas) |
| AC7 | Nada remove ninguém da categoria | Leitura do código |

### Pontos que o @dev acertou e vale registrar

A ordenação das entregas usa `created_at`, não `enviado_em` — e está certo: o insert do caminho
genérico (`worker/campanhas_engine.py:836`) **não preenche `enviado_em`**. Se tivesse usado o campo
"óbvio", o lote sairia errado ou nulo.

### Fora do escopo desta story

As **5 falhas em `test_meta_adapter_outbound.py`** são reais e **pré-existentes** — confirmei de
forma independente, rodando a suíte com as mudanças desta story fora da árvore: as mesmas 5 falham.
Não têm relação com o porteiro (são transbordo neutro e endpoint de envio). Merecem story própria.

### Recomendação

Seguir para o @devops **ou** pedir ao @dev a inversão de duas linhas da observação 1 antes do push
— as duas opções são defensáveis. O que **não** pode é ligar o porteiro (preencher
`categoria_evento_id`) antes da S-AE-CONF-04 criar a categoria `simulado 01`.

## QA Results — @qa (Quinn) · 2026-09-17 (2ª rodada)

**Veredito: CONCERNS — a correção está certa, o teste que a protege não está.**

### A correção do código: ✅ confirmada

Li a ordem no arquivo restaurado: `classificar_resposta` → `carregar_config` → `campanha_aberta` →
consultas. Mensagem que não é sim nem não sai antes de qualquer SELECT. O achado 1 da 1ª rodada
está resolvido de verdade, e o Dev Notes agora descreve o que o código faz.

### Achado 7 (BLOQUEANTE para o gate, trivial de corrigir) — o teste novo não pega a regressão

O @dev escreveu um teste que passa um `supabase` falso que **levanta `AssertionError` se qualquer
tabela for consultada**, para provar que nenhuma consulta acontece. Testei o teste: **reverti a
ordem no código e rodei — os 28 continuaram passando.**

O motivo é `carregar_config`, que tem `try/except Exception` e devolve `None` em qualquer erro.
`AssertionError` é subclasse de `Exception`: a consulta proibida acontece, a exceção é engolida
pelo próprio porteiro, `carregar_config` devolve `None`, `registrar_resposta` devolve `None` — e o
teste vê exatamente o que esperava ver. Ele passa **tanto com a ordem certa quanto com a errada**.

Isso é pior que não ter teste: dá confiança de que a ordem está protegida quando não está. Se
alguém reinverter as duas linhas daqui a três meses, a suíte fica verde.

**Correção:** trocar o "levanta exceção" por **contagem**. O falso registra os nomes das tabelas
consultadas numa lista, e o teste afirma que a lista está **vazia** ao final. Uma lista não é
engolida por `try/except`. Mesmas 4 mensagens de entrada, mesma intenção, aí sim com dente.

### O resto continua valendo da 1ª rodada

7 checks, mapeamento das ACs, banco conferido em produção (RLS efetiva, índice único, FKs), e as 5
falhas pré-existentes em `test_meta_adapter_outbound.py` — nada disso mudou.

`cancelar` mantido como negação, por decisão do Junior, está registrado no Dev Agent Record. Não é
mais pendência.

### Recomendação

Devolver ao @dev **só para o ajuste do teste** (3 linhas). O código de produção **não precisa de
mais nada** — se a pressa do dia 20 falar mais alto, dá para seguir para o @devops e corrigir o
teste depois, desde que isso vire pendência escrita e não esquecimento.

## QA Results — @qa (Quinn) · 2026-09-17 (3ª rodada — gate fechado)

**Veredito: PASS.** Achado 7 resolvido e verificado de forma independente. Nada pendente do lado
de código ou de banco.

### Como conferi (sem repetir o método do @dev)

Ele provou revertendo a ordem. Eu usei uma **mutação diferente**, para não validar só o caso que
ele já tinha na cabeça: **inseri um SELECT extra antes da classificação**, mantendo a ordem do
resto. O teste **falhou**, como tem que falhar — ou seja, ele protege a garantia ("nenhuma consulta
para mensagem irrelevante"), não uma forma específica de escrever o código.

Depois restaurei e conferi por `diff` que o módulo voltou idêntico. O `git diff` do worker mostra
**só as 16 linhas do hook** — nenhum resto de experimento ficou para trás.

### Estado final

| Item | Resultado |
|---|---|
| Porteiro + inbound | **119 testes passando** |
| Suíte do worker | **697 passando**, 6 falhas **pré-existentes** |
| `pyflakes` | Limpo nos arquivos novos |
| Banco (produção) | RLS efetiva, índice único, 4 FKs, nenhuma tabela existente alterada |

### Sobre as 6 falhas pré-existentes — agora com prova, não com suposição

São 5 em `test_meta_adapter_outbound.py` e 1 em `test_main_worker_scope.py`
(`test_worker_scope_academia_enem_nao_inicia_loops_de_outros_modulos`, que quebra por falta de
variável de ambiente: `supabase_url is required`).

Rodei a suíte **com e sem o hook desta story**: **669 passando e a mesma falha nos dois casos**.
Não têm relação com o porteiro. A do `worker_scope` só apareceu agora porque, sem
`OPENAI_API_KEY` no ambiente, aquele arquivo nem chegava a ser coletado — estava escondida, não
ausente. Vale uma story própria.

### O que continua valendo das rodadas anteriores

Os 7 quality checks, o mapeamento das ACs uma a uma, e a decisão do Junior de manter `cancelar`
como negação.

### Único ponto de atenção para o @devops

O porteiro está **desligado** (`categoria_evento_id` nulo na configuração) e deve continuar assim
até a **S-AE-CONF-04** criar a categoria `simulado 01`. O push não liga nada sozinho — mas o
redeploy do `cuca-worker` é necessário para o código valer em produção.

## Mudança de regra v2.0 (17/09) — a categoria é o único gatilho

**Decisão do Junior, depois do teste real.** A AC2 exigia **duas** condições: categoria do evento
**e** entrega comprovada de um disparo da campanha. Agora exige **uma**: estar na **categoria do
evento**.

**Por que mudou.** A programação pontual **não reabre para reenviar** — cada envio cria um evento
pontual **novo**. Como os disparos da campanha eram identificados pelo evento, todo envio novo
exigia alguém lembrar de registrar aquele evento na configuração. Esquecer não dava erro nenhum:
a planilha simplesmente ficava vazia. No teste de 17/09 isso já aconteceu — a confirmação só foi
gravada porque a entrega do dia anterior ainda valia.

**O túnel, agora:** a saída mira a **categoria do lote** (é o público do disparo); a entrada é
reconhecida pela **categoria do evento**. Mesma coisa que já governa o envio governa a escuta.

**O que se perde:** quem está na categoria, nunca recebeu o convite e responde "sim" para outro
assunto entra na planilha. Risco aceito e pequeno: a categoria é curada à mão e só tem gente do
edital. O risco do outro lado — planilha vazia por esquecimento — é bem maior.

**O que muda no texto das ACs:** AC2 item 2 e a AC2.4 (regra do lote pelo disparo) saem. O **lote
passa a vir da categoria de lote** da pessoa, pelo mapa `lotes` da configuração
(`categoria_id → nome`). AC2.2 (chave por telefone), AC2.1 (fechamento), AC2.3 (chave ambígua),
AC5 (última resposta vale) e AC6 continuam iguais.

## AC9 (v2.1, 17/09) — a conversa do lead da campanha não é encerrada

**Instrução do Junior:** o lead da campanha fica **dentro do túnel até o dia da prova**. Não pode
ter a conversa marcada como encerrada depois da despedida do agente — é o que garante que as
perguntas seguintes (horário, local) continuem sendo tratadas como parte da campanha.

**Como funciona:** quando o agente decide encerrar, o porteiro é consultado. Se for lead da
campanha e a campanha estiver aberta (AC2.1), a conversa volta para **`ativa`**. Não basta "não
marcar": o motor-agente também marca por dentro, então o inbound **desfaz**.

Passado o fechamento, encerra normalmente — como qualquer conversa.

**Custo:** a checagem só roda quando o agente decide encerrar, não em toda mensagem.

**O que não muda:** o texto da despedida continua o mesmo (decisão da AC6). O que muda é só a
conversa continuar aberta.

## Change Log

| Data | Versão | Descrição | Autor |
|---|---|---|---|
| 2026-09-16 | 0.1 | Draft inicial | @sm (River) |
| 2026-09-17 | 0.2 | AC2.2/AC2.3 (chave normalizada) + ajustes na AC1 e AC5; seção de escopo do Caminho C | @sm (River) |
| 2026-09-17 | 0.3 | Validação @po: GO condicional 7/10 — 3 achados bloqueantes registrados; status segue `Draft` | @po (Pax) |
| 2026-09-17 | 0.4 | Respostas do Junior: fechamento 20/09 12:00 (valor editável) e "entrega comprovada" como regra de envio — Achado 1 fechado, Achado 2 fechado em parte; Achado 3 segue aberto; status segue `Draft` | @sm (River) |
| 2026-09-17 | 0.5 | Respostas do Junior sobre o lote: criação manual pelo @dev; lote derivado do disparo que entregou; AC2.4 (mais de um lote) + alerta `opt_in` vs `bloqueado` — Achado 3 fechado; status segue `Draft` até confirmação do lever | @sm (River) |
| 2026-09-17 | 0.6 | Junior confirmou: `opt_in = false` no cadastro convidado, e isso vale só para disparo — AC2.5 (escuta continua em todos os lotes já enviados). 3 achados bloqueantes fechados; pronta para revalidação do @po | @sm (River) |
| 2026-09-17 | 0.7 | Achado 4: cenários de teste com Valmir Junior e João Escorcio (11 cenários). Achado 5: AC6.1 — texto fixo na confirmação, agente não decide esse caminho. Pendente só o texto da recusa | @sm (River) |
| 2026-09-17 | 0.8 | Junior revisou o Achado 5: AC6.1 removida, AC6 volta ao original — confirmação e recusa recebem o mesmo atendimento normal. Achado 5 fechado como custo aceito | @sm (River) |
| 2026-09-17 | 0.9 | Lacuna de borda da AC2.2 incorporada (formato inesperado → comparação exata), pendente desde a v0.3 | @sm (River) |
| 2026-09-17 | 1.0 | Revalidação @po: **GO 9/10** — 5 achados fechados; status `Draft` → **`Ready`** | @po (Pax) |
| 2026-09-17 | 1.1 | **Correção:** a campanha roda no canal Institucional (número da AE não pareado) — AC1/AC2 voltam para `logs_disparo`/`disparos`/`disparo_id`. Status **`Ready` → `Draft`** até o @po revalidar | @sm (River) |
| 2026-09-17 | 1.2 | Revalidação @po: **GO CONDICIONAL 8/10** — achado 6 (ledger compartilhado exige restringir aos disparos da campanha); status segue `Draft` | @po (Pax) |
| 2026-09-17 | 1.3 | Achado 6 corrigido na AC2: entrega comprovada tem que ser **de um disparo da campanha**, com a lista guardada junto da data de fechamento | @sm (River) |
| 2026-09-17 | 1.4 | Revalidação @po: **GO 9/10** — 6 achados fechados; status `Draft` → **`Ready`** | @po (Pax) |
| 2026-09-17 | 1.5 | Respostas do Junior + verificação em produção: categoria `simulado 01`; envio pela **programação pontual**; disparos da campanha identificados por `evento_id`; `disparos` **não tem `titulo`** (lote vira `disparo_id` + mapa na config); ambíguo com negação = "não vai" | @sm (River) |
| 2026-09-17 | 1.6 | **Implementada** (@dev): porteiro em módulo próprio + hook no inbound + migration aplicada em produção; 27 testes novos. Status → **`Ready for Review`** | @dev (Dex) |
| 2026-09-17 | 1.7 | QA gate: **CONCERNS** — 2 observações (config lida antes da classificação; "cancelar" como negação). Banco conferido em produção. Status → **`InReview`** | @qa (Quinn) |
| 2026-09-17 | 1.8 | Achado 1 do @qa corrigido (classificação antes de qualquer SELECT) + teste que prova; `cancelar` mantido por decisão do Junior. Status → **`Ready for Review`** | @dev (Dex) |
| 2026-09-17 | 1.9 | QA 2ª rodada: correção do achado 1 **confirmada**; achado 7 — o teste que a protege não pega a regressão (`AssertionError` engolida por `carregar_config`). Status → **`InReview`** | @qa (Quinn) |
| 2026-09-17 | 1.10 | Achado 7 corrigido: o teste passou a contar as tabelas consultadas em vez de levantar exceção; conferido por mutação (reverter a ordem faz o teste falhar). Status → **`Ready for Review`** | @dev (Dex) |
| 2026-09-17 | 1.11 | QA gate 3ª rodada: **PASS** — achado 7 verificado por mutação independente; 6 falhas pré-existentes provadas como não relacionadas. Liberada para o @devops | @qa (Quinn) |
| 2026-09-17 | 1.12 | Mergeado na `main` (PR #194) e `cuca-worker` redeployado sem erro. Porteiro no ar, **desligado** por configuração até a S-AE-CONF-04. Status → **`Done`** | @devops (Gage) |
| 2026-09-17 | 2.0 | **Mudança de regra:** gatilho passa a ser só a categoria do evento; lote vem da categoria de lote. Motivo: cada envio pontual cria evento novo e o vínculo por disparo quebrava em silêncio | @dev (Dex) |
| 2026-09-17 | 2.1 | AC9: conversa de lead da campanha não é encerrada enquanto a campanha estiver aberta (o inbound desfaz o encerramento do motor-agente) | @dev (Dex) |
