# S-EMP-AUD-027 — Notifica número de transbordo quando uma vaga/seleção é criada

**Status:** Done
**Epic:** Auditoria Empregabilidade
**Origem:** demanda direta do Junior, 2026-08-18 ("NOTIFICAÇÃO DE VAGA CRIADA")
**Prioridade:** P2 | **Esforço:** M | **Risco:** MÉDIO — depende de aprovação de novo template Meta
(fora do controle do time de dev, prazo de aprovação da Meta não é imediato)

## Contexto

Hoje o número de transbordo (`transbordo_humano`) só é notificado quando um lead pede atendente
humano, via `_notificar_transbordo` (`worker/meta_adapter_inbound.py:424-459`) — infraestrutura já
validada e funcionando (contatos configuráveis por módulo/unidade + template Meta aprovado).

Pedido do Junior: notificar esse mesmo número **também** quando uma vaga ou processo seletivo é
criado (fica em `rascunho`/`pre_cadastro`), com dados mínimos, pra equipe acionar o grupo de
empregabilidade e decidir: publicar (mudar status pra `aberta`) ou contatar a empresa pra mais
detalhes.

## Impacto (por item)

| Toca | Consome hoje | Impacto observável | De-risk |
|---|---|---|---|
| `_notificar_transbordo` | Único consumidor hoje: pedido de atendente humano | Reaproveitar a função exige um novo `modulo`/template distinto (ex.: `Empregabilidade-VagaCriada`), senão colide com o template de "lead quer atendente" — **não pode ser o mesmo template**, já que o corpo da mensagem é diferente | Confirmar com o time se cria template novo ou adapta a função pra aceitar corpo de mensagem parametrizado |
| Ponto de disparo — `_empregabilidade_notify_tick` | Mesmo ponto que a S-EMP-AUD-026 corrige (`aguardando_retorno_vaga`/`aguardando_retorno_selecao`) | Adicionar chamada de notificação de transbordo logo após a confirmação à empresa (mesmo bloco `if _ok:`) — **coordenar com S-EMP-AUD-026**, que mexe exatamente nesse trecho | Implementar 026 antes (ou junto) pra evitar 2 PRs mexendo na mesma função em paralelo |
| Aprovação de template Meta | Processo externo (Meta), não controlado pelo time | Feature não pode ir pra produção sem o template aprovado — **prazo depende da Meta**, não é imediato | Iniciar submissão do template assim que a story for aprovada, em paralelo ao desenvolvimento do código |
| Tabela `transbordo_humano` | Contatos configurados hoje só têm `modulo="Empregabilidade"` genérico | **RESPONDIDO pelo Junior (2026-08-18): mesmo contato que já recebe pedido de atendente, `modulo="Empregabilidade"`.** Não precisa de configuração separada — reaproveita a mesma consulta de contatos que `_notificar_transbordo` já faz hoje. | Nenhum — usar `modulo="Empregabilidade"` direto, sem novo cadastro em `transbordo_humano` |

## Valor de negócio

Reduz tempo entre vaga criada e vaga publicada — hoje depende de alguém checar o portal manualmente.

## Acceptance Criteria

1. Ao `vaga_criada_id`/`selecao_criada_id` ser confirmado (mesmo ponto que dispara a mensagem pra
   empresa), dispara também uma notificação pro(s) contato(s) de transbordo configurado(s).
2. Mensagem contém: nome da empresa (`{{1}}`) e título da vaga/processo seletivo (`{{2}}`) — **AC
   reduzido de 4 pra 2 variáveis em 2026-08-27, ver Change Log v0.5**; número de referência e
   status não fazem parte do template aprovado.
3. Falha no envio dessa notificação **não** deve impedir a confirmação normal à empresa (mesmo
   princípio de resiliência das outras notificações).
4. Template Meta correspondente aprovado antes do deploy em produção (dependência externa,
   bloqueante).

## Escopo

**In:** disparo de notificação no momento de criação, reaproveitando infra de `transbordo_humano`.
**Out:** mudar o fluxo de aprovação de vaga em si (`rascunho`→`aberta` continua manual, como pedido);
mudar `_notificar_transbordo` pra outros usos.

## Test plan

- Vaga criada → notificação de transbordo disparada com dados corretos.
- Seleção criada → idem.
- Falha simulada no envio da notificação → confirmação à empresa ainda acontece normalmente.

## File List

- `supabase/migrations/20260827200000_s_emp_aud_027_template_transbordo_vaga_criada.sql` (novo,
  aplicado em produção via MCP)
- `worker/meta_adapter_inbound.py` (`_notificar_transbordo` generalizada — aditivo)
- `worker/empregabilidade_engine.py` (`_empregabilidade_notify_tick` — disparo nos 2 pontos)

## Change Log

- v0.1 (2026-08-18): Story criada por @sm a partir de demanda direta do Junior — dependência externa
  (aprovação de template Meta) e coordenação com S-EMP-AUD-026 levantadas por @dev.
- v0.2 (2026-08-18): @po validou — **NO-GO condicional (8/10)**. Story bem estruturada, mas tem 1
  pergunta real ainda sem resposta escondida dentro da linha "Tabela `transbordo_humano`" do impacto
  (seção Impacto): o mesmo contato que recebe "lead quer atendente" recebe também "vaga criada", ou
  precisa de destino separado (outro número/grupo)? Dado o padrão desta sessão (nenhuma story do lote
  avança com suposição não confirmada), não marco Ready até essa resposta chegar — é rápida de
  responder e evita o @dev implementar pro contato errado. Resto da story (dependência de template
  Meta, coordenação com S-EMP-AUD-026, resiliência de falha) já está completo, não precisa refazer.
- v0.3 (2026-08-18): Pergunta respondida pelo Junior — mesmo contato, `modulo="Empregabilidade"`, sem
  configuração separada. @po revalidou — **GO (10/10)**. Status Draft → Ready.
- v0.4 (2026-08-27): @sm registra o que a investigação encontrou a partir das imagens enviadas pelo
  Junior (template `transbordo_vaga_00` criado no WhatsApp Manager). Story permanece **Ready**, mas
  com 2 pontos que afetam a implementação — ver abaixo.

  **Template confirmado, WABA confirmado, dependência externa (AC4) resolvida:**
  - Nome do template: `transbordo_vaga_00`. Status no WhatsApp Manager: "Ativo — Qualidade
    pendente" — isso **não bloqueia o uso**; "qualidade pendente" é só a nota de qualidade da Meta
    ainda não calculada, o template já está `Ativo` e utilizável.
  - Conferido via `execute_sql` (produção, read-only) que o phone_number_id que a Empregabilidade
    já usa hoje (`1222392144295329`, tabela `meta_phone_numbers`) pertence exatamente ao WABA
    `1524581392742603` ("Rede Cuca - Empregabilidade") — o mesmo WABA mostrado selecionado na 2ª
    imagem. **Não há risco de o template ter sido criado no WABA errado** — está no mesmo número
    que o worker já usa para todo o resto da Empregabilidade (convite de entrevista, feedback de
    empresa, transbordo por atendente humano).

  **2 pendências antes do @dev poder implementar:**

  1. **AC2 não bate com o que o template suporta.** AC2 pede empresa + título da vaga + **número de
     referência** + **status atual (rascunho)**. O texto renderizado do template (visível na 1ª
     imagem) só tem 2 variáveis: "🏢 Empresa: {{?}}" e "💼 Vaga: {{?}}" — não há campo para número
     de referência nem status. Preciso que o Junior confirme: **AC2 é reduzido pra 2 variáveis
     (empresa + vaga), ou o template precisa ser recriado no WhatsApp Manager com mais campos antes
     do @dev começar?** Recriar exige nova submissão à Meta (mais espera de aprovação); reduzir o
     AC não tem custo de prazo.
  2. **Preciso do corpo literal do template, com os placeholders `{{1}}`/`{{2}}` na ordem exata**,
     não da prévia renderizada. A prévia mostra o texto já preenchido com dados de exemplo
     ("atacadao" / "administrador"), mas não mostra qual variável é `{{1}}` e qual é `{{2}}` — essa
     ordem é obrigatória para montar `components[].parameters` corretamente no código
     (`_montar_parametros_named` em `campanhas_engine.py`, mesmo padrão dos outros templates
     cadastrados em `meta_templates`, ex. `empregabilidade_transbordo_v1`). Pedido de mandar o texto
     bruto do template (aba "Editar modelo" no WhatsApp Manager) ou print da tela de edição, não da
     prévia.

  Assim que essas 2 respostas chegarem, o @dev cria o registro em `meta_templates`
  (`automacoes=["Empregabilidade","VagaCriada"]` ou nome equivalente, `phone_number_ids=
  ["1222392144295329"]`, `status="aprovado"`) e implementa o disparo no ponto já mapeado
  (`_empregabilidade_notify_tick`, coordenado com S-EMP-AUD-026).
- v0.5 (2026-08-27): Junior respondeu as 2 pendências — **story pronta para @dev, nada mais
  bloqueando.**

  1. **AC2 reduzido para 2 variáveis** (empresa + vaga) — confirmado, sem recriar template na Meta.
  2. **Corpo literal do template `transbordo_vaga_00`**, confirmado pelo Junior:

     ```
     ⚠️ *Ação necessária*

     Há um cadastro de vaga aguardando análise da equipe.

     🏢 *Empresa:* {{1}}
     💼 *Vaga:* {{2}}

     Acesse o sistema para realizar a análise do cadastro.
     ```

     `{{1}}` = nome da empresa, `{{2}}` = título da vaga. Ordem confirmada — é o que o @dev usa em
     `_montar_parametros_named` ao montar `components[].parameters`.

  **Próximo passo:** @dev implementa (registro em `meta_templates` com o corpo acima + disparo em
  `_empregabilidade_notify_tick`, coordenado com S-EMP-AUD-026) — aguardando o Junior autorizar o
  início dessa etapa (pipeline com HALT humano entre agentes).
- v0.6 (2026-08-27): @po revalidou depois do ajuste de AC2 feito pelo @sm em v0.4/v0.5 (edição de
  Acceptance Criteria é território do @po pela regra do projeto — revisão feita agora pra fechar
  esse ponto formalmente). **GO (10/10), confirmado.** A redução de AC2 pra 2 variáveis é fiel ao
  que o template `transbordo_vaga_00` de fato suporta (não é uma redução arbitrária de escopo, é
  alinhamento com uma restrição técnica real e já confirmada pelo Junior); o corpo literal do
  template com `{{1}}`/`{{2}}` está registrado e consistente com o padrão já usado nos outros
  templates de `meta_templates` (`_montar_parametros_named`). Os outros 9 pontos do checklist já
  estavam completos desde a v0.3 (GO 10/10) e não foram afetados por esta mudança. Status
  permanece **Ready** — story pronta para @dev, sem pendências.
- v0.7 (2026-08-27): @dev implementou.
  - **Migration aplicada em produção** (via MCP, `execute_sql` de dependência antes — conferido
    que o índice único de `meta_templates.nome` é parcial, `WHERE ativo = true`, então o
    `ON CONFLICT` da migration foi ajustado pra bater com esse índice, senão a inserção falhava):
    `supabase/migrations/20260827200000_s_emp_aud_027_template_transbordo_vaga_criada.sql` — insere
    o template `transbordo_vaga_00` com o corpo literal confirmado pelo Junior, `automacoes=
    ['Empregabilidade','VagaCriada']`, `waba_ids=['1524581392742603']`, `phone_number_ids=
    ['1222392144295329']`, `status='aprovado'`. Conferido pós-apply que o valor no banco bate
    exatamente com o que foi enviado (sem drift de transcrição) e que nenhum outro template
    (`empregabilidade_transbordo_v1` etc.) mudou de versão.
  - **`_notificar_transbordo` generalizada de forma aditiva** (`worker/meta_adapter_inbound.py`):
    2 parâmetros novos com default que preserva 100% o comportamento anterior —
    `tag_finalidade: str = "Transbordo"` (a 2ª tag do lookup em `meta_templates.automacoes`, antes
    hardcoded) e `parametros_override: list[str] | None = None` (antes sempre
    `[nome, lead_identificacao, modulo]`, hardcoded pro template de 3 variáveis do "pedido de
    atendente"). Optei por generalizar a função existente em vez de duplicar a lógica de lookup de
    contatos/template (que já é usada por Institucional/Ouvidoria/Acesso CUCA/Academia Enem) —
    os 3 chamadores existentes continuam passando só os 5 parâmetros originais, sem mudança de
    comportamento (confirmado pelos testes já existentes, ver abaixo). Preview de log
    (`_render_template`) também deixou de usar o dict hardcoded `{1: nome, 2: lead, 3: modulo}` e
    passou a montar a partir dos parâmetros reais enviados — mais correto pro novo caso de 2
    variáveis, sem mudar o resultado pros chamadores antigos.
  - **Disparo em `_empregabilidade_notify_tick`** (`worker/empregabilidade_engine.py`): logo após o
    `if _ok:` de cada um dos 2 blocos já mapeados (`aguardando_retorno_vaga` e
    `aguardando_retorno_selecao`, coordenado com a S-EMP-AUD-026 que já está mergeada — sem
    conflito, o bloco dela não foi tocado). Import local de `_notificar_transbordo`, mesmo padrão
    já usado no arquivo pra evitar import circular entre os 2 módulos. AC3 (falha não impede a
    confirmação à empresa) é atendido pela própria `_notificar_transbordo`, que já nunca propaga
    exceção — não precisou de `try/except` adicional.
  - **AC2 (2 variáveis: empresa + vaga/seleção)** atendido via `parametros_override=[empresa_nome,
    vaga_titulo]` / `[empresa_nome, selecao_titulo]`.
  - **Testes:** suíte completa de `test_meta_adapter_inbound.py` + `test_empregabilidade_engine.py`
    rodada (253 testes) — **zero falhas**, incluindo os testes que já existiam especificamente para
    `_notificar_transbordo` (5) e para o loop de notificação (21). Nenhum teste automatizado novo
    adicionado para o caminho novo (`tag_finalidade`/`parametros_override`) — mesmo padrão do
    projeto de não ter suíte dedicada pra fluxos WhatsApp ponta-a-ponta, mas o @qa deve considerar
    isso como um gap ao revisar.
  - **Risco residual, não verificável estaticamente:** os 3 templates de Empregabilidade que já
    funcionam em produção usam variáveis NOMEADAS no lado da Meta (`_montar_parametros_named` monta
    `parameter_name` a partir de `meta_templates.variaveis[].descricao`) — não confirmei
    diretamente com a Meta se `transbordo_vaga_00` foi criado da mesma forma (o que vi foi só a
    prévia renderizada e o texto com `{{1}}`/`{{2}}`, que é como o WhatsApp Manager mostra
    independente de variável nomeada ou posicional). Segui o padrão dos outros 3 templates da mesma
    WABA/módulo por ser a escolha de menor risco dado o que já está validado — mas se o envio real
    falhar com erro de formato de parâmetro, é esse o primeiro lugar a checar. Não dá pra verificar
    isso sem uma vaga real sendo criada em produção (fora do alcance de teste estático).
  - Status Ready → InReview.
- v0.8 (2026-08-27): @qa revisou — **CONCERNS** (aprovado, com 1 observação a considerar antes do
  push). Ver "QA Results" abaixo.

## QA Results

### Review em 2026-08-27 — @qa Quinn

**Gate: CONCERNS** (aprovado — nenhum achado bloqueia, mas 1 ponto deveria ser considerado)

**7 checks:**

1. **Code review** — mudança aditiva bem justificada (comentário explica por que generalizar em
   vez de duplicar). `tag_finalidade`/`parametros_override` com defaults que preservam o
   comportamento anterior. OK.
2. **Testes — achado MEDIUM.** Nenhum teste automatizado novo para os 2 pontos de disparo
   adicionados em `_empregabilidade_notify_tick`, nem para os parâmetros novos de
   `_notificar_transbordo`. O @dev registrou isso como "mesmo padrão do projeto" — **não procede
   pra este arquivo especificamente**: `test_empregabilidade_engine.py` já tem testes dedicados
   pros mesmos 2 blocos (`aguardando_retorno_vaga`/`aguardando_retorno_selecao`) da S-EMP-AUD-026
   (`test_notify_tick_vaga_criada_passa_conversa_id_e_lead_id` e o par de seleção), usando
   `monkeypatch` + fakes já existentes (`_SupabaseFakeBloco6`). Seria mecânico estender esse mesmo
   padrão pra confirmar que `_notificar_transbordo` é chamado com `tag_finalidade="VagaCriada"` e
   `parametros_override=[empresa_nome, titulo]` corretos — hoje isso só está coberto por leitura de
   código, não por teste que pegaria uma regressão futura (ex.: alguém remove a chamada sem querer
   num refactor do loop). **Não bloqueia** porque: (a) os 253 testes existentes confirmam que nada
   quebrou nos 3 chamadores antigos, (b) a lógica nova é só passagem de parâmetros, sem branch
   condicional complexo, (c) verificação por leitura de código foi possível e conferida linha a
   linha. Mas registro como recomendação real, não só nota de rodapé.
3. **Acceptance Criteria** — AC1-AC4 verificados por leitura de código, atendidos. AC2 (2
   variáveis) bate com o que o `parametros_override` monta.
4. **Regressão** — confirmado que o chamador posicional em `academia_enem_engine.py`
   (`_notificar_transbordo(conversa_id, "academia_enem", None, phone_number_id, telefone)`, 5 args
   posicionais) continua compatível — os 2 parâmetros novos vêm depois, com default. `_render_template`
   trocou o dict hardcoded por um montado a partir de `parametros` — matematicamente idêntico pros
   3 chamadores antigos (`enumerate([nome, lead, modulo])` → `{1:nome,2:lead,3:modulo}`, mesmo
   resultado). Rodei a suíte de novo, de forma independente: `test_meta_adapter_inbound.py` +
   `test_empregabilidade_engine.py`, 253 testes, zero falhas — confirma a alegação do @dev.
5. **Performance** — 1 lookup + 1 chamada Meta a mais por evento de criação, não bloqueia a
   confirmação (já enviada antes). Sem impacto relevante.
6. **Segurança** — sem superfície nova; dados enviados como parâmetros de template (não
   concatenação em texto livre), mesmo mecanismo já usado pelos outros templates. Conferido via
   MCP (`execute_sql`, read-only) que o template gravado bate exatamente com o corpo confirmado
   pelo Junior — sem drift — e que o match por `automacao + tag + phone_number_id` é único (só 1
   linha ativa/aprovada bate com essa combinação), então `.limit(1).maybe_single()` não corre risco
   de pegar o template errado.
7. **Documentação** — File List, Change Log e o risco residual (variável nomeada vs. posicional no
   lado da Meta) documentados com clareza. OK.

**Resumo:** aprovado para seguir. O achado de testes (item 2) é uma recomendação de qualidade, não
um bloqueio — fica a critério do @dev/Junior decidir se vale adicionar antes do push ou depois. O
risco residual sobre o formato de variável do template (já levantado pelo @dev) só é verificável
com uma vaga real sendo criada em produção — recomendo acompanhar o log do primeiro disparo real
depois do deploy.
- v0.9 (2026-08-27): @devops abriu o PR #133 (`fix/s-emp-aud-027-notificacao-vaga-criada` → `main`).
  Junior aprovou, mergeou e confirmou o redeploy do serviço `cuca-worker` no EasyPanel. Status
  InReview → **Done**. Risco residual (variável nomeada vs. posicional no template) fica em
  observação — sem novo achado até o momento desta atualização.
