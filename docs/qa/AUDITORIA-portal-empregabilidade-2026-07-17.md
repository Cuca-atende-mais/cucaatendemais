# Auditoria — `cuca-portal/src/app/api/empregabilidade/**` (foco correção/segurança/performance/testes/tech-debt)

**Data:** 2026-07-17
**Autor:** Auditoria independente (João/sócio + Claude Code), não-implementação — este documento reporta diagnóstico, não aplica fixes.
**Escopo:** 24 arquivos de rota Next.js (App Router) sob `cuca-portal/src/app/api/empregabilidade/**`, ~2400 linhas — a camada de API que empresas, candidatos e a equipe CUCA usam pra gerenciar vaga, candidatura, currículo e banco de talentos. Sexta rodada de auditoria do projeto, primeira dentro do `cuca-portal` (Next.js) — as cinco anteriores cobriram só `worker/` (Python).
**Motivação direta**: duas rodadas anteriores (`worker/talent_bank_matcher.py`, `worker/campanhas_engine.py`) rastrearam até este diretório e levantaram suspeita de falha de autorização sem conseguir confirmar 100%. Esta rodada resolve isso — e encontra o problema muito mais espalhado do que a suspeita original.
**Método:** leitura completa dos 24 arquivos (4 subagents paralelos + vetting pessoal). Confirmei pessoalmente, lendo o código, os 3 achados de maior severidade (as 3 rotas DELETE sem checagem) antes de escrever este documento.
**Ferramenta usada:** skill `improve`, mesma das cinco rodadas anteriores.

**Nota sobre esta entrega**: sem `plans/` de novo — mesma decisão das cinco rodadas anteriores.

**Resumo executivo, antes dos achados**: das 24 rotas, **17 não têm nenhuma checagem de autenticação**, incluindo 3 que apagam dado em cascata (empresa inteira, currículo do banco de talentos, vaga) e várias que mandam mensagem WhatsApp/e-mail real pra candidato ou empresa. Todas as rotas usam a chave de serviço do Supabase (bypassa RLS completamente), então o código de cada rota é a **única** camada de proteção que existe — e na maioria das vezes ela simplesmente não existe. Confirmei também a causa raiz: não existe nenhum helper compartilhado de "exigir sessão" no código do portal — as 3 rotas que checam autenticação corretamente reimplementam a lógica cada uma do zero, e as outras 21 nunca tiveram isso adicionado.

---

## Diagnóstico

### 🔴 Segurança — achado central da rodada

#### SEC-01 — 3 rotas DELETE sem nenhuma checagem apagam dado em cascata

**Arquivos:** `empresa/[id]/route.ts` (DELETE), `talent-bank/[id]/route.ts` (DELETE), `vagas/[id]/route.ts` (DELETE) — as 3 lidas e confirmadas pessoalmente

Nenhuma das três tem checagem de sessão, token ou posse — só o `id` da URL. Dado só o ID:

- `empresa/[id]` DELETE apaga a empresa, **todas as vagas dela**, **todas as candidaturas dessas vagas**, os currículos no R2, e as entradas do banco de talentos vinculadas.
- `vagas/[id]` DELETE apaga a vaga, suas candidaturas e os currículos.
- `talent-bank/[id]` DELETE apaga um registro do banco de talentos (dado pessoal de candidato) e o currículo dele no R2.

```typescript
// talent-bank/[id]/route.ts — DELETE completo, sem nenhuma checagem
export async function DELETE(request, { params }) {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)  // bypassa RLS
    const { id } = await params
    // ... busca, deleta do R2, deleta do banco. Nenhuma verificação de quem está chamando.
}
```

- **Impacto:** ALTO — é o maior raio de explosão da auditoria inteira. Qualquer um que descubra (ou adivinhe) um `empresa_id`/`vaga_id`/`talent_bank.id` apaga dado real permanentemente, sem nenhuma atribuição, e a única recuperação seria backup.
- **Esforço do fix:** M — exigir sessão (provavelmente de nível equipe CUCA, já que apagar empresa/currículo do banco de talentos não é ação de autoatendimento de uma empresa comum) antes de qualquer uma das três.
- **Risco do fix:** MÉDIO — precisa confirmar quem hoje chama essas rotas de fato antes de travar, pra não quebrar um fluxo legítimo.
- **Confiança:** HIGH — as 3 lidas pessoalmente, confirmado zero checagem em nenhuma.

#### SEC-02 a SEC-04 — Ações reais (rejeitar candidatura, convocar, notificar) sem checagem de nenhum tipo

- **`candidaturas/[id]/rejeitar`** — qualquer um rejeita candidatura de qualquer empresa, sabendo só o ID.
- **`vagas/convocar`** e **`talent-bank/convocar`** — qualquer um manda mensagem WhatsApp real de convite pra entrevista pra qualquer candidato real, ou move um registro do banco de talentos pra "arquivado".
- **`notificar-selecionado`** — manda mensagem "você foi aprovado" real pra qualquer candidato. E é a **única das 24 rotas que não usa a chave de serviço** — usa o client de sessão/cookie sem nunca checar se existe sessão, o que pode estar mascarando falha de permissão como "candidato sem telefone" (ver achado de correção CORR-01 abaixo).

- **Impacto:** ALTO — é um vetor real de assédio/engenharia social contra pessoas de verdade (candidatos a emprego), fora de sabotar o funil de contratação de uma empresa.
- **Esforço do fix:** M — sessão + checagem de que a candidatura pertence à empresa de quem está chamando.
- **Confiança:** HIGH.

#### SEC-05 — Criar vaga/seleção em nome de qualquer empresa

**Arquivos:** `vagas/route.ts` (POST), `selecao/route.ts` (POST)

`empresa_id` vem do corpo da requisição e só é checado se existe/está ativo — nunca se pertence a quem está chamando. O comentário no próprio código diz "Rota pública: acesso via link gerado pelo worker" — sugerindo que a intenção era ser só uma rota máquina-a-máquina, mas o código não impõe isso (não tem o mesmo token `x-internal-token` que a rota de triagem usa).

- **Impacto:** ALTO — spam de vaga falsa atribuída a uma empresa real, sem rate limit.
- **Esforço do fix:** S/M — aplicar o mesmo padrão de token M2M já usado em `triar-banco-talentos`.
- **Confiança:** MED (a intenção "rota do worker" é plausível pelo comentário, mas não confirmada com o time).

#### SEC-06 a SEC-10 — Upload sem validação, prefixo de storage controlável, HTML sem escape, taxonomia global sem checagem, disparo de IA sem limite

| # | Achado | Arquivo | Confiança |
|---|---|---|---|
| SEC-06 | Upload pro banco de talentos sem limite de tamanho nem checagem de tipo real (a rota irmã `upload-cv` tem os dois) | `talent-bank/cadastrar/route.ts` | HIGH |
| SEC-07 | Parâmetro `folder` do upload vai direto pro prefixo da chave no R2, sem lista de valores permitidos | `upload-cv/route.ts` | MED |
| SEC-08 | Nome do candidato (input público, sem checagem) injetado sem escape no HTML do e-mail mandado pra empresa | `enviar-cv/route.ts`, `enviar-cv-lote/route.ts` | HIGH |
| SEC-09 | Criar/editar/apagar categoria de interesse (taxonomia usada pelo sistema inteiro) sem checagem nenhuma | `categorias/route.ts`, `categorias/[id]/route.ts` | HIGH |
| SEC-10 | Disparo de processamento de IA (custoso) sem limite, e `cv_url` aceito do corpo sem confirmar que pertence à candidatura informada | `talent-bank/disparar-ia/route.ts` | MED |

#### SEC-11 — Vazamento de informação pequeno, mas encadeável com os achados acima

`empresa/route.ts` (GET) devolve nome de qualquer empresa dado o ID, sem checagem — baixo risco isolado, mas funciona como "oráculo" pra confirmar um `empresa_id` chutado antes de usar contra o SEC-05.

---

### 🟠 Correção

| # | Achado | Evidência | Esforço | Confiança |
|---|---|---|---|---|
| CORR-01 | `notificar-selecionado` usa o client errado (anon/cookie em vez de service role) e não checa erro na consulta — pode estar mascarando falha de permissão como "candidato sem telefone" | `notificar-selecionado/route.ts:2,13,16-20` | S | MED |
| CORR-02 | `feedback-submit`: janela de corrida entre checar "token usado" e marcar como usado — duplo clique pode processar a mesma avaliação 2x e mandar confirmação duplicada pra empresa | `vagas/feedback-submit/route.ts:20-68` | S | HIGH |
| CORR-03 | Deletes em cascata (`empresa/[id]`, `vagas/[id]`) não são transacionais — se travar no meio, fica dado órfão (candidatura apagada, vaga não; currículo do R2 apagado antes do banco confirmar) | `empresa/[id]/route.ts:52-73`, `vagas/[id]/route.ts:188-199` | M | HIGH |
| CORR-04 | Envio de candidatura: checagem "já se candidatou" é ler-depois-decidir sem trava — duas submissões quase simultâneas passam as duas e duplicam candidatura ativa | `candidaturas/route.ts:70-101` | M | MED |
| CORR-05 | Os 2 fluxos de token de feedback retornam código HTTP diferente (410 vs 400) pro mesmo estado "usado/expirado" | `vagas/feedback-token/[token]/route.ts:38-44` vs `vagas/feedback-submit/route.ts:30-36` | S | HIGH |
| CORR-06 | 3 rotas gravam no banco de talentos sem checar erro — reportam sucesso mesmo quando a gravação falha, e nada loga a diferença | `candidaturas/[id]/rejeitar/route.ts:63-69`, `candidaturas/route.ts:163-169`, `talent-bank/cadastrar/route.ts:52-56` | S | HIGH |
| CORR-07 | Mesma classe do SEC-06, ângulo de correção: rota de cadastro no banco de talentos aceita upload sem os limites que a rota irmã já tem implementados prontos pra reusar | `talent-bank/cadastrar/route.ts:26-31` vs `upload-cv/route.ts` | S | HIGH |

---

### 🟡 Performance

| # | Achado | Evidência | Esforço | Confiança |
|---|---|---|---|---|
| PERF-01 | Envio de currículo em lote processa tudo sequencialmente — pior caso passa de 6 minutos, sem `maxDuration` estendido (só a rota de triagem tem isso) — risco real de timeout na plataforma | `enviar-cv-lote/route.ts:67,76-97` | M | HIGH |
| PERF-02 | Deletes de currículo no R2 rodam um por um dentro do loop de delete em cascata | `vagas/[id]/route.ts:178-186`, `empresa/[id]/route.ts:42-50` | S | HIGH |
| PERF-03 | Duas consultas independentes rodam em sequência antes da chamada ao worker de triagem, quando poderiam ser paralelas | `triar-banco-talentos/route.ts:40-58` | S | HIGH |
| PERF-04 | Analytics do dashboard busca colunas inteiras sem filtro e agrega em JavaScript, em vez de agregar no banco — não escala com o crescimento do banco de talentos | `analytics/route.ts:22-119` | M | MED (achado real, impacto atual não medido) |
| PERF-05 | Mais alguns pares de consulta independente que poderiam ser paralelos (`talent-bank/convocar`, `empresa/[id]`) | vários | S | HIGH |

---

### 🟢 Testes e dívida técnica

**TEST-01 (achado #1 desta categoria, por regra do playbook)** — o portal Next.js inteiro **não tem infraestrutura de teste nenhuma**: sem script `test` no `package.json`, sem framework instalado, um único arquivo de teste solto no repo que não roda via nenhum comando documentado e nem testa nada deste diretório. É diferente do `worker/` (que tem pytest configurado) — aqui é zero, do zero.

**TECHDEBT-02 — a causa raiz por trás de tantos achados de segurança**: não existe nenhum helper compartilhado de "exigir sessão"/"verificar posse" no código do portal. As 3 rotas que checam autenticação corretamente (`analytics`, `solicitar-feedback`, `triar-banco-talentos`) reescrevem a mesma lógica cada uma do zero. Sem um lugar central pra isso, é fácil esquecer — e foi exatamente o que aconteceu nas outras 21.

| # | Achado | Esforço | Confiança |
|---|---|---|---|
| TECHDEBT-01 | 17 das 24 rotas duplicam a construção do client admin do Supabase à mão em vez de usar o helper `createAdminClient()` que já existe no repo — e a versão duplicada omite opções de auth que o helper tem | S | HIGH |
| TEST-02 | Rotas de delete em cascata sem nenhum teste — o valor real aqui é um teste de integração contra um Supabase de teste, não um teste unitário | M | HIGH |
| TEST-03 | Rotas que mandam WhatsApp/e-mail real sem teste — extrair a lógica pura (montagem de mensagem, normalização de telefone) pro mesmo padrão que já existe no único teste do repo | M | HIGH |
| TECHDEBT-03 | `enviar-cv`/`enviar-cv-lote` duplicam ~90% da lógica de montar o e-mail — e já divergiram (a versão em lote esqueceu 2 seções que a versão individual tem) | M | HIGH |
| TECHDEBT-04 | Validação de token de feedback duplicada entre as 2 rotas — e já divergiu no código de status HTTP (mesmo achado do CORR-05, ângulo de manutenção) | S | HIGH |
| TECHDEBT-05 | Status de vaga/candidatura são strings soltas em todo lugar, sem tipo — nenhuma proteção contra typo | M | HIGH |
| TECHDEBT-06 | Inconsistência de convenção REST (`/recurso/[id]/acao` vs `/recurso/acao` com id no corpo) — real, mas não vale a pena mexer isolado | — | MED (não recomendo agir sozinho) |

---

## Perguntas em aberto para o Valmir

1. **SEC-01 (as 3 rotas DELETE)** — é a prioridade máxima desta rodada. Quem legitimamente chama essas rotas hoje? Precisa saber isso antes de travar com autenticação, pra não quebrar um fluxo real do portal.
2. **SEC-05 (criar vaga em nome de qualquer empresa)** — o comentário no código sugere que era pra ser uma rota só do worker. É isso mesmo? Se for, o fix é rápido (mesmo padrão de token que `triar-banco-talentos` já usa).
3. **CORR-01 (`notificar-selecionado` usa client errado)** — preciso confirmar a política de RLS real de `candidaturas`/`vagas` pra saber se isso hoje falha silenciosamente ou se, pior, o RLS é permissivo o bastante pra essa rota funcionar sem sessão nenhuma.
4. **Prioridade geral** — dado o tamanho da lista (24 rotas, a maioria sem checagem), faz sentido tratar isso como um trabalho único ("adicionar o helper `requireUser()` que falta e aplicar nas rotas certas") em vez de rota por rota?
