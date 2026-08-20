# S-AE-13 — Cadastro de Leads via Upload de Planilha

## Status
Ready

## Story
**Como** responsável pela Academia Enem,
**quero** subir uma planilha (Excel/CSV) com nome e telefone dos jovens participantes,
**para que** o sistema cadastre automaticamente só os leads novos, sem eu precisar digitar um por um nem verificar manualmente quem já existe.

## Contexto
Novo requisito (decisão do Junior, 2026-08-20). Analisado o arquivo de exemplo (`docs/envio-enem-pontual/jovens-enem-ajust01.csv`, 7.950 linhas): é uma planilha **já organizada**, com exatamente duas colunas (`nome`, `telefone`), confirmado pelo Junior que **sempre** chega nesse formato — nunca como foto/scan. **Decisão de design (proposta pelo @sm, não a ideia original do Junior de usar OCR):** não usar OCR nem IA para isso — o `/developer/triage` existente serve para currículos em PDF (texto não-estruturado), problema diferente. Aqui basta um leitor direto de planilha (CSV/XLSX), determinístico, sem custo de IA e sem risco de erro de leitura.

## Escopo
### IN
- Tela de upload dentro do menu Academia Enem (rota protegida por `ae_leads_upload:create`), aceitando `.csv` e `.xlsx`.
- Leitor de planilha: extrai as colunas `nome`/`telefone` (aceitar variação de nome de coluna/maiúsculas, mas exigir as duas colunas presentes).
- Normalização de telefone (mesmo padrão de normalização já usado no cadastro de leads existente do sistema — não inventar um novo formato).
- **Dedup determinístico:** para cada linha, comparar o telefone normalizado com os já existentes na tabela `leads`. Se já existe, ignora (não duplica, não sobrescreve). Se não existe, cadastra.
- Leads novos cadastrados com a categoria/tag "Academia Enem" (`categorias_interesse`, já existe no banco).
- Relatório de resultado do upload: quantas linhas na planilha, quantos já existiam (ignorados), quantos novos cadastrados, quantas linhas com erro (ex.: telefone inválido/vazio).

### OUT
- OCR ou leitura de imagem/PDF escaneado — confirmado pelo Junior que não é necessário; se algum dia for preciso, é uma story separada.
- Edição manual de leads já cadastrados a partir da planilha (só cadastra os novos, não atualiza os existentes).

## Critérios de Aceite (Given/When/Then)
1. **Given** uma planilha com 7.950 linhas (nome, telefone), **when** o responsável faz upload, **then** o sistema lê as duas colunas sem precisar de IA/OCR.
2. **Given** uma linha cujo telefone já existe em `leads`, **then** essa linha é ignorada (não duplica).
3. **Given** uma linha cujo telefone é novo, **then** um lead é cadastrado com a tag "Academia Enem".
4. **Given** o upload concluído, **then** o responsável vê um resumo: total de linhas, quantos ignorados (já existiam), quantos novos, quantos com erro.
5. **Given** uma linha com telefone vazio ou claramente inválido, **then** ela entra no contador de erro e não derruba o processamento do restante da planilha.
6. **Given** um usuário sem `ae_leads_upload:create`, **then** a tela/rota fica bloqueada.
7. **Given** um arquivo que não é `.csv`/`.xlsx` ou não tem as colunas esperadas, **then** o sistema rejeita com mensagem clara, sem tentar adivinhar.

## Dev Notes — análise de impacto (item por item)
1. **Toca:** tabela `leads` (compartilhada com todo o sistema — Empregabilidade, Institucional, etc. também cadastram/leem leads).
   **Depende disso hoje:** telas de leads, disparo, filtros de todos os módulos.
   **Impacto real:** o `INSERT` de leads novos é o mesmo caminho já usado por qualquer outro cadastro de lead no sistema — não é um caminho de escrita novo, só uma origem nova (upload em lote em vez de formulário individual ou webhook). Não deveria ter efeito nos outros módulos, desde que reaproveite exatamente a mesma função/validação de cadastro de lead já existente (não reimplementar um `INSERT` paralelo).
   **De-risk concreto:** antes de implementar, verificar se `leads.telefone` tem índice único/constraint — se não tiver, o dedup desta story precisa ser feito por comparação explícita (`SELECT` antes do `INSERT`), não por `ON CONFLICT`; confirmar isso evita tanto duplicar quanto falhar silenciosamente.
2. **Toca:** categoria "Academia Enem" em `categorias_interesse` — já existe (criada na migração de banco da Meta direta).
   **Depende disso hoje:** telas de filtro de leads por categoria (S-AE-08, e potencialmente outras).
   **Impacto real:** nenhum — é a mesma categoria já usada pelo filtro S-AE-08, só ganhando mais leads marcados.

## Tasks
- [ ] Tela de upload (rota `ae_leads_upload:create`).
- [ ] Leitor de CSV/XLSX (bibliotecas padrão de parsing, sem IA).
- [ ] Normalização de telefone (reaproveitar função já existente no projeto).
- [ ] Verificar constraint/índice único de `leads.telefone` (de-risk acima) antes de implementar o dedup.
- [ ] Dedup + cadastro dos novos com tag "Academia Enem".
- [ ] Relatório de resultado do upload.

## Dependências
Depende de **S-AE-00** (fundação/menu) e **S-AE-01** (RBAC — novo recurso `ae_leads_upload`). Alimenta o público de disparo da **S-AE-09**.

## Quality Gate
- Tipo: backend + front (upload). Agentes: @qa. CodeRabbit: foco no dedup (nunca duplicar/nunca sobrescrever lead existente) e na validação de coluna/arquivo (nunca processar um arquivo fora do formato esperado sem avisar).

## File List
_A preencher pelo @dev._

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-08-20 | @sm (River) | Criação da story (Draft) — decisão do Junior de ter cadastro de leads via planilha; recomendação do @sm de leitura direta (sem OCR/IA) confirmada pelo Junior após análise do arquivo de exemplo. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 9/10) → Status Draft→Ready.** De-risk sobre constraint única de `leads.telefone` está corretamente colocado como Task **antes** do dedup — evita tanto duplicar quanto falhar silenciosamente. |
