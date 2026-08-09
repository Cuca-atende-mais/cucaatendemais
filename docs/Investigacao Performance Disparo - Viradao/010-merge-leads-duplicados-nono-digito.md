# Plan 010: Decisão de produto + migração de merge dos leads duplicados pelo 9º dígito

> **Executor instructions**: Este plano tem um **checkpoint de decisão de produto obrigatório**
> (Step 2) que precisa de resposta humana explícita (Junior e/ou Valmir) antes de rodar
> qualquer coisa contra o banco de produção. Não pule o checkpoint assumindo a
> recomendação como aprovada — é uma recomendação, não uma decisão já tomada (diferente
> do Plano 008, onde a decisão já vinha pronta). Rode Step 1 (só leitura), pare, apresente
> o resultado, espere resposta, só então prossiga.
>
> **Drift check (run first)**: `git diff --stat bf8b152..HEAD -- worker/meta_adapter_inbound.py`
> Este plano assume que **`plans/009-normalizar-telefone-inbound-meta.md` já está em
> produção** antes de rodar a migração (Step 3) — senão, novos pares de duplicados
> continuam sendo criados enquanto a limpeza dos antigos acontece. Confirme isso antes
> de prosseguir; se o Plano 009 não estiver mergeado/deployado, STOP e reporte.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: HIGH — apaga/reescreve linhas reais de pessoas reais (leads, conversas, mensagens) em produção. Mitigado por: backup explícito antes de qualquer `DELETE` (Step 3.1), migração transacional, testada primeiro contra 1 par antes de rodar contra todos, e um checkpoint de decisão humana antes de qualquer escrita.
- **Depends on**: `plans/009-normalizar-telefone-inbound-meta.md` (precisa estar em produção primeiro — ver drift check acima)
- **Category**: migration (dados) + tech-debt (limpeza) — não é bug de código
- **Planned at**: commit `bf8b152`, 2026-08-08

## Why this matters

`AUDITORIA-duplicacao-lead-telefone-disparo-2026-08-07.md` documenta 28-29 pares de leads duplicados (mesmo telefone, um com o 9º dígito, outro sem) causados pela ausência de normalização no caminho inbound (corrigida pelo Plano 009, mas só para leads *novos*). Cada par existente hoje tem:

- O registro **"sobrevivente" recomendado** (telefone de 13 dígitos, com o 9): tem o enriquecimento de CRM (`unidade_cuca`, `tags`, `origem`, `opt_in` geralmente `true`) mas **quase sempre também tem** uma conversa real (a maioria recebeu o disparo e a mensagem gerou uma linha em `conversas`).
- O registro **"perdedor"** (telefone de 12 dígitos, sem o 9): nasceu no exato momento em que a pessoa respondeu pelo WhatsApp, `opt_in=false` (valor padrão da coluna, não um opt-out real), e é onde a conversa **de verdade** está gravada (mensagens reais, trocadas com o bot).

**Achado crítico deste plano, não coberto pela auditoria original:** os dois lados de **27 dos 29 pares (93%)** já têm uma linha em `conversas` — e `conversas` tem uma constraint `UNIQUE(lead_id, origem_id)`. Isso significa que um merge ingênuo (`UPDATE conversas SET lead_id = sobrevivente WHERE lead_id = perdedor`) **quebra imediatamente** na constraint de unicidade pra quase todos os casos. O merge precisa mover as *mensagens* pra dentro da conversa que já existe no sobrevivente, não só repontar a linha de `conversas` inteira. Ver Step 3 para o desenho completo.

Sem este plano, os 28-29 registros duplicados continuam do jeito que estão: a pessoa real tem seu histórico de conversa "preso" num cadastro que o resto do CRM não reconhece (sem `unidade_cuca`, sem `opt_in`, invisível pra segmentação de campanhas futuras).

## Current state

### A query de diagnóstico usada na auditoria (rode de novo no Step 1 — o número de pares muda com o tempo, mais respostas continuam chegando)

```sql
with pares as (
  select a.id as id_sobrevivente, a.telefone as tel_sobrevivente, a.nome as nome_sobrevivente,
         b.id as id_perdedor, b.telefone as tel_perdedor, b.nome as nome_perdedor,
         a.opt_in as optin_sobrevivente, b.opt_in as optin_perdedor
  from leads a
  join leads b on b.telefone = regexp_replace(a.telefone, '^(55\d{2})9', '\1')
  where a.telefone ~ '^55\d{2}9\d{8}$'
)
select * from pares order by id_sobrevivente;
```

Confirmado em 2026-08-08: 29 pares. **Este número já mudou desde a auditoria (era 28 horas antes)** — o bug ainda está ativo em produção até o Plano 009 ser deployado. Rode a query de novo no início do Step 1, não confie no número documentado aqui.

### Tabelas com FK pra `leads.id` (levantado via `pg_constraint`, 2026-08-08 — confira de novo se o schema mudou)

| Tabela | Coluna FK | Constraint única que pode conflitar num merge |
|---|---|---|
| `conversas` | `lead_id` | `UNIQUE(lead_id, origem_id)` — **conflita em 27/29 pares hoje** |
| `mensagens` | `lead_id` (+ `conversa_id`) | nenhuma |
| `logs_disparo` | `lead_id` | nenhuma |
| `inscricoes_eventos` | `lead_id` | `UNIQUE(evento_id, lead_id)` — pode conflitar |
| `participacoes_escuta` | `lead_id` | `UNIQUE(evento_id, lead_id)` — pode conflitar |
| `lead_atividades` | `lead_id` | `UNIQUE(lead_id, equipamento, atividade)` — pode conflitar |
| `lead_interesses` | `lead_id` | `UNIQUE(lead_id, categoria_id)` — pode conflitar |
| `historico_opt_in` | `lead_id` | nenhuma |
| `candidatos` | `lead_id` | `UNIQUE(cpf)` — não envolve `lead_id`, sem risco de conflito no repoint |
| `solicitacoes_acesso` | `lead_id` | `UNIQUE(protocolo)` — idem |
| `ouvidoria_registros` | `lead_id` | `UNIQUE(protocolo)` — idem |
| `feedbacks` | `lead_id` | nenhuma |
| `ae_presencas` | `lead_id` | `UNIQUE(telefone, data_encontro)` — não envolve `lead_id` |
| `ae_conversas` | `lead_id` | `UNIQUE(ae_instancia_id, wa_contact)` — não envolve `lead_id` |

### `historico_opt_in` — schema (usado no Step 3 pra decidir `opt_in` final)

```
id, lead_id, opt_in (boolean), motivo (varchar), canal (varchar), operador_id, created_at
```

### Repo conventions to match

- Migrations ficam em `supabase/migrations/YYYYMMDDHHMMSS_slug.sql` (ver `supabase/migrations/20260706000000_claim_atomico_disparos_race_condition.sql` como exemplo de estilo/comentário).
- Nenhuma migration deste projeto até hoje faz `DELETE` em massa de dados reais — este é o primeiro caso. Redobre o cuidado com o backup do Step 3.1.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rodar SQL contra produção | via MCP Supabase (`execute_sql` pra leitura/diagnóstico, `apply_migration` só depois do checkpoint do Step 2) | resultado da query |
| Verificar constraints de uma tabela | `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.<tabela>'::regclass;` | lista de constraints |

## Scope

**In scope**:
- Uma migration nova (`supabase/migrations/<timestamp>_merge_leads_duplicados_nono_digito.sql`) contendo: tabela de backup, função de merge, aplicação da função aos pares identificados como seguros no Step 1.
- Registro dos pares que **não** puderem ser mesclados automaticamente (achados no Step 1 como "precisa revisão manual") — documentar, não tentar forçar.

**Out of scope** (não mexer, mesmo que pareça relacionado):
- Qualquer alteração em `worker/meta_adapter_inbound.py` — isso é o Plano 009, já deve estar deployado antes deste plano rodar.
- Leads duplicados por qualquer outra causa que não seja o padrão "mesmo telefone, com/sem 9º dígito" (ex.: duas pessoas com nomes parecidos, ou erros de digitação de telefone diferentes) — fora do escopo desta migration.
- `ae_presencas`/`ae_conversas` — a FK pra `leads` existe, mas essas tabelas são do módulo Academia Enem, com 0-24 linhas hoje e sem nenhum caso real encontrado nos 29 pares (confirme no Step 1; se aparecer algum caso real, trate como achado novo, não improvise a correção aqui).

## Git workflow

- Branch: `chore/merge-leads-duplicados-nono-digito`
- A migration em si roda via `apply_migration` do MCP Supabase (não é um commit de código Python/TS) — mas o arquivo `.sql` gerado deve ser commitado no repo normalmente, junto com a atualização deste plano e do `plans/README.md`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Diagnóstico — classificar os pares (só leitura, sem escrita)

Rode a query de "Current state" acima pra pegar a lista atual de pares. Para cada par, classifique:

```sql
with pares as (
  select a.id as id_sobrevivente, a.telefone as tel_sobrevivente,
         b.id as id_perdedor, b.telefone as tel_perdedor
  from leads a
  join leads b on b.telefone = regexp_replace(a.telefone, '^(55\d{2})9', '\1')
  where a.telefone ~ '^55\d{2}9\d{8}$'
)
select
  p.*,
  (select count(*) from conversas where lead_id = p.id_sobrevivente) as n_conv_sobrevivente,
  (select count(*) from conversas where lead_id = p.id_perdedor) as n_conv_perdedor,
  exists (
    select 1 from conversas cs
    join conversas cp on cp.origem_id = cs.origem_id
    where cs.lead_id = p.id_sobrevivente and cp.lead_id = p.id_perdedor
  ) as tem_conflito_origem_id
from pares p;
```

- Pares com `tem_conflito_origem_id = true` (esperado: a maioria) → seguem o caminho de **merge de mensagens** no Step 3.
- Pares sem conflito → repoint direto de `conversas`, mais simples.
- Se algum par tiver `n_conv_sobrevivente = 0 and n_conv_perdedor = 0` (nenhum dos dois tem conversa) → merge trivial, só os outros 13 campos de FK.

**Não prossiga para o Step 2 sem apresentar esta tabela ao usuário.**

### Step 2: CHECKPOINT — decisão de produto (obrigatório, não pule)

Apresente ao usuário (Junior/Valmir) e obtenha confirmação explícita sobre:

1. **Qual registro sobrevive**: recomendação deste plano é o registro com telefone de 13 dígitos (com o 9) — é o que tem `unidade_cuca`/`tags`/`origem` preenchidos e geralmente `opt_in=true`. Precisa de confirmação, não é óbvio pra todo mundo que vai revisar isso depois.
2. **O que fazer com a conversa do "perdedor"**: recomendação é mover as *mensagens* (conteúdo real trocado) para dentro da conversa já existente do sobrevivente (quando `origem_id` bate) — preserva o conteúdo, descarta só a linha-container duplicada de `conversas`. Alternativa rejeitada por este plano: apagar a conversa do perdedor inteira (perderia histórico real de conversa de gente real, não é aceitável).
3. **`opt_in` final**: recomendação é manter o valor do sobrevivente, **exceto** se existir um registro real de opt-out (`historico_opt_in.opt_in = false`) associado a qualquer um dos dois lados — nesse caso, opt-out vence (é sinal real da pessoa, não artefato de bug).
4. **Hard delete do registro perdedor** (depois de repontar tudo que tem valor) vs. manter como linha "morta"/arquivada: recomendação é hard delete, porque o registro perdedor não tem nenhuma identidade própria válida — é 100% artefato do bug, e a `leads.telefone` dele colidiria de novo com o sobrevivente se ficasse marcado como ativo. Se o usuário preferir manter rastro, uma alternativa é gravar `(perdedor_id, sobrevivente_id, telefone_perdedor, nome_perdedor, merged_at)` numa tabela de auditoria simples antes do `DELETE` — ver Step 3.1 (o backup já cobre isso).

**STOP aqui até ter resposta explícita para os 4 pontos.** Se a resposta divergir das recomendações, ajuste a função de merge do Step 3 de acordo antes de aplicar.

### Step 3: Migration de merge

Depois do checkpoint aprovado, crie `supabase/migrations/<timestamp>_merge_leads_duplicados_nono_digito.sql`:

```sql
-- Merge dos leads duplicados criados pela ausência de normalização do 9º dígito
-- no caminho inbound da Meta (worker/meta_adapter_inbound.py, corrigido pelo
-- Plano 009 / AUDITORIA-duplicacao-lead-telefone-disparo-2026-08-07.md).
-- Decisão de produto confirmada em <PREENCHER DATA> por <PREENCHER QUEM>: ver Step 2
-- do plano.

-- 3.1: Backup — snapshot dos leads "perdedores" e seus pares antes de qualquer DELETE
CREATE TABLE IF NOT EXISTS public._backup_leads_duplicados_20260808 AS
SELECT
  a.id AS id_sobrevivente, a.telefone AS tel_sobrevivente, a.nome AS nome_sobrevivente,
  b.id AS id_perdedor, b.telefone AS tel_perdedor, b.nome AS nome_perdedor, b.*,
  now() AS backup_criado_em
FROM leads a
JOIN leads b ON b.telefone = regexp_replace(a.telefone, '^(55\d{2})9', '\1')
WHERE a.telefone ~ '^55\d{2}9\d{8}$';
-- Esta tabela nunca deve ser apagada por nenhum cron de limpeza automática —
-- confirme que "_backup_leads_duplicados_20260808" não bate em nenhum padrão
-- usado pelo cron `reset_automation_memory_daily` antes de seguir.

-- 3.2: Função de merge — 1 par por vez
CREATE OR REPLACE FUNCTION public._merge_lead_duplicado(p_perdedor_id uuid, p_sobrevivente_id uuid)
RETURNS void AS $$
DECLARE
  v_conv RECORD;
  v_conv_sobrevivente_id uuid;
BEGIN
  -- Conversas: mover mensagens pra dentro da conversa equivalente do sobrevivente
  -- quando origem_id colide (constraint UNIQUE(lead_id, origem_id)); repontar
  -- a conversa inteira quando não colide.
  FOR v_conv IN SELECT id, origem_id FROM conversas WHERE lead_id = p_perdedor_id LOOP
    SELECT id INTO v_conv_sobrevivente_id
    FROM conversas WHERE lead_id = p_sobrevivente_id AND origem_id = v_conv.origem_id;

    IF v_conv_sobrevivente_id IS NOT NULL THEN
      UPDATE mensagens SET conversa_id = v_conv_sobrevivente_id, lead_id = p_sobrevivente_id
      WHERE conversa_id = v_conv.id;
      DELETE FROM conversas WHERE id = v_conv.id;
    ELSE
      UPDATE conversas SET lead_id = p_sobrevivente_id WHERE id = v_conv.id;
      UPDATE mensagens SET lead_id = p_sobrevivente_id WHERE conversa_id = v_conv.id;
    END IF;
  END LOOP;

  -- Tabelas com FK simples (sem constraint única em conflito) — repoint direto
  UPDATE logs_disparo SET lead_id = p_sobrevivente_id WHERE lead_id = p_perdedor_id;
  UPDATE historico_opt_in SET lead_id = p_sobrevivente_id WHERE lead_id = p_perdedor_id;
  UPDATE feedbacks SET lead_id = p_sobrevivente_id WHERE lead_id = p_perdedor_id;
  UPDATE candidatos SET lead_id = p_sobrevivente_id WHERE lead_id = p_perdedor_id;
  UPDATE solicitacoes_acesso SET lead_id = p_sobrevivente_id WHERE lead_id = p_perdedor_id;
  UPDATE ouvidoria_registros SET lead_id = p_sobrevivente_id WHERE lead_id = p_perdedor_id;

  -- Tabelas com constraint única envolvendo lead_id — mantém a linha do
  -- sobrevivente quando já existe equivalente, descarta a do perdedor
  -- (é redundante, não é conteúdo original como as mensagens acima)
  UPDATE inscricoes_eventos SET lead_id = p_sobrevivente_id
    WHERE lead_id = p_perdedor_id
      AND evento_id NOT IN (SELECT evento_id FROM inscricoes_eventos WHERE lead_id = p_sobrevivente_id);
  DELETE FROM inscricoes_eventos WHERE lead_id = p_perdedor_id;

  UPDATE participacoes_escuta SET lead_id = p_sobrevivente_id
    WHERE lead_id = p_perdedor_id
      AND evento_id NOT IN (SELECT evento_id FROM participacoes_escuta WHERE lead_id = p_sobrevivente_id);
  DELETE FROM participacoes_escuta WHERE lead_id = p_perdedor_id;

  UPDATE lead_atividades SET lead_id = p_sobrevivente_id
    WHERE lead_id = p_perdedor_id
      AND (equipamento, atividade) NOT IN (SELECT equipamento, atividade FROM lead_atividades WHERE lead_id = p_sobrevivente_id);
  DELETE FROM lead_atividades WHERE lead_id = p_perdedor_id;

  UPDATE lead_interesses SET lead_id = p_sobrevivente_id
    WHERE lead_id = p_perdedor_id
      AND categoria_id NOT IN (SELECT categoria_id FROM lead_interesses WHERE lead_id = p_sobrevivente_id);
  DELETE FROM lead_interesses WHERE lead_id = p_perdedor_id;

  -- opt_in: opt-out real (se existir, de qualquer um dos dois lados) vence sobre o valor do sobrevivente
  IF EXISTS (
    SELECT 1 FROM historico_opt_in
    WHERE lead_id IN (p_sobrevivente_id, p_perdedor_id) AND opt_in = false
  ) THEN
    UPDATE leads SET opt_in = false WHERE id = p_sobrevivente_id;
  END IF;

  DELETE FROM leads WHERE id = p_perdedor_id;
END;
$$ LANGUAGE plpgsql;

-- 3.3: TESTE — aplique primeiro contra 1 único par antes de rodar em todos.
-- Escolha o par com o telefone da Célia usado na auditoria como caso de teste manual
-- (tem conflito de origem_id confirmado, é um bom caso representativo):
-- SELECT public._merge_lead_duplicado('<id_perdedor_celia>', '<id_sobrevivente_celia>');
-- Confira o resultado (Step 4) ANTES de rodar o loop abaixo pra todos os pares.

-- 3.4: Aplicar a todos os pares identificados no Step 1
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT a.id AS id_sobrevivente, b.id AS id_perdedor
    FROM leads a
    JOIN leads b ON b.telefone = regexp_replace(a.telefone, '^(55\d{2})9', '\1')
    WHERE a.telefone ~ '^55\d{2}9\d{8}$'
  LOOP
    PERFORM public._merge_lead_duplicado(r.id_perdedor, r.id_sobrevivente);
  END LOOP;
END $$;
```

Aplique via `apply_migration` do MCP Supabase, **em duas chamadas separadas**: primeiro só até o final da 3.2 (backup + função, sem side-effect), confirme que a função foi criada, rode o teste manual da 3.3 isoladamente, verifique (Step 4), e só então aplique a 3.4 (o loop completo).

**Verify**: depois da 3.2, `select count(*) from _backup_leads_duplicados_20260808;` deve bater com o número de pares do Step 1.

### Step 4: Verificação pós-merge

```sql
-- Não deve sobrar nenhum par duplicado
with pares as (
  select a.id from leads a
  join leads b on b.telefone = regexp_replace(a.telefone, '^(55\d{2})9', '\1')
  where a.telefone ~ '^55\d{2}9\d{8}$'
)
select count(*) from pares;  -- esperado: 0

-- Nenhuma mensagem deve ter sido perdida (soma antes == soma depois, comparando com o backup)
select count(*) from mensagens;  -- compare manualmente com a contagem pré-migration

-- Nenhum lead perdedor sobrevivendo
select count(*) from leads where id in (select id_perdedor from _backup_leads_duplicados_20260808);  -- esperado: 0
```

Escolha 2-3 pares do backup (inclusive o par da Célia usado como exemplo na auditoria) e confirme manualmente, olhando as mensagens do `id_sobrevivente`, que o histórico de conversa do perdedor está presente e em ordem cronológica correta.

## Test plan

Esta é uma migration de dados, não código de aplicação — não há suíte `pytest` pra rodar. A "verificação" é o Step 4 acima, rodado contra o ambiente real após o teste isolado da 3.3. Se o projeto tiver um branch de desenvolvimento Supabase disponível (`mcp__supabase__create_branch`), prefira rodar a migration completa lá primeiro, comparar os resultados do Step 4, e só depois aplicar em produção — mas isso depende de branching estar disponível/ativado no plano do Supabase deste projeto (confirme antes de assumir que existe).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `plans/009-normalizar-telefone-inbound-meta.md` confirmado DONE em produção antes de iniciar o Step 3
- [ ] Step 2 (checkpoint) tem resposta explícita registrada (screenshot/mensagem/decisão escrita em algum lugar rastreável, não só "assumido")
- [ ] `_backup_leads_duplicados_20260808` existe e tem 1 linha por par identificado no Step 1
- [ ] Teste isolado (3.3) verificado manualmente (Step 4) antes do loop completo (3.4)
- [ ] Após 3.4: query de pares duplicados retorna 0 linhas
- [ ] Nenhum lead perdedor sobrevive (`select count(*) from leads where id in (select id_perdedor from _backup...)` = 0)
- [ ] `plans/README.md` — linha de status do Plano 010 atualizada

## STOP conditions

Stop and report back (do not improvise) if:

- O checkpoint do Step 2 não tiver resposta humana explícita — nunca assuma a recomendação como aprovada sozinho.
- O Plano 009 não estiver confirmadamente em produção antes do Step 3.
- Qualquer par no Step 1 tiver um padrão diferente do esperado (ex.: mais de 1 conversa por lado com o mesmo `origem_id` — não deveria acontecer dada a constraint única, mas se acontecer, é sinal de dado inconsistente que precisa de investigação manual, não de merge automático).
- O teste isolado (3.3) não bater com o esperado no Step 4 — não prossiga para o loop completo (3.4) até isso ser resolvido.
- Encontrar qualquer linha em `ae_presencas`/`ae_conversas` referenciando um dos 29 pares — fora do escopo mapeado neste plano, reporte em vez de tentar mesclar sem entender o módulo Academia Enem.
- O número de pares mudar significativamente entre o Step 1 e o Step 3 (ex.: dobrar) — pode indicar que o Plano 009 não está realmente ativo em produção ainda; STOP e confirme antes de prosseguir.

## Maintenance notes

- `_backup_leads_duplicados_20260808` e a função `_merge_lead_duplicado` ficam no banco depois deste plano — não são temporários por padrão. Considerar, numa limpeza futura (fora de escopo aqui), apagar a função (o backup vale manter por mais tempo, é o único registro de que essas 29 pessoas existiram como duplicatas).
- Se o Plano 009 tiver algum gap não coberto (ex.: um país diferente de BR com o mesmo tipo de problema), novos pares no mesmo padrão podem voltar a aparecer — não há proteção automática recorrente aqui, é uma limpeza pontual dos duplicados existentes até a data deste plano.
- O merge de mensagens (Step 3.2) assume que `origem_id` é o identificador certo pra saber "é o mesmo canal/número de WhatsApp" — se o modelo de `origem_id` mudar no futuro (ex.: passar a incluir mais de um `phone_number_id` por lead legitimamente), esta lógica de merge precisa ser revisada.
