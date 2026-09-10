# S-PROG-02 — Duplicar programação do mês anterior

**Status:** InReview
**Epic:** Reestruturação da criação de programação
**Origem:** Pedido central do Junior (a junta técnica hoje copia e cola abas no Google Sheets).
**Prioridade:** P1 | **Esforço:** M | **Risco:** MED-HIGH — a rota de gravação atual apaga campanha
existente sem aviso (ver item 3).
**Depende de:** S-PROG-01 (duplicar sem ter onde editar em massa não entrega valor).

## Contexto

Medição em produção (`atividades_mensais`, 2.250 registros): as modalidades de ESPORTES que reaparecem
em 2+ meses são **89% a 100% por unidade** (Mondubim e Pici: 100%). Redigitar todo mês é trabalho ~95%
redundante. Este é o motivo pelo qual a junta técnica prefere a planilha.

## O que precisa ser implementado

### 1. Seletor de mês de origem, com selo de qualidade

Ao criar uma programação (unidade + mês de destino), listar os meses já publicados daquela unidade como
cartões com: contagem por categoria e um **selo de qualidade calculado na hora** — percentual de
`faixa_etaria` sem nenhum dígito, campos obrigatórios vazios, categoria inválida.

Isso não é enfeite: a contaminação histórica medida é 100% (mai/2026), 76% (jun), 27% (jul), 1% (ago).
**Duplicar junho propaga o lixo.** Campanhas com categoria inválida (a campanha `ESPORTE` de Jangurussu,
66 linhas com metadata `info_bruta`) **não podem aparecer como origem**.

### 2. Política de zeramento — global

**Decisão do Junior, vale para todas as categorias:** ao duplicar, vêm em branco **data, hora
(início e fim) e vagas**. Todo o resto do descritivo vem copiado — modalidade, professor, turma, faixa
etária, pré-requisitos, dias da semana, local, ementa, meta e diretoria.

> A proposta por categoria do levantamento §3.2 está **superada** por esta decisão. Ignorar aquela tabela.

Efeito colateral conhecido e aceito: em ESPORTES, isso significa que o horário das ~126 turmas volta
vazio todo mês.

### 3. Gravação — não reusar o delete implícito

`cuca-portal/src/app/api/programacao/importar/route.ts:44-50` **apaga a campanha existente** do mesmo
mês/ano/unidade antes de inserir, com CASCADE em `atividades_mensais` e remoção dos embeddings pelo
trigger. Se a duplicação reusar essa rota, duplicar para um mês que já tem programação **apaga a que
está no ar sem aviso**, derrubando o RAG daquela unidade até o novo embedding rodar.

Fluxo obrigatório: detectar campanha existente no destino → confirmar explicitamente com o usuário →
gravar como **rascunho**, com embeddings gerados só na aprovação (S-PROG-04).

### 4. Normalização na cópia (não cópia crua)

- `faixa_etaria` textual da origem → tentar extrair `idade_min`/`idade_max`. O que não parsear vem
  **vazio e destacado**, para o operador preencher. Nunca chutar.
- `trim()` em todo texto; colapsar espaços duplos.
- Texto de exemplo detectado na origem (`nome sobrenome`, `idade`, `00h00`) **não é copiado** — o campo
  vem vazio e marcado.

### 5. Ajuda (camada 1)

Tooltip/popover no seletor: "Escolha o mês que serve de base. Vem copiado tudo que se repete; data,
horário e vagas voltam em branco para você preencher." Selo de qualidade com ajuda explicando o que o
percentual significa.

## Acceptance Criteria

1. Duplicar Agosto/2026 do Mondubim para Setembro produz todas as atividades com descritivo preenchido
   e **data, hora início, hora fim e vagas vazios**, em todas as categorias.
2. A campanha `ESPORTE` (categoria inválida, metadata `info_bruta`) não aparece como origem possível.
3. Meses com contaminação alta aparecem com selo de aviso e o percentual real, calculado no momento.
4. Duplicar para um mês que já tem programação exige confirmação explícita e **nunca** apaga a campanha
   existente sem essa confirmação.
5. A programação duplicada nasce com status `rascunho` e **não gera embeddings** até ser aprovada.
6. `faixa_etaria` não parseável resulta em campo vazio e destacado, nunca em valor adivinhado.

## Fora de escopo

Aprovação e publicação (S-PROG-04), formato gravado em `metadata` (S-PROG-03).

## Dev Agent Record

### Implementação (2026-09-09, @dev/Dex)

**Levantamento de impacto feito antes de codar** (consulta direta em produção, `svzkrkfzpiqcesloukgb`,
read-only): o formato real de `metadata` das campanhas aprovadas é mais heterogêneo do que a
story descreve — CURSOS não tem `data_inicio_raw`/`data_fim_raw`, tem um blob `periodo`
misturando as duas datas e o texto de dias; `carga_horaria` vem como `"17h30min"`/`"17h/aula"`;
`dias_semana` de ESPORTES é texto totalmente livre (`"Ter e Qui"`, `"Ter a sex"`, `"qui e ter"` na
MESMA campanha, Mondubim/set-2026). Isso mudou o escopo real da normalização (item 4) — reportado
ao Junior antes de implementar, autorizado a seguir.

**Achado crítico, corrigido em PR separado (#165) antes desta story:** `montarAtividadePayload`
(S-PROG-01) mandava `hora_inicio`/`hora_fim` como `""` quando vazio — `atividades_mensais` tem
essas colunas como `time`, que rejeita `""` (`invalid input syntax for type time: ""`, confirmado
direto no banco). Isso já quebrava qualquer save com horário em branco, inclusive fora do escopo
da duplicação — corrigido para `null`, mesmo padrão do `parseTimeString` do import de planilha.

**Decisões de escopo tomadas durante a implementação:**

1. **`dias_raw` nunca é reconstruído de texto livre.** Dado real de produção não tem lista fechada
   de dias (é exatamente o problema que a S-PROG-01 resolveu pra frente) — parsear texto livre
   arbitrário pra uma lista fechada sem chutar não é seguro. `dias_raw` sempre nasce vazio na
   duplicação; o painel de revisão já detecta "nenhum dia da semana selecionado" (regra que já
   existia antes desta story), então isso vira pendência visível, não um buraco silencioso.
2. **`parsePeriodoCursos`/data de CURSOS: parser escrito e testado contra o formato real, resultado
   descartado.** As datas zeram por política (item 2) igual toda categoria — o parser existe e
   fica exportado porque a S-PROG-05 (exportação) provavelmente precisa da mesma extração pra
   reconstituir o período em texto legível pra gráfica.
3. **Só campanhas `aprovado` aparecem como origem.** Rascunho é trabalho em andamento, não uma
   referência "que já funcionou" — a story fala em "meses já publicados", que só corresponde a
   `aprovado` no fluxo atual (aprovação de verdade é escopo da S-PROG-04, ainda não existe).
4. **AC4 corrigido no próprio endpoint compartilhado** (`/api/programacao/importar`), não só na
   tela de duplicação — o problema (apagar sem confirmar) já existia para "criar do zero" também,
   e os dois fluxos passam pelo mesmo endpoint. `import-planilha-modal.tsx` (fluxo de upload de
   planilha) já tem sua própria confirmação e apaga a campanha antes de chamar o endpoint — não
   foi tocado, e não é afetado pela mudança (nunca vai encontrar conflito no servidor, porque já
   apagou antes).
5. **AC5 não exigiu mudança de banco.** Lido o código do trigger `trigger_indexar_campanha_mensal`
   (schema_producao.sql) — já é condicional a `NEW.status = 'aprovado'`; `rascunho` nunca ativa
   embeddings. Confirmado por leitura, não assumido.

**Não verificado nesta rodada:** renderização real no navegador (sem autorização de
navegador/localhost nesta sessão) — recomendo o @qa testar o fluxo completo (escolher origem →
grade populada → editar → salvar → confirmar substituição) antes do PASS.

### Verificação executada

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` | Limpo nos arquivos da story |
| `vitest run src/lib/programacao` | **108 passed, 0 failed** (32 novos em `duplicar.test.ts`, com amostras literais de dado real de produção) |
| `eslint` nos 6 arquivos novos/alterados | Só os 6 erros pré-existentes (`any`), sem mudança nas linhas |
| Consulta direta ao banco de produção (read-only) | Confirmou formato real de `metadata`, categoria inválida real (`ESPORTE`), e que `''::time` quebra / `null::time` funciona |

### Cobertura de Acceptance Criteria

| AC | Status |
|---|---|
| 1. Duplicar produz descritivo preenchido, data/hora/vagas vazios em toda categoria | ✅ implementado e testado (`duplicar.test.ts`) |
| 2. Campanha com categoria inválida não aparece como origem | ✅ implementado e testado |
| 3. Selo de qualidade com percentual real, calculado na hora | ✅ implementado (`calcularSeloQualidade`) |
| 4. Confirmação explícita antes de substituir, nunca apaga sem confirmar | ✅ implementado (`AlertDialog` + gate no endpoint, com 409 pra corrida entre usuários) |
| 5. Nasce rascunho, sem gerar embeddings até aprovação | ✅ já garantido pelo trigger existente (confirmado por leitura) |
| 6. `faixa_etaria` não parseável vem vazio, nunca adivinhado | ✅ implementado e testado com o lixo real de produção |

## File List

| Arquivo | Mudança |
|---|---|
| `cuca-portal/src/lib/programacao/duplicar.ts` | **novo** — parsers (faixa etária, período de curso, carga horária), normalização, selo de qualidade |
| `cuca-portal/src/lib/programacao/duplicar.test.ts` | **novo** — 32 testes com amostras reais de produção |
| `cuca-portal/src/lib/programacao/ajuda.ts` | +2 chaves de ajuda (`duplicar_origem`, `selo_qualidade`, item 5) |
| `cuca-portal/src/components/programacao/selecionar-origem.tsx` | **novo** — tela de seleção de origem (item 1) |
| `cuca-portal/src/components/programacao/criar-programacao-view.tsx` | Novo step "Origem" (renumeração 1-4); `AlertDialog` de confirmação (AC4) |
| `cuca-portal/src/app/api/programacao/importar/route.ts` | Delete condicionado a `confirmarSubstituicao` (AC4), 409 em conflito |

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-08 | @sm (River) | Story criada |
| 2026-09-08 | @po (Pax) | Validado GO (documento `VALIDACAO-PO-stories-programacao-2026-09-08.md`) — status não havia sido atualizado no arquivo da story até agora |
| 2026-09-09 | @dev (Dex) | Status Draft → Ready → InProgress → InReview; implementação completa; 108/108 testes, 0 lint/tsc novos; PR #166 aberto contra #165 (dependência: fix de horário vazio) |

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-08 | @sm (River) | Story criada |
