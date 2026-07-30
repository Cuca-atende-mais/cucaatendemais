# Auditoria — `empregabilidade_engine.py` (arquivo completo, foco correção/segurança/performance/testes/tech-debt)

**Data:** 2026-07-17
**Autor:** Auditoria independente (João/sócio + Claude Code), não-implementação — este documento reporta diagnóstico, não aplica fixes.
**Escopo:** `worker/empregabilidade_engine.py` (2799 linhas, estado no commit `bf8b152`) — a máquina de estados Python que roda todo o canal Empregabilidade via WhatsApp (empresa cadastra/gerencia vaga, candidato consulta status, público navega/aplica/deixa currículo). Categorias auditadas: correctness/bugs, security, performance, test coverage, tech debt/arquitetura — mesmo recorte da auditoria irmã do canal Institucional (`docs/qa/AUDITORIA-motor-agente-2026-07-16.md`, branch `audit/motor-agente-2026-07-16`).
**Fora de escopo nesta rodada:** `cv_processor.py`, `talent_bank_matcher.py`, `import_curriculos.py`, `category_extractor.py` — módulos adjacentes chamados a partir de outros pontos do sistema (não deste arquivo, confirmado por ausência de import), tratamento de currículo/PDF e o portal Next.js que recebe os links gerados por este arquivo. Fica para uma próxima rodada.
**Método:** leitura completa do arquivo (4 subagents paralelos, cada um cobrindo uma categoria, mais uma passada de vetting minha própria sobre os achados de maior severidade — confirmei pessoalmente os 3 primeiros achados abaixo linha por linha antes de incluir aqui). **Não executei a suíte de testes** (`pytest worker/tests`) — esta sessão não tinha um ambiente Python com as dependências do `requirements.txt` instaladas, e instalar pacotes está fora das regras da skill usada (`improve`, leitura-apenas). Recomendo que quem continuar isso rode `cd worker && pip install -r requirements.txt && pytest tests/test_empregabilidade_engine.py tests/test_intencao_detector.py -v` como primeiro passo antes de mexer em qualquer coisa — os achados de teste abaixo (#5, #14, #16) são baseados em leitura estática dos arquivos de teste, não em execução real.
**Ferramenta usada:** skill `improve`, mesma da auditoria do Institucional.

**Nota importante sobre esta entrega — leia antes de decidir o que fazer**: por pedido explícito de quem encomendou esta auditoria, **esta rodada não gerou `plans/`** (os planos de execução mecânicos e auto-contidos que a auditoria do Institucional gerou em `plans/001` a `plans/017`). A decisão foi deliberada: você (Claude do Valmir) tem contexto de produto/negócio que nós não temos sobre este canal — prioridade real de lançamento, quais fluxos são mais usados na prática, decisões de arquitetura já tomadas que não estão documentadas aqui. Este documento é o **diagnóstico completo, vetado, com evidência linha-a-linha** — a decisão de quais achados viram plano, em que ordem, e se algum deles é "não é bug, é assim mesmo por motivo X" é sua. Se quiser, aplique o mesmo formato de plano usado na auditoria do Institucional (`plans/NNN-slug.md`, ver `plans/001-typecheck-database-generic.md` como exemplo de nível de detalhe esperado) para os achados que decidir atacar.

---

## Diagnóstico

### 🔴 Achados de maior severidade/leverage

#### SEC-01 — Empresa é "autenticada" só pelo CNPJ — dado público, sem verificação de posse

**Arquivo:** `empregabilidade_engine.py:753` (lookup), `:761-767` (concessão de sessão)

```python
emp_res = supabase.table("empresas").select("id, nome, nome_fantasia").eq("cnpj", cnpj_limpo).execute()
if emp_res.data:
    empresa = emp_res.data[0]
    ...
    _set_fluxo(conversa_id, {
        "etapa": "aguardando_criar_vaga",
        "cnpj": cnpj_limpo,
        "empresa_id": empresa["id"],
        ...
    })
```

Qualquer conversa que informe os 14 dígitos de um CNPJ já cadastrado recebe, sem mais nenhuma verificação, a identidade completa daquela empresa (`empresa_id`) pelo resto da sessão. CNPJ não é segredo — está em nota fiscal, contrato, site de busca pública (inclusive o próprio bot ecoa razão social/endereço/telefone da empresa via `_formatar_dados_cnpj`, `:142-171`, puxados de `https://publica.cnpj.ws`). Os fluxos de edição (`selecionando_vaga_edicao`, `:485-526`) e cancelamento (`selecionando_vaga_cancelamento`/`confirmando_cancelamento`, `:568-694`) filtram corretamente por `.eq("empresa_id", empresa_id)` — mas esse `empresa_id` só vale o que vale o check acima, ou seja, nada. Quem souber (ou adivinhar/pesquisar) o CNPJ de uma empresa concorrente pode registrar um número de WhatsApp qualquer como aquela empresa e cancelar/editar vagas reais dela, ou ver quantas candidaturas ela recebeu.

- **Impacto:** ALTO — takeover completo de identidade de empresa, ação destrutiva possível (cancelamento é irreversível pelo próprio texto do bot: "*não pode ser reativada*").
- **Esforço do fix:** M — precisa de uma etapa de verificação fora de banda (código enviado ao e-mail/telefone já registrado da empresa, ou aprovação manual) antes de vincular um novo número de WhatsApp a um `empresa_id` já existente.
- **Risco do fix:** MÉDIO — mexe no fluxo de retomada usado por toda empresa recorrente; precisa de rollout cuidadoso pra não trancar usuário legítimo fora.
- **Confiança:** HIGH (li o fluxo completo, nenhuma verificação existe em lugar nenhum do arquivo).

#### SEC-02 — Consulta de status de candidatura vaza dado de terceiro

**Arquivo:** `empregabilidade_engine.py:1298-1352` (as 4 estratégias de busca dentro de `_processar_candidato`)

```python
# Busca por telefone (10-11 dígitos)
elif len(apenas_digitos) in (10, 11):
    cand_res = supabase.table("candidaturas").select(
        "id, status, vaga_id, created_at, observacoes"
    ).eq("telefone", apenas_digitos).order("created_at", desc=True).limit(5).execute()
...
# Busca por nome (texto com espaço, 5+ chars)
elif len(texto_limpo) >= 5 and " " in texto_limpo:
    cand_res = supabase.table("candidaturas").select(
        "id, status, vaga_id, created_at, observacoes, nome"
    ).ilike("nome", f"%{texto_limpo}%")...
```

O bot pede explicitamente ao usuário: "*você pode tentar com: número da candidatura, nome completo, ou telefone cadastrado*" (`:1339-1345`). As 4 estratégias de busca (CPF, código de referência, telefone, nome) usam o valor **digitado na mensagem**, nunca o `phone` real de quem está mandando a mensagem (que já está disponível como parâmetro da função). Qualquer pessoa que saiba o nome completo ou telefone de um candidato — ex-empregador, familiar, golpista — consegue puxar o status da candidatura dele e as `observacoes` internas do recrutador, sem provar que é aquela pessoa.

- **Impacto:** ALTO — exposição de PII de público em geral (candidatos a emprego), incluindo notas internas de recrutador.
- **Esforço do fix:** S — trocar a comparação de telefone pelo `phone` já confiável passado como argumento da função; a busca por nome deveria exigir também bater com esse telefone, ou ser removida.
- **Risco do fix:** BAIXO — estreita uma busca já existente, não deve quebrar uso legítimo (o telefone de quem manda a mensagem já é conhecido no servidor).
- **Confiança:** HIGH (as 3 ramificações lidas, nenhuma valida identidade do remetente).

#### BUG-01 — Estado `aguardando_retorno_selecao` sem handler em `_processar_empresa` — reseta a empresa inteira

**Arquivo:** `empregabilidade_engine.py:1012-1046` (onde a etapa é atribuída), `:358-1116` (`_processar_empresa`, onde deveria ser tratada), `:1113-1115` (fallback que efetivamente acontece)

Quando a empresa escolhe "2️⃣ Marcar seleção" (`escolhendo_tipo_vaga`, `:1034-1045`), a etapa vira `aguardando_retorno_selecao` enquanto aguarda o preenchimento do formulário no portal. As duas etapas irmãs (`aguardando_retorno_vaga`, `:1058-1099`, e `aguardando_retorno_edicao`, `:529-565`) têm um branch explícito pra tratar mensagem manual do usuário enquanto espera ("Ainda aguardando o preenchimento..."). `aguardando_retorno_selecao` não tem — cai direto no fallback genérico (`:1113-1115`):

```python
# Fallback — iniciar fluxo empresa
_set_fluxo(conversa_id, {"etapa": "solicitar_cnpj"})
await _processar_empresa(...)
```

Qualquer mensagem da empresa nesse meio-tempo ("oi", "ainda aí?") reseta a conversa inteira pra "informe seu CNPJ", perdendo `empresa_id` e todo contexto — o único jeito de recuperar é digitar o CNPJ de novo. (O loop de notificação em background, `empregabilidade_notify_loop:2678`, trata o lado assíncrono — quando o *portal* confirma — mas isso é uma função completamente separada, não cobre mensagem manual do usuário nesse meio-tempo.)

- **Impacto:** ALTO — regressão de UX direta no fluxo "marcar seleção", que é uma opção de primeira classe no menu.
- **Esforço do fix:** S — espelhar o bloco já existente em `aguardando_retorno_vaga`/`aguardando_retorno_edicao`.
- **Risco do fix:** BAIXO — branch novo isolado, não toca comportamento existente.
- **Confiança:** HIGH (confirmado por grep exaustivo de todo `if etapa ==`/`etapa in (...)` do arquivo — é o único valor de etapa atribuído em algum lugar e checado em nenhum, em `_processar_empresa`).

#### BUG-02 / PERF-01 — Quase todas as chamadas Supabase são síncronas dentro de `async def` — travam o event loop inteiro

**Arquivo:** todo o arquivo — `asyncio.to_thread` aparece **1 vez** (`:115`, dentro de `_enviar`); `supabase.table(` aparece **49 vezes**. As outras ~48 chamadas (incluindo `_get_fluxo`/`_set_fluxo`, `:178-188`, chamadas em praticamente toda mensagem) rodam direto, bloqueantes, dentro de handlers `async def` — inclusive dentro do loop de notificação em background (`empregabilidade_notify_loop`, `:2595-2799`, que roda a cada 20s).

`supabase-py` (`.execute()`) é uma chamada de rede síncrona. Como o worker roda num único event loop asyncio atendendo todas as conversas simultâneas, cada uma dessas ~48 chamadas trava o **processo inteiro** — não só a conversa daquele usuário — pela duração do round-trip ao Postgres. Sob tráfego concorrente (várias pessoas mandando mensagem ao mesmo tempo, que é a condição normal de operação de um número de WhatsApp compartilhado), atendimento que deveria ser concorrente vira serializado. Isso também derruba parcialmente o propósito do mecanismo de debounce que já existe em `meta_adapter_inbound.py` — o debounce serializa o dispatch por conversa, mas não impede que uma conversa trave todas as outras enquanto está bloqueada numa query.

- **Impacto:** ALTO — afeta escalabilidade/responsividade de **todo o canal**, não um fluxo específico; agrava-se com o volume de uso, que tende a crescer justo por causa do lançamento do dia 7.
- **Esforço do fix:** L — mecânico mas espalhado (~49 pontos); melhor via um helper (`_exec(query_builder)` envolvendo `asyncio.to_thread`) aplicado sistematicamente, ou migração pra um client Supabase assíncrono se a versão instalada suportar.
- **Risco do fix:** MÉDIO — mudança mecânica, mas a extensão (quase todo o arquivo) aumenta a chance de esquecer um ponto; recomendo ter os testes do achado #5 no lugar antes de fazer essa refatoração.
- **Confiança:** HIGH (contagem por grep confirmada).

#### TEST-01 — Zero testes nos 3 fluxos de maior risco (cancelamento, cadastro de empresa, confirmação de entrevista)

**Arquivo:** `empregabilidade_engine.py:608-694` (`confirmando_cancelamento` — marca vaga como `cancelada`, irreversível pelo próprio texto do bot), `:820-904` (`confirmando_cadastro`/`confirmando_cadastro_com_correcao` — insere linha real em `empresas`), `:2223-2281` (confirmação/recusa de entrevista — grava `candidaturas.status`). Grep em `worker/tests/test_empregabilidade_engine.py` confirma **zero** ocorrências de `confirmando_cancelamento`, `confirmando_cadastro` ou `entrevista_confirmada`.

São os 3 caminhos de maior risco do arquivo inteiro (apagar uma vaga real, criar uma empresa real, registrar o resultado de uma entrevista real) e nenhum tem uma linha de teste de regressão. Qualquer edit futuro (renomear coluna, trocar filtro `.eq()`, mexer na tupla de palavras afirmativas) pode quebrar cancelamento, cadastro ou tracking de entrevista sem nenhum sinal no CI.

- **Impacto:** ALTO — não é sobre o estado atual do código (não achei bug nesses 3 blocos especificamente), é sobre a ausência de rede de segurança pra qualquer mudança futura, inclusive as que este próprio documento sugere.
- **Esforço do fix:** M — precisa de fixture `mock_sb` por branch (formato de retorno já é dedutível do código) + assert no payload exato do `.insert()`/`.update()`, não só "não quebrou".
- **Risco do fix:** BAIXO — é só teste novo, não muda produção.
- **Confiança:** HIGH.

---

### 🟠 Demais achados vetados

| # | Achado | Categoria | Evidência | Esforço | Confiança | Nota |
|---|---|---|---|---|---|---|
| 6 | Leitura-modificação-escrita do estado sem lock: `_set_fluxo` refaz o `select` que `_get_fluxo` já fez (3-4 round-trips redundantes por mensagem) **e** corre risco real de lost-update contra o loop de notificação (`empregabilidade_notify_loop`, roda a cada 20s independente do dispatch de mensagem) | perf + bug | `:178-188` (helpers), `:2160-2166` (entry point refaz select), `:2595-2799` (loop concorrente) | M | HIGH (redundância) / MED (race, não medido em produção) | fix natural: `_set_fluxo` aceitar o dict já em mãos em vez de re-buscar, mais uma trava por `conversa_id` (mesmo padrão do debounce já usado em `meta_adapter_inbound.py`) |
| 7 | Escape hatch semântico (S-WM-20) falta em 4 pontos — mesma classe de bug que a própria story já corrigiu em 14 outros lugares do arquivo | bug/tech-debt | `:1795-1806` (`listou_categorias`), `:1834-1841` (`aguardando_escolha_unidade`), `:507` e `:590` (2º re-prompt de `selecionando_vaga_edicao`/`cancelamento`) | S | HIGH | fix é literalmente copiar o padrão já usado nos outros 14 pontos (ex. `:1753`) |
| 8 | `_quer_encerrar` usa substring solta (`"pronto"`, `"obrigado"` sem delimitador de palavra) e roda **antes** de qualquer outra lógica em 3 fluxos | bug | `:24-28` (lista), `:191-193` (check), `:374`/`:1267`/`:1494` (chamado no topo de cada `_processar_*`) | S | MED | `_quer_banco_talentos` (`:1416-1456`) já foi corrigido pra esse exato problema — `_quer_encerrar` ficou de fora |
| 9 | N+1 em 2 telas de listagem: contagem de candidaturas por vaga (loop com 1 query por vaga) e título de vaga por candidatura (idem) | perf | `:1219-1237` (até 10 queries), `:1349-1352` (até 5 queries) | S | HIGH | troca simples por `.in_(...)` + agrupamento em Python |
| 10 | Regex de número de vaga (`\b(\d{1,4})\b`) pode capturar dígito de CNPJ/data em vez do número certo, já que `\b` não barra pontuação | bug | `:487`, `:570`, `:1192` (e variante `\d{1,2}` em `:1775`, `:1812`, `:1888`) | S | MED | ex: "aqui está o CNPJ 12.345.678/0001-95, quero editar a vaga 3" pode casar "12" em vez de "3" |
| 11 | Texto do menu de 4 opções duplicado 10x como string literal (uma cópia já divergiu — `:646` diz "Encerrar" em vez de "Cancelar uma vaga"); 7 tuplas de palavra afirmativa diferentes entre si (sinônimo aceito numa etapa é rejeitado em outra) | tech-debt | menu: `:387,404,456,541,643,687,929,2659,2693,2725`. Afirmativo: `:616,826,872,913,2291,2340,2351` | S/M | HIGH | consolidar precisa de revisão etapa-a-etapa (não é find-replace cego — algumas palavras têm sentido específico de contexto, ex. "vou"/"1" em `escolhendo_tipo_vaga`) |
| 12 | Links do portal (`vagas/editar`, `vagas/nova`, `selecao/nova`, `candidatura`) levam `empresa_id`/`vaga_id`/telefone/nome crus na query string, sem assinatura nem expiração | security | `:513`, `:1023`, `:1035`, `:2087-2088` | M | MED (a parte que falta verificar é do lado do portal Next.js, fora do escopo lido) | mensagem de WhatsApp é trivialmente encaminhável; se o portal confia só na URL, isso é uma capability-URL sem proteção |
| 13 | 2 pontos gravam o estado **antes** de enviar a mensagem (inversão proposital, comentário no próprio código admite isso) — se o envio falhar depois, a próxima mensagem do usuário é interpretada pelo handler errado | bug | `:1826-1832`, `:1962-1972` | S | MED | resto do arquivo faz enviar-depois-persistir; esses 2 pontos são a exceção |
| 14 | Mocks de Supabase nos testes nunca verificam formato da query (`.eq()`, nome de tabela/coluna) — um bug de coluna/filtro passaria por todos os testes existentes | tests | `worker/tests/test_empregabilidade_engine.py` — zero ocorrências de `.assert_called_with` contra qualquer mock de `supabase` | S | HIGH | complementa o #5: ao escrever os testes que faltam, já incluir o assert de payload |
| 15 | Loop de notificação (a cada 20s) faz 1 busca de lead por conversa dentro de um `for` (N+1); a query externa que lista conversas ativas não tem `.limit()` | perf | `:2606-2608` (sem limit), `:2611-2634` (loop) | S/M | HIGH (N+1) / MED ("cresce sem limite", não medido contra volume real de linhas) | batch fácil via `.in_("id", [...lead_ids])`; limitar a query externa pode precisar de coluna gerada pra `etapa` (hoje filtrada em Python depois do fetch) |
| 16 | Fluxos de candidato (lógica de busca em si) e público (a maior parte do arquivo: categorias, unidades, banco de talentos, link de candidatura) quase sem teste além dos escape hatches de "quer sair"/"mudou de assunto" | tests | `_rotear_por_intencao` (`:2472-2588`) só tem teste pro branch `ambiguo`; ~30 etapas de público/candidato sem nenhum hit no arquivo de teste | L | HIGH | é o maior bloco de trabalho da lista; priorizar as 4 branches de `_rotear_por_intencao` primeiro (mais barato, maior sinal) |
| 17 | CNPJ completo em log de erro, sem o mascaramento que o resto do arquivo já usa pra telefone | security | `:138` (`logger.warning(f"...{cnpj_limpo}...")`) vs. `:2172,2205,2491` (telefone mascarado) | S | HIGH | inconsistência pontual, impacto baixo (CNPJ é quase-público) mas fácil de alinhar |

**Considerados e rebaixados** (avaliados, não entraram no corte acima — mas registrados aqui pra não serem reauditados à toa):

- CNPJ sem dígito verificador (`:127-129`, `:736-737`) — só checa `len == 14`. Impacto real é baixo: a consulta externa (`publica.cnpj.ws`) já barra CNPJ com dígitos errados antes de qualquer insert em `empresas`; o custo é só um round-trip HTTP desnecessário (até 10s) em CNPJ digitado errado.
- 2 etapas "legado"/"DEPRECADO" que são só shim de redirecionamento (`menu_empresa_retomada`, `:397-412`; `perguntando_unidade_vaga`, `:464-482`) — parecem seguras pra apagar, mas isso só é confirmável rodando uma query real (`select count(*) from conversas where metadata->'empreg_fluxo'->>'etapa' in ('menu_empresa_retomada','perguntando_unidade_vaga')`) — não consegui rodar isso nesta sessão (MCP do Supabase não autenticado). Se der zero, remover junto com um teste garantindo que a etapa não é mais alcançável.
- Quebrar o arquivo de 2799 linhas (god-module, 4.7x o tamanho de `campanhas_engine.py`, maior em churn — 62 commits) em módulos menores — não recomendo fazer isso antes dos achados #5/#14/#16 estarem resolvidos; é alto risco sem rede de testes.
- Gap no docstring de `test_empregabilidade_engine.py:11-21` — cita "Bugs 2/6" cobertos "em outro lugar" sem apontar onde. Achado real mas trivial, cabe como observação dentro do trabalho do #5, não merece item isolado.

---

## Perguntas em aberto para o Valmir

1. **SEC-01 (autenticação por CNPJ)** — existe alguma verificação fora deste arquivo (ex. no portal, ou um passo manual da equipe CUCA) que hoje mitiga isso na prática, ou o CNPJ realmente é o único fator? Se não houver mitigação nenhuma, isso parece prioridade P1 antes do lançamento do dia 7, já que o canal Empregabilidade abre pro público externo (empresas parceiras).
2. **Achado #12 (links do portal sem assinatura)** — só o Valmir tem visão do código do portal Next.js pra confirmar se a rota que recebe `vaga_id`/`empresa_id` da URL faz alguma checagem de sessão própria antes de aceitar a edição. Se fizer, esse achado cai de prioridade.
3. **Etapas "legado" (`menu_empresa_retomada`, `perguntando_unidade_vaga`)** — pede pra alguém com acesso ao banco rodar a query de contagem citada acima antes de decidir se remove.
