# S-EMP-AUD-023 — Vaga Direta: consolida listagem de vagas por cargo com seleção múltipla

**Status:** Ready
**Epic:** Auditoria Empregabilidade
**Origem:** demanda direta do Junior, 2026-08-18 ("VAGA DIRETA"), detalhada por ele em 2026-08-18 após
1ª versão da story ser considerada insuficiente
**Prioridade:** P2 | **Esforço:** G | **Risco:** MÉDIO-ALTO

> **Nota de processo:** esta é a 2ª versão desta story. A 1ª foi rejeitada pelo Junior por falta de
> detalhe técnico suficiente pra implementar sem retrabalho. Esta versão inclui investigação real
> contra o banco de produção (dados reais, não hipotéticos) e separa claramente o que está
> **confirmado por schema/código** do que **precisa da sua decisão** antes de codar.

---

## 1. Pedido original do Junior (texto literal, preservado)

> 1 - Lead escolhe ver vagas em aberto
> 2 - Automação busca no banco de dados as vagas em aberto e compila os cargos semelhantes e soma a
> quantidade e exibe:
>
> ```
> Olá {nome_lead} Segue as vagas abertas hoje — digite o número:
>
>     1 - Porteiro - 20 vagas
>     2 - Constureira - 06 vagas
>     3 - Auxiliar de Servilos gerais - 20 vagas
>     4 - CONSULTORA DE VENDAS - ATACADO - Maraponga Mart Moda - 01 vaga
>
> Digite o *número da vaga* para se candidatar.
> ```
>
> 3 - Lead digita o número, pegando o exemplo acima, digitou a opção "1" e "4":
>
> ```
> **Porteiro**
>
> 1 - 10 Vagas - Empresa singular - Processo seletivo Cuca: Toda a Rede
> 2 - 05 Vagas - Empresa Singular - Processo seletivo Cuca: Toda a Rede
> 3 - 05 vagas - Empresa singular - Processo seletivo Cuca: Toda a Rede
>
> escolha uma ou mais vagas, caso queira mais de uma separe com vírgula(1,3)
>
> **CONSULTORA DE VENDAS - ATACADO - Maraponga Mart Moda**
>
> 1 - 01 vaga - Empresa 47.308.179 NAYANA PACIFICO JUCA NOBRE - Vaga individual
>
> escolha uma ou mais vagas, caso queira mais de uma separe com vírgula(1,3)
> ```
>
> 4 - Após a escolha, segue o fluxo normal

## 2. O que o código confirma HOJE (schema real, produção)

Investiguei o schema da tabela `vagas` e os dados reais abertos em produção pra entender exatamente
que informação existe pra alimentar essa tela nova. **Achado importante: hoje, 100% das vagas abertas
em produção são do tipo `selecao_evento`** (as criadas pelo modal "Novo Processo Seletivo" que
ajustamos ontem) — não existe nenhuma `vaga_normal` aberta agora. Isso muda a leitura do próprio
exemplo do Junior — ver seção 4.

### 2.1 Dois tipos de vaga, duas formas diferentes de guardar cargo

| Campo | `tipo = "vaga_normal"` | `tipo = "selecao_evento"` |
|---|---|---|
| Cargo/título | `titulo` (1 string, 1 cargo por vaga) | `cargos_lista` (jsonb, **array** de `{titulo, quantidade, faixa_etaria}` — vários cargos numa seleção só) |
| Quantidade | `total_vagas` (int) | soma de `quantidade` de cada item em `cargos_lista` |
| Empresa | `empresa_id` → join `empresas.nome` | idem |
| Alcance/visibilidade | `unidade_destino` (`'global'` ou UUID de `unidades_cuca`) | **sempre `'global'`** (hardcoded na criação, `cuca-portal/src/app/api/empregabilidade/selecao/route.ts:77`) — nunca varia hoje |

Ou seja: pra montar a lista consolidada por cargo, é preciso **"explodir"** cada `selecao_evento` nos
seus N cargos individuais (1 linha por item de `cargos_lista`), e tratar cada `vaga_normal` como 1
cargo só — depois agrupar tudo junto por nome de cargo normalizado.

### 2.2 Dado real de produção (4 seleções abertas hoje, verbatim do banco)

```json
[
  {"numero_vaga": 17, "empresa": "SINGULAR FACILITIES SERVICE S.A.", "unidade_cuca": "CUCA Jangurussu", "cargos": [
    {"titulo": "Auxiliar de Serviços Gerais", "quantidade": 50},
    {"titulo": "Porteiro", "quantidade": 30},
    {"titulo": "Auxiliar de Manutenção", "quantidade": 20},
    {"titulo": "Auxiliar de Cozinha", "quantidade": 20}
  ]},
  {"numero_vaga": 20, "empresa": "SINGULAR FACILITIES SERVICE S.A.", "unidade_cuca": "<uuid>", "cargos": [
    {"titulo": "Auxiliar de serviços gerais", "quantidade": 50},
    {"titulo": "Auxiliar de menutenção", "quantidade": 20},
    {"titulo": "Porteiro", "quantidade": 20},
    {"titulo": "Jardineiro", "quantidade": 20}
  ]},
  {"numero_vaga": 21, "empresa": "SINGULAR FACILITIES SERVICE S.A.", "unidade_cuca": "CUCA Pici", "cargos": [
    {"titulo": "Auxiliar de serviços gerais", "quantidade": 50},
    {"titulo": "porteiro", "quantidade": 20},
    {"titulo": "jardineiro", "quantidade": 20},
    {"titulo": "auxiliar de manutenção", "quantidade": 20}
  ]},
  {"numero_vaga": 38, "empresa": "LABISE SERVIÇOS LTDA", "unidade_cuca": "<uuid>", "cargos": [
    {"titulo": "COSTUREIRA  OPERADORA OVERLOCK E GOLERA", "quantidade": "6"}
  ]}
]
```

**Isso bate exatamente com o exemplo do Junior** — "Porteiro" aparece 3x (30+20+20=70 vagas, 3
seleções diferentes, mesma empresa "SINGULAR"), assim como o cenário "Porteiro — 1 - 10 Vagas -
Empresa singular - Processo seletivo... / 2 - 05 Vagas.../ 3 - 05 vagas..." do pedido dele. Confirma
que o exemplo dele **é** baseado no dado real (mesma empresa aparecendo 3x pro mesmo cargo).

### 2.3 ⚠️ Achado crítico — normalização de nome de cargo não é trivial (evidência real)

Olhando o dado real acima, o mesmo cargo aparece escrito de formas diferentes:

- **Variação só de maiúscula/minúscula** (fácil de unificar): `"Porteiro"` / `"porteiro"` ·
  `"Auxiliar de Serviços Gerais"` / `"Auxiliar de serviços gerais"` · `"Jardineiro"` / `"jardineiro"`.
- **Erro de digitação real, já em produção** (⚠️ **não** unifica só com case-insensitive):
  `"Auxiliar de Manutenção"` (vaga #17) vs `"auxiliar de manutenção"` (vaga #21, mesma grafia, unifica
  ok) vs **`"Auxiliar de menutenção"`** (vaga #20 — erro de digitação real, "menutenção" em vez de
  "manutenção"). Com normalização simples (minúsculo + trim de espaços), essa 3ª entrada **fica de
  fora** do grupo "Auxiliar de Manutenção" e vira um 4º cargo separado na lista, com 20 vagas — errado
  aos olhos de quem está lendo, mas não é bug de código, é erro de digitação de quem cadastrou.

Isso não é hipotético — é o dado real de hoje. Preciso de uma decisón sua sobre como tratar isso (ver
pergunta 1, seção 8) antes de definir o algoritmo de agrupamento.

### 2.4 ⚠️ Achado — `unidade_cuca` tem formato inconsistente nos dados reais (CORRIGIDO — é o campo certo, ver seção 3)

No dado acima, `unidade_cuca` aparece ora como texto literal (`"CUCA Jangurussu"`, `"CUCA Pici"`), ora
como UUID (referência à tabela `unidades_cuca`). Isso é dado legado inconsistente — não sei se vem de
uma migração antiga ou de um formulário anterior ao atual. **Correção da v0.2 desta story:** eu tinha
descartado `unidade_cuca` como fonte do rótulo, propondo `unidade_destino` no lugar — **o Junior
corrigiu isso (2026-08-18): `unidade_cuca` é sim o campo certo**, `unidade_destino` é outra coisa
(visibilidade pública, sempre `global` pra seleção, e não representa "pra qual unidade a empresa
marcou"). Ver seção 3 pra regra corrigida e a implicação técnica dessa inconsistência de formato.

## 3. O que ISSO significa pro rótulo "Processo seletivo Cuca: Toda a Rede" / "CUCA Pici"

**Corrigido pelo Junior (2026-08-18), resposta à pergunta 3 original:** o rótulo vem de `unidade_cuca`
(não de `unidade_destino`, que é sempre `global` pra seleção e não serve pra isso). Regra confirmada:

- Empresa marca "Toda a Rede" na criação → `unidade_cuca = null` no banco (confirmado no código do
  modal, `cuca-portal/src/components/empregabilidade/selecao-modal.tsx`: `unidadeCuca === "global" ?
  null : unidadeCuca`) → rótulo `"Processo seletivo Cuca: Toda a Rede"`.
- Empresa marca uma unidade específica → `unidade_cuca` = UUID daquela unidade → rótulo
  `"Processo seletivo Cuca: {nome da unidade}"` (ex.: "CUCA Pici").
- **Isso vale pra seleção mesmo** — o Junior confirmou explicitamente que não existe um padrão fixo de
  "toda seleção é sempre toda a rede": a empresa escolhe por seleção, então o rótulo tem que refletir
  o valor real de cada seleção, não assumir.

**Implicação técnica que muda a implementação (não é mais opcional, vira bloqueante):** como
`unidade_cuca` mistura UUID e texto literal nos dados reais (achado 2.4), resolver o nome exige uma
função que primeiro testa se o valor parece um UUID — se sim, busca `unidades_cuca.nome`; se não (já é
texto), usa direto. **Nota:** nenhuma das 4 seleções abertas hoje tem `unidade_cuca = null` — as 3 que
formam o grupo "Porteiro" no exemplo do Junior têm, na verdade, unidades específicas diferentes
(Jangurussu, Pici, e uma 3ª por UUID) — ou seja, no dado real de hoje, o rótulo de cada uma seria o
nome da unidade específica, não "Toda a Rede" como no texto ilustrativo original. Isso não é
contradição — é só a diferença entre o exemplo ilustrativo do Junior e o estado real do banco agora;
a regra em si está clara e confirmada.

**Regra final, pronta pra implementar:**
- `tipo = "selecao_evento"`, `unidade_cuca IS NULL` → `"Processo seletivo Cuca: Toda a Rede"`.
- `tipo = "selecao_evento"`, `unidade_cuca` preenchido → resolver nome (UUID ou texto literal, ver
  acima) → `"Processo seletivo Cuca: {nome}"`.
- `tipo = "vaga_normal"`, `unidade_destino = "global"` → `"Vaga individual"` (confirmado pelo exemplo
  original do Junior).
- `tipo = "vaga_normal"`, `unidade_destino` = unidade específica → **RESPONDIDA (2026-08-18):**
  `"Vaga individual — {nome da unidade}"`, ex.: `"Vaga individual — CUCA Pici"`. Mesma função de
  resolução de nome de unidade (UUID → `unidades_cuca.nome`) reaproveitada da seção acima.

## 4. Sobre o item 4 do exemplo do Junior ("CONSULTORA DE VENDAS...")

Esse exemplo usa uma `vaga_normal` — mas **hoje não existe nenhuma `vaga_normal` aberta em
produção** (seção 2, achado). Ou seja, o exemplo mistura os 2 tipos de vaga de propósito (pra mostrar
como cada um se comporta), mesmo sem ter uma `vaga_normal` real aberta agora pra testar ao vivo. Vou
tratar isso como confirmado — a feature deve cobrir os 2 tipos — mas o teste de aceite vai precisar de
uma `vaga_normal` de teste criada propositalmente (staging/dado de teste), já que não tem uma real
disponível agora.

## 5. Regras de exibição — o que está confirmado vs. o que falta decidir

### Confirmado (implementar sem perguntar de novo):
1. Nível 1 (lista de cargos): 1 linha por cargo normalizado, com soma de `quantidade`
   (`selecao_evento`) ou `total_vagas` (`vaga_normal`) de todas as ocorrências daquele cargo.
2. Nível 1 permite seleção múltipla por vírgula (ex.: `1,4`) — mesmo parser já usado em
   `listando_cargos_selecao` hoje (`worker/empregabilidade_engine.py`), reaproveitar, não recriar.
3. Ao escolher 1+ cargos no Nível 1, abre 1 bloco por cargo escolhido (Nível 2), cada bloco com
   cabeçalho = nome do cargo, listando cada ocorrência individual (1 linha por seleção/vaga que
   contém aquele cargo) com: quantidade, nome da empresa (`empresas.nome`), rótulo de tipo (seção 3).
4. Nível 2 também permite seleção múltipla por vírgula, independente por bloco.
5. **[Corrigido pela resposta do Junior à pergunta 2]** Após a escolha final, cada vaga escolhida
   segue **a rota completa e correta pro seu próprio tipo**, uma de cada vez, esperando a conclusão de
   uma antes de iniciar a próxima — **nunca reaproveitando nome/dados entre elas**, porque são rotas
   de candidatura diferentes por tipo: `selecao_evento` pede nome + telefone e confirma via mensagem
   de seleção; `vaga_normal` (fora do escopo de seleção) segue o fluxo de envio de currículo
   (link de candidatura). Ex. do próprio Junior: candidato escolhe Porteiro na empresa 1 (seleção) e
   Porteiro na empresa 3 (vaga individual) → primeiro passa pelo fluxo completo de seleção (nome,
   telefone, confirmação), só depois de concluído entra no fluxo de envio de currículo pra segunda.
   Precisa de uma fila/estado que lembre quais escolhas ainda faltam processar (não existe hoje — é
   mecanismo novo, ver impacto seção 6).
6. "Voltar" funciona em cada nível novo (integrar em `_ETAPA_ANTERIOR`).
7. Escape semântico (S-EMP-AUD-024) já nasce ligado nas etapas novas — não repetir o gap que a 024
   está corrigindo.

## 6. Impacto (por item, conforme análise obrigatória)

| Toca | Consome hoje | Impacto observável | De-risk |
|---|---|---|---|
| `_mostrar_categorias`/`_mostrar_vagas_da_categoria` (`empregabilidade_engine.py:751-800`) | Único ponto de entrada pra listar vagas hoje | Substituição completa da lógica de agrupamento (categoria/setor → cargo consolidado) | Manter a função `_buscar_vagas_abertas_e_candidaturas` (já filtra candidaturas já feitas) como base, só mudar o agrupamento |
| `mapa_categorias`/`mapa_vagas` (estrutura salva em `empreg_fluxo`) | `listou_categorias`, `listou_vagas`, `voltar` | Estrutura de dados no fluxo muda — precisa de campo novo tipo `mapa_cargos_consolidados` + `mapa_ocorrencias_por_cargo` | Escrever migração de leitura tolerante (se um fluxo antigo em andamento tiver a estrutura velha, não quebrar — improvável dado volume baixo de conversas ativas, mas checar) |
| Parser de seleção múltipla (`listando_cargos_selecao`, já existe) | Único consumidor hoje é a seleção de cargo dentro de 1 seleção específica | Reaproveitar pros 2 níveis novos — **não duplicar lógica de parsing de vírgula** | Extrair pra função utilitária compartilhada se ainda não for |
| Fluxo de candidatura múltipla em sequência | Hoje 1 candidatura por vez é o caminho comum | **Confirmado como mecanismo novo** (não existe fila hoje — busquei `historico_vagas_aplicadas` e correlatos, não achei nada equivalente): precisa de uma fila de "escolhas pendentes" no `empreg_fluxo`, processada 1 por vez, cada uma rodando sua rota completa (seleção ou vaga individual) do zero, sem atalho/reaproveitamento entre elas — confirmado pelo Junior (pergunta 2) | Novo campo no fluxo (ex.: `fila_candidaturas_pendentes: [{tipo, vaga_id ou cargo_titulo, empresa_id}]`), consumido 1 item por vez ao final de cada rota completa; reaproveitar `historico_vagas_aplicadas` só pra continuar marcando o que já foi concluído, como hoje |
| `unidades_cuca` (join) | Não usado hoje nesse fluxo | **Confirmado como necessário** (não é mais condicional) — a resolução de `unidade_cuca` (seção 2.4/3) precisa desse join sempre que o valor for um UUID | Implementar a função de resolução (detectar UUID vs texto literal) como utilitário único, reaproveitável nos 2 pontos que precisam dela (rótulo de seleção e, se a pergunta 4 confirmar, rótulo de vaga_normal também) |

## 7. Valor de negócio

Reduz fricção e abandono no fluxo mais usado do canal (ver vagas → candidatar). Fluxo atual mistura
"categoria de negócio" (setor) com listagem de seleção por empresa — não deixa claro pro candidato
"tem vaga pro que eu sei fazer" até abrir várias camadas.

## 8. Perguntas — preciso da sua decisão antes de implementar

1. ~~**Normalização de cargo com erro de digitação**~~ — **RESPONDIDA pelo Junior (2026-08-18):**
   normalização não pode depender de lista manual nem só de case-insensitive — a empresa vai continuar
   errando digitação sempre, a IA tem que interpretar/classificar comparando o resto da expressão
   ("manutenção" minúsculo/maiúsculo é o mesmo cargo, "aux." é o mesmo que "auxiliar", etc.). Ver
   seção 8.1 pro desenho técnico dessa decisão.
2. ~~**Ordem de exibição dos cargos no Nível 1**~~ — **RESPONDIDA (2026-08-18): ordem alfabética**
   (pelo nome canônico do cargo, após a normalização da pergunta 1). Nível 2 (empresas dentro de um
   cargo) não teve ordem definida explicitamente — vou assumir alfabético por nome de empresa também,
   por consistência, a menos que você diga outra coisa depois de ver o resultado.
3. ~~**Candidatura múltipla em sequência**~~ — **RESPONDIDA (2026-08-18): pergunta pra cada
   candidatura separadamente, rota completa por tipo, sem atalho.** Detalhe do Junior, preservado:
   *"escolho porteiro para a empresa 1 e 3 e a 1 é seleção, irei digitar meu nome e depois meu número,
   depois recebo a confirmação e mensagem [de] qual será a seleção e a do porteiro da empresa 3 é vaga
   individual, preciso passar pelo fluxo de envio de currículo, então são duas rotas completamente
   diferentes."* Já incorporado nas seções 3 (rótulo), 5 (regra confirmada #5, corrigida) e 6 (fila
   nova como item de impacto confirmado).
4. ~~**Rótulo pra `vaga_normal` com unidade específica**~~ — **RESPONDIDA (2026-08-18):** exatamente
   o formato sugerido — `"Vaga individual — CUCA Pici"` (ou o nome da unidade que for). Confirmado
   pelo Junior: *"Esse texto mesmo CUCA Pici (se for pra o Pici)"*. Regra final na seção 3.
5. ~~**Cargos sem vaga disponível pro candidato**~~ — **RESPONDIDA (2026-08-18).** Regra exata do
   Junior, preservada literal: *"Vaga para porteiro para 3 empresas, empresa 1 - 20 vagas, 2 - 30,
   3 - 40, ele se candidatou na empresa 2 e 3, elas somem para ele e mostra somente as empresa 1,
   quando ele se cadastrar para essa, também some porteiro para esse lead, a quantidade de vaga por
   cargo aparece para ele saber que tem 20 vagas e as chances dele são maiores do que uma empresa que
   oferta 10 no mesmo cargo."* Ou seja: exclusão é **por ocorrência/empresa dentro do cargo**, não do
   cargo inteiro — a quantidade total do cargo no Nível 1 é recalculada excluindo as ocorrências já
   candidatadas por aquele lead especificamente (a quantidade em si continua sendo mostrada como sinal
   de "chance" pro candidato, não só como contador abstrato). Quando **todas** as ocorrências de um
   cargo já foram candidatadas pelo lead, o cargo inteiro some do Nível 1 (consequência natural da
   regra — soma zero).

### 8.1 Desenho técnico da normalização semântica (decisão do Junior, seção 8 item 1)

O projeto já tem o padrão exato pra isso: `intencao_detector.py` (`avaliar_mensagem_contextual`,
`:116-186`) já chama a OpenAI (`AsyncOpenAI`, `chat.completions.create`) pra classificação semântica
em vários pontos do fluxo de Empregabilidade. Vou seguir o mesmo padrão em vez de inventar um
mecanismo novo:

1. **Pré-passo barato, sem IA** (roda sempre, sem custo/latência): normalizar caixa (minúsculo) +
   espaços duplicados + trim. Resolve os casos óbvios ("Porteiro"/"porteiro") sem gastar tokens.
2. **Passo com IA** (só quando sobrar ambiguidade após o passo 1): mandar pra 1 chamada de IA a lista
   de títulos de cargo únicos restantes (hoje, no máximo ~15-20 por consulta, dado o volume real de
   vagas abertas) e pedir de volta um agrupamento — quais títulos são o mesmo cargo (erro de digitação,
   abreviação — "aux." = "auxiliar" — sinônimo direto), com um nome canônico de exibição pra cada
   grupo. Mesmo formato de prompt estruturado (JSON de entrada/saída) já usado em
   `intencao_detector.py`.
3. **Cache por conteúdo:** a lista de vagas abertas muda pouco (só quando alguém cadastra/edita/fecha
   uma vaga) — cachear o resultado do agrupamento por um hash do conjunto de títulos de entrada, TTL
   curto (ex.: 60-120s, ajustável), pra não gastar 1 chamada de IA a cada "ver vagas abertas" de cada
   lead. Evita custo desnecessário sem trocar a qualidade do agrupamento.
4. **Fail-safe:** se a chamada de IA falhar (mesmo padrão de fallback seguro já usado em
   `avaliar_mensagem_contextual:175`), cai pro resultado do passo 1 (só normalização de caixa) — nunca
   trava a listagem de vagas por causa de uma falha de classificação.
5. **Risco a monitorar:** IA pode juntar cargos que **não** deveriam ser o mesmo (falso positivo —
   ex.: "Auxiliar de Cozinha" ≠ "Auxiliar de Manutenção", são cargos diferentes, só compartilham a
   palavra "Auxiliar"). O prompt precisa deixar isso explícito (só agrupar quando for claramente o
   mesmo cargo com erro de digitação/abreviação/case — nunca por similaridade genérica de palavra) e
   o test plan (seção 10) precisa cobrir esse caso de falso positivo com o dado real já visto
   (`Auxiliar de Serviços Gerais`, `Auxiliar de Manutenção`, `Auxiliar de Cozinha` — 3 cargos
   diferentes, mesma primeira palavra, não podem ser agrupados entre si).

## 9. Escopo

**In:** agrupamento por cargo (`vaga_normal` + `selecao_evento`), seleção múltipla em 2 níveis,
reaproveitamento do parser de vírgula existente, normalização semântica via IA (seção 8.1).
**Out:** mudar como vagas são cadastradas/criadas.

## 10. Test plan (a expandir após respostas da seção 8)

- Cenário real de produção (dado da seção 2.2) usado como fixture de teste — "Porteiro" deve somar
  70 vagas (30+20+20) de 3 seleções da mesma empresa.
- Cargo com variação de maiúscula/minúscula unifica corretamente (pré-passo sem IA).
- Cargo com erro de digitação real (`Auxiliar de menutenção`) unifica com `Auxiliar de Manutenção`
  via passo de IA.
- Abreviação (`Aux. de Cozinha` ou similar) unifica com `Auxiliar de Cozinha` via passo de IA.
- **Falso positivo (crítico):** `Auxiliar de Serviços Gerais`, `Auxiliar de Manutenção` e
  `Auxiliar de Cozinha` (dado real de produção) **não podem** ser agrupados entre si — são cargos
  diferentes que só compartilham a palavra "Auxiliar".
- Cache por conteúdo funciona — 2 consultas seguidas com o mesmo conjunto de vagas abertas não geram
  2 chamadas de IA.
- Falha simulada da chamada de IA → cai pro pré-passo (case-insensitive), não trava a listagem.
- `vaga_normal` (fixture de teste, já que não existe uma real aberta) aparece com título completo
  quando é a única ocorrência daquele cargo.
- Seleção múltipla em ambos os níveis (`1,3` e variações com espaço).
- Seleção inválida (número fora do range) em cada nível.
- Voltar em cada nível.
- Escape semântico disparando corretamente na etapa nova (depende de S-EMP-AUD-024).

## Change Log

- v0.1 (2026-08-18): Story criada por @sm — versão inicial, insuficientemente detalhada.
- v0.2 (2026-08-18): Reescrita por @sm + @dev a pedido do Junior — investigação real contra schema e
  dados de produção (tabela `vagas`, `cargos_lista`, `empresas`, `unidades_cuca`); achados de
  normalização de cargo e inconsistência de `unidade_cuca` documentados com evidência real; 5
  perguntas de decisão levantadas em vez de assumidas.
- v0.3 (2026-08-18): Pergunta 1 (normalização) respondida pelo Junior — precisa ser IA/semântica, não
  lista manual nem só case-insensitive (empresa vai continuar errando digitação, não dá pra exigir
  correção). Desenho técnico adicionado (seção 8.1): pré-passo barato sem IA + passo de IA reusando o
  padrão já existente em `intencao_detector.py` + cache por conteúdo + fail-safe + risco de falso
  positivo (cargos diferentes com palavra em comum) documentado e coberto no test plan. Restam 4
  perguntas abertas (seção 8, itens 2-5).
- v0.4 (2026-08-18): Perguntas 2, 3 (renumerada 5) e 5 (renumerada 4) respondidas pelo Junior — (a)
  ordem alfabética no Nível 1; (b) candidatura múltipla pergunta pra cada uma separadamente, rota
  completa por tipo sem atalho, motivado pelo fato de seleção e vaga individual serem rotas de
  candidatura tecnicamente diferentes — implica numa fila nova no `empreg_fluxo`, mecanismo que não
  existia antes; (c) exclusão de cargo é por ocorrência/empresa, não por cargo inteiro — quantidade
  recalculada excluindo o que o lead já aplicou, mantendo a quantidade visível como sinal de "chance".
  **Correção importante nesta rodada:** o rótulo "Toda a Rede"/"CUCA Pici" pra seleção vem de
  `unidade_cuca`, não de `unidade_destino` como a v0.2 tinha proposto — o Junior corrigiu
  explicitamente que a empresa escolhe a unidade por seleção, não existe um padrão fixo de "toda
  seleção é toda a rede" (seção 3 reescrita). Restava 1 pergunta aberta.
- v0.5 (2026-08-18): Última pergunta respondida pelo Junior — rótulo de `vaga_normal` restrita a
  unidade específica: `"Vaga individual — {nome da unidade}"` (ex.: "Vaga individual — CUCA Pici"),
  mesmo formato sugerido, confirmado sem alteração. Todas as 5 perguntas respondidas.
- v0.6 (2026-08-18): @po validou — **GO (10/10)**. Achado técnico (`unidade_cuca` vs `unidade_destino`,
  seção 2.4/3) documentado com correção explícita registrada, não escondida — mostra o processo de
  decisão real, não só o resultado. Risco MÉDIO-ALTO é esperado pro escopo (reescrita de fluxo + fila
  de candidatura múltipla nova + normalização via IA) e está coberto por de-risk item a item (seção 6)
  e test plan cobrindo o caso de falso positivo mais perigoso (cargos com palavra em comum). Única
  observação não-bloqueante: seção 5 funciona como Acceptance Criteria mas não tem esse título
  explícito — @dev pode tratar a seção 5 ("Regras de exibição confirmadas") como os ACs reais da
  story. Dependência com S-EMP-AUD-024 (escape semântico nas etapas novas) documentada e deve ser
  sequenciada antes ou junto. Status Draft → Ready.
