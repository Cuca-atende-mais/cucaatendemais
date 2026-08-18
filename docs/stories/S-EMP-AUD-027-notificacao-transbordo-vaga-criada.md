# S-EMP-AUD-027 — Notifica número de transbordo quando uma vaga/seleção é criada

**Status:** Ready
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
2. Mensagem contém: nome da empresa, título da vaga/processo seletivo, número de referência,
   status atual (rascunho).
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
