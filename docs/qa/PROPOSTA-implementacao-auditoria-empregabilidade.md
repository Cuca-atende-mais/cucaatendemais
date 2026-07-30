# Proposta de implementação — Auditoria de Empregabilidade (verificação da equipe)

**Data:** 2026-07-29
**Autor:** Time AIOX (@sm River, com verificação de @dev/@qa sobre o código real)
**Status:** Para validação do Junior → decisão do sócio. **Nada foi implementado.**

## Fontes usadas (caminhos reais — attention, têm espaço no nome da pasta)

- `docs/Auditoria Empregabilidade - Cuca Atende/AUDITORIA-empregabilidade-CONSOLIDADA-2026-07-29.md`
- `docs/Auditoria Empregabilidade - Cuca Atende/auditorias-originais/AUDITORIA-empregabilidade-2026-07-09.md`
- `docs/Auditoria Empregabilidade - Cuca Atende/auditorias-originais/AUDITORIA-empregabilidade-2026-07-17.md`
- `docs/Auditoria Empregabilidade - Cuca Atende/plans/README.md` e `plans/001-*.md` a `plans/019-*.md`
- `docs/Auditoria Empregabilidade - Cuca Atende/testes-locais-nao-commitados/` (2 arquivos `.py` + `achados-EMP-01-a-04.patch`) — **não commitados, ainda presentes no working tree**

> Nota: os caminhos citados no pedido original (`docs/qa/AUDITORIA-...`, `plans/empregabilidade/...`) não existem — os reais são os acima, dentro da pasta com espaço no nome. Corrigindo aqui para quem for abrir os arquivos depois.

## Achado que exige cautela na leitura de urgência — mas NÃO reduz prioridade de nada

Consultamos a produção (`cuca`, `svzkrkfzpiqcesloukgb`) e hoje `conversas` não tem nenhuma linha com `agente_tipo = 'Empregabilidade'` (o único valor presente é `'Institucional'`, 788 linhas) nem nenhuma linha com `metadata->'empreg_fluxo'` preenchido. Nossa primeira leitura foi "o módulo não está recebendo tráfego real" — **mas fomos verificar essa hipótese antes de escrever isso no documento, e ela não se sustenta:**

```
conversas:      min(created_at) = 2026-07-24, max = 2026-07-28  (788 linhas — janela de só 4 dias)
empresas:       min(created_at) = 2026-04-22, max = 2026-07-02  (18 linhas)
vagas:          min(created_at) = 2026-04-28, max = 2026-07-02  (23 linhas)
candidaturas:   min(created_at) = 2026-04-30, max = 2026-07-21  (124 linhas)
```

A tabela `conversas` só tem linhas dos últimos ~4 dias — **todo o dado real de empresas/vagas/candidaturas é de antes dessa janela**. Não determinamos a causa exata (pode ser poda/retenção da tabela, ou pode ser que `conversas` só passou a ser escrita a partir de 2026-07-24, por exemplo por causa da virada para o canal Meta oficial) — mas em nenhum dos dois casos o "zero conversas de Empregabilidade" prova ausência de tráfego real no período mais antigo, onde o dado de empresas/vagas/candidaturas existe. Não temos como, com o dado disponível hoje, confirmar se houve ou não uso real via WhatsApp nesse período.

**Correção em relação a uma leitura inicial nossa que descartamos:** não é correto concluir "hoje não há exposição ativa, dá pra corrigir com calma" — isso seria basear uma decisão de prioridade numa ausência de dado que tem outra explicação mais provável (retenção), não confirmação de segurança. **Os planos 001 e 002 mantêm a urgência P1 pelo próprio mérito técnico (identidade assumível por qualquer um que souber um CNPJ; vazamento de dado de terceiro), independente de tráfego atual estar ou não ativo.**

**Verificação adicional relevante ao Plano 001:** o desenho v2 (transbordo para atendimento humano quando um número não autorizado tenta acessar) depende de `human_handover_contacts` ter contato cadastrado para o módulo. Confirmamos: existe **1 linha** com `modulo = 'empregabilidade'`. O mecanismo de fallback não está vazio (não é um dead-end silencioso), mas é uma cobertura de contato único — vale confirmar com o sócio se 1 contato é suficiente ou se deveria haver redundância antes de depender disso como rede de segurança do novo desenho de autenticação.

**Pergunta para o sócio/Junior:** (a) o módulo Empregabilidade no WhatsApp oficial (Meta) já esteve ou está pareado e recebendo tráfego real em algum momento, ou ainda depende inteiramente da migração geral (`feat/whatsapp-oficial`)? (b) 1 contato em `human_handover_contacts` para o módulo é suficiente, ou deveria haver mais de um antes do Plano 001 entrar em produção?

---

## Ciclo completo de autenticação — confirmado ponto a ponto (Plano 001)

O documento original confirmava peças isoladas do Plano 001 (transbordo aciona; existe tela de empresas pra apoiar autorização) mas não tinha rastreado a costura entre elas ponta a ponta. Rastreamos agora os 4 pontos pedidos, com evidência de código.

### 1. Empresa entra, escolhe opção 1, é pedido o CNPJ

Confirmado em `worker/empregabilidade_engine.py:2411-2413` (`_processar_menu_inicial`): texto `"1"`/`"empresa"`/`"divulgar"`/etc. seta `{"perfil": "empresa", "etapa": "solicitar_cnpj"}` e chama `_processar_empresa`, que pede o CNPJ.

### 2. Se o CNPJ não existe, cadastro pede dados do responsável como etapas bloqueantes

**Correção à ordem descrita no pedido:** o fluxo real pede primeiro **e-mail**, depois **telefone** do responsável (não o inverso). Sequência confirmada:

- CNPJ não encontrado → consulta Receita Federal (`_consultar_cnpj`) → `confirmando_cadastro`/`confirmando_cadastro_com_correcao` (`:820-904`) → ao confirmar, `INSERT` em `empresas` (`:874-884`) → `aguardando_criar_vaga`.
- `aguardando_criar_vaga`, se responde "sim" (`:913-925`) → pede e-mail do responsável → etapa `coletando_email_responsavel`.
- `coletando_email_responsavel` (`:946-970`): valida formato (`"@" not in` / domínio com `"."`) — **se inválido, repete o pedido** (ou cai no escape semântico se o usuário claramente quer sair do assunto). Não há como avançar para a próxima etapa com e-mail vazio/inválido.
- `coletando_telefone_responsavel` (`:973-1005`): valida `len(dígitos) >= 10` — mesma lógica, **bloqueia avanço** até um valor válido (ou escape semântico pra sair do fluxo inteiro, não pra pular só o campo).

**Confirmado: são etapas bloqueantes de fato** — não existe um "pular" que leve direto para `escolhendo_tipo_vaga` sem os dois valores válidos. A única saída é abandonar o fluxo inteiro (encerrar ou escape semântico), não pular um campo específico.

### 3. `empresa_whatsapp_autorizados` gravado antes da criação de vaga/seleção, com `phone` do webhook

Confirmado no desenho do Step 2 do plano (`plans/001-...md:145-204`) — nos dois caminhos:
- **Empresa nova**: o plano insere em `empresa_whatsapp_autorizados` com `telefone: phone` logo após o `.insert()` em `empresas` retornar o `id` (ou seja, dentro de `confirmando_cadastro_com_correcao`, antes de `aguardando_criar_vaga` e muito antes de `coletando_email_responsavel`/`coletando_telefone_responsavel`/criação de vaga real).
- **Empresa já cadastrada, 1º toque** (backfill): o plano insere `telefone: phone` **antes** de conceder `aguardando_criar_vaga`.

Em ambos os casos, `phone` é o parâmetro de `_processar_empresa` (vem do webhook, nunca de `email_responsavel`/`telefone_responsavel` coletados depois) — a costura no **desenho do plano** está correta e na ordem certa. Isto descreve o plano como escrito (ainda não implementado, ver `list_migrations` — a tabela não existe hoje).

### 4. Cenário de número não autorizado — o que falta depois do transbordo

Confirmado: aciona transbordo (`conversas.status = "awaiting_human"` + `_notificar_transbordo`), como já registrado.

**4a. O que devolve a conversa pro controle da IA?** Existe hoje um mecanismo — mas é **100% manual e desconectado da autorização**. `cuca-portal/src/components/chat/chat-window.tsx:236-248` tem `handleRetornarIA()`, que faz `conversas.update({status: "ativa"})`; o botão "Retornar para IA" aparece em `:407-417` quando `conversation.status === "awaiting_human"` e o usuário tem permissão `update` no módulo. Confirmamos que este componente **é reusado pelo módulo Empregabilidade**: `cuca-portal/src/app/(dashboard)/empregabilidade/mensagens/page.tsx:35` monta `<ChatWindow moduloAtendimento="atendimentos_empregabilidade" />`. Ou seja, o botão existe e funciona para conversas de Empregabilidade — **mas nada liga esse clique ao ato de autorizar o número**. São 2 telas diferentes (`empregabilidade/empresas` para autorizar, `empregabilidade/mensagens` para retornar a IA), sem nenhuma automação entre uma e outra, hoje nem no desenho do plano (Step 3/4 do Plano 001 não menciona reverter `conversas.status` nem chamar `handleRetornarIA`).

**4b. Quem avisa o lead que pode continuar?** Ninguém, automaticamente. `handleRetornarIA()` (`chat-window.tsx:236-248`) só troca o status e mostra um `toast` para o **operador** — não envia nenhuma mensagem WhatsApp para o lead. O Step 3/4 do Plano 001 (endpoint de autorização + UI mínima) também não prevê isso. Depende inteiramente do colaborador lembrar de mandar uma mensagem manual pelo próprio chat (ação separada, disponível na mesma tela) ou avisar por fora.

**4c. GAP REAL — confirmado, não é suposição.** Hoje, e no desenho atual do Plano 001, autorizar um número exige **2 ações manuais desconectadas, em 2 telas diferentes, potencialmente por pessoas diferentes**: (i) autorizar o telefone na tela de empresas (endpoint novo do Step 3, ainda a construir) e (ii) clicar "Retornar para IA" na tela de mensagens (já existe, mas não é disparado automaticamente por (i)). O plano reconhece parcialmente o problema em "Maintenance notes" (`:256` — "`_notificar_transbordo` só notifica; não existe hoje nenhuma fila/painel de empresas aguardando verificação"), mas isso está registrado como observação, não como item de escopo do Step 3/4 — não cobre a reversão de status nem o aviso ao lead. Adicionalmente, verificamos que quando a conversa retorna à IA, o `_set_fluxo(conversa_id, {})` feito no momento do transbordo (Step 2 do plano, `:182`) zera o estado — a próxima mensagem do lead reentra do zero em `_rotear_por_intencao`/`_processar_menu_inicial` (`:2394-2413`), ou seja, o lead precisa escolher "empresa" e digitar o CNPJ de novo, sem qualquer aviso de que isso é necessário nem de que já foi autorizado.

**Recomendação da equipe — não presumir que "o colaborador vai lembrar" é solução aceitável:** isso deve subir de prioridade e entrar no escopo do Plano 001, não ficar como lacuna implícita. Sugestão mínima a validar com o sócio: (1) o endpoint de autorização (Step 3) já reverter `conversas.status` para `"ativa"` na mesma chamada; (2) enviar uma mensagem automática ao lead nesse momento avisando que o acesso foi liberado e pode reenviar o CNPJ. **Ressalva técnica sobre o "como" do item (1):** o padrão de busca de conversa por `metadata->empreg_fluxo->>empresa_id` usado em `selecao/route.ts:84-90` **não serve aqui**, porque o `_set_fluxo(conversa_id, {})` do transbordo (Step 2, `:182`) já zerou esse metadata — buscar por `empresa_id` não encontraria a conversa certa. O caminho de busca precisa ser outro: pelo **telefone que está sendo autorizado** (o mesmo `telefone` recebido no endpoint do Step 3) → `leads.telefone` → `conversas.lead_id`, e dentre essas, a que estiver com `status = "awaiting_human"`. Esse é um ponto que quem implementar precisa definir explicitamente, não um detalhe já resolvido.

**Pergunta adicional para o sócio/Junior:** a recomendação acima (reversão automática de status + mensagem automática ao lead no momento da autorização) deve entrar no escopo do próprio Plano 001, ou vira um plano separado? Sem uma das duas, o desenho v2 fecha o buraco de segurança mas abre um buraco operacional (empresa legítima autorizada continua sem resposta do bot até alguém lembrar de 2 passos manuais).

---

## Ordem de execução proposta

Mantemos a ordem do `README.md` (severidade + dependência) com 1 adição no topo:

| Ordem | Item | Motivo |
|---|---|---|
| **0 (novo)** | Levar os 2 arquivos de teste locais não commitados (e/ou aplicar `achados-EMP-01-a-04.patch`) para dentro de `worker/tests/`, e só então commitar | Confirmamos que os arquivos ainda estão no working tree, mas soltos em `docs/Auditoria .../testes-locais-nao-commitados/` — fora de `worker/tests/`, o `pytest` não os coleta. Os planos 004-007 dizem literalmente "o teste já existe, não precisa escrever": isso só é verdade se o teste estiver no lugar certo e rodando, não apenas presente em disco. Simplesmente commitar onde estão preserva o arquivo mas não resolve a cobertura. É o próprio risco #1 que a auditoria consolidada já aponta. Baixíssimo esforço, deve vir antes de tudo — mas é trabalho do @dev, não desta análise. |
| 1 | 001, 002, 003 | Segurança/bug crítico, independentes entre si. Confirmados ao vivo (ver abaixo). |
| 2 | 004, 005, 006, 007 | Bugs confirmados, teste já escrito, baratos. |
| 3 | 008 | Cobertura de teste antes de mexer em código de alto risco. |
| 4 | 009 | Só depois do 008 (dependência dura, confirmada). |
| 5 | 010, 011 | Podem entrar em paralelo com 004-009. 011 tem uma ressalva nova (ver abaixo). |
| 6 | 012-019 | Severidade menor. 015 continua bloqueado por decisão de produto. |

Nenhuma discordância da ordem lógica do README — só a adição do passo 0.

---

## Plano 001 — SEC-01: autenticação de empresa só por CNPJ

**Status: CONFIRMADO — e o ponto crítico do Junior está correto e é o cerne do problema.**

Verificamos ao vivo em `worker/empregabilidade_engine.py:753-768`: quando o CNPJ digitado bate com uma empresa já cadastrada, o código concede `empresa_id` no fluxo **sem nenhuma verificação contra `phone`** (o parâmetro que vem do webhook — a conversa real). Qualquer número que souber ou adivinhar um CNPJ de empresa já cadastrada (14 dígitos, não é segredo — está no rodapé de qualquer nota fiscal, contrato, site) assume a identidade daquela empresa.

**Confirmando o ponto do sócio, ao vivo:** `telefone_responsavel` e `email_responsavel` são campos coletados **depois**, em etapas separadas (`coletando_email_responsavel`/`coletando_telefone_responsavel`), usados só como dado de contato da vaga — **não são usados para autenticação hoje**. Ou seja: hoje não existe *nenhum* vínculo entre "CNPJ autorizado" e o número real da conversa. O design v2 do plano (tabela `empresa_whatsapp_autorizados` com `phone` do webhook) é exatamente o que falta — está corretamente alinhado com o que o sócio pediu.

**Verificação adicional que fizemos (não estava no plano, resolve uma dúvida que levantamos e descartamos):** o `phone`/`telefone` usado nesse fluxo vem sempre de `msg.get("from", "")` no payload do webhook Meta (`meta_adapter_inbound.py:225`), nunca de texto livre digitado pelo usuário — e confirmamos ao vivo que **100% das 801 linhas de `leads.telefone`** estão em formato puro-dígito (sem formatação). Ou seja, a comparação `phone not in telefones_autorizados` que o plano propõe é segura contra o problema de formatação inconsistente que achamos em outra tabela (ver Plano 002) — esse risco **não se aplica** ao Plano 001, porque a fonte do dado é outra (webhook, não input de formulário).

Também rodamos a checagem do STOP condition #4 do próprio plano: `select cnpj, count(*) from empresas group by cnpj having count(*) > 1` → **0 linhas**. Não há CNPJ duplicado hoje — o design da nova tabela não esbarra em dado legado inconsistente.

**Nenhuma discordância técnica.** Plano pronto para execução como está.

---

## Plano 002 — SEC-02: consulta de candidatura vaza dado de terceiro

**Status: CONFIRMADO, com 1 risco adicional não coberto pelo plano.**

O mecanismo de vazamento (correspondência solta contra input não confiável) confere com o código atual.

**Risco novo, encontrado por nós:** rodamos ao vivo em produção:
```
select
  count(*) filter (where telefone ~ '^[0-9]+$') as puro_digito,
  count(*) filter (where telefone !~ '^[0-9]+$') as com_formatacao
from candidaturas;
```
Resultado: **46 linhas puro-dígito, 78 linhas com formatação** (ex.: `"(85) 92146-7046"`) — maioria dos registros reais está formatada, não normalizada. Se a correção usar comparação exata de string (`.eq()`) contra `candidaturas.telefone` sem normalizar os dois lados antes, o fix pode falhar silenciosamente para a maior parte do dado real (candidato legítimo não encontra a própria candidatura) ou, pior, reabrir uma variante do próprio bug se a normalização for feita só de um lado.

**Recomendação da equipe:** o fix deve normalizar (remover tudo que não é dígito) tanto o telefone recebido quanto `candidaturas.telefone` antes de comparar — não assumir que o dado já está limpo. Isso é um ajuste pequeno dentro do próprio plano 002, não motivo para atrasá-lo.

---

## Plano 003 — BUG-01: `aguardando_retorno_selecao` sem handler síncrono

**Status: CONFIRMADO, com um esclarecimento relevante que reduz a incerteza do plano.**

O plano nota que falta um handler síncrono para a etapa `aguardando_retorno_selecao` (o usuário manda mensagem manualmente antes do loop assíncrono notificar). Confirmamos isso.

Fomos além do plano numa dúvida que ele deixa em aberto (se o campo `vaga_criada_id`/`vaga_numero` é realmente populado para o fluxo de seleção, ou só para vaga normal): lemos `worker/empregabilidade_engine.py:2595-2710` (o loop assíncrono) e **confirmamos que o branch `elif etapa_c == "aguardando_retorno_selecao":` (linha 2678) já existe e já lê `fluxo.get("vaga_criada_id")` normalmente** — e confirmamos no portal (`cuca-portal/src/app/api/empregabilidade/selecao/route.ts:84-101`) que o endpoint de criação de seleção **escreve** `vaga_criada_id`/`vaga_numero` no `empreg_fluxo` da conversa, exatamente como o de vaga normal (`vagas/route.ts:84-101`).

**Ou seja: não é código morto, e o lado assíncrono do 003 já funciona.** O que falta é só o lado síncrono (usuário manda mensagem manualmente durante a espera) — exatamente o escopo que o plano já define. Nenhuma discordância, plano confirmado e a incerteza que ele próprio registrava está resolvida a favor do "está tudo conectado, só falta o handler síncrono".

---

## Plano 004 — EMP-01: filtro de setor por substring esconde vagas

**Status: CONFIRMADO, sem drift.** Verificado ao vivo em `worker/empregabilidade_engine.py:2508`:
```python
if any(setor_canonical.lower() in (s or "").lower() for s in (v.get("setor") or []))
```
— substring solta, exatamente o bug descrito (ex.: setor "TI" bate em "Atividade").

## Plano 005 — EMP-02: `_quer_encerrar` por substring encerra por engano

**Status: CONFIRMADO, sem drift — mas com 1 risco adicional sobre a cobertura de teste do próprio fix.** `_quer_encerrar` em `worker/empregabilidade_engine.py:191-193` (`t in _PALAVRAS_ENCERRAR or any(p in t for p in _PALAVRAS_ENCERRAR)`), chamada nos 3 call sites citados pelo plano: `:374` (empresa), `:1267` (candidato), `:1494` (público) — todos confirmados. `_PALAVRAS_ENCERRAR` (`:24-28`) tem palavras soltas como `"tchau"`, `"encerrar"`, `"obrigado"`.

**Risco que o plano não cobre com teste:** o plano recomenda corrigir seguindo o padrão de `_quer_banco_talentos` (que remove o trecho que deu match e decide pelo que sobra da frase) — direção correta, evita trocar o bug de falso-positivo por um de falso-negativo (se o fix virasse simplesmente "só aceita a mensagem inteira", frases legítimas como "quero encerrar por favor" deixariam de encerrar). Conferimos o teste vermelho local (`TestQuerEncerrarSubstringSemLimiteDePalavra`, em `testes-locais-nao-commitados/test_empregabilidade_engine.py:642-670`): **só existe 1 caso, cobrindo a direção falso-positivo** ("muito obrigado! mas ainda tenho dúvida" não deveria encerrar). Não há nenhum caso confirmando que despedidas reais ("tchau", "obrigado, pode fechar", "quero encerrar por favor") continuam encerrando depois do fix. **Recomendação:** quem implementar deve adicionar ao menos 1 caso de teste nessa direção antes de considerar o plano fechado — não é motivo para atrasar a execução, só para não fechar sem essa cobertura.

## Plano 006 — EMP-03: negação ignorada em `pos_candidatura`

**Status: CONFIRMADO, sem drift.** Etapa `pos_candidatura` confirmada em torno de `worker/empregabilidade_engine.py:1583-1619` — a exceção de tolerância a "obrigado/valeu" (comentário `S37C-03`, `:1493-1494`) existe, mas não distingue negação de agradecimento, reabrindo a busca de vagas como o plano descreve.

## Plano 007 — EMP-04: `menu_pos_vaga` reinterpreta contra menu errado

**Status: CONFIRMADO, sem drift.** Confirmado: a etapa vira `menu_pos_vaga` ao criar vaga (`:1076-1082`), mas o dispatch em `:1101-1102` redireciona para o handler de `menu_empresa_acoes` — o menu mostrado ao usuário e o menu que o handler espera não são o mesmo, como o plano descreve.

Planos 004-007: todos com o teste vermelho já escrito localmente (ver Passo 0 acima). Nenhuma discordância técnica em nenhum dos 4; execução direta.

---

## Plano 008 — TEST-01 + achado #14: cobertura dos 3 fluxos de maior risco

**Status: CONFIRMADO.** Verificamos o arquivo de teste real committed (`worker/tests/test_empregabilidade_engine.py`) e confirmamos ausência de cobertura nos 3 fluxos citados como maior risco (inclui a falta de teste de `empregabilidade_notify_loop`, também citada no Plano 017 abaixo). Sem drift em relação ao estado dos mocks/testes descrito. Concordamos que deve vir antes do 009, como o próprio README já define.

---

## Plano 009 — BUG-02/PERF-01: ~49 chamadas síncronas no event loop

**Status: CONFIRMADO — contagem exata bate.** Recontamos: `asyncio.to_thread` aparece 1 vez, `supabase.table(` aparece 49 vezes em `empregabilidade_engine.py` — exatamente os números do plano. Concordamos com o Effort L e com a dependência dura do 008 (não mexer em 49 pontos espalhados sem rede de segurança de teste).

---

## Plano 010 — achado #12: links do portal sem assinatura nem expiração

**Status: CONFIRMADO — e o risco é mais amplo do que a amostra original.**

A auditoria original verificou 1 página como amostra. Conferimos as 4 páginas do portal que recebem parâmetro via link (`candidatura`, `vagas/editar`, `vagas/nova`, `selecao/nova`) — **nenhuma das 4** tem verificação de assinatura HMAC (`crypto.timingSafeEqual`, ou qualquer checagem equivalente). Todas usam só `useSearchParams` cru.

Também verificamos a camada de API por trás (não estava no escopo original): `cuca-portal/src/app/api/empregabilidade/vagas/[id]/route.ts` (GET e PATCH) valida "posse" fazendo `.eq("id", id).eq("empresa_id", empresaId)` — mas **`empresa_id` é o próprio parâmetro da URL, controlado pelo requisitante**. Ou seja, a checagem de posse na API é circular: não prova que quem está chamando é de fato aquela empresa, só confirma que os dois IDs fornecidos combinam entre si no banco. Isso **não reduz** o risco do achado #12 — na prática reforça que a única barreira real hoje é a URL não ser adivinhada, exatamente o que o plano já aponta como insuficiente.

**Recomendação da equipe:** manter a prioridade P2 do README; a correção (assinatura HMAC reaproveitando o padrão de `cuca-portal/src/lib/auctaflux/webhook.ts`) deve cobrir as 4 páginas, não só 1.

---

## Plano 011 — achado #6: `_set_fluxo` redundante + risco de lost-update

**Status: CONFIRMADO, com 1 ressalva técnica que muda a solução proposta.**

O plano descreve reaproveitar "o mesmo padrão do debounce" de `meta_adapter_inbound.py` para resolver o lost-update. Conferimos o mecanismo real: existe um **debounce** (`_DEBOUNCE_TASKS`, `_agendar_dispatch_debounced`, em torno da linha 471-540) — ele adia o processamento de mensagens que chegam em rajada para uma única execução. **Isso não é um lock de exclusão mútua.** Debounce resolve "várias mensagens do mesmo lead quase juntas", mas não impede que o loop assíncrono de notificação (`empregabilidade_notify_loop`, roda a cada 20s) escreva em cima do fluxo no mesmo instante em que uma mensagem inbound está sendo processada — que é exatamente o cenário de lost-update que o achado #6 descreve.

**Também não encontramos** o documento `docs/qa/INVESTIGACAO-worker-multiplos-processos-gunicorn-2026-07-23.md` citado no plano — nem no working tree nem no histórico do git (`git log --all --oneline --name-only -- '*gunicorn*'` retornou vazio). Não afirmamos que a investigação nunca existiu (pode ter ficado só localmente com quem a fez, sem commit) — só registramos que não está disponível para conferência hoje. O que confirmamos de forma independente: o `Dockerfile` do worker roda `gunicorn -w 1 -k uvicorn.workers.UvicornWorker` — **1 processo só**, o que é uma condição necessária (mas não suficiente sozinha) para qualquer solução baseada em lock em memória funcionar de verdade.

**Recomendação da equipe:** o fix não deve ser descrito como "reaproveitar o debounce" — precisa ser um mecanismo de exclusão mútua de fato (lock por `conversa_id`, em memória já que é 1 processo confirmado). Pedimos que o Junior confirme se a investigação do gunicorn existe em algum lugar (anotação pessoal, outro branch, conversa antiga) antes de considerar o "1 processo" definitivamente fechado como premissa permanente — hoje está correto, mas é o tipo de configuração que pode mudar numa migração de infra sem que quem mexe no código perceba.

---

## Plano 012 — achado #9: N+1 em 2 telas de listagem

**Status: CONFIRMADO, sem drift.** Os 2 pontos citados pelo plano, `worker/empregabilidade_engine.py:1219` e `:1349`, confirmados ao vivo como consultas dentro de loop, sem batching.

## Plano 013 — achado #10: regex de número de vaga pode capturar CNPJ

**Status: CONFIRMADO, sem drift.** Confirmado em `worker/empregabilidade_engine.py:487, 570, 1192` — todas usam `re.search(r"\b(\d{1,4})\b", texto)`. Como `\b` marca fronteira entre caractere-de-palavra e não-palavra (pontuação conta como não-palavra), um CNPJ como `12.345.678/0001-90` tem grupos de 1-4 dígitos cercados por `.`/`/`/`-` que também satisfazem `\b` — o regex captura um trecho do CNPJ como se fosse "número da vaga". O padrão do bug é o mesmo tipo de armadilha de `\b` do EMP-01 (Plano 004), mas com nuance diferente: ali o problema é palavra-dentro-de-palavra; aqui é dígito-embutido-em-sequência-pontuada — a correção certa é `(?:^|\s)...(?:\s|$)`, não simplesmente adicionar `\b` (que já está presente e não resolve este caso).

## Plano 014 — achado #11: menu duplicado 10x + 7 tuplas de afirmativo inconsistentes

**Status: CONFIRMADO — divergência de `:646` confirmada ao vivo, é uma pergunta de produto, não um bug óbvio.**

Confirmamos: das 10 ocorrências do menu de 4 opções, 9 dizem `"4️⃣ Cancelar uma vaga"` e a de `:646` diz `"4️⃣ Encerrar"`. O próprio plano já reconhece que não dá para saber pelo código sozinho qual das duas é a certa.

**Pergunta para o sócio (o plano já registra isso, reforçamos aqui):** em `:646`, "Encerrar" era intencional para aquela etapa específica, ou deveria dizer "Cancelar uma vaga" como as outras 9? Sem essa resposta, consolidar as 10 ocorrências numa constante corre o risco de "corrigir" um comportamento que era proposital.

## Plano 015 — achado #13: ordem persistir-antes-de-enviar — bug ou decisão deliberada?

**Status: SEM FIX PRESCRITO — decisão de produto necessária antes de codar (o plano já sinaliza isso corretamente).**

Confirmamos ao vivo que os comentários citados ainda existem exatamente como o plano descreve, em `worker/empregabilidade_engine.py:1826` e `:1962`: ambos dizem explicitamente que a ordem persistir-antes-de-enviar foi escolhida **de propósito** para evitar o usuário ficar "preso" se o envio falhar — o que contradiz a classificação de "bug" da auditoria de 17/07.

**Pergunta para o sócio/Junior (verbatim do plano, endossada pela equipe):**
1. A ordem invertida nesses 2 pontos foi mesmo deliberada e ainda é a que vocês querem? Se sim, o achado deve ser rebaixado para "não é bug, só falta comentário explicando o trade-off".
2. Ou o comentário documenta uma intenção que, na prática, gerou um problema pior (mensagem interpretada no contexto errado é mais grave que usuário preso)? Se sim, aí inverte — mas com teste cobrindo o cenário de falha de envio.

Não implementar nada aqui até essa resposta.

## Plano 016 — achado #15: loop de notificação sem `.limit()`

**Status: CONFIRMADO, sem drift.** Confirmado em `worker/empregabilidade_engine.py:2606-2608`: `supabase.table("conversas").select(...).eq("agente_tipo", "Empregabilidade").in_("status", ["ativa", "aberta"]).execute()` — sem `.limit()`. Verificamos o volume real que o loop processaria hoje: **0 linhas** batem nesse filtro agora (nota: isso reflete a mesma limitação de retenção da tabela `conversas` descrita na abertura deste documento, não confirma ausência histórica de volume). O risco do achado (crescer sem paginação) continua real e vale corrigir.

## Plano 017 — achado #16: cobertura de `_rotear_por_intencao`

**Status: CONFIRMADO, sem drift.** Conferimos o arquivo de teste real (committed, `worker/tests/test_empregabilidade_engine.py`, distinto da cópia local não commitada) — `_rotear_por_intencao` só aparece coberto em `TestFallbackAmbiguoPrimeiroContato` (3 ocorrências). Os outros branches principais da função não têm teste. Bate com o escopo reduzido que o plano já propõe.

## Plano 018 — achado #17: CNPJ sem mascaramento em log

**Status: CONFIRMADO, sem drift.** Confirmado em `worker/empregabilidade_engine.py:138` (`logger.warning(f"[CNPJ API] Erro ao consultar {cnpj_limpo}: {e}")`) — CNPJ completo em texto puro no log, enquanto o padrão já estabelecido no mesmo arquivo mascara telefone (`phone[:6]`+`"****"`, ver Plano 001).

## Plano 019 — cosmético: parâmetro `token` de `_enviar()` nunca usado

**Status: CONFIRMADO, sem drift.** Confirmado em `worker/empregabilidade_engine.py:96-97`: `async def _enviar(instance_name: str, token: str, phone: str, ...)` — `token` é recebido mas nunca repassado para `_meta_enviar` (a função interna que de fato envia usa outro mecanismo de autenticação). Prioridade P5 confirmada como a mais baixa de todas — concordamos que pode ficar por último ou ser descartado se a equipe preferir não gastar um ciclo nisso.

---

## Resumo para decisão rápida

| Categoria | Planos |
|---|---|
| Confirmados, sem discordância, prontos para execução direta | 001, 003 (parcialmente esclarecido), 004, 005, 006, 007, 008, 009, 012, 013, 016, 017, 018, 019 |
| Confirmados, com risco adicional a incorporar ao próprio plano (sem bloquear) | 002 (normalizar telefone dos 2 lados), 010 (cobrir as 4 páginas + API não valida posse de fato) |
| Confirmados, mas a solução proposta precisa de ajuste técnico antes de codar | 011 (debounce ≠ lock; confirmar premissa "1 processo" com o Junior) |
| Bloqueado por decisão de produto — não codar sem resposta | 014 (`:646`), 015 (ordem persistir/enviar) |

**Perguntas que precisam de resposta do sócio/Junior antes da execução:**
1. Status real do canal Meta oficial para Empregabilidade — já esteve ou está pareado e recebendo tráfego real, ou ainda depende inteiramente da migração geral (`feat/whatsapp-oficial`)? (a tabela `conversas` só retém ~4 dias, não dá pra confirmar isso só pelo banco)
2. `human_handover_contacts` tem só 1 contato cadastrado para o módulo `empregabilidade` — suficiente como rede de segurança do transbordo do Plano 001, ou deveria ter redundância antes de ir para produção?
3. Plano 014 — `:646` deveria dizer "Encerrar" ou "Cancelar uma vaga"?
4. Plano 015 — a ordem persistir-antes-de-enviar nos 2 pontos foi deliberada e continua sendo a intenção, ou deve ser invertida?
5. Plano 011 — alguém tem a investigação sobre múltiplos processos gunicorn (não encontramos no repositório) para confirmar que "1 processo" é premissa estável, não só o estado de hoje?

Nenhuma implementação foi iniciada. Aguardando decisão do Junior/sócio sobre o que segue para codificação.
