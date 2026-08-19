# S-EMP-AUD-023 — Vaga Direta: consolida listagem de vagas por cargo com seleção múltipla

**Status:** InProgress (passo 4/4 implementado — ver nota sobre "5 passos" no Dev Agent Record, HALT pro Junior)
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

## Dev Agent Record

### Correção técnica encontrada antes de codar (bloqueante, resolvida)

A seção 6 (impacto) cita `_buscar_vagas_abertas_e_candidaturas` como base a manter — confirmado que a
função existe, mas seu `select` hoje busca só
`id, titulo, tipo_contrato, salario, escolaridade_minima, total_vagas, faixa_etaria, setor,
unidade_destino` — **não busca `tipo`, `cargos_lista`, `empresa_id`, `unidade_cuca`**, campos que o
motor de agrupamento por cargo precisa. Isso não é uma decisão de negócio (não voltou pro Junior) — é
correção de fato de schema. O passo 1 abaixo widen essa busca (dado consumido separadamente pelo motor
novo, sem remover os campos já usados pela listagem antiga, que continua funcionando até o passo de
integração — ver nota de escopo abaixo).

### Nota de escopo — story grande demais pra 1 commit só (Esforço G, Risco MÉDIO-ALTO)

Dividida em 5 passos, cada um com commit e revisão próprios (ordem definida com o Advisor, dado o
tamanho e risco da story):

1. **[ENTREGUE NESTE COMMIT]** Motor de agrupamento por cargo (explode `vaga_normal`/`selecao_evento`,
   soma quantidade, resolve rótulo de unidade/tipo, exclusão por ocorrência, ordena alfabético). Só o
   motor de dados — **ainda não plugado no fluxo de conversa ao vivo**, nenhuma etapa chama essas
   funções ainda. Comportamento do candidato **não muda** com este commit.
2. Listagem de Nível 1 e Nível 2 com seleção múltipla, integrando o motor no fluxo real (substitui
   `_mostrar_categorias`) — aqui sim muda o comportamento observável, revisão própria.
3. `fila_candidaturas_pendentes` — mecanismo novo de fila sequencial por tipo de rota (maior risco da
   story, commit e teste próprios).
4. Normalização de cargo via IA (seção 8.1, passo 2) — por último, propositalmente: os passos 1-3
   funcionam corretamente só com o pré-passo barato (maiúscula/minúscula); se a camada de IA se
   provar instável, a feature já é entregável sem ela.

### File List (passo 1)

- `worker/empregabilidade_engine.py`: `_normalizar_cargo_basico`, `_resolver_nome_unidade_cuca`,
  `_gerar_rotulo_tipo_vaga`, `_construir_cargos_consolidados` — funções novas, não chamadas por
  nenhuma etapa ainda.
- `worker/tests/test_empregabilidade_engine.py`: `TestS_EMP_AUD_023CargosConsolidados`, 13 testes —
  fixture verbatim da seção 2.2 (dado real de produção, Porteiro soma 70 de 3 seleções), teste crítico
  do falso positivo (Auxiliar de Serviços Gerais/Manutenção/Cozinha não se misturam), as 4 regras de
  rótulo da seção 3, exclusão por ocorrência (pergunta 5), fail-safe de UUID desconhecido.

### Completion Notes (passo 1)

- Suíte completa: 125 passed (112 pré-existentes + 13 novos), 0 falhas.
- Normalização nesta etapa é só o pré-passo sem IA (seção 8.1, passo 1) — confirmado por teste que
  erro de digitação real (`menutenção`) **não** unifica ainda (esperado, é o passo 4).
- Não houve mudança de comportamento observável pro candidato neste commit — seguro pra revisar e
  mergear isoladamente antes do passo 2.

### Decisão registrada nesta sessão — numeração do Nível 2 (passo 2)

O exemplo literal do Junior (seção 1) mostra cada bloco de cargo reiniciando a numeração em 1. Isso é
ambíguo pra responder por texto: com 2+ blocos abertos na mesma mensagem, um "1" digitado pelo lead não
diz a qual bloco pertence. Perguntado diretamente, o Junior escolheu **numeração única e contínua**
entre todos os blocos escolhidos (bloco 1 termina em N, bloco 2 continua em N+1, sem reiniciar) — o
cabeçalho de cada bloco (nome do cargo) continua sendo o separador visual, só a numeração muda do
exemplo original. Registrado aqui porque já houve atrito nesta story por decisão não documentada
explicitamente.

### File List (passo 2)

- `worker/empregabilidade_engine.py`:
  - `_buscar_vagas_abertas_e_candidaturas` (dentro de `_processar_publico`): select ampliado com
    `tipo, cargos_lista, empresa_id, unidade_cuca` (ordem dos campos deliberada — evita colisão de
    substring com outra query já existente, ver comentário no código); busca em lote de
    `empresas_por_id`/`unidades_por_id`; `unidades_cuca` resolvida **sem** filtro `ativo` (é resolução
    de nome, não oferta de escolha).
  - `_mostrar_cargos_consolidados`, `_construir_mapa_ocorrencias`, `_mostrar_ocorrencias_cargo` —
    funções novas de exibição (Nível 1 e Nível 2).
  - `_confirmar_cargos_selecao_evento` — extraída de `listando_cargos_selecao` (SQS-49) pra ser
    compartilhada com a etapa nova `listou_ocorrencias_cargo`, sem mudar o comportamento do call site
    original.
  - Etapas novas: `listou_cargos_consolidados` (Nível 1) e `listou_ocorrencias_cargo` (Nível 2),
    registradas em `_ETAPA_ANTERIOR`, `_ETAPAS_OFERTA_ATENDENTE`, `_ETAPAS_PUBLICO` e no guard do "4
    puro" — escape semântico (S-EMP-AUD-024) ligado desde o nascimento das duas (regra 7).
  - `_voltar_etapa_publico`: novo branch pra voltar de `listou_ocorrencias_cargo` a
    `listou_cargos_consolidados`.
  - Ponto de entrada (antigo bloco "SQS-41 Ação 2.1: Menu dinâmico agrupado por categoria")
    substituído pelo motor de cargo consolidado — usa a lista **não filtrada** (`vagas_raw`) em vez da
    filtrada por vaga inteira (`vagas`), porque a exclusão por ocorrência do motor é mais correta (ver
    Correção de escopo abaixo).
  - `_mostrar_categorias`/`_mostrar_vagas_da_categoria` e as etapas antigas (`listou_categorias`,
    `listou_vagas`) **mantidas** — servem só a conversas legadas já em andamento com `mapa_categorias`
    salvo no fluxo; nenhuma conversa nova entra mais nelas.
- `worker/tests/test_empregabilidade_engine.py`: `TestS_EMP_AUD_023Passo2FluxoReal`, 11 testes —
  entrada fresca mostra Nível 1 (não categoria), escolha única abre Nível 2, escolha múltipla no Nível
  1 numera ocorrências de forma contínua entre blocos, Nível 2 roteia corretamente pros 4 casos
  (seleção com/sem coleta de currículo, vaga individual global/específica), escolha múltipla no Nível 2
  roteia só a 1ª e avisa, "voltar" nos 2 níveis novos, e o teste de correção da exclusão por ocorrência
  (abaixo). Também ajustado 1 teste pré-existente
  (`test_quero_ver_outras_vagas_reabre_listagem_sem_llm`) cuja asserção esperava a etapa antiga
  (`listou_categorias`) — comportamento mudou de propósito neste commit, teste atualizado pra refletir
  a etapa nova (`listou_cargos_consolidados`). Fake de teste (`_SupabaseFakeBloco6`) ganhou suporte a
  `coleta_curriculo_por_vaga` e tabela `empresas`.

### Correção de escopo encontrada durante a implementação (passo 2)

O filtro antigo (`ids_excluir`, por vaga inteira) escondia a vaga **inteira** de uma `selecao_evento`
assim que qualquer 1 dos seus cargos entrava no histórico de sessão — isso violava a pergunta 5
(exclusão deveria ser por ocorrência/cargo, não pela vaga toda). O motor novo evita isso usando a lista
não filtrada (`vagas_raw`) e fazendo sua própria exclusão por ocorrência (já implementada no passo 1).
Coberto pelo teste `test_exclusao_por_ocorrencia_nao_esconde_outros_cargos_da_mesma_selecao`. O filtro
antigo continua existindo, mas agora só é consumido pelas etapas legadas mantidas vivas (acima).

### Completion Notes (passo 2)

- Regra 5 (seção 5) entregue **PARCIALMENTE** — a rota completa por tipo (seleção vs. vaga individual)
  já funciona corretamente para 1 ocorrência escolhida. Quando o lead escolhe mais de uma ocorrência no
  Nível 2, só a **primeira** é roteada agora; ele é avisado e escolhe a próxima manualmente depois de
  concluir. A fila que encadearia isso automaticamente (`fila_candidaturas_pendentes`) é o passo 3,
  ainda não implementado — decisão de escopo, não bug.
- Regras 1, 2, 3, 4 (parse), 6 e 7 da seção 5: entregues.
- Suíte completa do arquivo: 136 passed (125 pré-existentes + 11 novos), 0 falhas. Suíte completa do
  worker (exceto `test_main_retomar_disparo.py`, que já falha na coleta sem o pacote `openai`
  instalado neste ambiente — pré-existente, não relacionado): 314 passed, 5 falhas em
  `test_meta_adapter_outbound.py` — confirmadas pré-existentes (mesmas falhas com `git stash`, antes
  desta mudança).

### Fechamento do achado do @qa — teste de escape semântico (regra 7 / test plan seção 10)

@qa (CONCERNS) apontou que o item do test plan "escape semântico disparando corretamente na etapa
nova" não tinha teste dedicado — a chamada existia no código, mas nada provava que
`_escape_semantico_ou_none` era de fato invocado e honrado nas 2 etapas novas. Fechado com 2 testes
novos (`test_escape_semantico_dispara_em_listou_cargos_consolidados`,
`test_escape_semantico_dispara_em_listou_ocorrencias_cargo`) — entrada não numérica força o parser
determinístico a falhar, cai no classificador semântico mockado com `quer_sair=True`, e o teste
confirma que o fluxo foi de fato encerrado (`estado == {}`) — isso só acontece se o classificador foi
chamado e seu retorno foi honrado, não só se o parser de número falhou. Suíte completa: 138 passed
(136 + 2 novos).

### File List (passo 3)

- `worker/empregabilidade_engine.py`:
  - `_confirmar_cargos_selecao_evento` — ganhou parâmetro opcional `fila_candidaturas_pendentes`
    (default `None`, não muda o call site original em `listando_cargos_selecao`), persistido no fluxo
    resultante quando presente.
  - `_enviar_link_candidatura` — passa adiante `fila_candidaturas_pendentes` do fluxo recebido pro
    fluxo resultante, só quando o chamador explicitamente a incluiu (callers antigos nunca tinham essa
    chave, então não ganham ruído novo no estado).
  - `_rotear_ocorrencia_escolhida` — função nova, extraída do que antes era o corpo inline de
    `listou_ocorrencias_cargo`: roteia 1 ocorrência (seleção ou vaga individual) pra sua rota completa,
    recebendo `fila_restante` (persistida) e `usar_prefill` (só True pra 1ª ocorrência escolhida no
    Nível 2 — itens dequeueados da fila são sempre `usar_prefill=False`, nunca reaproveitam nome,
    conforme regra 5 literal). Corrigido um vazamento de prefill que só aparecia com fila: o branch
    "vaga é global" perguntava a unidade sem checar `usar_prefill`, e a etapa
    `aguardando_escolha_unidade` (existente, genérica) reaproveitaria `nome_candidato_prefill` de uma
    candidatura anterior por padrão — agora esse campo é explicitamente limpo quando `usar_prefill=False`.
  - `listou_ocorrencias_cargo` (etapa) — refatorada pra chamar `_rotear_ocorrencia_escolhida` em vez de
    duplicar a lógica de roteamento; monta `fila_restante` a partir das ocorrências escolhidas além da
    1ª; copy da mensagem de aviso atualizada (antes dizia pra escolher a próxima manualmente, agora diz
    que a fila continua sozinha).
  - `aguardando_confirmacao_candidatura` (etapa, branch de sucesso não-banco-de-talentos) — antes de
    oferecer "outra/encerrar", checa `fila_candidaturas_pendentes`; se não vazia, encadeia a próxima
    ocorrência via `_rotear_ocorrencia_escolhida` (usar_prefill=False) em vez de perguntar.
  - `confirmando_presenca_telefone` (etapa, SQS-56 sem coleta de currículo) — mesmo encadeamento, no
    ponto de conclusão da rota de seleção sem currículo.
- `worker/tests/test_empregabilidade_engine.py`: `TestS_EMP_AUD_023Passo3FilaCandidaturas`, 5 testes —
  escolha múltipla no Nível 2 popula a fila com o restante; conclusão de candidatura por link encadeia
  a próxima automaticamente (e salva histórico antes); a fila nunca reaproveita nome entre candidaturas
  diferentes (mesmo com prefill disponível); conclusão da rota de seleção sem currículo encadeia a
  próxima; sem fila, o comportamento antigo de "outra/encerrar" continua intacto (regressão). Fake de
  teste (`_SupabaseFakeBloco6`/`_TabelaFake`) ganhou suporte a `insert()` e `.is_()`.

### Completion Notes (passo 3)

- Regra 5 (seção 5) agora **entregue por completo**: candidatura múltipla em sequência, rota completa
  por tipo, sem atalho, sem reaproveitar nome/dados entre candidaturas diferentes — automática, sem o
  lead precisar escolher a próxima manualmente.
- Achado corrigido durante a implementação (não estava no plano original, achado ao rastrear o dado até
  o consumidor real): o branch de vaga global dentro do roteamento de ocorrência não sabia distinguir
  "1ª ocorrência do Nível 2" de "item da fila" — a etapa `aguardando_escolha_unidade` (compartilhada,
  pré-existente) reaproveitaria `nome_candidato_prefill` por padrão depois de escolhida a unidade,
  quebrando a regra 5 pro caso específico "vaga individual global, vinda da fila". Corrigido limpando o
  prefill nesse caminho quando `usar_prefill=False`.
  ~~Coberto por `test_fila_nunca_reaproveita_nome_entre_candidaturas_diferentes`.~~ **Impreciso — ver
  fechamento do achado do @qa abaixo:** esse teste cobre só o branch de unidade específica, não o de
  vaga global — o branch global ficou sem teste até a revisão seguinte.
- Suíte completa do arquivo: 143 passed (138 pré-existentes + 5 novos), 0 falhas. Suíte completa do
  worker (exceto `test_main_retomar_disparo.py`, pré-existente/não relacionado): 321 passed, mesmas 5
  falhas pré-existentes em `test_meta_adapter_outbound.py`.
- Escopo da story (seção 9) permanece respeitado: não mudou como vagas são cadastradas/criadas.

### Fechamento do achado do @qa — cobertura do branch "vaga global vinda da fila"

@qa (CONCERNS) verificou empiricamente — desligando a linha da correção na mão e rodando a suíte
inteira — que a suíte continuava 100% verde sem ela. Ou seja, a correção do prefill pro branch de vaga
**global** (distinto do branch de unidade específica, já coberto) não tinha nenhum teste garantindo que
continuaria lá. Fechado com `test_fila_com_vaga_global_tambem_nao_reaproveita_nome`: fila com uma
ocorrência `vaga_normal` de unidade `"global"`, fluxo com `nome_candidato_prefill` de uma candidatura
anterior — confirma que a etapa `aguardando_escolha_unidade` resultante tem o prefill limpo
(`""`). Repeti a mesma verificação empírica do @qa (desliguei a correção, o novo teste falhou
exatamente como esperado; religuei, voltou a passar) antes de considerar fechado. Suíte completa: 144
passed (143 + 1 novo).

### File List (passo 4)

- `worker/empregabilidade_engine.py`:
  - `import json` adicionado (parse da resposta da IA — mesmo padrão de `intencao_detector.py`).
  - `_chave_cache_normalizacao_cargos`, `_chamar_ia_normalizacao_cargos`, `_normalizar_cargos_via_ia` —
    funções novas (seção 8.1): pré-passo barato já existia (passo 1); estas cobrem o passo com IA, cache
    por conteúdo (TTL 90s) e fail-safe. `_chamar_ia_normalizacao_cargos` isolada em função própria pra
    mock direto nos testes, mesmo padrão de `_chamar_gpt_contextual` em `intencao_detector.py`.
  - `_construir_cargos_consolidados` (passo 1, frozen) — ganhou parâmetro opcional
    `mapa_normalizacao_ia` (default `None`, preserva o comportamento exato do passo 1 — os 13 testes
    originais continuam passando sem alteração). Quando presente, usa o nome canônico (re-normalizado)
    como chave de agrupamento em vez da chave básica sozinha.
  - Ponto de entrada ("ver vagas"): monta `mapa_cargos_sem_ia` primeiro (pré-passo puro), extrai os
    títulos únicos restantes, chama `_normalizar_cargos_via_ia`, e só reconstrói com
    `mapa_normalizacao_ia` quando a IA de fato retornou algum grupo (evita reconstrução redundante no
    caso comum de mapa vazio — fail-safe ou nada pra fundir).
- `worker/tests/test_empregabilidade_engine.py`: `TestS_EMP_AUD_023Passo4NormalizacaoIA`, 10 testes —
  guard de menos de 2 títulos (não chama IA), aplica grupo retornado, fail-safe contra alucinação
  (membro fora da lista original é descartado), ignora grupo com 1 membro só, fail-safe quando a IA
  lança exceção, cache evita 2ª chamada pro mesmo conjunto (ordem diferente), fusão real do erro de
  digitação de produção (`Auxiliar de menutenção` + `Auxiliar de Manutenção` = 60), **teste crítico do
  falso positivo** (seção 10 do test plan: `Auxiliar de Serviços Gerais`/`Auxiliar de Cozinha`/`Auxiliar
  de Manutenção` continuam 3 grupos separados mesmo com o mapa da IA presente), mapa ausente preserva
  comportamento do passo 1, e 1 teste fim a fim (`_processar_publico` chama a IA de verdade e usa o
  resultado na listagem mostrada ao lead).

### Completion Notes (passo 4)

- Seção 8.1 (todos os 4 passos do desenho técnico) entregue: pré-passo barato (já existia, passo 1) +
  passo com IA + cache por conteúdo (item 3) + fail-safe (item 4). Risco a monitorar (item 5, falso
  positivo) coberto por teste dedicado com o dado real de produção mais perigoso (3 cargos "Auxiliar de
  ...", só 1 par deveria fundir).
- Cache implementado como dict em memória de processo (não distribuído) — TTL 90s conforme sugerido na
  seção 8.1 (60-120s, ajustável). Nota de escala: como é em memória por processo, múltiplos workers em
  paralelo não compartilham cache entre si (cada um cacheia separado) — não é um problema de
  corretude (resultado é sempre recomputável, só reduz o quanto a economia de chamadas de IA se
  acumula entre processos); registrado aqui como nota, não como bloqueio, dado o volume baixo de vagas
  abertas hoje (seção 2).
- Suíte completa do arquivo: 154 passed (144 pré-existentes + 10 novos), 0 falhas. Suíte completa do
  worker (exceto `test_main_retomar_disparo.py`, pré-existente/não relacionado): 332 passed, mesmas 5
  falhas pré-existentes em `test_meta_adapter_outbound.py`.
- Escopo da story (seção 9) permanece respeitado.

### Fechamento do achado do @qa — conteúdo do `canonico` sem validação (CONCERNS → PASS)

O @qa revisou o passo 4 (commit `fbcca75`) e deu **CONCERNS**: o `canonico` retornado pela IA é
exibido direto pro candidato sem nenhuma validação de conteúdo — só os `membros` eram conferidos
contra a lista original enviada. Como o título de cargo vem de dado de empresa (não confiável),
isso abria uma superfície nova (texto sintetizado pela IA sem checagem), mesmo não sendo regressão
(o texto cru da empresa já era exibido sem validação antes).

Corrigido: `_normalizar_cargos_via_ia` (`worker/empregabilidade_engine.py`) ganhou um fail-safe de
conteúdo — `canonico` só é aceito se (a) tiver até 80 caracteres e (b) compartilhar pelo menos uma
palavra real (4+ letras) com um dos títulos originais válidos do próprio grupo. Grupo que falha
nessa checagem é descartado inteiro (cai pro pré-passo sem IA pros títulos envolvidos, nunca trava
a listagem). Teste novo
(`test_ignora_canonico_sem_relacao_com_titulos_originais`) verificado empiricamente: desabilitando
o guard, só esse teste falha (10 passaram, 1 falhou); religado, 155 passed. Suíte completa do
worker: 333 passed, mesmas 5 falhas pré-existentes em `test_meta_adapter_outbound.py` (não
relacionadas).

### ⚠️ Inconsistência encontrada — a "Nota de escopo" diz "5 passos" mas só lista 4

A seção "Nota de escopo" (linha 322, escrita no passo 1, antes desta sessão) diz literalmente "Dividida
em 5 passos" mas enumera só 4 itens (1: motor de dados: 2: Nível 1/2 + fluxo real; 3: fila; 4:
normalização via IA). Os 4 itens listados estão **todos implementados** agora (este commit fecha o
item 4). Não inventei um "passo 5" pra completar o número 5 citado no texto — isso seria inventar
escopo sem pedido real (Artigo IV da Constitution, "No Invention"), o oposto do que essa story já
corrigiu uma vez (a 1ª versão foi rejeitada por falta de detalhe, não por excesso). Levanto isso
explicitamente pro Junior decidir: (a) era só um erro de contagem no texto original e a story está
funcionalmente completa com os 4 passos, ou (b) havia um 5º passo em mente que não ficou registrado e
precisa ser descrito. Não presumo nenhuma das duas — HALT aqui.

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
- v0.7 (2026-08-18): @dev implementou o **passo 1/5** — motor de agrupamento por cargo, isolado, ainda
  não plugado no fluxo real (zero mudança de comportamento observável). Achado de schema corrigido
  (seção 6 citava `_buscar_vagas_abertas_e_candidaturas` sem os campos que o motor precisa — corrigido
  no código, não é decisão de negócio). 13 testes novos com o fixture real de produção da seção 2.2,
  incluindo o teste crítico de falso positivo do test plan. Suíte completa: 125 passed. Status
  Ready → InProgress. Story dividida em 5 passos com commit/revisão próprios dado o tamanho — próximo
  passo (listagem Nível 1/2 + integração real) só começa após revisão deste.
- v0.8 (2026-08-19): @dev implementou o **passo 2/5** — Nível 1 e Nível 2 plugados no fluxo real,
  substituindo o menu por categoria/setor. Decisão de numeração do Nível 2 (contínua entre blocos, não
  reinicia por cargo) registrada explicitamente com o Junior antes de codar. Regra 5 (fila de
  candidatura múltipla) entregue parcialmente — só a 1ª ocorrência escolhida é roteada; a fila
  (passo 3) ainda não existe. Correção de escopo encontrada e resolvida: o filtro antigo escondia a
  seleção inteira por causa de 1 cargo já candidatado — o motor novo corrige isso usando exclusão por
  ocorrência (pergunta 5). 11 testes novos, suíte completa: 136 passed. Status mantido InProgress —
  próximo passo (fila sequencial) só começa após revisão deste.
- v0.9 (2026-08-19): @qa revisou o passo 2 — veredito **CONCERNS** (nada crítico, sem regressão; único
  ponto real: teste do item de test plan "escape semântico na etapa nova" faltando). @dev fechou o
  achado com 2 testes dedicados provando que `_escape_semantico_ou_none` dispara e é honrado nas 2
  etapas novas. Suíte completa: 138 passed.
- v0.10 (2026-08-19): PR #105 (passo 2) mergeado em `main` pelo @devops, com aprovação do Junior.
  @dev implementou o **passo 3/5** — `fila_candidaturas_pendentes`: candidatura múltipla em sequência
  agora encadeia automaticamente (regra 5 da seção 5, entregue por completo). Achado corrigido durante
  a implementação: vazamento de prefill de nome no caminho "vaga individual global vinda da fila" (a
  etapa compartilhada `aguardando_escolha_unidade` reaproveitaria nome de candidatura anterior por
  padrão) — corrigido, limpando o prefill explicitamente quando o item vem da fila. 5 testes novos,
  suíte completa: 143 passed. Status mantido InProgress — próximo passo (normalização de cargo via IA)
  só começa após revisão deste.
- v0.11 (2026-08-19): @qa revisou o passo 3 — veredito **CONCERNS**, achado verificado empiricamente
  (desligou o código da correção do prefill no branch "vaga global" na mão, suíte inteira continuou
  100% verde — nenhum teste cobria esse branch específico). @dev fechou com
  `test_fila_com_vaga_global_tambem_nao_reaproveita_nome`, confirmado com a mesma técnica (desligar e
  religar). Suíte completa: 144 passed.
- v0.12 (2026-08-19): PR #106 (passo 3) mergeado em `main`, redeploy do `cuca-worker` feito pelo Junior.
  @dev implementou o **passo 4/4** — normalização de cargo via IA (seção 8.1), seguindo o mesmo padrão
  já usado em `intencao_detector.py` (GPT-4o-mini, função de chamada isolada, fail-safe). Cache por
  conteúdo (TTL 90s) e teste crítico do falso positivo (3 cargos "Auxiliar de..." reais de produção, só
  1 par deveria fundir) cobertos. `_construir_cargos_consolidados` (passo 1) ganhou parâmetro opcional
  que preserva o comportamento antigo por padrão — os 13 testes originais continuam intactos. 10 testes
  novos, suíte completa: 154 passed. **Achado**: a "Nota de escopo" (passo 1) diz "5 passos" mas só
  lista 4 — os 4 estão completos agora. Não inventei um 5º passo pra fechar o número; HALT pro Junior
  decidir se é só erro de contagem (story completa) ou se falta algo não registrado.
- v0.13 (2026-08-19): @qa revisou o passo 4 — veredito **CONCERNS** (achado: `canonico` da IA exibido
  ao candidato sem validação de conteúdo, só os `membros` eram conferidos). @dev fechou com um
  fail-safe de conteúdo (`canonico` precisa compartilhar palavra real com os títulos originais do
  grupo, limite de 80 caracteres) + teste dedicado, confirmado empiricamente (desligar → só esse teste
  falha; religar → 155 passed). Suíte completa do worker: 333 passed, mesmas 5 falhas pré-existentes
  não relacionadas. Retomado a pedido do Junior após levantamento de auditoria confirmar, com conversa
  real de produção (`108da528`, 19/08 19:40), que este era exatamente o bug reproduzido ("auxiliar de
  manutenção" vs "Auxiliar de menutenção" não fundidos). Passo 4/4 pronto pra @devops abrir PR.
