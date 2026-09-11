# SQS-44 — Criação Interna da Programação Mensal

**Status:** Ready for Review  
**Epic:** Programação Mensal  
**Prioridade:** Alta  
**Estimativa:** 5–8 sessões  
**Autor:** Dex (@dev) via análise de RAG  
**Data:** 2026-04-16  

---

## Story

**Como** membro da junta de criação da programação da Rede CUCA,  
**Quero** criar e editar a programação mensal diretamente no portal, guiado por formulários com máscaras e validações por categoria,  
**Para que** os dados fiquem sempre no formato correto, eliminando os erros de digitação, colunas invertidas e campos livres que corrompem o RAG e a visualização.

---

## Contexto & Motivação

Hoje a programação mensal entra via upload de planilhas Excel criadas manualmente por cada unidade. A análise dos dados reais do banco revelou erros graves e sistemáticos:

- **ESPORTES:** campos `sexo`, `vagas`, `faixa_etaria` e `dias_semana` frequentemente invertidos entre unidades
- **DIA A DIA / ESPECIAIS:** campo `hora_fim` preenchido com texto de local ("campo de areia", "anfiteatro - cucaroots")
- **CURSOS:** período sem estrutura ("07/04/2026 30/04/2026 Terça e Quinta" — tudo num campo texto livre), carga horária com e sem "h"
- **TODOS:** capitalização inconsistente, datas com dupla barra "22//04", horários em 10+ formatos diferentes

O código atual tenta corrigir esses erros via gambiarras (mapeamento dinâmico de headers, regex de normalização, parsers de horário), mas os dados corruptos ainda chegam ao banco e comprometem o RAG e a visualização.

A solução é criar um **modal de criação interna guiada** que garante o formato correto na entrada, coexistindo com o upload de planilha para quem já tem arquivos prontos.

---

## Acceptance Criteria

### AC-1: Modal de Criação da Programação
- [ ] Botão "Criar Programação Manual" na página `/programacao` (ao lado do "Atualizar Programação")
- [ ] Modal multi-step: (1) Cabeçalho da Campanha → (2) Adicionar atividades → (3) Revisão/Finalização
- [ ] Step 1 — Cabeçalho: campos `Unidade CUCA` (dropdown), `Mês` (dropdown), `Ano` (ano corrente pré-preenchido)
- [ ] Step 2 — Atividades: seletor de categoria abre formulário específico
- [ ] Cada atividade adicionada aparece em lista editável dentro do modal
- [ ] Step 3 — Revisão: tabela resumo com contagem por categoria + botão "Salvar como Rascunho"

### AC-2: Formulário CURSOS
- [ ] `Título do Curso` — campo texto, obrigatório, max 100 chars
- [ ] `Educador` — campo texto, obrigatório
- [ ] `Vagas` — campo número, obrigatório, min 1
- [ ] `Carga Horária (horas)` — campo número (apenas número inteiro, sem "h"), obrigatório
- [ ] `Requisitos` — campo texto (ex: "15 a 29 anos"), obrigatório
- [ ] `Data de Início` — date picker, obrigatório
- [ ] `Data de Fim` — date picker, obrigatório, >= data início
- [ ] `Dias da Semana` — multi-select: Segunda / Terça / Quarta / Quinta / Sexta / Sábado / Domingo
- [ ] `Horário Início` — time picker com máscara HH:MM, obrigatório
- [ ] `Horário Fim` — time picker com máscara HH:MM, obrigatório
- [ ] `Ementa` — textarea, obrigatório
- [ ] O campo `periodo` no metadata é gerado automaticamente: `"{data_inicio} {data_fim} {dias_semana}"` no formato consistente
- [ ] O campo `horario` no metadata é gerado automaticamente: `"HH:MM às HH:MM"`

### AC-3: Formulário ESPORTES
- [ ] `Modalidade` — campo texto, obrigatório, max 100 chars (ex: "Natação", "Futsal")
- [ ] `Professor` — campo texto, obrigatório
- [ ] `Turma` — campo texto, obrigatório (ex: "Turma 01") — padronizado com prefixo "Turma"
- [ ] `Vagas` — campo número, obrigatório, min 1
- [ ] `Sexo` — dropdown: Misto / Masculino / Feminino — obrigatório
- [ ] `Faixa Etária De` — campo número (idade), obrigatório (ex: 15)
- [ ] `Faixa Etária Até` — campo número (idade), obrigatório (ex: 29), >= De
- [ ] `Dias da Semana` — multi-select: Segunda / Terça / Quarta / Quinta / Sexta / Sábado / Domingo
- [ ] `Horário Início` — time picker com máscara HH:MM, obrigatório
- [ ] `Horário Fim` — time picker com máscara HH:MM, obrigatório
- [ ] O campo `faixa_etaria` no metadata é gerado como `"{De} a {Até} anos"`
- [ ] O campo `horario` no metadata é gerado como `"HH:MM às HH:MM"`
- [ ] O campo `dias_semana` no metadata é gerado em formato padrão ex: "Ter e Qui"

### AC-4: Formulário DIA A DIA / ESPECIAIS
- [ ] `Título da Atividade` — campo texto, obrigatório, max 100 chars
- [ ] `Sessão/Eixo` — campo texto (ex: "DPDH", "Empregabilidade"), obrigatório
- [ ] `Data do Evento` — date picker, obrigatório (salva em `data_atividade` e `meta.data_real` formatado "DD/MM")
- [ ] `Dia da Semana` — preenchido automaticamente a partir da data selecionada (ex: "Sexta-feira")
- [ ] `Horário Início` — time picker com máscara HH:MM, obrigatório
- [ ] `Horário Fim` — time picker com máscara HH:MM, obrigatório
- [ ] `Local` — campo texto, obrigatório — salva em `local` e `meta.local` (NUNCA em hora_fim)
- [ ] `Descrição da Atividade` — campo texto curto, obrigatório (`meta.atividade`)
- [ ] `Informações/Objetivo` — textarea opcional (`meta.informacoes`)
- [ ] Seletor de categoria: "Dia a Dia" ou "Especiais" (ambos usam mesmo formulário)

### AC-5: Gestão da Lista de Atividades
- [ ] Cada atividade adicionada aparece como card na lista com: categoria, título, horário
- [ ] Botão "Editar" no card abre o formulário preenchido para aquela atividade
- [ ] Botão "Remover" no card remove da lista (com confirmação)
- [ ] Contador de atividades por categoria visível na lista
- [ ] Validação: não permite salvar campanha com 0 atividades

### AC-6: Salvar, Editar e Aprovação
- [ ] Ao clicar "Salvar como Rascunho" → chama `POST /api/programacao/importar` com `status: "rascunho"`
- [ ] Campanhas criadas pelo modal aparecem na listagem igual às importadas via planilha
- [ ] Campanha em `rascunho` tem botão "Abrir para Edição" que permite adicionar/remover/editar atividades
- [ ] Campanha em `rascunho` tem botão "Finalizar Programação" → muda status para `pendente`
- [ ] Fluxo de aprovação existente se mantém: `pendente` → `aprovado` (botão já existente na página `/mensal/[id]`)

### AC-8: Identidade da Programação — Mês como Chave Primária ⭐ NOVO
- [ ] O Step 1 do modal (Cabeçalho) deve destacar visualmente que a combinação `Unidade + Mês + Ano` é a **identidade única** da programação
- [ ] Ao selecionar Unidade + Mês + Ano, o sistema verifica via Supabase se já existe campanha para essa combinação
- [ ] Se já existe: exibir alerta "Já existe uma programação para [Unidade] em [Mês/Ano] com status [X]. Deseja editar a existente?" com botão de redirecionamento
- [ ] O Step 1 deve ter seletor de `Mês` (dropdown jan–dez) e campo `Ano` (número, pré-preenchido com ano corrente) com destaque visual claro — são os campos mais importantes do formulário
- [ ] O título da campanha é gerado automaticamente: `"Programação [Unidade] — [Mês] [Ano]"` (não requer input do usuário)

### AC-9: RAG do Mês — Indexação Somente após Aprovação ⭐ NOVO
- [ ] Campanhas com status `rascunho` ou `pendente` **NÃO** são disponibilizadas ao chatbot/automação (RAG)
- [ ] Apenas campanhas com status `aprovado` entram no contexto do RAG mensal
- [ ] O campo `status` na tabela `campanhas_mensais` é o gate: o worker/RAG filtra `status = 'aprovado'` ao montar o contexto
- [ ] A automação (chatbot Sofia/motor) **NÃO** informa programação de meses anteriores ao mês corrente
- [ ] Caso lead pergunte sobre mês anterior: resposta padrão informando que a informação não está disponível e encaminhamento para transbordo humano
- [ ] A query de RAG deve sempre filtrar `mes = mes_atual AND ano = ano_atual AND status = 'aprovado'`

### AC-10: Divulgação — Disparo Somente com Todas as Unidades Aprovadas ⭐ NOVO
- [ ] O botão "Disparar Aviso Global" em `/divulgacao` fica **habilitado somente quando TODAS as unidades CUCA do mês selecionado tiverem status `aprovado`**
- [ ] Regra atual (incorreta): `aprovadas > 0 && !!instanciaDisp` — **alterar para**: `aprovadas === unidadesCuca.length && !!instanciaDisp`
- [ ] Enquanto nem todas estiverem aprovadas: botão desabilitado com tooltip mostrando `"X unidades ainda aguardam aprovação: [lista de unidades pendentes]"`
- [ ] O painel de status por unidade em `/divulgacao` deve mostrar claramente quais unidades ainda estão como `sem_planilha` ou `pendente`
- [ ] Exceção configurável: se houver unidades sem programação prevista para o mês (ex: unidade em reforma), permitir marcação de "unidade ausente" para que não bloqueie o disparo
- [ ] O texto informativo abaixo do botão deve exibir: `"X/Y unidades aprovadas — aguardando [lista]"` quando incompleto

### AC-7: Exportação para Gráfica
- [ ] Na página `/programacao/mensal/[id]`, botão "Exportar para Gráfica (.xlsx)"
- [ ] Gera arquivo XLSX com múltiplas abas, uma por categoria: `CURSOS - {MÊS}`, `ESPORTES - {MÊS}`, `DIA A DIA - {MÊS}`, `ESPECIAIS - {MÊS}`
- [ ] Cada aba com estrutura idêntica à planilha original (linha 1: título visual, linha 2: headers, linha 3+: dados)
- [ ] Headers e dados exatos por aba:
  - **CURSOS:** `#` | `Curso` | `Carga Horária` | `Vagas` | `Ementa` | `Requisitos` | `Período` | `Horário` | `Educador`
  - **ESPORTES:** `#` | `Modalidade` | `Professor` | `Turma` | `Faixa Etária` | `Sexo` | `Vagas` | `Dias` | `Horário`
  - **DIA A DIA / ESPECIAIS:** `#` | `Sessão` | `Data` | `Dia da Semana` | `Atividade` | `Horário Início` | `Horário Fim` | `Local` | `Informações`
- [ ] Abas sem atividades são omitidas do arquivo
- [ ] Nome do arquivo: `Programacao_{UnidadeCuca}_{Mes}_{Ano}.xlsx`

---

## Dev Notes

### Arquivos relevantes existentes
- `cuca-portal/src/components/programacao/import-planilha-modal.tsx` — modal de upload (referência de padrão visual e lógica)
- `cuca-portal/src/components/programacao/unified-program-modal.tsx` — modal de evento pontual (referência de multi-step)
- `cuca-portal/src/app/(dashboard)/programacao/page.tsx` — página principal (onde adicionar botão novo)
- `cuca-portal/src/app/(dashboard)/programacao/mensal/[id]/page.tsx` — página de detalhes (onde adicionar botão exportar + Finalizar/Editar)
- `cuca-portal/src/app/api/programacao/importar/route.ts` — API de insert (reutilizar diretamente)
- `cuca-portal/src/app/api/programacao/excluir/route.ts` — API de exclusão

### Schema do banco (confirmado)
```
campanhas_mensais: id, mes, ano, titulo, unidade_cuca, total_atividades, status, created_by, created_at
atividades_mensais: id, campanha_id, unidade_cuca, titulo, descricao, local, data_atividade, hora_inicio, hora_fim, categoria, metadata (JSONB)
```

### Status flow
```
rascunho → pendente → aprovado
```
- Modal salva como `rascunho` (novo) ou permite reabrir para edição
- "Finalizar Programação" muda para `pendente`  
- "Aprovar Programação" (já existe) muda para `aprovado`

### Campos metadata por categoria (formato canônico a gerar)
```typescript
// CURSOS
{ ementa, educador, vagas: string, carga_horaria: string, periodo: "DD/MM/YYYY DD/MM/YYYY Dia e Dia", horario: "HH:MM às HH:MM", requisitos }

// ESPORTES
{ professor, turma: "Turma XX", faixa_etaria: "XX a XX anos", sexo: "Misto"|"Masculino"|"Feminino", vagas: string, dias_semana: "Ter e Qui", horario: "HH:MM às HH:MM" }

// DIA A DIA / ESPECIAIS
{ sessao, data_real: "DD/MM", dia_semana: "Sexta-feira", atividade, hora_inicio: "HH:MM", hora_fim: "HH:MM", local, informacoes }
```

### Exportação XLSX
- Usar biblioteca `xlsx` (já instalada no portal)
- Padrão de abas: `"${CATEGORIA} - ${MÊS_EM_MAIÚSCULAS}"` ex: `"CURSOS - ABRIL"`
- Linha 1: mesclada com título visual (ex: "CURSOS CUCA BARRA — ABRIL 2026")
- Linha 2: headers em negrito
- Linha 3+: dados

### Novo componente a criar
- `cuca-portal/src/components/programacao/criar-programacao-modal.tsx` — modal principal de criação
- Sub-componentes internos (não arquivos separados): `CursosForm`, `EsportesForm`, `DiaDiaForm`

### API nova a criar
- `cuca-portal/src/app/api/programacao/reabrir/route.ts` — PATCH para mudar status rascunho/pendente
- Ou estender a rota existente de excluir para um `PATCH /api/programacao/status`

---

## Tasks

### T1 — Componente `criar-programacao-modal.tsx`
- [x] T1.1 — Estrutura do modal multi-step com navegação (Step 1: Cabeçalho, Step 2: Atividades, Step 3: Revisão)
- [x] T1.2 — Step 1: Form de cabeçalho (unidade, mês, ano) com validação
- [x] T1.3 — Step 2: Seletor de categoria + renderização do form correto
- [x] T1.4 — Formulário CURSOS com todos os campos, máscaras e validação
- [x] T1.5 — Formulário ESPORTES com dropdowns, time pickers e geração automática de campos derivados
- [x] T1.6 — Formulário DIA A DIA / ESPECIAIS com date picker e preenchimento automático do dia da semana
- [x] T1.7 — Lista de atividades com cards editáveis/removíveis e contador por categoria
- [x] T1.8 — Step 3: Revisão com tabela resumo
- [x] T1.9 — Submit: chamar `POST /api/programacao/importar` com `status: "rascunho"`

### T2 — Integração na página principal
- [x] T2.1 — Adicionar botão "Criar Programação" na `programacao/page.tsx` ao lado do "Atualizar Programação"
- [x] T2.2 — Controle de permissão: mesmo `hasPermission("programacao_mensal", "create")` do botão existente

### T3 — Página de detalhes `/mensal/[id]`
- [x] T3.1 — Botão "Finalizar Programação" para campanhas em `rascunho` → muda para `pendente`
- [x] T3.2 — Botão "Reabrir para Edição" para campanhas em `pendente` → volta para `rascunho`
- [x] T3.3 — Botão "Exportar para Gráfica (.xlsx)" em campanhas aprovadas/pendentes
- [x] T3.4 — Função `handleExportarXLSX` que gera o arquivo com abas por categoria

### T4 — API de status
- [x] T4.1 — `PATCH /api/programacao/status` — altera status de uma campanha (rascunho ↔ pendente)
- [x] T4.2 — Validação de permissão server-side

### T5 — Edição de programação existente
- [ ] T5.1 — Ao "Reabrir para Edição", carregar atividades existentes no modal de criação (modo edição)
- [ ] T5.2 — Em modo edição: permitir adicionar novas atividades e remover existentes
- [ ] T5.3 — Submit em modo edição: apagar atividades antigas e reinserir as novas (upsert via API existente)
> ⚠️ T5 pendente: requer prop `campanhaId` no `CriarProgramacaoModal` + fetch das atividades existentes ao abrir. Funcionalidade adiada — Reabrir abre detalhes da campanha (status rascunho) mas não pré-carrega o modal com atividades antigas nesta entrega.

### T6 — Identidade da Programação por Mês ⭐ NOVO (AC-8)
- [x] T6.1 — Step 1 do modal: bloco destacado com borda primária para Mês + Ano como campos principais
- [x] T6.2 — Verificação de duplicata ao avançar Step 1: query `campanhas_mensais` por `unidade_cuca + mes + ano`; alerta no Step 2 se existir
- [x] T6.3 — Geração automática do `titulo`: `"Programação {Unidade} — {NomeMes} {Ano}"` sem campo manual
- [x] T6.4 — Badge com mês/unidade em tempo real no header do modal a partir do Step 2

### T7 — Gate de RAG por Status e Mês ⭐ NOVO (AC-9)
- [x] T7.1 — Auditado: trigger `trigger_indexar_campanha_mensal` já implementa gate por status — `ativo=true` somente quando `status='aprovado'`
- [x] T7.2 — Auditado: trigger desativa meses anteriores (`ativo=false`) na aprovação; motor-agente filtra `ativo=true` — gate funcional
- [x] T7.3 — Regra adicionada no `prompt_sistema` do agente Institucional na tabela `prompts_agentes` (Supabase): perguntas sobre meses anteriores → resposta padrão + `[[HANDOVER]]` obrigatório
- [x] T7.4 — Fix crítico: `criar-programacao-modal.tsx` agora gera `descricao` no formato canônico idêntico ao `import-planilha-modal` — trigger usa esse campo para montar o conteúdo do RAG (commit `792fd8a`)
> ✅ T7 concluído via configuração de banco (sem deploy de worker). Bug crítico de `descricao` corrigido antes que chegasse a produção.

### T8 — Divulgação: Disparo Bloqueado até Todas Aprovadas ⭐ NOVO (AC-10)
- [x] T8.1 — Em `/divulgacao/page.tsx`: condição alterada de `aprovadas > 0` para `aprovadas === unidadesCuca.length`
- [x] T8.2 — Tooltip no botão desabilitado listando unidades pendentes (title + texto abaixo do botão)
- [x] T8.3 — Texto `"{aprovadas}/{unidadesCuca.length} unidades aprovadas"` já existia — gate agora consistente
- [ ] T8.4 — Campo "unidade ausente no mês" para exceção — débito técnico registrado

---

## File List

### Arquivos Criados
- `cuca-portal/src/components/programacao/criar-programacao-modal.tsx` — modal principal multi-step (T1, T6)
- `cuca-portal/src/app/api/programacao/status/route.ts` — PATCH API de status (T4)

### Arquivos Modificados
- `cuca-portal/src/app/(dashboard)/programacao/page.tsx` — botão "Criar Programação" + import + modal (T2)
- `cuca-portal/src/app/(dashboard)/programacao/mensal/[id]/page.tsx` — botões Finalizar/Reabrir/Exportar + funções (T3)
- `cuca-portal/src/app/(dashboard)/divulgacao/page.tsx` — gate podeDiparar + tooltip unidades (T8)

---

## Dev Agent Record

### Agent Model Used
Claude Sonnet 4.6

### Debug Log
*Vazio*

### Completion Notes
*Vazio*

### Change Log
- 2026-04-16: Story criada via análise dos dados reais do banco + código existente
- 2026-04-16: Replanejamento @dev — adicionados AC-8, AC-9, AC-10 e Tasks T6, T7, T8 após análise do código de Programação Mensal e Divulgação (solicitação do usuário via chat)
- 2026-04-16: Implementação @dev — T1-T4, T6, T8 concluídos; T5 mantido (fluxo planilha inalterado para testes produção Abril/2026); T7 concluído via auditoria de trigger + fix descricao RAG + regra transbordo no prompt_sistema
- 2026-04-16: Status → Ready for Review. Push: commits 6838c93 e 792fd8a em main. Redeploy: portal (frontend)
