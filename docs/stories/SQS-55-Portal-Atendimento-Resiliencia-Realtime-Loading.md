# SQS-55 - Portal - Resiliencia do atendimento contra falhas de Realtime e loading preso

## Status
InProgress

## Contexto
Atendentes relataram travamentos no atendimento, principalmente em Empregabilidade:

- ao assumir atendimento humano e enviar mensagem, o botao fica carregando;
- apos trocar de contato, a tela pode travar ou mostrar dados inconsistentes;
- em alguns casos so volta apos `Ctrl+Shift+R`;
- console mostra falhas de WebSocket Supabase Realtime e erros `ERR_NETWORK_CHANGED` / `ERR_INTERNET_DISCONNECTED`.

## Diagnostico Inicial
Os erros de console indicam instabilidade/quebra de rede no navegador, mas o portal nao estava degradando bem:

- cada chamada `createClient()` no browser podia criar novo cliente Supabase e potencialmente novos canais/WebSockets;
- envio manual para o worker nao tinha timeout no proxy do Next;
- leitura via worker tambem nao tinha timeout, embora seja operacao nao critica;
- `ChatWindow` dependia do Realtime para exibir a mensagem enviada, sem atualizar o estado local imediatamente;
- troca rapida de conversa podia permitir que respostas antigas de requests sobrescrevessem o contato atual.
- algumas telas de empregabilidade abriam requests paralelos sem cancelamento, o que aumentava corrida de estado e mantinha loading ativo por mais tempo ao trocar filtros/itens rapidamente.

Logs do Supabase Realtime foram consultados e nao indicaram bloqueio de seguranca especifico; os eventos vistos foram ciclos de inicializacao/desligamento por ausencia de usuarios conectados.

## Implementacao
Arquivos alterados:

- `cuca-portal/src/lib/supabase/client.ts`
- `cuca-portal/src/components/chat/chat-window.tsx`
- `cuca-portal/src/components/chat/chat-sidebar.tsx`
- `cuca-portal/src/app/api/chat/send-message/route.ts`
- `cuca-portal/src/app/api/chat/read-message/route.ts`
- `cuca-portal/src/app/(dashboard)/empregabilidade/candidatos/page.tsx`
- `cuca-portal/src/app/(dashboard)/empregabilidade/banco-talentos/page.tsx`

Mudancas:

- cliente Supabase browser virou singleton;
- Realtime recebeu limite de eventos por segundo no client;
- envio manual pelo proxy do Next recebeu timeout de 12s;
- marcacao de leitura recebeu timeout de 5s e continua nao bloqueante;
- mensagem enviada passa a aparecer localmente mesmo se o WebSocket atrasar;
- se envio externo falhar, a mensagem local/DB inserida otimisticamente e removida;
- `ChatWindow` e `ChatSidebar` ignoram respostas antigas quando o usuario troca de conversa/filtro;
- `ChatWindow`, `ChatSidebar`, `CandidatosGlobaisPage` e `BancoTalentosPage` agora cancelam requests em andamento ao trocar contexto, evitando loading preso e respostas antigas sobrescrevendo o estado;
- logs de `CHANNEL_ERROR` e `TIMED_OUT` foram adicionados no console para diagnostico.

## Criterios de Aceite
- [x] Envio manual nao deve ficar carregando indefinidamente se worker/UAZAPI/rede falhar.
- [x] Troca de contato nao deve receber dados atrasados da conversa anterior.
- [x] Mensagem enviada aparece sem depender exclusivamente do Realtime.
- [x] Browser usa um unico Supabase client compartilhado.
- [ ] Smoke test manual em producao: assumir atendimento, enviar mensagem, trocar contato, voltar ao contato.
- [ ] Monitorar console apos deploy para confirmar se falhas de WebSocket nao bloqueiam a UI.

## QA
- [x] `npx tsc --noEmit`
- [x] `npx eslint src/lib/supabase/client.ts src/components/chat/chat-window.tsx src/components/chat/chat-sidebar.tsx src/app/api/chat/send-message/route.ts src/app/api/chat/read-message/route.ts` sem erros; restaram avisos de `react-hooks/exhaustive-deps`.
- [x] `npx eslint src/app/(dashboard)/empregabilidade/candidatos/page.tsx src/app/(dashboard)/empregabilidade/banco-talentos/page.tsx src/components/chat/chat-sidebar.tsx src/components/chat/chat-window.tsx` sem erros; restaram avisos de hooks e componentes legados.
- [x] `git diff --check`
- [ ] `npm run lint` completo tentou varrer o projeto e estourou heap do Node local; validar no build/CI ou rodar com heap maior se necessario.
- [ ] `npm test` nao disponivel no `package.json` do portal.

## File List
- `cuca-portal/src/lib/supabase/client.ts`
- `cuca-portal/src/components/chat/chat-window.tsx`
- `cuca-portal/src/components/chat/chat-sidebar.tsx`
- `cuca-portal/src/app/api/chat/send-message/route.ts`
- `cuca-portal/src/app/api/chat/read-message/route.ts`
- `cuca-portal/src/app/(dashboard)/empregabilidade/candidatos/page.tsx`
- `cuca-portal/src/app/(dashboard)/empregabilidade/banco-talentos/page.tsx`
- `docs/stories/SQS-55-Portal-Atendimento-Resiliencia-Realtime-Loading.md`
