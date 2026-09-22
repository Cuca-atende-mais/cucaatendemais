## O que muda e por quê

<!-- O diff mostra o QUE. Escreva aqui o PORQUÊ: que problema isso resolve, ou o que
     estava errado antes. Se veio de um achado de auditoria ou de um relato, cite. -->

## O que isso pode quebrar

<!-- Responda de verdade, item por item — não "nada". Onde este código é usado? Que caminho
     passa por aqui? Se a resposta for mesmo "nada", diga como você verificou. -->

## Como foi verificado

<!-- Marque o que se aplica. Deixe desmarcado o que NÃO foi feito — desmarcado é informação
     útil; marcado sem ter feito é o que faz a revisão perder valor. -->

- [ ] `npm test` — worker e portal
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run test:edge`
- [ ] **Verificado no navegador** *(obrigatório se mexeu em tela — a esteira não faz isso)*
- [ ] Testado contra dado real / caso reproduzido

<!-- Se mediu alguma coisa, ponha o número: "745/5 → 750/0", "266 → 302 testes", "2 críticas → 0". -->

## Banco de dados

- [ ] Não mexe no banco
- [ ] Tem migration — é **idempotente** e **retrocompatível**
- [ ] Altera dado existente — quantos registros: `___` · backup em: `___`

## Depois do merge

- [ ] Não precisa de nada
- [ ] Redeploy: `cuca-worker` / `portal` / `cuca-academia-enem` / Edge Function *(riscar o que não se aplica)*
- [ ] Precisa de passo manual — qual: `___`
- [ ] Precisa de configuração (permissão, variável de ambiente) — qual: `___`

## Decisões em aberto

<!-- Algo que você notou e decidiu NÃO resolver aqui? Escreva. Vale mais como registro do que
     como silêncio — foi assim que vários achados deste projeto apareceram. -->
