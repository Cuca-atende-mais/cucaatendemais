# S-WM-51 — RAG de serviços institucionais por unidade (documento único, sempre carregado)

## Status
Ready for Review

## Origem
`docs/qa/INVESTIGACAO-RAG-Institucional-Por-Unidade-2026-07-20.md` (investigação original, pergunta em aberto nº 1) + `RESPOSTA-servicos-institucional-2026-07-20.md` (decisão de design, aprovada pelo sócio) + verificação técnica do @dev Dex nesta sessão (linha do gate corrigida, achado de atribuição `=` vs `+=` virou condição obrigatória desta story). Desenho final, não é mais proposta em discussão.

## Complexidade
**S** — 1 função nova (mesmo padrão de `carregarResumoRede`), wiring em 3 branches existentes do Passo 6 com cuidado explícito de concatenação, 1 ajuste de texto de prompt, 1 adição pequena no portal (dropdown).

## Prioridade
P2 — funcionalidade nova aprovada pelo sócio, sem urgência de incidente (não é bug).

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . → baseline atual 177 passed/0 failed/2 ignored + testes novos, 0 failed
  - deno check index.ts → não piora baseline atual (36 erros)
  - teste obrigatório de concatenação (AC5) → prova que serviços sobrevive quando o branch também escreve conteúdo próprio em contextRAG
  - inspeção manual do dropdown "Tipo" em cuca-portal/rag-global → confirma que a nova opção aparece e grava unidade_cuca:null (comportamento já existente do form, não deveria precisar mudar)
  - execute_sql (read-only) conferindo pg_get_functiondef('trigger_indexar_documento'::regproc) → confirma que 'servicos_rede' foi incluído na exceção de skip (AC9, achado @po)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que o bot Institucional tenha acesso a um documento único, sempre carregado, com os serviços comuns a todas as unidades CUCA + as exceções por unidade,
**para que** perguntas como "tem defensoria pública no CUCA?" (com ou sem unidade escolhida) sejam respondidas com dado real, sem precisar de nenhuma classificação de intenção nova nem duplicar a lista comum 5 vezes.

## Contexto e Problema

A investigação original (`INVESTIGACAO-RAG-Institucional-Por-Unidade-2026-07-20.md`) mapeou que `endereco`/`telefone`/`responsavel` já existem em `unidades_cuca` (tabela própria do portal), mas "serviços que a unidade oferece" não tinha campo nenhum. A 1ª versão da resposta de design propunha um campo estruturado (`servicos_extras`) em `unidades_cuca`, carregado só depois da unidade resolvida — mesmo gate que a ficha de endereço usaria.

**Essa 1ª versão falha num caso real, confirmado em código nesta sessão**: o sócio esclareceu que o padrão real é "quase tudo é igual entre as 5 unidades, com exceções pontuais que só somam" (nunca removem) — ex.: só o CUCA Barra tem Defensoria Pública. Uma pergunta como "tem defensoria pública no CUCA?" **sem nenhuma unidade escolhida** cai no branch `isAgenteProgramacao && perguntaGeralAtiva` (hoje `index.ts:1530`), que só carrega `carregarResumoRede()` (`index.ts:1082`) + busca vetorial de FAQ — **nunca tocaria** num campo em `unidades_cuca` (confirmei: zero referências a essa tabela em todo `motor-agente/index.ts`). Com o gate por unidade resolvida, essa pergunta ficaria sem resposta real.

**Design final, aprovado**: um único documento em `documentos_rag`, `tipo: "servicos_rede"`, `unidade_cuca: null`, com o padrão comum + as exceções já nomeando a unidade (texto livre, sem chunk/embedding — mesmo padrão de carregamento que `carregarResumoRede` já usa). Diferente da ficha de endereço (que só carregaria com unidade já resolvida), **este documento é carregado sempre que o agente for Institucional, com ou sem unidade conhecida** — é pequeno o bastante (algumas linhas) pra não valer a pena gatear atrás de nenhuma condição, e resolve as duas perguntas possíveis ("o que a unidade X oferece" e "qual unidade oferece X") sem nenhuma 5ª função de decisão.

**Achado técnico que vira condição obrigatória desta story** (verificação do @dev, não do design original): `contextRAG` começa `""` (`index.ts:1407`) e a **primeira escrita em cada um dos 3 branches que o agente Institucional realmente alcança usa atribuição (`=`), não concatenação (`+=`)**:
- Branch A — `temUnidadeDefinida && isAgenteProgramacao && precisaVisaoGeral` (`index.ts:1445`): primeira escrita em `index.ts:1472` (`contextRAG = "\n\n--- PROGRAMACAO MENSAL..."`), condicional a `if (conteudoPrograma)`.
- Branch B — `else if (temUnidadeDefinida && isAgenteProgramacao)` (`index.ts:1499`): primeira escrita em `index.ts:1514` OU `index.ts:1527` (2 caminhos mutuamente exclusivos dentro do mesmo branch, ambos `=`).
- Branch C — `else if (isAgenteProgramacao && perguntaGeralAtiva)` (`index.ts:1530`): primeira escrita em `index.ts:1556` (`if (blocosRede.length > 0) contextRAG = "\n\n" + ...`).

Se o documento de serviços for somado a `contextRAG` **antes** do `if/else` de forma ingênua (`contextRAG += ...` antes da cadeia), **qualquer um desses 3 branches sobrescreve o conteúdo silenciosamente na primeira escrita, sem erro nenhum**. Isso não invalida o design (ainda é simples), mas exige um dos dois ajustes abaixo — ver Escopo/AC.

> **Nota sobre o 4º branch (`else`, `index.ts:1557`)**: é o fallback genérico (Sofia/Ana/Julia, ou uma borda rara do próprio Institucional sem unidade nem `perguntaGeralAtiva`, que não acontece no tráfego real hoje — `unidade_cuca` do canal Institucional é sempre `'Geral'`, confirmado em `meta_phone_numbers`). Fora de escopo desta story (ver Escopo OUT) — não precisa do mesmo tratamento agora, mas fica documentado pra não ser esquecido se algum dia esse branch passar a ser alcançado por Institucional de verdade.

**Instrução de prompt que também precisa de ajuste** (mesmo achado já confirmado pela investigação original e revalidado agora): `index.ts:1605` (branch `trocouUnidade && trocaComPedidoEspecifico`) hoje diz literalmente "...responda DIRETAMENTE ao pedido especifico **usando os dados da programacao carregada acima**..." — precisa passar a mencionar os dois blocos possíveis (programação e serviços), senão o GPT tem o dado de serviços disponível mas a instrução empurra ele só pra programação.

## Escopo

### IN

**1. Documento e carregamento**
- Nova função `carregarServicosRede(supabase)`, mesmo padrão exato de `carregarResumoRede` (`index.ts:1082`): `documentos_rag.select("conteudo").eq("tipo", "servicos_rede").eq("ativo", true).order("created_at", {ascending:false}).limit(1).single()`, retorna `""` se não existir ainda (sem erro).
- Chamar essa função **uma vez**, antes da cadeia `if/else` do Passo 6, para `agente_tipo === 'Institucional'` (ver nota abaixo sobre `isAgenteProgramacao` vs. literal).
- **AC obrigatório de concatenação** (não opcional): o conteúdo de serviços precisa sobreviver às 3 escritas por atribuição mapeadas acima. Caminho recomendado: variável separada (`const contextServicos = ...`) somada explicitamente nas linhas de atribuição de `contextRAG` dos branches A, B e C (trocar cada `contextRAG = "..."` relevante por `contextRAG = contextServicos + "..."`, e o `+=` de A permanece `+=` normalmente). Alternativa aceitável: trocar o padrão de `=` para `+=` nessas mesmas linhas, mantendo `contextRAG` pré-carregado com o bloco de serviços antes do `if/else`. Qualquer uma das duas serve, desde que o teste do AC5 passe.

**2. Ajuste de instrução de prompt**
- `index.ts:1605` (branch `trocouUnidade && trocaComPedidoEspecifico`): ajustar o texto pra mencionar o bloco de serviços como fonte possível, não só "dados da programação". Confirmar o número de linha real no momento da implementação (a S-WM-50 já deslocou essa linha uma vez; qualquer commit novo pode deslocar de novo).

**3. Portal — tornar o documento editável (achado do @sm, não pedido explicitamente por Junior — sinalizado pra @po validar)**
- `cuca-portal/src/app/(dashboard)/configuracoes/rag-global/page.tsx:42`: adicionar `"Serviços da Rede"` (ou label equivalente, mapeando pro valor real `servicos_rede` gravado no banco) ao array `TIPOS`. **Justificativa**: sem isso, o documento só poderia ser criado/editado via SQL direto, contradizendo o próprio design aprovado ("editável pela rede quando precisar" / "reaproveita a tela RAG Global, nenhuma tela nova"). É uma mudança de 1 linha (array de strings), sem migration, sem lógica nova — a tela já grava `unidade_cuca: null` de forma hardcoded para qualquer tipo escolhido (`page.tsx:126`), então nenhuma mudança adicional é necessária pra esse documento especificamente gravar com `unidade_cuca: null`.
- **Não incluído**: preencher o conteúdo real do documento (lista de serviços de verdade) — isso é trabalho de conteúdo do sócio/rede, não de código (mesma lógica do item "responsável ainda é placeholder" já registrado como OUT). O @dev pode deixar o documento inexistente (função já trata "" como caso seguro) ou criar um registro vazio/placeholder textual explícito, à critério da implementação, mas sem inventar dado de serviço real.

**4. Migration obrigatória — achado da validação @po, não estava no desenho original (BLOQUEANTE, não opcional)**
- Existe um trigger ativo em produção, `tr_indexar_documento` (`AFTER INSERT OR UPDATE OF titulo, conteudo ON documentos_rag`, confirmado via `pg_trigger`), que dispara `processar-documento` (chunk + embedding real via OpenAI) pra **qualquer** insert/update de `titulo`/`conteudo`, **exceto** quando `tipo = 'resumo_rede'` — essa exceção foi adicionada especificamente pela migration `20260713200000_swm32_resumo_rede_skip_indexacao.sql` depois de um incidente confirmado em produção (resumo_rede sendo chunkeado/embeddado à toa, custo real de OpenAI + chunks mortos no índice, já que nenhum `p_tipos` de `buscar_chunks_similares` inclui esses tipos "carrega inteiro").
- **`servicos_rede` sofre exatamente do mesmo problema, e a Task 3 desta story (tornar o documento editável no portal) é o que ativa esse gatilho** — toda vez que a rede criar ou editar o documento de serviços pela tela do RAG Global, o trigger dispara automaticamente, gerando custo de embedding e chunks mortos, do mesmo jeito que aconteceu com `resumo_rede` antes da correção.
- **AC obrigatório**: nova migration idempotente estendendo `trigger_indexar_documento()` pra também pular `tipo = 'servicos_rede'` (`IF NEW.tipo IN ('resumo_rede', 'servicos_rede') THEN RETURN NEW; END IF;` ou equivalente) — aplicada diretamente via MCP em produção, junto com o resto da implementação (banco faz parte do ciclo do @dev, conforme `aiox-pipeline-enforcement.md`).
- **Fora de escopo** (pré-existente, não introduzido por esta story): o botão manual "Indexar" na tela do RAG Global chama `processar-documento` diretamente, sem checar `tipo` — bypassa o trigger corrigido acima. Isso já existe hoje pro próprio `resumo_rede` (um editor pode clicar "Indexar" nele por engano) e não é agravado por esta story — não corrigir aqui, só registrar.

**5. Nice-to-have, não bloqueante**
- Alerta de tamanho na tela do RAG Global (contador com limiar sugerido) — sugestão do @dev na verificação técnica, registrar como item de UI de baixo esforço, não é AC obrigatório.

### OUT
- Ficha de endereço/telefone/responsável por unidade (`carregarFichaUnidade`) — desenho já existe na investigação original, mas ainda não foi aprovado formalmente pelo sócio. Story separada, se/quando aprovado.
- Restrição de permissão de escrita em `unidades_cuca` (RLS hoje permite qualquer autenticado) — decisão de produto/segurança pendente, não desta story.
- Preenchimento dos nomes reais de `responsavel` (hoje placeholder "Gestor CUCA Barra" etc.) — trabalho de conteúdo, não de código, e nem é o campo que esta story toca.
- Qualquer mudança no canal Empregabilidade — confirmado (investigação original + verificação técnica) que Empregabilidade não passa por este `handler()` em nenhuma hipótese (roda em `worker/empregabilidade_engine.py`, zero referência cruzada a `motor-agente`).
- Qualquer mudança nos outros `agente_tipo` (Sofia/Ana/Julia) — o carregamento é exclusivo de `isAgenteProgramacao`/`Institucional`.
- Tratamento do 4º branch (`else`, `index.ts:1557`) — fora do alcance real do agente Institucional hoje (ver nota no Contexto).
- Consolidação das 4 funções de decisão de unidade (Plano 017) — não relacionado, não reabrir.
- Conteúdo real do documento de serviços (texto final com a lista verdadeira) — trabalho do sócio/rede.
- Deploy automático.

## Acceptance Criteria

1. **Given** um documento ativo em `documentos_rag` com `tipo: "servicos_rede"`, **when** `carregarServicosRede` é chamada, **then** retorna o `conteudo` desse documento; **given** nenhum documento desse tipo existe ainda, **when** chamada, **then** retorna `""` sem lançar erro (mesmo contrato de `carregarResumoRede`).
2. **Given** uma mensagem do agente Institucional **sem unidade escolhida** que cai no branch `perguntaGeralAtiva` (`index.ts:1530`), **when** processada, **then** o bloco de serviços aparece no prompt final — cobre exatamente o caso que motivou a correção de percurso ("tem defensoria pública no CUCA?").
3. **Given** uma mensagem do agente Institucional **com unidade já definida e `precisaVisaoGeral=true`** (branch A, `index.ts:1445`), **when** processada, **then** o bloco de serviços **e** o bloco de programação mensal aparecem juntos no prompt final — nenhum sobrescreve o outro.
4. **Given** uma mensagem do agente Institucional **com unidade já definida, em acompanhamento** (branch B, `index.ts:1499`, qualquer um dos 2 caminhos internos — atividade específica ou busca vetorial), **when** processada, **then** o bloco de serviços continua presente no prompt final junto com o conteúdo próprio do branch.
5. **AC obrigatório (não opcional)**: teste automatizado que força um cenário que cai em cada um dos 3 branches (A, B, C) **com** conteúdo de serviços disponível **e** conteúdo próprio do branch disponível, e confirma via asserção no prompt final enviado ao GPT que **ambos** os blocos estão presentes — prova direta de que a atribuição `=` não sobrescreve o pré-carregamento.
6. **Given** `agente_tipo` diferente de Institucional (Sofia/Ana/Julia) ou o canal Empregabilidade, **when** processado, **then** o documento de serviços **não** é carregado nem consultado (nenhuma chamada nova a `documentos_rag` com `tipo="servicos_rede"` fora do agente Institucional).
7. **Given** a instrução de `trocaComPedidoEspecifico` (`index.ts:1605` ou linha equivalente confirmada na implementação), **when** o bloco de serviços está presente no contexto, **then** o texto da instrução menciona explicitamente esse bloco como fonte possível, não só "dados da programação".
8. **Given** o array `TIPOS` da tela RAG Global, **when** inspecionado após a mudança, **then** inclui a nova opção mapeando pro valor `servicos_rede`, e criar/editar um documento com essa opção grava `unidade_cuca: null` (comportamento já existente do form, sem mudança adicional necessária).
9. **AC obrigatório, achado da validação @po**: **given** a migration desta story aplicada em produção, **when** um documento com `tipo='servicos_rede'` é inserido ou tem `titulo`/`conteudo` atualizado, **then** `trigger_indexar_documento()` **não** chama `processar-documento` pra esse documento (mesma exceção que já existe pra `resumo_rede`) — validar via `execute_sql` conferindo `pg_get_functiondef('trigger_indexar_documento'::regproc)` inclui `'servicos_rede'` na condição de skip, e/ou testando um insert real e confirmando ausência de linhas novas em `chunks_documentos` pra esse `documento_id`.
10. `deno test` → sem `failed` novo (baseline atual: 177 passed/0 failed/2 ignored) + testes novos desta story.
11. `deno check index.ts` não piora vs. baseline atual (36 erros).
12. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — `carregarServicosRede` + wiring nos 3 branches** (AC: 1, 2, 3, 4, 5, 6)
  - [x] Criar a função, mesmo padrão de `carregarResumoRede`.
  - [x] Confirmar no código atual (na hora de implementar) os números de linha exatos dos 3 branches e das escritas por atribuição — reconferidos, idênticos aos citados na story (nenhum commit novo desde a validação @po).
  - [x] Aplicar o fix de concatenação — caminho escolhido: `contextRAG = contextServicos;` no início de cada um dos 3 branches, com as escritas internas viradas de `=` pra `+=` (equivalente à alternativa B do Escopo, mais simples que introduzir uma 2ª variável em cada ponto de saída).
  - [x] Gatear a chamada em `isAgenteProgramacao` (decisão registrada abaixo, não literal `'Institucional'`).
  - [x] Teste obrigatório do AC5 (concatenação, force os 3 branches) — 2 testes dedicados (branch A e branch B) + a asserção do AC2 já cobre o branch C.
  - [x] Teste do AC2 (pergunta sem unidade, cenário que motivou a correção de percurso).
  - [x] Teste do AC6 (outros agentes não carregam o documento).
- [x] **Task 2 — Ajuste de instrução de prompt** (AC: 7)
  - [x] Localizar a linha atual (1641, deslocada de 1605 pelas mudanças da Task 1 — confirmado, não pelo commit anterior).
  - [x] Ajustar o texto pra mencionar os dois blocos possíveis.
  - [x] Teste de regressão: texto original ("responda DIRETAMENTE ao pedido especifico") continua presente, teste existente da S-WM-34/VAL-23 não quebrou.
- [x] **Task 3 — Portal: nova opção no dropdown** (AC: 8)
  - [x] Adicionar a opção em `TIPOS` (`rag-global/page.tsx:48` — deslocada de 42 pelo comentário adicionado).
  - [x] Documentado inline (comentário no código) que o valor exibido no dropdown será `servicos_rede` (técnico), não um rótulo em português — limitação conhecida, registrada, fora de escopo corrigir agora (exigiria separar valor/rótulo no componente Select). Inspeção manual completa (criar documento de teste) não executada nesta sessão — o comportamento de gravar `unidade_cuca: null` já é hardcoded no form (`page.tsx:126`, inalterado), não depende do valor escolhido em `TIPOS`.
- [x] **Task 4 — Migration: excluir `servicos_rede` do gatilho de indexação (BLOQUEANTE, achado @po)** (AC: 9)
  - [x] `[db-read]` Reconferida a definição atual de `trigger_indexar_documento()` via `execute_sql` antes de alterar — idêntica à documentada na validação @po.
  - [x] Migration idempotente criada: `supabase/migrations/20260720000000_swm51_servicos_rede_skip_indexacao.sql`.
  - [x] Aplicada via `apply_migration` (MCP) diretamente em produção (`svzkrkfzpiqcesloukgb`) — sucesso confirmado (`{"success":true}`).
  - [x] Validado com insert + update reais: criei um documento de teste (`tipo='servicos_rede'`), confirmei `chunks_documentos` com 0 linhas pra esse `documento_id` após INSERT e após UPDATE de `conteudo`, depois apaguei o registro de teste.
- [x] **Task 5 — Fechamento** (AC: 10, 11, 12)
  - [x] Suíte completa: 177 → **183 passed / 0 failed / 2 ignored** (+6 testes novos desta story).
  - [x] `deno check index.ts`: **36 erros**, idêntico ao baseline.
  - [x] `deno lint`: **7 problemas**, idêntico ao baseline.
  - [x] Mutation test próprio (antes de entregar ao @qa): reverti temporariamente a inicialização `contextRAG = contextServicos` do branch A e confirmei que o teste do AC3/AC5 falha exatamente como esperado — restaurado em seguida, suíte voltou a 183/0/2.
  - [x] Nenhum push/PR executado. A migration foi aplicada via MCP em produção (banco faz parte do ciclo do @dev, `aiox-pipeline-enforcement.md`) — não é "deploy" de App/EasyPanel/git.

## Dev Notes

- Base: `origin/main` pós-merge da S-WM-50 (commit `35cf85d`). Baseline confirmado nesta story: `deno test` → 177 passed/0 failed/2 ignored; `deno check` → 36 erros.
- **`agente_tipo === 'Institucional'` (literal) vs. `isAgenteProgramacao` (constante já existente, inclui `'Institucional' || 'maria'`)**: o pedido do Junior especifica literalmente "Institucional". `isAgenteProgramacao` já é a constante usada em todos os outros gates do Passo 6 (evita introduzir uma condição nova e ligeiramente divergente das já existentes) e `'maria'` hoje não tem nenhum número WhatsApp ativo (`meta_phone_numbers` só tem `Institucional` e `Empregabilidade` — confirmado na investigação original), então a diferença é um no-op no tráfego real de hoje. Recomendo usar `isAgenteProgramacao` por consistência com o resto do arquivo, mas registrar essa escolha explicitamente no Dev Agent Record — se o Junior quiser estritamente só `'Institucional'`, é uma troca de 1 condição, sem impacto em nenhum outro AC.
- **Números de linha citados nesta story são do estado do `origin/main` em 2026-07-20 (commit `35cf85d`)** — qualquer commit entre a criação desta story e a implementação desloca linhas subsequentes. Confirmar sempre no código real antes de editar, não confiar cegamente nas linhas aqui.
- O documento de serviços em si (linha 1, `carregarServicosRede`) não precisa de `unidade_cuca` no filtro da query — mesmo padrão de `carregarResumoRede`, que também não filtra por unidade (só existe 1 linha ativa desse tipo por vez, por design).
- **Correção da validação @po**: `documentos_rag.tipo` de fato não tem `CHECK constraint` (confirmado via `pg_constraint`) — nenhuma migration é necessária só por causa do valor novo em si. **Mas** existe uma migration obrigatória por outro motivo (ver Escopo IN item 4 / AC9): o trigger `tr_indexar_documento` precisa ser estendido pra também pular `servicos_rede`, senão todo save do documento no portal dispara chunk+embedding real à toa — mesmo incidente que já aconteceu com `resumo_rede` (`20260713200000_swm32_resumo_rede_skip_indexacao.sql`).

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente`.

## Dependências
- Nenhuma dependência técnica com a ficha de endereço/telefone (`carregarFichaUnidade`) — pode ser implementada antes, depois ou nunca, sem afetar esta story.
- Nenhuma dependência com o VAL-19/S-WM-50 (já mergeado) além de conviver no mesmo arquivo — sem sobreposição de código (confirmado na verificação técnica).

## Riscos
- Baixo, com 2 pontos de atenção explícitos, ambos virados AC obrigatório:
  1. Esquecer o fix de concatenação (AC5) faria o documento de serviços "funcionar às vezes" (só quando nenhum branch escrevesse conteúdo próprio) — bug silencioso, sem erro.
  2. Esquecer a migration do trigger (AC9, achado da validação @po) faria todo save do documento no portal disparar chunk+embedding real à toa (custo de OpenAI + chunks mortos no índice) — mesmo incidente já ocorrido com `resumo_rede` antes da correção `20260713200000_swm32_resumo_rede_skip_indexacao.sql`. Sem essa migration, a Task 3 (tornar o documento editável) reintroduz exatamente esse incidente pra um tipo novo.
- Crescimento do documento ao longo do tempo: sem teto técnico hoje em nenhum documento de `documentos_rag` (confirmado, tela RAG Global só mostra contador de caracteres, sem validação) — não é bloqueante agora (o pior caso real, `monthly_program`, usa ~54% do teto de TPM do Tier 1 com ~43.860 caracteres; um documento de serviços precisaria de ordem de grandeza semelhante pra competir por esse espaço, muito acima de "algumas exceções pontuais"). Item de UI nice-to-have registrado no Escopo, não bloqueante.
- Pré-existente, não agravado por esta story: o botão manual "Indexar" na tela do RAG Global chama `processar-documento` direto, sem checar `tipo` — bypassa a exceção do trigger. Já existe hoje pro `resumo_rede`; um editor pode clicar nele por engano em qualquer um dos dois. Não corrigir nesta story.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-20 | 0.1 | Story criada a partir do design aprovado (`RESPOSTA-servicos-institucional-2026-07-20.md`) e da verificação técnica do @dev (linha do gate corrigida, achado de atribuição `=`/`+=` virou AC obrigatório). Adicionada Task 3 (portal) por inferência do @sm — não pedida explicitamente, justificada no Escopo, para @po validar. Linhas de código confirmadas contra `origin/main` pós-S-WM-50 (commit `35cf85d`). | @sm River |
| 2026-07-20 | 0.2 | @po validate-story-draft: **GO condicional, correção já aplicada nesta mesma passada.** 9/10 pontos ok de cara (título objetivo, contexto completo com refs de código reconferidas de forma independente, AC testáveis, IN/OUT bem definidos, complexidade/prioridade justificadas, riscos documentados, alinhado ao design aprovado e à investigação original). 1 ponto exigiu correção **bloqueante** antes do GO: investiguei o trigger `tr_indexar_documento` (`pg_trigger`/`pg_get_functiondef`, produção) e confirmei que ele dispara `processar-documento` (chunk+embedding real via OpenAI) pra qualquer insert/update de `titulo`/`conteudo` em `documentos_rag`, **exceto** `tipo='resumo_rede'` — exceção adicionada por um incidente real já ocorrido (`20260713200000_swm32_resumo_rede_skip_indexacao.sql`). A Task 3 desta story (tornar `servicos_rede` editável no portal) reintroduziria exatamente esse incidente pra um tipo novo, sem uma migration equivalente — a story original não mencionava isso em nenhum lugar (nem Escopo, nem AC, nem Dev Notes — que inclusive afirmava incorretamente "nenhuma migration é necessária", correto só quanto ao `CHECK constraint` inexistente, não quanto ao trigger). Corrigido: novo item no Escopo IN (item 4), novo AC (9, renumerando os 3 seguintes), nova Task (4, banco), Dev Notes corrigidas, Riscos atualizados, `quality_gate_tools` com verificação read-only do trigger. Status Draft → Ready. | @po Pax |
| 2026-07-20 | 0.3 | Implementado: `carregarServicosRede` + wiring nos 3 branches com fix de concatenação (`contextRAG = contextServicos` no início de cada branch + escritas internas viradas `+=`), instrução de prompt ajustada, opção `servicos_rede` adicionada ao portal, migration do trigger criada/aplicada/validada em produção ANTES do commit. 6 testes novos (AC1-AC7). Suíte: 177→183 passed, 0 failed, 2 ignored. `deno check`/`deno lint` idênticos ao baseline. Mutation test próprio confirmou que o teste de concatenação não é tautológico. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Debug Log References

- Reconferi os números de linha da story contra o código atual antes de editar (Task 1) — todos idênticos aos citados (`carregarResumoRede:1082`, gate `1445`, instrução `1605`), nenhum commit novo desde a validação @po.
- **Decisão registrada (Dev Notes pedia isso explicitamente)**: usei `isAgenteProgramacao` (não o literal `agente_tipo === 'Institucional'`) pra gatear `carregarServicosRede` — consistência com todos os outros gates do Passo 6; `'maria'` sem tráfego real hoje, no-op confirmado.
- **Decisão de implementação do fix de concatenação**: entre as 2 alternativas do Escopo (variável separada + soma explícita OU trocar `=`→`+=` com `contextRAG` pré-carregado), escolhi uma combinação: `contextRAG = contextServicos;` como 1ª linha de cada branch (não uma soma cega antes do `if/else`, que sofreria do mesmo problema em sub-casos condicionais — ex.: branch A com `conteudoPrograma` vazio) + as escritas internas de cada branch viradas de `=` pra `+=`. Isso cobre inclusive os sub-casos onde o conteúdo próprio do branch acaba vazio (`if (conteudoPrograma)` falso, `blocosRede.length === 0`) — nesses casos `contextRAG` ainda fica igual a `contextServicos`, não `""`.
- Migration `20260720000000_swm51_servicos_rede_skip_indexacao.sql` aplicada via MCP em produção, validada com insert + update reais contra `documentos_rag`/`chunks_documentos` (0 chunks gerados em ambos os casos) — registro de teste apagado depois.
- Baseline ANTES: `deno test` 177 passed/0 failed/2 ignored; `deno check` 36 erros; `deno lint` 7 problemas.
- DEPOIS: `deno test` **183 passed/0 failed/2 ignored** (+6 testes novos); `deno check` **36 erros** (idêntico); `deno lint` **7 problemas** (idêntico).
- Mutation test próprio: revertida a inicialização `contextRAG = contextServicos` do branch A → teste do AC3/AC5 falhou exatamente como esperado → restaurado → suíte voltou a 183/0/2. Prova que o teste não é tautológico, antes de entregar ao @qa.

### Completion Notes List

- `carregarServicosRede` criada, mesmo padrão de `carregarResumoRede` — carrega o documento `tipo='servicos_rede'` inteiro, sem chunk/embedding, retorna `""` com segurança se ainda não existir.
- `contextServicos` carregado 1x no início do Passo 6 (gateado em `isAgenteProgramacao`), e injetado como base de `contextRAG` nos 3 branches relevantes (visão geral, acompanhamento, pergunta geral sem unidade) — o 4º branch (`else`, fora de escopo) não foi tocado.
- Instrução de `trocaComPedidoEspecifico` (agora linha 1641) ajustada pra mencionar o bloco de serviços, mantendo o texto original intacto (regressão coberta pelo teste já existente da S-WM-34/VAL-23).
- Portal: `"servicos_rede"` adicionado ao array `TIPOS` da tela RAG Global — comentário no código deixa explícito que o valor exibido no dropdown é o técnico (snake_case), não um rótulo em português, e por quê (mesmo precedente de `"FAQ"` já existente na lista).
- Migration aplicada e validada em produção ANTES do commit, conforme exigido — trigger `tr_indexar_documento` agora pula tanto `resumo_rede` quanto `servicos_rede`.
- Nenhum documento de conteúdo real foi criado — função trata ausência como caso seguro (`""`), preenchimento de conteúdo real é trabalho do sócio/rede (fora de escopo, conforme a story).
- Nenhum push/PR executado por @dev — commit local, aguardando @qa.

### File List

- `supabase/functions/motor-agente/index.ts`
- `supabase/functions/motor-agente/index.audit.test.ts`
- `supabase/migrations/20260720000000_swm51_servicos_rede_skip_indexacao.sql`
- `cuca-portal/src/app/(dashboard)/configuracoes/rag-global/page.tsx`
- `docs/stories/S-WM-51-RAG-Servicos-Institucionais-Por-Unidade.md`

## QA Results

### Review Date: 2026-07-20

### Reviewed By: @qa Quinn

### Gate Decision

**PASS** — implementação aprovada para seguir para @devops.

### Requirements Traceability

- AC1 (sem documento → `""` seguro): coberto por `S-WM-51 AC1` — validado, `deno test` isolado.
- AC2 (pergunta sem unidade → bloco aparece): coberto por `S-WM-51 AC2` — validado, e reutilizado como prova de concatenação do branch C (ver Verificação independente).
- AC3 (branch A, visão geral): coberto por `S-WM-51 AC3/AC5` — validado.
- AC4 (branch B, acompanhamento): coberto por `S-WM-51 AC4/AC5` — validado.
- AC5 (concatenação, obrigatório): coberto pelos 3 testes acima (um por branch) + **mutation test independente meu** nos branches B e C (o Dev só tinha mutado o A) — os 3 branches têm cobertura real comprovada, não só de forma.
- AC6 (outros agentes não carregam o documento): coberto por `S-WM-51 AC6` — validado; reconfirmei também que o gate `isAgenteProgramacao` (`index.ts:1424`) não foi alterado por esta story e que Empregabilidade tem zero referência cruzada a `motor-agente` (`grep` em `empregabilidade_engine.py`).
- AC7 (instrução de prompt menciona os 2 blocos): coberto por `S-WM-51 AC7` — validado, e confirmei que o texto original ("responda DIRETAMENTE ao pedido especifico") permanece intacto (regressão da S-WM-34/VAL-23 preservada).
- AC8 (dropdown do portal): validado por inspeção de código — `"servicos_rede"` presente em `TIPOS` (`rag-global/page.tsx:48`); `unidade_cuca: null` continua hardcoded no submit (`page.tsx:126`, não tocado por esta story).
- AC9 (migration do trigger, bloqueante): **validado de forma independente em produção**, não apenas conferindo o relato do @dev — ver seção abaixo.
- AC10/AC11 (deno test/check sem piora): validado, `deno test` 183 passed/0 failed/2 ignored, `deno check` 36 erros — isolei a suíte eu mesma, não reaproveitei números do Dev Agent Record.
- AC12 (sem deploy): confirmado — branch local não pushada, 1 commit à frente de `origin/main`.

### Verificação independente (pedidos específicos do Junior, todos executados por mim, não conferidos de segunda mão)

1. **Migration do trigger — reproduzida do zero, mais abrangente que o teste do Dev.** Reli `pg_get_functiondef('trigger_indexar_documento')` direto em produção (confirmei `IN ('resumo_rede', 'servicos_rede')`), inseri meu próprio documento de teste (`tipo='servicos_rede'`), e testei **3 cenários** (o Dev só testou 2): 0 chunks em `chunks_documentos` após INSERT, após UPDATE de `conteudo`, **e após UPDATE de `titulo`** (o trigger dispara em `UPDATE OF titulo, conteudo` — testar só `conteudo` deixava metade da condição do gatilho sem cobertura). Registro de teste apagado depois.
2. **Mutation test — reproduzido em branches diferentes do que o Dev testou.** O Dev mutou o branch A (visão geral); eu mutei o branch C (`perguntaGeralAtiva`) e o branch B (acompanhamento) independentemente, removendo a inicialização `contextRAG = contextServicos` de cada um. Os testes `S-WM-51 AC2` (branch C) e `S-WM-51 AC4/AC5` (branch B) falharam exatamente como esperado nos dois casos — restaurei o código original em seguida, suíte voltou a 183/0/2 confirmado. Com o teste do próprio Dev (branch A), **os 3 branches têm mutation test confirmado**, não só 1.
3. **Sobreposição com Frente C (S-WM-35) e VAL-19 (S-WM-50)**: conferido via diff completo do commit — `decidirConversaEngajada` (S-WM-50) tem **zero** ocorrências no diff desta story (função intocada, região de código completamente separada). Para a Frente C (`buscarAtividadeDeterministica`/`buscarAtividadeEspecifica`), confirmei a ordem exata no código atual: em ambos os branches A e B, a chamada da Frente C ou já vinha depois de `contextRAG = contextServicos` (branch A, linha 1501 antes de 1514) ou seu resultado fica num `const` local computado antes, sem tocar `contextRAG` até a atribuição/soma já corrigida (branch B) — sem race, sem sobrescrita, sem necessidade de mudança na Frente C.
4. **Gate `isAgenteProgramacao`**: confirmei que a condição (`index.ts:1424`) não foi alterada por esta story — mesma constante que já gateava tudo no Passo 6. Rodei o teste `S-WM-51 AC6` isolado (agente `sofia`) e confirmei zero chamada a `documentos_rag`. Confirmei também que Empregabilidade tem zero referência cruzada a `motor-agente` no worker Python — não é uma escolha desta story, é um limite estrutural (motor separado).
5. **Baseline isolada por mim**: `deno test` (183/0/2), `deno check` (36 erros, `grep` confirmando nenhum menciona `contextServicos`/`carregarServicosRede`), `deno lint` (7 problemas) — todos rodados diretamente, não copiados do relato do Dev.

### Verificação adicional (além do pedido, achado durante a revisão)

- Rodei `eslint` no arquivo do portal alterado (`rag-global/page.tsx`) — 2 erros + 1 warning (`no-explicit-any` em 2 pontos, `exhaustive-deps` no `useEffect`). Comparei contra a versão do arquivo **antes** desta story (`git show 35cf85d:...`) — os mesmos 3 problemas já existiam, só as linhas mudaram (comentário novo deslocou tudo). **Não é regressão desta story**, é baseline pré-existente do arquivo.

### Risk Assessment

- Risco funcional: baixo. Mudança aditiva num arquivo já bem coberto por suíte; os 3 pontos de escrita de `contextRAG` mais sensíveis (onde o bug de sobrescrita silenciosa poderia se esconder) têm mutation test confirmado, não só teste verde.
- Risco de regressão cruzada: baixo, confirmado por diff completo — sem sobreposição de código com S-WM-35/S-WM-50, apesar dos 3 tocarem a mesma região do arquivo em sessões próximas.
- Segurança/custo: o achado mais crítico da story (trigger de indexação) foi verificado 2x de forma independente (Dev e QA, cada um com seu próprio insert/update de teste) — risco de repetir o incidente do `resumo_rede` está coberto.
- Banco/produção: migration aplicada e validada (2x, por 2 pessoas diferentes) antes deste commit. Sem `CHECK constraint`/schema alterado além da função do trigger.
- Escopo (Sofia/Ana/Julia/Empregabilidade): confirmado que nenhum desses recebe o documento de serviços, nem por engano.

### Evidence

- `pg_get_functiondef('trigger_indexar_documento'::regproc)` → `IN ('resumo_rede', 'servicos_rede')` confirmado em produção.
- Insert + 2 updates de teste próprios (`documentos_rag`, `tipo='servicos_rede'`) → 0 linhas em `chunks_documentos` nos 3 casos; registro apagado depois.
- Mutation test próprio nos branches B e C → 2 testes falham como esperado, restaurado, suíte volta a 183/0/2.
- `deno test --no-check --allow-env --allow-read --allow-net .` → 183 passed / 0 failed / 2 ignored.
- `deno check index.ts` → 36 erros, idêntico ao baseline; `grep` confirma nenhum erro novo relacionado ao código desta story.
- `deno lint` → 7 problemas, idêntico ao baseline.
- `eslint` no arquivo do portal → 3 problemas, idênticos ao baseline (comparado antes/depois via `git show`).
- `git log origin/main..HEAD` → 1 commit local, sem push.

### Notes

- Não há bloqueio para PR.
- **Deploy tem 2 alvos nesta story** (sinalizar pro @devops): `supabase/functions/motor-agente/index.ts` exige redeploy da Edge Function `motor-agente` (mesmo fluxo já usado nas stories anteriores); `cuca-portal/.../rag-global/page.tsx` exige redeploy do serviço **portal** no EasyPanel (frontend Next.js) — os dois precisam ser promovidos, não só um.
- A migration do trigger já foi aplicada em produção pelo @dev (e revalidada por mim) — não é uma ação pendente pro @devops, já está em produção antes mesmo do merge do código (mudança de banco, ciclo próprio do @dev conforme `aiox-pipeline-enforcement.md`).
