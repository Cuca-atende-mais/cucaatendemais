# Plan 017 (PLANO EM ESTÁGIOS — não mecânico): Extrair seções do `handler()` de ~540 linhas

> **Executor instructions**: Este NÃO é um plano de execução direta de uma sessão só. É um plano de **estágios** — cada estágio é pequeno, verificável, e só deve começar depois do estágio anterior estar em produção (ou pelo menos mergeado e estável) por um tempo. Não tente fazer tudo numa sessão. **Não execute nenhum estágio antes do [plano 010](010-test01-cobertura-branches-erro-handler.md) estar concluído** — sem aquela cobertura de teste, esta refatoração não tem rede de segurança suficiente dado o histórico de regressões sutis deste arquivo específico.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` antes de cada estágio — não só no início.

## Status
- **Priority**: P3 (alto valor de longo prazo, mas não urgente — e arriscado o suficiente para não ser feito com pressa)
- **Effort**: L (multi-dia, em estágios)
- **Risk**: HIGH — este arquivo tem histórico real de regressões sutis (ver "Por que isso importa")
- **Depends on**: **[plano 010](010-test01-cobertura-branches-erro-handler.md) precisa estar concluído primeiro**
- **Category**: tech-debt
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

`handler()` (`index.ts:895-1437`) tem ~540 linhas — quase 38% do arquivo inteiro — com múltiplas flags booleanas cruzadas ao longo de toda a função (`trocouUnidade`, `trocaComPedidoEspecifico`, `perguntaGeralAtiva`, `conversaJustCreated`, `conversaGenuinamenteNova`, `menuCategoriaAtivoAnterior`, entre outras) e até 4 níveis de aninhamento `if/else if` só na seção de resolução de unidade (linhas ~1003-1170).

Isso não é um problema hipotético: `git log --oneline -- supabase/functions/motor-agente/index.ts` mostra 22 commits neste arquivo, boa parte corrigindo bugs sutis de estado cruzando essas flags — o comentário em `index.ts:1198-1203` descreve exatamente esse padrão: "achado do @qa Quinn... um 2º `.update({metadata:{...}})` no mesmo turno apagava o que um 1º tinha acabado de gravar". Uma função deste tamanho, com este número de variáveis de estado compartilhadas implicitamente, é exatamente a forma que já produziu essa classe de bug múltiplas vezes.

**Por que não fazer de uma vez**: o próprio tamanho e a quantidade de testes que hoje passam por `handler()` como caixa-preta (`index.audit.test.ts` inteiro) tornam uma extração de uma sessão só arriscada — um erro de qualquer flag perdida na extração só aparece como um teste vermelho difícil de rastrear até a variável exata, ou pior, não aparece em teste nenhum (daí a dependência do plano 010 primeiro).

## Estado atual (mapa da função, não código completo — 540 linhas é grande demais pra citar aqui)

Seções identificáveis dentro de `handler()`, com linhas aproximadas (commit `bf8b152`):
1. Parse do body + validação (895-912)
2. Resolução de lead (914-920)
3. Resolução de conversa (922-955)
4. Histórico + prompt (957-970)
5. Boas-vindas Sofia (972-990)
6. Resolução de unidade (5b, ~992-1170) — a seção mais aninhada, múltiplas flags
7. Montagem de contexto RAG (Passo 6, ~1173-1314) — os 4 branches duplicados do plano 012
8. Montagem do prompt final + chamada GPT (Passo 10-11, ~1316-1377)
9. Pós-processamento (tags handover/encerrar/encaminhar, divisão em partes, salvar, retornar) (~1378-1436)

Padrão de extração já usado com sucesso neste mesmo arquivo, para reutilizar como modelo: `decidirAguardandoUnidade`, `decidirConversaEngajada`, `decidirPrimeiraMensagem` — funções puras, já extraídas da lógica de decisão, com suas próprias assinaturas de entrada/saída explícitas e testadas isoladamente (procure essas 3 funções no arquivo para ver a forma exata que uma extração bem-sucedida assumiu aqui).

## Estágios

### Estágio 0 (pré-requisito, plano separado): [Plano 010](010-test01-cobertura-branches-erro-handler.md)
Characterization tests para os branches de erro/saída antecipada. Sem isso, não prossiga.

### Estágio 1: extrair a seção 7 (montagem de contexto RAG) — menor risco, já parcialmente escopado
O [plano 012](012-td03-extrair-montagem-contexto-rag.md) já extrai a duplicação de formatação de chunks dentro dessa seção. Um passo seguinte natural (fora do escopo do 012) é extrair a seção inteira (~140 linhas) para uma função `montarContextoRAG(supabase, params...) => Promise<string>`, recebendo como parâmetros só o que essa seção efetivamente lê (`temUnidadeDefinida`, `isAgenteProgramacao`, `precisaVisaoGeral`, `unidadeEfetiva`, `textoFinal`, `openaiKey`, `perguntaGeralAtiva`, `agente_tipo`, `fontes`) e devolvendo só `contextRAG` (string). Esta seção é a mais isolável — não escreve nenhum estado de `conversas`/`metadata`, só lê e retorna texto.

**Critério de sucesso do estágio**: toda a suíte de testes (incluindo os novos do plano 010) continua verde; a assinatura da função nova documenta explicitamente cada parâmetro (nada de "passa o objeto `handler` inteiro" — cada dependência explícita, seguindo o padrão de `decidirAguardandoUnidade` etc.).

### Estágio 2: extrair a seção 6 (resolução de unidade, 5b) — maior risco, faça só depois do Estágio 1 estável
Esta é a seção mais aninhada e mais rica em flags cruzadas (`trocouUnidade`, `trocaComPedidoEspecifico`, etc.) — a que mais historicamente gerou bugs (AUD-04, S-WM-34/VAL-23, entre outros citados nos comentários do próprio arquivo). Extrair como uma função que recebe o estado de entrada relevante (unidade salva, mensagem, avaliação semântica) e retorna um objeto de decisão explícito (`{ unidadeEfetiva, trocouUnidade, trocaComPedidoEspecifico, ... }`), no mesmo espírito de `decidirAguardandoUnidade`.

**Não tente fazer o Estágio 2 sem o Estágio 1 primeiro em produção/estável** — reduzir o tamanho do `handler()` primeiro facilita isolar qualquer regressão do Estágio 2 ao que realmente mudou.

### Estágio 3 (opcional, avaliar depois dos 2 primeiros): demais seções
Menor prioridade — as seções 1-5 e 8-9 são mais lineares (menos ramificação condicional cruzada) e já relativamente pequenas individualmente. Só extraia se, depois dos Estágios 1-2, o `handler()` ainda estiver grande o suficiente para justificar o esforço adicional.

## Comandos que você vai precisar (a cada estágio)

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` | `0 failed`, mesma contagem de `passed` (ou mais, se plano 010 já rodou) |
| Typecheck | `deno check index.ts` | não piora vs. baseline |

## Escopo
**No escopo, por estágio:** só a seção sendo extraída naquele estágio — não misture estágios no mesmo commit/PR.
**Fora do escopo:** qualquer mudança de comportamento observável — cada estágio é uma refatoração pura (mesmo input → mesmo output), nunca uma correção de bug junto (se encontrar um bug durante a extração, pare, reporte separadamente, não corrija "de brinde").

## Fluxo git
- Um branch por estágio: `advisor/017-td01-estagio-1-rag`, `advisor/017-td01-estagio-2-unidade`, etc.
- Um PR por estágio — não empacote os estágios juntos, mesmo que a tentação de "já que estou mexendo" apareça.

## Test plan (por estágio)
- Antes de extrair: confirme que a suíte atual (incluindo plano 010) está 100% verde.
- Depois de extrair: a suíte inteira precisa continuar 100% verde, SEM alterar nenhum teste existente (se um teste precisar mudar para passar, isso é sinal de que o comportamento mudou — pare e investigue antes de "ajustar o teste").
- Adicione testes de unidade diretos para a função nova extraída (ex.: `montarContextoRAG` isolada, testando os 4 branches sem precisar montar o `handler()` inteiro) — reduz o custo de testar essa lógica em extrações futuras.

## Done criteria (por estágio)
- [ ] Suíte inteira verde, sem nenhum teste existente alterado
- [ ] Testes de unidade novos para a função extraída
- [ ] `deno check index.ts` não piora vs. baseline
- [ ] `handler()` reduziu de tamanho (confirme com `wc -l` na função, ou contagem de linhas entre as marcações)
- [ ] `plans/README.md` atualizado com o estágio concluído

## STOP conditions
- Se qualquer teste existente precisar mudar (não só adicionar) para passar depois de uma extração — pare, o comportamento mudou, isso não é mais uma refatoração pura.
- Se o Estágio 2 (resolução de unidade) revelar que alguma flag depende de estado mutável fora do escopo óbvio da seção (ex.: uma variável declarada antes da seção 6 mas só lida na seção 7 ou 8) — mapeie essa dependência explicitamente antes de prosseguir; não deixe uma variável "vazando" implicitamente entre a função extraída e o resto do `handler()`.
- Se o plano 010 (pré-requisito) não estiver concluído — não comece nenhum estágio.

## Maintenance notes
- Depois dos Estágios 1-2, reavalie se o `handler()` ainda justifica o Estágio 3 — pode ser que a redução já seja suficiente para o objetivo real (reduzir a superfície de bugs de estado cruzado), sem precisar extrair tudo.
- Revisor de cada estágio deve confirmar que NENHUM comportamento observável mudou — o teste mais forte disso é "a suíte inteira passa sem eu ter tocado em nenhum assert existente".
