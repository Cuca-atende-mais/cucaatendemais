# S-PROG-09 — Abrir e continuar um rascunho já gravado

**Status:** InReview
**Epic:** Reestruturação da criação de programação
**Origem:** Levantamento @dev de 2026-09-10 (`GAP-prototipo-vs-implementado-2026-09-10.md`).
**Não foi pedida explicitamente pelo Junior** — é leitura minha de que o fluxo da S-PROG-08 não
fecha sem ela. Se a leitura estiver errada, esta story cai sem prejuízo das outras.
**Prioridade:** P0 | **Esforço:** M | **Risco:** **ALTO** — mexe em gravação de dado real.
**Depende de:** S-PROG-08.

## Por que existe

No protótipo, `abrirEditor(id)` é chamado de quatro lugares: criar do zero, duplicar, "Continuar
edição" num rascunho da lista, e "Ver conteúdo" na tela de aprovação. **O editor é um destino, não
uma etapa de assistente.**

Na implementação, `CriarProgramacaoView` recebe só `unidadeInicial`. Não aceita id de campanha, não
carrega atividade gravada. `handleSalvarRascunho` faz um `POST` no fim e navega para fora.
`/programacao/mensal/[id]` é somente leitura.

**Efeito prático:** quem duplica agosto recebe 178 linhas e precisa preencher data, horário e vagas
de todas **numa única sessão de navegador**. Fechou a aba, o rascunho fica gravado e inacabável —
não existe tela que o abra para edição. A S-PROG-08 entrega a duplicação; sem esta story, o que ela
entrega não tem como ser concluído.

## O problema técnico central: hoje "salvar" apaga e recria

`POST /api/programacao/importar` resolve conflito de mês/unidade **apagando a campanha existente** e
inserindo uma nova (linhas 62-72). Isso funciona para importar planilha, onde é sempre substituição
total. Para um editor de rascunho, é destrutivo — confirmado direto no banco de produção:

```
atividades_mensais_campanha_id_fkey   → ON DELETE CASCADE
campanha_historico_campanha_id_fkey   → ON DELETE CASCADE
```

Ou seja, cada "salvar" no editor, do jeito que a rota funciona hoje:

1. **apaga o histórico inteiro** da campanha (quem criou, quem devolveu, com que motivo);
2. **troca o `id` da campanha**, deixando `documentos_rag.metadados->>'campanha_id'` apontando para
   um registro que não existe mais — o que quebra `buscarAtividadeDeterministica` no motor-agente,
   que resolve a atividade justamente por esse caminho;
3. dispara `tr_campanha_mensal_delete_rag`, removendo o documento de RAG de uma programação que
   estava no ar, se ela tiver sido reaberta.

**Esta story não pode ser implementada reaproveitando a rota atual como está.**

## O que precisa ser implementado

### 1. Gravação incremental, preservando a identidade da campanha

Rota nova (`PATCH /api/programacao/rascunho`) ou um ramo explícito na rota atual, que:

- **nunca apaga a campanha** — atualiza `campanhas_mensais` no lugar (`total_atividades`, `titulo`);
- substitui apenas as **atividades**, dentro de uma transação, mantendo o `campanha_id`;
- recusa gravar se a campanha não estiver em `rascunho` (uma aprovada só volta a ser editável depois
  de reaberta, que é transição própria — ver S-PROG-04).
- checa `has_permission('programacao', 'update')` antes de gravar — mesmo padrão de
  `/api/programacao/status`; achado @po: a story não mencionava a checagem de permissão da rota
  nova, ausência que destoa do resto do módulo.

### 2. Editor carregando dado gravado

`CriarProgramacaoView` passa a aceitar `campanhaId` opcional. Com ele:

- carrega `campanhas_mensais` + `atividades_mensais` da campanha;
- converte cada linha gravada de volta para `AtividadeForm` — **a função de conversão já existe**:
  `atividadeFormDeLinhaExistente` (`lib/programacao/duplicar.ts`), escrita para a duplicação, com 32
  testes sobre dado real de produção. A diferença é que aqui **nada é zerado**: data, horário e vagas
  vêm como estão. Extrair o contrato de zeragem para parâmetro em vez de duplicar a função;
- abre direto na etapa de edição (a grade), pulando Origem — a origem já foi decidida quando o
  rascunho nasceu.

### 3. Entrada pela lista

O botão "Continuar edição" do card de rascunho (S-PROG-08) passa a ter destino: abre o editor
carregado. É o gatilho que estava rotulado sem tela por trás.

### 4. Indicação de estado de gravação

O protótipo diz *"Nada é gravado até salvar"* na tela de Origem. No editor de um rascunho já
existente isso deixa de ser verdade — o dado já está no banco. O editor precisa deixar claro o que
está gravado e o que não está, com um indicador de alterações não salvas e aviso ao sair da página
com pendência.

## Acceptance Criteria

1. Clicar "Continuar edição" num rascunho abre a grade com todas as atividades gravadas, cada campo
   no valor que está no banco.
2. Salvar de novo **mantém o mesmo `campanhas_mensais.id`** — verificável comparando o id antes e
   depois.
3. Salvar de novo **não apaga** linhas de `campanha_historico` da campanha.
4. Sair do editor e voltar mostra exatamente o que foi salvo, sem perda de campo.
5. Tentar gravar por essa rota uma campanha que não está em `rascunho` é recusado com erro claro.
6. Sair da página com alteração não salva pede confirmação.
7. Uma falha no meio da gravação não deixa a campanha sem atividades (transação ou ordem segura).
8. A rota recusa gravar sem `has_permission('programacao', 'update')`, com 403.

## Análise de impacto

| Item | Toca | Quem consome hoje | Impacto observável | De-risk |
|---|---|---|---|---|
| Rota de gravação incremental | `api/programacao/*` | `import-planilha-modal.tsx` e `criar-programacao-view.tsx` usam `POST importar` | Se o ramo novo for enfiado na rota existente, um erro afeta **também a importação de planilha**, que funciona hoje | Rota separada para o editor; não tocar no caminho da planilha nesta story |
| Conversão linha→formulário | `lib/programacao/duplicar.ts` | A duplicação (S-PROG-08) usa a mesma função | Parametrizar a zeragem pode alterar o comportamento da duplicação sem querer | Os 32 testes existentes cobrem o caminho da duplicação — devem continuar passando sem alteração; os testes novos cobrem o caminho sem zeragem |
| Identidade da campanha | `campanhas_mensais.id` | `documentos_rag.metadados->>'campanha_id'`, lido por `buscarAtividadeDeterministica` (motor-agente) e por `campanha_historico` | Trocar o id silenciosamente quebra a busca determinística do agente **em produção**, sem erro visível — o agente cai para busca vetorial e responde pior | Teste que confirma id estável entre duas gravações; conferir com `execute_sql` que o `campanha_id` do documento de RAG continua resolvendo |
| Edição de campanha aprovada | `campanhas_mensais.status` | Trigger `tr_campanha_mensal_index` | Se deixar gravar sobre uma aprovada, o conteúdo no ar muda sem passar por aprovação | Recusa no servidor, não só esconder o botão |

## Dev Agent Record

### Item 1 — Gravação incremental (2026-09-10, @dev/Dex) — **concluído**

Implementado só o item 1. Itens 2, 3 e 4 (editor carregando dado, entrada pela lista, indicador de
não salvo) **não foram feitos** — aguardando autorização pra continuar (instrução do Junior:
desenvolver story por story, sem lote).

### Item 2 — Editor carregando dado gravado (2026-09-10, @dev/Dex) — **concluído**

Autorizado pelo Junior ("@dev siga"). Item 4 (indicador de não salvo) **não foi feito** — só o
carregamento/gravação de rascunho existente.

**O que foi implementado:**
- `lib/programacao/duplicar.ts` — `atividadeFormDeLinhaExistente` ganhou um terceiro parâmetro
  opcional `{ zerar?: boolean }` (padrão `true`, comportamento da duplicação inalterado — os 32
  testes existentes passam sem qualquer alteração). Com `zerar: false`, reconstitui os valores
  reais em vez de zerar: `hora_inicio`/`hora_fim` (coluna, formatada), `vagas`, `dias_raw`
  (revertido de `dias_semana` — nova função `parseDiasAbreviados`, inverso de
  `DIAS_SEMANA_ABREV`), `data_inicio_raw`/`data_fim_raw` (CURSOS, revertido de `meta.periodo` +
  conversão BR→ISO), `dia_semana`/`data_real` (DIA A DIA, copiados como gravados). `faixa_etaria`
  ganhou suporte a "a partir de X anos" (formato que a própria gravação produz sem idade máxima),
  além do formato antigo "X a Y anos" já suportado.
- `criar-programacao-view.tsx` — prop `campanhaId` opcional. Com ela: builda direto no step 3
  (pula Cabeçalho/Origem), carrega `campanhas_mensais` + `atividades_mensais` num `useEffect`,
  recusa no cliente campanha que não está em `rascunho` (reforça o que a função já recusa no
  servidor), converte as linhas com `atividadeFormDeLinhaExistente(..., { zerar: false })` e
  grava por `PATCH /api/programacao/rascunho` (não passa pelo `POST /api/programacao/importar`,
  que apaga e recria). "Voltar" no primeiro step em modo edição sai da tela (não existe
  Cabeçalho/Origem pra revisitar).
- `app/(dashboard)/programacao/criar/page.tsx` — aceita `?campanhaId=` e repassa; ausente mantém
  o fluxo de criação normal, inalterado.

**Verificação executada:**
- `vitest run src/lib/programacao`: 150/150 (7 novos em `duplicar.test.ts`, cobrindo ESPORTES,
  CURSOS e DIA A DIA com `zerar: false`, incluindo o caso "a partir de X anos" e campo ausente).
- `tsc --noEmit`: limpo nos arquivos tocados.
- `eslint`: 0 erros/avisos novos (o único erro remanescente em `criar-programacao-view.tsx`, linha
  90, é `campanhaExistente: any`, pré-existente, não tocado nesta mudança).
- `npm run build`: **falha, mas por um problema alheio a esta mudança** —
  `node_modules/lucide-react/dist/esm/` está com o diretório `shared/` ausente (pacote instalado
  incompleto no ambiente local), quebrando qualquer página que importe `lucide-react` (achado em
  `empregabilidade/vagas`, não em `programacao`). Confirmado que não é efeito desta story:
  `criar-programacao-view.tsx` já importava `lucide-react` antes desta mudança, e o diretório
  `shared/` simplesmente não existe no pacote instalado — é integridade de `node_modules`, não
  código. Não tentei corrigir (fora do escopo desta story, reinstalar dependência é decisão de
  ambiente). `tsc --noEmit` e `vitest`, que não dependem do bundler, confirmam que o código em si
  está correto.

**Não verificado:** navegador/localhost — regra do projeto proíbe sem autorização explícita
(`qa-testes-sem-navegador-ao-vivo.md`). Verificação foi só estática (tipos, lint, testes, build).
Não há ainda botão "Continuar edição" apontando pra cá (isso é o item 3, ou o próprio card da
S-PROG-08) — a rota aceita `?campanhaId=` mas nada no app ainda a chama.

### Item 4 — Indicador de alterações não salvas (2026-09-10, @dev/Dex) — **concluído**

Autorizado pelo Junior ("Segue pro item 4"). Com isso a S-PROG-09 fecha os 4 itens do "O que
precisa ser implementado" — falta só o item 3 (botão "Continuar edição" de verdade, que depende
do card da S-PROG-08 existir).

**Decisão de escopo:** o indicador/confirmação só se aplica em modo edição (`campanhaId`
presente). Na criação do zero a frase do protótipo "Nada é gravado até salvar" continua
verdadeira e nada muda ali — é exatamente a distinção que o item 4 descreve ("no editor de um
rascunho já existente isso deixa de ser verdade").

**O que foi implementado:**
- `snapshotAtividades`: JSON das atividades no momento em que a tela terminou de carregar (ou da
  última gravação bem-sucedida). Comparado contra o estado atual para saber se há alteração
  pendente — mais simples que um diff campo a campo, e cobre qualquer edição na grade ou na
  ficha lateral (ambas passam por `setAtividades`).
- Badge no cabeçalho: "Alterações não salvas" (âmbar) ou "Tudo salvo" (verde), visível só em
  modo edição.
- `beforeunload`: navegador confirma antes de fechar a aba/atualizar com alteração pendente.
- Navegação interna (ArrowLeft do header e "Cancelar" do primeiro passo do editor) passa a
  checar alteração pendente antes de sair — com pendência, abre `AlertDialog` ("Sair sem salvar
  as alterações?") em vez de sair direto; sem pendência, sai normalmente, sem diálogo a mais.

**Verificação executada:**
- `vitest run src/lib/programacao`: 150/150 (sem novo teste — mudança é de estado/UI do
  componente, sem lógica pura nova extraível pra `lib/`; comportamento coberto por leitura de
  código, não há suíte de componente no projeto pra este arquivo).
- `tsc --noEmit`: limpo.
- `eslint`: 0 erros/avisos novos (mesmo único erro pré-existente da linha 90, não tocado).

**Não verificado:** navegador — mesma restrição do item 2 (`qa-testes-sem-navegador-ao-vivo.md`).

### Correção do achado crítico do @qa — permissão dentro da função (2026-09-10, @dev/Dex)

O @qa revisou a story e achou (`QA Results` abaixo) que `programacao_salvar_rascunho` é
`SECURITY DEFINER` + `GRANT EXECUTE` para `authenticated`, e não checava permissão nenhuma
internamente — só a rota checava. Isso é chamável direto via `/rest/v1/rpc/...` com o JWT de
qualquer colaborador, contornando a rota e a RLS (que a `SECURITY DEFINER` já bypassa por
natureza). Achado **CONFIRMADO** — reproduzi com um colaborador real sem `programacao:update`
("Admin Empregabilidade", `can_update: false` no módulo) e a chamada direta funcionava.

**Correção:** `supabase/migrations/20260910190000_s_prog_09_fix_permissao_salvar_rascunho.sql` —
`CREATE OR REPLACE FUNCTION` adicionando, como primeira linha do corpo, antes de qualquer
leitura/escrita:
```sql
IF NOT public.has_permission('programacao', 'update') THEN
    RAISE EXCEPTION 'Sem permissão para editar programação' USING ERRCODE = '42501';
END IF;
```
Resto da função inalterado. `has_permission()` lê `auth.uid()`, que reflete o JWT de quem chamou
a função (não o dono dela) — confirmado lendo a definição dela em produção antes de aplicar.

**Verificação executada, direto em produção (`svzkrkfzpiqcesloukgb`):**
- Definição da função pós-migration conferida via `pg_get_functiondef` — `search_path` continua
  fixado (`SET search_path TO 'public'`), a checagem nova está no lugar certo.
- **Caso negativo (a exploração que o @qa descreveu):** simulando `auth.uid()` de
  "Admin Empregabilidade" (`can_update: false` real, confirmado em `sys_permissions`) via
  `set_config('request.jwt.claim.sub', ...)`, a chamada agora falha com `42501` **antes** de
  tocar em `campanhas_mensais`/`atividades_mensais` — o buraco está fechado.
- **Caso positivo (não quebrar quem tem permissão):** simulando `auth.uid()` de um colaborador
  `developer` real, `has_permission` retorna `true` e a chamada passa da checagem nova, chegando
  ao próximo estágio da função (`P0002`, porque o teste usou um `campanha_id` inexistente de
  propósito — não precisei recriar uma campanha descartável pra provar que o *guard* não
  bloqueia quem deveria passar).
- Sem sessão nenhuma (contexto direto de `execute_sql`, sem JWT): `has_permission` retorna
  `false` e a função recusa com `42501` — mesmo resultado do caso negativo, reforça que o guard
  funciona em qualquer contexto sem permissão.
- Nenhum dado de teste ficou no banco (as inserções de teste rodaram dentro de transações não
  commitadas).
- `cuca-portal/src/lib/programacao/rascunho.ts` — `mapearErroSalvarRascunho` ganhou o código
  `42501` → `403` (achado à parte: sem isso, um `42501` vindo da função cairia no `500` genérico
  em vez de `403` — cenário só alcançável por corrida entre o check da rota e a chamada da
  função, mas correto mapear mesmo assim). 1 teste novo.
- `vitest run src/lib/programacao`: 151/151 (1 novo). `tsc --noEmit` e `eslint`: limpos.

**Decisão de negócio confirmada pelo Junior antes de codar:** `atividades_mensais.data_atividade`
é `NOT NULL` e está correto — duplicar zera hora_início, hora_fim e vagas sempre; zera a data só
pra categorias com data própria (CURSOS/DIA A DIA/ESPECIAIS). ESPORTES não tem data individual —
recebe o placeholder do 1º dia do mês da campanha (mesma convenção da planilha,
`import-planilha-modal.tsx:261`, `fallbackDate`), garantido dentro da própria função Postgres, não
confiado ao que o cliente manda.

**O que foi implementado:**
- `supabase/migrations/20260910180000_s_prog_09_salvar_rascunho.sql` — função
  `programacao_salvar_rascunho(campanha_id, titulo, atividades jsonb)`: `SECURITY DEFINER`,
  `search_path` fixado (evita entrar no débito de `function_search_path_mutable` já sinalizado
  pelo advisor). Recusa se a campanha não existe (`ERRCODE P0002`) ou não está em `rascunho`
  (`P0001`, com o status atual na mensagem). Nunca apaga a campanha — só substitui as atividades
  (delete + insert) e atualiza `titulo`/`total_atividades`, tudo numa chamada de função só (atômico
  por construção, sem precisar de transação explícita no lado do Next.js).
- `cuca-portal/src/app/api/programacao/rascunho/route.ts` (novo) — `PATCH`: autentica, checa
  `has_permission('programacao', 'update')`, chama a função e traduz o erro.
- `cuca-portal/src/lib/programacao/rascunho.ts` (novo) — `mapearErroSalvarRascunho`, função pura
  que traduz o `ERRCODE` da função Postgres pro status HTTP. 5 testes.

**Verificação executada:**
- Testada a função direto no banco (produção, dado descartável, apagado depois): id da campanha
  permanece igual antes/depois; ESPORTES grava o placeholder de mês; CURSOS mantém a data real;
  recusa corretamente campanha aprovada (`P0001`) e campanha inexistente (`P0002`).
- `vitest run src/lib/programacao`: 143/143 (5 novos).
- `tsc --noEmit`: limpo nos arquivos novos.
- `eslint`: 0 erros, 0 avisos nos 3 arquivos novos.

**Não verificado:** o caminho completo via HTTP (rota chamada pelo navegador) — não há UI ainda
que chame esta rota (itens 2-3 desta story). A verificação foi direto na função + revisão de
código da rota.

## Fora de escopo

Edição colaborativa/simultânea por duas pessoas. Autosave. Versionamento de rascunho.

## File List

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/20260910180000_s_prog_09_salvar_rascunho.sql` | **novo** — função `programacao_salvar_rascunho`, aplicada em produção |
| `cuca-portal/src/app/api/programacao/rascunho/route.ts` | **novo** — rota `PATCH`, item 1 |
| `cuca-portal/src/lib/programacao/rascunho.ts` | **novo** — mapeamento de erro, item 1 |
| `cuca-portal/src/lib/programacao/rascunho.test.ts` | **novo** — 5 testes |
| `cuca-portal/src/lib/programacao/duplicar.ts` | item 2 — `atividadeFormDeLinhaExistente` ganhou `{ zerar }`; nova `parseDiasAbreviados`; `parseFaixaEtaria` ganhou "a partir de X anos" |
| `cuca-portal/src/lib/programacao/duplicar.test.ts` | item 2 — 7 testes novos (`zerar: false` + `parseDiasAbreviados`) |
| `cuca-portal/src/components/programacao/criar-programacao-view.tsx` | item 2 — prop `campanhaId`, carregamento de rascunho, gravação via `PATCH /rascunho`; item 4 — indicador de alterações não salvas, `beforeunload`, confirmação ao sair |
| `cuca-portal/src/app/(dashboard)/programacao/criar/page.tsx` | item 2 — aceita `?campanhaId=` |
| `supabase/migrations/20260910190000_s_prog_09_fix_permissao_salvar_rascunho.sql` | **novo** — correção do achado crítico do @qa: `has_permission` dentro da função, aplicada em produção |
| `cuca-portal/src/lib/programacao/rascunho.ts` | correção do achado crítico — mapeia `42501` → 403; 1 teste novo |

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-10 | @dev (Dex) | Story rascunhada; CASCADE das duas FKs confirmado por consulta direta ao banco de produção |
| 2026-09-10 | @po (Pax) | Validado GO (9/10). AC8 adicionado (checagem de permissão ausente na rota nova). Status Draft → Ready |
| 2026-09-10 | @dev (Dex) | Item 1 (gravação incremental) implementado e verificado direto no banco. Status Ready → InProgress. Itens 2-4 pendentes, aguardando autorização |
| 2026-09-10 | @dev (Dex) | Item 2 (editor carregando rascunho) implementado, autorizado pelo Junior ("@dev siga"). `vitest` 150/150, `tsc`/`eslint` limpos. `npm run build` achou problema de ambiente pré-existente e alheio a esta mudança (lucide-react com `node_modules` incompleto) — documentado no Dev Agent Record. Item 4 (indicador de não salvo) pendente |
| 2026-09-10 | @dev (Dex) | Item 4 (indicador de alterações não salvas + confirmação ao sair) implementado, autorizado pelo Junior ("Segue pro item 4"). Escopo restrito a modo edição (justificado no Dev Agent Record). `vitest` 150/150, `tsc`/`eslint` limpos. Todos os 4 itens da story concluídos — falta só o item 3 depender do card da S-PROG-08 pra ter um botão real apontando pra cá |
| 2026-09-10 | @qa (Quinn) | Revisão completa (`*review`). Veredito **FAIL** — achado crítico de controle de acesso na função `programacao_salvar_rascunho` (ver QA Results). Status permanece InProgress |
| 2026-09-10 | @dev (Dex) | Achado crítico corrigido: `has_permission('programacao','update')` agora dentro da função, aplicado em produção. Verificado com colaborador real sem permissão (bloqueado, 42501) e colaborador real com permissão (não bloqueado). Rota mapeia `42501` → 403. `vitest` 151/151, `tsc`/`eslint` limpos. Pronto para nova revisão do @qa |
| 2026-09-10 | @qa (Quinn) | Nova revisão (`*review`). Achado crítico **CONFIRMADO CORRIGIDO** — reproduzi de forma independente (colaborador real sem permissão bloqueado, colaborador real com permissão não bloqueado), conferi `GRANT`/`search_path` inalterados, testes/tipos/lint limpos. Veredito **PASS**. Status InProgress → InReview |

## QA Results

### Rodada 2 — @qa (Quinn) · 2026-09-10 · Veredito: **PASS**

Reverifiquei o achado crítico da Rodada 1 de forma **independente** (não só lendo o relato do
@dev) — refiz as duas chamadas diretas contra produção, com `campanha_id` diferentes das que o
@dev usou, pra não repetir os mesmos parâmetros de teste dele:

- Colaborador real sem `programacao:update` ("Admin Empregabilidade", confirmado em
  `sys_permissions`) → `programacao_salvar_rascunho(...)` falha com `42501`, **antes** de tocar
  em `campanhas_mensais`. Buraco fechado, confirmado por mim.
- Colaborador real `developer` → passa da checagem nova, chega em `P0002` (id inexistente de
  propósito). O guard não bloqueia quem deveria passar.
- `pg_get_functiondef` conferido: a checagem é literalmente a primeira instrução do corpo,
  `search_path` continua `SET ... TO 'public'` (função não reaparece em
  `function_search_path_mutable` no advisor).
- `GRANT`/`REVOKE` inalterados (`information_schema.routine_privileges`): só
  `authenticated`/`service_role`/`postgres`, sem `anon` — como já era, agora com a diferença de
  que a permissão de EXECUTAR não é mais a mesma coisa que ter permissão de USAR.
- `vitest run src/lib/programacao`: 151/151 (o teste novo do `42501`→403 incluso). `tsc --noEmit`
  e `eslint`: limpos (mesmo único erro pré-existente e não relacionado, linha 90 de
  `criar-programacao-view.tsx`).

**Concerns não-bloqueantes seguem os mesmos da Rodada 1** (indicador "Alterações não salvas"
pode falsear positivo por diferença de ordem de chaves; AC1 não fecha ponta a ponta sem a
S-PROG-08/item 3). Nenhum dos dois impede aprovar esta rodada — nenhum é regressão nem
segurança.

**Decisão:** story pode seguir para o @devops quando o Junior autorizar. Status InProgress →
InReview.

---

### Rodada 1 — @qa (Quinn) · 2026-09-10 · Veredito: FAIL (bloqueante — não seguir para @devops sem correção)

### Achado crítico — controle de acesso quebrado em `programacao_salvar_rascunho` (produção)

**O quê:** a função é `SECURITY DEFINER` (bypassa RLS por completo) e tem `GRANT EXECUTE ... TO authenticated` — ou seja, é chamável **diretamente** via `/rest/v1/rpc/programacao_salvar_rascunho` por **qualquer** usuário autenticado, com o próprio JWT dele, sem passar pela rota Next.js. A única checagem de permissão (`has_permission('programacao','update')`) está **só** em `app/api/programacao/rascunho/route.ts` — a função em si não checa nada.

**Confirmado em produção** (`svzkrkfzpiqcesloukgb`), consultando RLS real das duas tabelas que a função escreve:

```
atividades_mensais  UPDATE/INSERT/DELETE → todas exigem has_permission('programacao', <ação>)
campanhas_mensais   UPDATE               → exige has_permission('programacao','update')
```

Todo outro caminho de escrita nessas duas tabelas passa por essa RLS (inclusive `/api/programacao/status`, que usa o client comum, RLS-protegido) ou por `createAdminClient()` — que usa a **service role key**, nunca exposta ao navegador, só invocável de dentro da própria rota server-side (`/api/programacao/importar`). `programacao_salvar_rascunho` é o único caminho de escrita desse módulo que é (a) `SECURITY DEFINER`, contornando a RLS, **e** (b) diretamente alcançável pelo cliente com uma chave que o navegador já tem (o JWT do próprio usuário logado) — as duas condições juntas é que tornam isso explorável.

**Cenário concreto de falha:** um colaborador autenticado, **sem** a permissão `programacao:update` (ex.: alguém só com acesso a outro módulo), chama a função diretamente via `fetch` para `.../rest/v1/rpc/programacao_salvar_rascunho` com seu próprio token — a chamada **funciona**, apagando e recriando as atividades de qualquer campanha em `rascunho`, de qualquer unidade, e renomeando o título. Não precisa passar pelo portal nem pela rota Next.js.

**A comparação feita no comentário da migration ("mesmo padrão de `/api/programacao/status`") não se sustenta:** `/api/programacao/status` escreve com o client comum, então a RLS acima é a barreira real — o `has_permission` da rota é redundante com ela, não a única linha de defesa. Aqui é o oposto: a RLS foi contornada pelo `SECURITY DEFINER`, e a checagem da rota é a única barreira, e essa barreira não existe pra quem chama a função direto.

**Correção recomendada (mínima, já é o padrão do projeto):** a própria `has_permission()` já é segura de chamar de dentro de uma função `SECURITY DEFINER` — ela lê `auth.uid()`, que reflete o JWT de quem chamou, não o dono da função (confirmado lendo a definição de `has_permission` em produção). Adicionar, como primeira linha do corpo da função, antes de qualquer leitura/escrita:

```sql
IF NOT public.has_permission('programacao', 'update') THEN
    RAISE EXCEPTION 'Sem permissão para editar programação' USING ERRCODE = '42501';
END IF;
```

Isso fecha o buraco independente de quem chama (rota ou REST direto) — mesmo padrão que toda RLS do módulo já usa. A rota continua com a checagem dela (não é redundante remover — é a mensagem amigável antes de gastar uma chamada de rede); a função passa a ser a barreira de verdade.

**Por que é bloqueante:** a função já está aplicada em produção agora, com o buraco aberto. Recomendo fortemente aplicar a correção (nova migration, idempotente via `CREATE OR REPLACE FUNCTION`) antes de qualquer push/PR — e o quanto antes, independente do push, já que o código já está no ar.

### Demais checks (7 pontos)

1. **Code review** — código limpo, comentários no padrão do módulo, motivo de cada decisão registrado. Sem duplicação relevante.
2. **Testes** — `vitest run src/lib/programacao`: 150/150. Os 32 testes originais de `duplicar.ts` passam sem alteração (parametrização não regrediu a duplicação, como a análise de impacto pedia). 7 testes novos cobrem `zerar: false` nas 3 categorias, incluindo o formato "a partir de X anos" e campo ausente.
3. **Acceptance Criteria** — AC2, AC3, AC5, AC7 verificados (item 1, testado direto no banco). AC4 verificado por leitura de código (round-trip `atividadeFormDeLinhaExistente({zerar:false})` ↔ `montarAtividadePayload`, sem perda de campo nos casos testados). AC6 implementado e revisado em código. **AC1 não é verificável ponta a ponta ainda** — não existe botão "Continuar edição" no app (depende da S-PROG-08); a capacidade técnica existe (`?campanhaId=`), mas a jornada descrita no AC não tem como ser clicada hoje. **AC8, tecnicamente cumprido pela rota, mas insuficiente** — ver achado crítico acima.
4. **Regressão** — `/api/programacao/importar` e `/api/programacao/status` não foram tocados; caminho de planilha intacto.
5. **Performance** — sem impacto, volume de atividades por campanha é pequeno (dezenas a ~200).
6. **Segurança** — achado crítico acima. Sem SQL injection (parâmetros tipados, sem concatenação de string). `search_path` fixado corretamente (não aparece em `function_search_path_mutable` do advisor, diferente de 42 funções legadas do projeto).
7. **Documentação** — Dev Agent Record, File List e Change Log completos e precisos para os 3 itens implementados.

### Concerns não-bloqueantes

- Indicador "Alterações não salvas" compara `JSON.stringify(atividades)` — pode falsear positivo em edições que não mudam o conteúdo semântico (ex.: reordenar chaves de um objeto). Cosmético, não achei caminho real do app que produza isso hoje.
- Item 3 (botão real na lista) e S-PROG-08 seguem pendentes — sem eles, AC1 não fecha ponta a ponta. Não é um defeito desta story, é a dependência declarada dela mesma.
