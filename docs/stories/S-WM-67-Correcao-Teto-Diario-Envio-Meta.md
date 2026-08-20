# S-WM-67 — Correção do Cálculo de Teto Diário de Envio (Meta, todos os números)

## Status
Ready

## Story
**Como** operador dos canais Meta (Institucional, Empregabilidade, Divulgação e, em breve, Academia Enem),
**quero** que o sistema respeite de verdade o limite diário de mensagens por número confirmado pela Meta,
**para que** nenhum canal ultrapasse o teto real e arrisque penalização/qualidade do número.

## Contexto
Levantamento técnico (`docs/migracao-meta/PLANO-Academia-Enem-Migracao-Meta-Direta.md`, seção 5) identificou dois problemas no desenho atual (`worker/campanhas_engine.py::_get_daily_limit_by_phone_sync`/`_warn_if_daily_limit_above_tier_sync`):
1. Quando o limite configurado está acima do tier real confirmado pela Meta, o sistema só **loga um aviso** — nunca ajusta nem bloqueia.
2. O contador de "limite" é por **execução de disparo**, não por dia real — duas campanhas no mesmo dia, cada uma dentro do próprio teto, somadas podem passar do que a Meta libera.

**Decisão do Junior (2026-08-20):** aplicar a correção para **todos os números** de uma vez (não só o da Academia Enem) — é a mesma lacuna, mesmo risco, para qualquer canal. Como o cálculo é por `phone_number_id`, o número da Academia Enem (quando existir, via S-AE-02) já fica automaticamente protegido sem risco de misturar teto com Institucional/Empregabilidade/Divulgação.

## Escopo
### IN
- No momento de decidir quantas mensagens uma execução pode mandar, calcular o teto efetivo como `mínimo(daily_limit configurado, messaging_limit_tier confirmado)` — usar esse valor para **bloquear**, não só avisar.
- Antes de iniciar o envio, somar quantas mensagens **já saíram naquele número, no dia corrente** (consultar `logs_disparo.enviado_em`/`status`, cruzado com o `phone_number_id` do disparo). Se a soma do dia já bateu o teto efetivo, a nova execução não inicia (ou inicia só com o que sobra de teto).
- Quando o tier ainda não foi confirmado (`NULL`), manter o fallback conservador atual (500) — já está correto.

### OUT
- Qualquer mudança na lógica de conteúdo/template/disparo em si — só o cálculo/trava do teto.

## Critérios de Aceite (Given/When/Then)
1. **Given** um número com `messaging_limit_tier` confirmado menor que o `daily_limit` configurado, **when** uma execução de disparo roda, **then** o teto efetivo usado é o `messaging_limit_tier` (o menor dos dois) — não só um log de aviso.
2. **Given** duas execuções de disparo no mesmo dia, no mesmo número, cada uma dentro do próprio teto isoladamente, **when** a soma das duas ultrapassaria o teto efetivo do dia, **then** a segunda execução é contida (envia só o que sobra de teto, ou não inicia).
3. **Given** um número sem `messaging_limit_tier` confirmado (`NULL`), **then** o fallback de 500 continua sendo aplicado, sem mudança de comportamento.
4. **Given** o número da Academia Enem (quando cadastrado via S-AE-02), **then** ele é protegido pela mesma lógica, com teto contado separadamente do teto de Institucional/Empregabilidade/Divulgação (por ser um `phone_number_id` diferente).
5. **Given** os testes existentes de `campanhas_engine.py` para Institucional/Empregabilidade, **then** todos continuam passando após a mudança (sem regressão de comportamento para quem já está dentro do teto).

## Dev Notes — análise de impacto (item por item)
1. **Toca:** `worker/campanhas_engine.py::_get_daily_limit_by_phone_sync`/`_warn_if_daily_limit_above_tier_sync` — código **compartilhado** por todos os disparos Meta (Institucional, Divulgação, Empregabilidade, e futuramente Academia Enem).
   **Depende disso hoje:** todo disparo em produção desses canais passa por essa função — é o caminho ativo, não um código morto.
   **Impacto real observável:** para números que hoje já estão dentro do tier real, **nenhuma mudança perceptível** (o teto efetivo já era o configurado). Para números cujo `daily_limit` configurado está acima do tier real, o comportamento muda de "avisa mas envia tudo" para "trava no tier real" — isso é a correção pretendida, mas é uma mudança de comportamento em produção que precisa ser comunicada antes do deploy (algum disparo que hoje "passa" pode começar a ser contido).
   **De-risk concreto:** antes de aplicar, rodar `execute_sql` (read-only) para conferir, para cada `phone_number_id` ativo hoje (Institucional, Empregabilidade), qual é o `daily_limit` configurado vs. `messaging_limit_tier` confirmado — se algum dos dois números em produção já estiver com `daily_limit` acima do tier real, a correção vai **conter** disparos que hoje passam sem trava; isso deve ser avisado ao Junior antes do deploy, não descoberto depois.
   **Teste de causalidade (regra do projeto):** antes de considerar pronto, reverter temporariamente a correção, confirmar que os novos testes falham com o comportamento antigo, restaurar a correção e confirmar que passam — mesmo padrão já usado nas últimas stories de empregabilidade desta sessão.

## Tasks
- [ ] Levantar (read-only) o `daily_limit`/`messaging_limit_tier` reais dos números em produção — reportar ao Junior antes de aplicar, se houver divergência.
- [ ] Corrigir `_get_daily_limit_by_phone_sync` para usar o mínimo entre configurado e tier confirmado.
- [ ] Implementar soma cumulativa diária via `logs_disparo` antes de iniciar uma nova execução.
- [ ] Testes cobrindo os 5 ACs, incluindo o cenário de duas execuções no mesmo dia.
- [ ] Regressão: suíte completa de `test_campanhas_engine.py` (ou equivalente) verde.

## Dependências
Nenhuma story bloqueia esta — é código já em produção. É consumida por **S-AE-09** (disparo próprio da Academia Enem), que herda a proteção automaticamente quando o número existir.

## Quality Gate
- Tipo: backend (worker), código compartilhado entre módulos. Agentes: @qa (obrigatório rastrear os 2 canais já em produção, não só testar isoladamente — regra de análise de impacto do projeto). CodeRabbit: foco em regressão de Institucional/Empregabilidade.

## File List
_A preencher pelo @dev._

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-08-20 | @sm (River) | Criação da story (Draft) — decisão do Junior de aplicar a correção do teto diário para todos os números de uma vez, motivada pela migração da Academia Enem para Meta direta. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 9/10) → Status Draft→Ready.** Análise de impacto sobre código compartilhado com Institucional/Empregabilidade está completa: nomeia o risco real (disparo que hoje "passa" pode passar a ser contido) e exige o levantamento read-only **antes** do deploy, não depois. Quality Gate corretamente exige rastrear os 2 canais já em produção, não só testar isolado — conforme regra do projeto. |
