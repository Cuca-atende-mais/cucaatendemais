# S-EMP-AUD-034 — Observabilidade de erro no formulário público de candidatura (Sentry)

**Status:** InReview
**Epic:** Auditoria Empregabilidade
**Origem:** Auditoria `AUDITORIA-empregabilidade-2026-08-27.md` (achado BUG-03) + Plano
`028-heic-e-observabilidade-envio-curriculo-publico.md` (Steps 3-4), separada da
S-EMP-AUD-035 (HEIC) por recomendação do @dev na leitura da auditoria — o log é barato, sem
risco, e vale independente de o suporte a HEIC ser implementado.
**Prioridade:** P1 (subida de P2 — ver justificativa abaixo) | **Esforço:** S | **Risco:** BAIXO —
aditivo, só adiciona captura de erro, não muda comportamento existente.
**Depende de:** nenhuma. Não depende da S-EMP-AUD-035.

> **Por que a prioridade subiu em relação ao plano original:** a auditoria já registra que esta é
> a **2ª vez** que uma investigação neste repositório esbarra em "não dá pra confirmar a causa
> raiz porque não existe log" (ver também achado #2 do Plano 003 em `plans/README.md`). Log
> estruturado é a mudança de menor risco e maior alavancagem desta leva — sem ele, o próximo caso
> parecido volta a depender de sorte (um atendente perceber, um candidato insistir).

## Contexto

Duas candidatas relataram "está dando erro"/"falha" ao tentar enviar o currículo, levaram entre
1h e 1h30 pra conseguir, com intervenção humana no meio. Não foi bloqueio de idade — a causa
técnica exata **não pôde ser confirmada** pela auditoria, porque não existe nenhum log de erro
nos dois pontos onde uma falha real acontece:

- `cuca-portal/src/app/empregabilidade/candidatura/page.tsx:275` — catch do `handleSubmit`, só
  `console.error(error)`, visível apenas no console do navegador do próprio candidato.
- `cuca-portal/src/app/api/empregabilidade/upload-cv/route.ts:65` — catch da rota, só
  `console.error("[upload-cv] Erro:", err)`, log efêmero do servidor, sem correlação com
  `conversa_id`/telefone/vaga.

**Confirmado nesta leitura (2026-08-28):** o `cuca-portal` já tem Sentry configurado e ativo
(`sentry.client.config.ts`, `sentry.server.config.ts`, `NEXT_PUBLIC_SENTRY_DSN`) — o STOP
condition do plano original ("Sentry não estiver de fato configurado") **não se aplica**, pode
seguir direto pra implementação sem essa checagem extra.

## O que precisa ser implementado

### 1. Captura de erro na página pública (client-side)

`cuca-portal/src/app/empregabilidade/candidatura/page.tsx:275` — trecho atual:
```ts
} catch (error: any) {
    console.error("Erro no envio:", error)
    toast.error(error.message || "Não foi possível enviar sua candidatura agora.")
}
```
Adicionar `Sentry.captureException` com contexto (reaproveitar o import já usado em
`global-error.tsx`/`sentry-test/route.ts` — `import * as Sentry from "@sentry/nextjs"`):
```ts
} catch (error: any) {
    console.error("Erro no envio:", error)
    Sentry.captureException(error, {
        tags: { fluxo: "empregabilidade_candidatura_publica" },
        extra: { vagaId, conversaId, nomeArquivo: arquivo?.name, tipoArquivo: arquivo?.type },
    })
    toast.error(error.message || "Não foi possível enviar sua candidatura agora.")
}
```
(nomes exatos das variáveis de contexto — `vagaId`, `conversaId`, `arquivo` — a confirmar contra
o estado real do componente no momento da implementação).

### 2. Captura de erro na rota de upload (server-side)

`cuca-portal/src/app/api/empregabilidade/upload-cv/route.ts:65` — mesma ideia, versão
server-side do Sentry, com o `folder` recebido (já carrega o `vagaId` embutido) como contexto.

### 3. Log de rejeição esperada (nível `warn`, não erro)

Quando a validação de magic bytes rejeita um arquivo (`route.ts`, blocos de validação antes do
catch), logar os primeiros ~12 bytes recebidos (não o arquivo inteiro) — é o que teria
confirmado ou descartado a hipótese HEIC desta auditoria se já existisse, e vai confirmar ou
descartar a próxima hipótese parecida sem precisar de sorte com uma conversa ao vivo.

## Acceptance Criteria

1. Erro no `catch` de `candidatura/page.tsx` gera evento no Sentry com tag
   `fluxo: empregabilidade_candidatura_publica` e contexto (`vagaId`, `conversaId`, nome/tipo do
   arquivo).
2. Erro no `catch` de `upload-cv/route.ts` gera evento no Sentry com o mesmo nível de contexto
   (server-side).
3. Rejeição de arquivo por magic bytes inválido gera log nível `warn` com os primeiros bytes do
   arquivo recebido (não o conteúdo completo).
4. Nenhuma mudança de comportamento visível pro candidato — a mensagem de erro exibida continua a
   mesma, só passa a ser instrumentada por trás.

## Escopo

**In:** os 4 ACs acima. **Out:** suporte a HEIC (S-EMP-AUD-035, story separada); mudar a UI do
seletor de arquivo (`accept=".pdf,image/png,image/jpeg"`) — cosmético, não faz parte desta
story.

## ⚠️ Análise de impacto — por item

### Item 1 — Sentry client-side em `candidatura/page.tsx`

- **Toca:** só o bloco `catch` do `handleSubmit` — nenhuma mudança de fluxo feliz.
- **Consome hoje:** ninguém depende do formato do log atual (só `console.error`, invisível pra
  equipe hoje) — mudança estritamente aditiva.
- **Impacto observável:** nenhum pro candidato (mesma mensagem de erro exibida); equipe passa a
  ver o erro real no Sentry, com contexto suficiente pra diagnosticar sem precisar de uma conversa
  ao vivo acontecendo na hora.
- **De-risk:** teste manual forçando um erro (ex. desconectar rede a meio do upload) e confirmar
  que o evento aparece no Sentry com o contexto esperado.

### Item 2 — Sentry server-side em `upload-cv/route.ts`

- **Toca:** só o bloco `catch` da rota — mesma lógica do Item 1, lado servidor.
- **Consome hoje:** mesma análise do Item 1 — sem consumidor dependendo do log atual.
- **Impacto observável:** mesmo — invisível pro candidato, visível pra equipe.
- **De-risk:** mesmo teste do Item 1, conferindo do lado do evento server-side (tag/ambiente
  diferentes do client, se o Sentry do projeto já distingue os dois — confirmar contra a config
  existente).

### Item 3 — Log de rejeição de magic bytes

- **Toca:** os blocos de validação de `upload-cv/route.ts` que hoje só retornam 400 sem log
  nenhum.
- **Consome hoje:** nenhum consumidor — é log novo.
- **Impacto observável:** nenhum pro candidato (a rejeição continua acontecendo do mesmo jeito,
  com a mesma mensagem); equipe ganha visibilidade de **qual** formato está sendo rejeitado e com
  que frequência — dado que teria resolvido de forma definitiva a hipótese HEIC desta auditoria.
- **De-risk:** confirmar que só os primeiros ~12 bytes são logados, nunca o arquivo completo
  (currículo pode conter dado pessoal sensível — cuidado deliberado, não né afrouxar validação de
  segurança nenhuma, só log de metadado técnico).

## Test plan

- Upload válido (fluxo feliz) — confirmar que nada muda no comportamento visível.
- Forçar erro proposital (rede desconectada, ou mock de falha do R2) — confirmar evento no Sentry
  com contexto (`conversa_id`/`vaga_id`/nome-tipo do arquivo) nos dois pontos (client e server).
- Upload de arquivo inválido conhecido (ex. `.txt` renomeado pra `.pdf`) — confirmar que a
  rejeição continua funcionando como hoje (não regredir validação de segurança) **e** que o log
  de warn (Item 3) aparece com os bytes esperados.

## File List

- `cuca-portal/src/app/empregabilidade/candidatura/page.tsx` — `Sentry.captureException` no
  catch do `handleSubmit`, com tag `fluxo: empregabilidade_candidatura_publica` e contexto
  (`vagaId`, `conversaId`, `bancoTalentos`, extensão/tipo/tamanho do arquivo); helper
  `extensaoArquivo` (achado @qa v0.4 — nome do arquivo trocado pela extensão, ver Change Log v0.5).
- `cuca-portal/src/app/api/empregabilidade/upload-cv/route.ts` — `Sentry.captureException`
  server-side no catch da rota (tag `fluxo: empregabilidade_upload_cv`, extra `folder`); `console.warn`
  com os primeiros 12 bytes em hex nos 2 pontos de rejeição (magic bytes desconhecidos, MIME
  fora da lista), usando extensão em vez do nome completo do arquivo (achado @qa v0.4); `folder`
  movido pra fora do `try` (estava dentro, inacessível no catch — corrigido durante a
  implementação, não estava nem no plano original nem na story); helper `extensaoArquivo`.

## Change Log

- v0.1 (2026-08-28): @sm cria a story a partir dos Steps 3-4 do Plano 028, separada do suporte a
  HEIC (S-EMP-AUD-035) por recomendação do @dev — log tem menor risco e maior alavancagem
  imediata, não depende da decisão técnica de HEIC pra entregar valor. Confirmado nesta leitura
  que o Sentry já está configurado no `cuca-portal` (STOP condition do plano original não se
  aplica). Status: Draft — aguardando validação do @po.
- v0.2 (2026-08-28): @po valida — **GO** (10/10 no checklist de validação de story). Story mais
  limpa da leva: sem decisão de produto pendente, sem dependência de outra story, escopo
  pequeno e já confirmado contra o código real (Sentry ativo). Status: Draft → **Ready**.
  Recomendação (não bloqueante): priorizar esta antes da S-EMP-AUD-035 — os logs que ela gera são
  o que vai confirmar, com dado real, se vale investir no suporte a HEIC.
- v0.3 (2026-08-28): @dev implementa os 4 ACs — Sentry client-side (Item 1) e server-side
  (Item 2), log de warn com os primeiros 12 bytes em hex nas 2 rejeições de magic bytes/MIME
  (Item 3). **Achado durante a implementação, fora do desenho original:** `folder` estava
  declarado dentro do `try`, então o `catch` não teria acesso a ele pro contexto do Sentry —
  movido pra fora do `try` (`let folder` antes do bloco). `npx tsc --noEmit` limpo nos 2 arquivos
  tocados (erros pré-existentes em `tests/*.test.ts`, sem relação com esta mudança, confirmados
  por não citarem nenhum dos 2 arquivos). Nenhum teste manual em navegador/localhost feito nesta
  sessão (regra `qa-testes-sem-navegador-ao-vivo.md` — precisa de autorização explícita do
  Junior antes; recomendo o teste manual dos 3 cenários do Test Plan antes do push). Status:
  InProgress → **Ready for Review** (aguardando @qa).
- v0.4 (2026-08-28): @qa revisou — **CONCERNS** (aprovado, com 2 recomendações não-bloqueantes).
  Ver "QA Results" abaixo. Status: Ready for Review → **InReview**.

## QA Results

### Review em 2026-08-28 — @qa Quinn

**Gate: CONCERNS** (aprovado — nenhum achado bloqueia, mas 2 pontos deveriam ser considerados)

**7 checks:**

1. **Code review** — mudança pequena e contida (2 arquivos), comentários explicam o "porquê", não
   só o "o quê", e citam a story/auditoria de origem — bom padrão pra quem for ler isso depois. O
   @dev encontrou e corrigiu por conta própria um bug real de escopo (`folder` inacessível no
   catch) que nem o plano original nem a story tinham previsto — achado de qualidade, registrado
   com transparência no File List/Change Log. OK.
2. **Testes — achado MEDIUM, não-bloqueante.** Nenhum teste automatizado novo cobre os 4 ACs — a
   story previa só teste manual (Test Plan), e não existe suíte de teste automatizado prévia para
   `upload-cv/route.ts` nem para `candidatura/page.tsx` neste repositório (confirmado por busca,
   nenhum arquivo em `cuca-portal/tests` referencia `upload-cv`). Não é regressão desta mudança,
   mas fica sem rede de segurança automatizada pra esta lógica daqui pra frente. Não bloqueio o
   gate por isso (não estava no escopo pedido e o `tsc --noEmit` limpo já é alguma garantia), mas
   registro como débito: se o `cuca-portal` ganhar suíte de teste pra rotas de API no futuro, esta
   é uma candidata natural.
3. **Acceptance Criteria** — AC1, AC2 e AC3 verificados por leitura de código, atendidos
   corretamente (`Sentry.captureException` nos dois pontos com tags/extra esperados;
   `console.warn` com `primeirosBytesHex` nos 2 blocos de rejeição). AC4 (nenhuma mudança de
   comportamento visível) confirmado — a resposta HTTP e a mensagem de erro exibida não mudaram
   em nenhum dos caminhos, só o que acontece "por trás" antes do `return`. **Nenhum dos ACs foi
   testado ao vivo** (nem pelo @dev nem por mim) — a regra `qa-testes-sem-navegador-ao-vivo.md`
   também me impede de subir servidor/navegador sem autorização sua, então minha verificação é
   100% estática (leitura de código + typecheck), consistente com o que o próprio @dev já
   registrou como pendência no Change Log v0.3.
4. **Regressão** — `npx tsc --noEmit` rodado de forma independente: confirmo limpo nos 2 arquivos
   tocados, mesmos erros pré-existentes em `tests/*.test.ts` (sem relação, nenhum cita os arquivos
   desta story). Tracing manual do fluxo: o `return NextResponse.json(...)` em cada ponto de
   rejeição continua exatamente onde estava — o `console.warn` foi inserido **antes** do return
   existente, sem alterar a ordem de execução nem o valor retornado. Confirmado que
   `Sentry.captureException` não lança nem interrompe o fluxo (é fire-and-forget, comportamento
   padrão do SDK) — não há risco de o log quebrar o `catch` que ele está dentro.
5. **Performance** — sem impacto perceptível; `Sentry.captureException` já é usado em outros
   pontos do `cuca-portal` (`global-error.tsx`, `sentry-test/route.ts`) sem overhead relatado, e
   só roda no caminho de erro (raro), não no caminho feliz. `primeirosBytesHex` opera só nos
   primeiros 12 bytes de um `Buffer` já em memória — custo desprezível.
6. **Segurança — achado MEDIUM, não-bloqueante.** `nomeArquivo: file.name` é enviado tanto pro
   Sentry (Item 1 e 2) quanto pro log de warn (Item 3). Nome de arquivo de currículo
   frequentemente contém o nome real do candidato (ex. `curriculo_joao_silva.pdf`) — ou seja, dado
   pessoal identificável passa a trafegar pra um serviço terceirizado (Sentry, fora da
   infraestrutura do projeto) e pro log de servidor. A story foi cuidadosa em explicitamente não
   logar o **conteúdo** do arquivo por esse motivo (Item 3, "cuidado deliberado"), mas não
   considerou que o **nome** do arquivo é, na prática, um vetor parecido de dado pessoal. Não
   bloqueio o gate porque (a) é um padrão já aceito no projeto — o R2 já grava arquivos com nome
   original em alguns fluxos, e (b) Sentry é ferramenta de uso interno da equipe, não pública —
   mas registro como ponto a decidir: se isso for uma preocupação real de LGPD/privacidade,
   trocar `nomeArquivo: file.name` por só a extensão (`file.name?.split(".").pop()`) resolveria
   sem perder o valor diagnóstico (o que importa pra investigar é o formato, não o nome exato).
7. **Documentação** — story completa, com contexto, decisão, impacto por item, File List e Change
   Log atualizados a cada etapa (@sm → @po → @dev). Achado de escopo do `folder` documentado com
   transparência, não escondido. OK.

**Resumo:** aprovado para seguir. Os 2 achados (testes automatizados ausentes; nome de arquivo
como dado pessoal trafegando pro Sentry/log) são recomendações de qualidade/privacidade, não
bugs — ficam a critério do Junior decidir se algum vira ajuste antes do push ou fica documentado
como débito conhecido.

- v0.5 (2026-08-28): @dev trata o achado 6 (nome de arquivo como dado pessoal) — Junior pediu
  explicitamente pra trocar o nome pela extensão e seguir. Nos 3 pontos onde `file.name`/
  `arquivo?.name` era logado (2 `console.warn` em `route.ts`, 1 `extra` do Sentry em `page.tsx`),
  substituído por `extensaoArquivo(...)`, novo helper local em cada arquivo (sem dependência
  nova) que retorna só a extensão em minúsculas (`"sem_nome"`/`"sem_extensao"` como fallback
  explícito, nunca `undefined` silencioso). `npx tsc --noEmit` limpo nos 2 arquivos. Achado 5
  (testes automatizados ausentes) fica como débito documentado, sem ajuste — não foi pedido.
  Status: InReview (achado tratado, aguardando decisão de push).
