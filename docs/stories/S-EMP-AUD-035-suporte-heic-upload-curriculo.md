# S-EMP-AUD-035 — Suporte a HEIC no upload de currículo

**Status:** Ready for Review
**Epic:** Auditoria Empregabilidade
**Origem:** Auditoria `AUDITORIA-empregabilidade-2026-08-27.md` (achado BUG-03) + Plano
`028-heic-e-observabilidade-envio-curriculo-publico.md` (Steps 1-2), separada da
S-EMP-AUD-034 (observabilidade) por recomendação do @dev — a causa HEIC ainda é hipótese, não
fato confirmado; a S-EMP-AUD-034, uma vez em produção, é o que vai confirmar (ou descartar) essa
hipótese com dado real antes de investir no suporte a conversão.
**Prioridade:** P2 | **Esforço:** S, mas condicionado ao resultado do Step 1 abaixo (pode virar
M se exigir dependência nova) | **Risco:** LOW/MED — aditivo (aceita mais 1 formato), mas pode
introduzir dependência nova (ex. `sharp`/libheif) se a conversão for necessária.
**Depende de:** recomendado rodar **depois** da S-EMP-AUD-034 estar em produção por um tempo —
os logs de rejeição (Item 3 daquela story) vão mostrar, com dado real, se HEIC é de fato uma
fração relevante das rejeições, em vez de investir aqui só por suspeita.

## Contexto

Fotos tiradas com o app Câmera padrão de iPhone (desde iOS 11, 2017) vêm em formato HEIC/HEIF por
padrão, a não ser que o usuário tenha mudado manualmente a configuração de câmera pra "Mais
Compatível". O upload de currículo (`upload-cv/route.ts`) só reconhece 5 assinaturas de magic
bytes — PDF, JPEG, PNG, DOCX, DOC — e devolve `"Arquivo inválido ou corrompido. Envie apenas PDF,
Word, JPG ou PNG."` pra qualquer HEIC.

Duas candidatas da auditoria relataram "está dando erro" ao enviar currículo pela mesma vaga e só
conseguiram depois de múltiplas tentativas — consistente com essa hipótese, mas **não confirmado**
(pode ter sido erro transitório de rede, sem relação com formato de arquivo). Confidence do achado
original: MEDIUM.

## O que precisa ser implementado

### Step 1 (investigação, antes de codar): o resto do pipeline aceita HEIC?

Ler `cuca-portal/src/app/api/process-cv/route.ts` (rota real confirmada nesta leitura —
`cuca-portal/src/app/api/process-cv/` existe no projeto) pra entender se o OCR de currículo já
lida com qualquer imagem (lib com suporte nativo a HEIF) ou espera JPEG/PNG/PDF especificamente.
**Confirmado nesta leitura:** `package.json` do `cuca-portal` não tem `sharp` nem nenhuma lib de
conversão HEIF hoje — se a conversão for necessária, é dependência nova, não reaproveitamento.

Isso decide entre 2 caminhos:
- **(a)** Se o pipeline exige JPEG/PNG/PDF: aceitar HEIC na validação de magic bytes + converter
  pra JPEG antes de `uploadToR2`, usando uma lib nova (avaliar `sharp` com suporte HEIF — checar
  se builda sem binário nativo pesado no ambiente de deploy atual, ou alternativa mais leve).
- **(b)** Se o pipeline já aceita qualquer imagem: só adicionar a assinatura HEIC à lista de
  `MAGIC_SIGNATURES`, sem conversão, mantendo `ext: "heic"` e o mime correto.

### Step 2: implementar o caminho decidido no Step 1

`cuca-portal/src/app/api/empregabilidade/upload-cv/route.ts` — adicionar detecção de HEIC pela
assinatura (`ftyp` no offset 4-7, brand `heic`/`heix`/`mif1`/`heif` no offset 8-11 — HEIC não tem
assinatura de 4 bytes fixos como os formatos já cobertos, precisa checar os bytes 4-11) como uma
6ª entrada em `MAGIC_SIGNATURES` (linha 7-13), com ou sem passo de conversão conforme o Step 1.

## Acceptance Criteria

1. Upload de um arquivo HEIC real (foto de câmera de iPhone sem configuração alterada, ou arquivo
   `.heic` de amostra) retorna 200 com URL válida, não mais o erro de "arquivo inválido".
2. Upload de arquivo genuinamente inválido (ex. `.txt` renomeado pra `.pdf`) continua sendo
   rejeitado como hoje — não regredir a validação de segurança existente.
3. Se o Step 1 confirmar necessidade de conversão: o arquivo convertido é processável pelo mesmo
   pipeline de OCR que já processa JPEG/PNG hoje, sem tratamento especial.
4. Decisão do Step 1 (converte ou aceita cru) documentada na story antes do Step 2 ser
   implementado — não implementar Step 2 sem essa resposta registrada.

## Escopo

**In:** os 4 ACs acima, restritos a `upload-cv/route.ts` (+ dependência nova, se o Step 1 exigir).
**Out:** observabilidade de erro (S-EMP-AUD-034, já implementada/em implementação separadamente);
mudar a UI do seletor de arquivo (`accept=".pdf,image/png,image/jpeg"`, cosmético).

## ⚠️ Análise de impacto — por item

### Item 1 — Investigação do pipeline de OCR (Step 1)

- **Toca:** nenhuma mudança de código ainda — só leitura de `process-cv/route.ts` e do
  `package.json`.
- **Consome hoje:** decide se o Step 2 precisa de dependência nova ou não.
- **Impacto observável:** nenhum ainda.
- **De-risk:** ler o código real antes de estimar esforço — já confirmado nesta story que
  `sharp`/libheif não está no `package.json` hoje, então qualquer conversão é dependência nova, a
  avaliar com cuidado (tamanho do pacote, se builda sem binário nativo no ambiente de deploy do
  `cuca-portal` no EasyPanel).

### Item 2 — Adicionar assinatura HEIC + (talvez) conversão

- **Toca:** `MAGIC_SIGNATURES` e `detectMagicBytes` em `upload-cv/route.ts` — validação usada por
  **todo** upload de currículo do canal Empregabilidade (não só o caso de foto de iPhone).
- **Consome hoje:** o resultado alimenta `uploadToR2` e, depois, o pipeline de OCR
  (`process-cv`) — se o Step 1 mostrar que o OCR não lida com HEIC cru, pular a conversão quebraria
  a extração de texto do currículo silenciosamente (upload "funciona", mas o currículo não é lido
  depois) — por isso o Step 1 é bloqueante antes do Step 2, não opcional.
- **Impacto observável:** candidatos com foto de iPhone (formato padrão desde 2017) passam a
  conseguir enviar currículo sem precisar mudar configuração de câmera ou tentar múltiplas vezes.
- **De-risk:** AC2 garante que a validação de segurança pra arquivos genuinamente inválidos não
  regride. Teste manual com arquivo HEIC real antes de considerar pronto — não só teste
  automatizado com mock de bytes.

## Test plan

- Upload de arquivo HEIC real — confirmar sucesso (AC1).
- Upload de arquivo genuinamente inválido — confirmar que segue rejeitado (AC2).
- Se conversão implementada: confirmar que o arquivo convertido passa pelo OCR normalmente
  (AC3) — teste ponta a ponta, não só o upload isolado.

## File List

- `cuca-portal/src/app/api/empregabilidade/upload-cv/route.ts`:
  - `isHeic` — checa a caixa `ftyp` + brand no offset 4-11 (HEIC não tem assinatura fixa de 4
    bytes como os formatos existentes).
  - `converterHeicParaJpeg` (substituiu a chamada direta a `heic-convert` — v0.4, achado @qa) —
    usa `heic-decode.all()` pra ler width/height do HEIC **antes** de decodificar os pixels
    (barato, só cabeçalho), aplica o limite de dimensão/megapixel, só então decodifica de
    verdade e codifica pra JPEG via `jpeg-js` (mesma fórmula de quality que `heic-convert` usa
    por trás, `Math.floor(quality*100)` — saída equivalente, só com o gate no meio). Timeout de
    15s tanto na leitura do cabeçalho quanto na decodificação dos pixels, com `clearTimeout` no
    lado perdedor da corrida (achado @qa v0.6). Reaplica `MAX_SIZE_BYTES` sobre o JPEG resultante
    (HEIC comprime melhor, pode sair maior convertido). `try/finally` chamando
    `imagens.dispose?.()` — achado @qa v0.6 (crítico): `.all()` não libera o decoder WASM sozinho
    como `.one()` fazia, sem o dispose manual todo HEIC convertido com sucesso vazava memória.
  - Checagem de MIME do cliente (Step 3 do fluxo existente) pulada quando o arquivo já foi
    convertido de HEIC (o navegador declara `image/heic`/vazio, irrelevante depois da conversão).
- `cuca-portal/package.json` / `package-lock.json`:
  - `heic-decode` + `jpeg-js` como dependências diretas (+ `@types/heic-decode` em
    devDependencies) — **substituem** `heic-convert`/`@types/heic-convert` (removidos, v0.4): a
    conversão passou a ser feita chamando `heic-decode`/`jpeg-js` diretamente (as mesmas libs que
    `heic-convert` usa por trás), pra poder inserir o gate de dimensão entre a leitura do
    cabeçalho e a decodificação de fato — `heic-convert` não expõe esse ponto intermediário na
    sua API pública. Todas puramente JS/WASM (`heic-decode` via `libheif-js`), sem binário nativo
    pra compilar — mesma cautela de deploy que motivou a escolha original no Step 1.

## Change Log

- v0.1 (2026-08-28): @sm cria a story a partir dos Steps 1-2 do Plano 028, separada da
  observabilidade (S-EMP-AUD-034) por recomendação do @dev — a causa HEIC ainda é hipótese
  (confidence MEDIUM no achado original), e rodar a S-EMP-AUD-034 primeiro em produção vai gerar
  dado real pra confirmar se vale a pena investir aqui antes de codar às cegas. Confirmado nesta
  leitura que não há dependência de conversão HEIF (`sharp` ou similar) no `package.json` hoje —
  qualquer conversão é dependência nova, a avaliar no Step 1. Status: Draft — aguardando
  validação do @po.
- v0.2 (2026-08-28): @po valida — **GO** (9/10 no checklist de validação de story; esforço
  estimado como "S, condicional a M" é honesto mas deixa a story menos previsível que as outras
  3 — aceitável, dado que o Step 1 é investigação obrigatória antes de comprometer estimativa
  fechada). Status: Draft → **Ready**. Confirma a recomendação de sequenciamento já registrada
  na própria story: só iniciar depois da S-EMP-AUD-034 estar em produção por um tempo.
- v0.3 (2026-08-28): Junior pede pra seguir logo após o deploy da S-EMP-AUD-034 — sem esperar
  acumular dado real de produção, como a story recomendava. @dev registra a ressalva e segue por
  decisão explícita do Junior.

  **Step 1 (investigação) concluído — decisão: caminho (a), converter.** Lendo
  `worker/cv_processor.py::process_cv_ocr` (é pra onde `process-cv/route.ts` só repassa a
  chamada): pra qualquer arquivo que não seja PDF, o OCR baixa o arquivo e monta um data URI
  **hardcoded como `image/jpeg`** (`f"data:image/jpeg;base64,{file_b64}"`, linha 251) pra mandar
  pro GPT-4o Vision — a API de Visão da OpenAI **não aceita HEIC** de jeito nenhum (só
  PNG/JPEG/WEBP/GIF não-animado), e mesmo que aceitasse, o mime já sai errado no data URI hoje.
  **Não dá pra só "aceitar cru"** — teria que converter, ou o upload funcionaria mas o OCR falharia
  silenciosamente depois (o problema mudaria de lugar, não seria resolvido).

  **Achado adjacente, fora do escopo desta story:** o mesmo trecho (`cv_processor.py:251`)
  hardcoda `image/jpeg` no data URI **para qualquer imagem**, inclusive PNG hoje já aceito —
  não investiguei se isso já causa algum problema real com PNG (não fazia parte do escopo), só
  registro como achado a considerar numa auditoria futura do pipeline de OCR.

  **Biblioteca escolhida:** `heic-convert` (não `sharp`) — usa `heic-decode` (WASM via
  `libheif-js`, sem binário nativo), evitando o risco de build pesado no ambiente de deploy do
  EasyPanel que a story já tinha sinalizado. `npm install heic-convert @types/heic-convert`
  rodado — 6 pacotes novos, sem alerta de vulnerabilidade crítica adicional (auditoria de
  segurança da dependência em si fora do escopo desta story).

  **Implementação:** `isHeic()` detecta a caixa `ftyp` + brand HEIC/HEIF (não confunde com MP4/MOV,
  que também usam `ftyp` mas brands diferentes — testado). Quando detectado, converte pra JPEG
  via `heic-convert` **antes** de `uploadToR2`, tratando o resultado como um JPEG normal daí em
  diante (mesma extensão/mime, mesmo pipeline de OCR, sem tratamento especial — AC3).

  **Teste manual com arquivo HEIC real (não mock de bytes)** — sem HEIC de amostra disponível
  neste ambiente (as 3 amostras `.heic` encontradas no disco eram na verdade JPEG mal-rotulado,
  confirmado pelos magic bytes `ffd8ff`), gerei 1 HEIC genuíno e válido localmente
  (`pillow-heif`, biblioteca Python instalada e **removida logo depois de gerar o arquivo** — não
  faz parte da aplicação) e rodei a conversão real via `heic-convert`: HEIC de 447 bytes → JPEG
  de 699 bytes, assinatura `ffd8ff` confirmada. Confirmado também que arquivo genuinamente
  inválido (texto puro) e um arquivo `ftyp`-based não-HEIC (MP4 simulado) continuam **não**
  reconhecidos como HEIC — AC2 preservado.

  `npx tsc --noEmit` limpo no arquivo tocado (mesmos 4 erros pré-existentes em `tests/*.test.ts`,
  sem relação). Nenhum teste automatizado novo (não havia suíte prévia pra esta rota — mesmo
  débito já registrado na S-EMP-AUD-034).

  Status: Ready → **InReview** (aguardando @qa).
- v0.4 (2026-08-28): @qa revisou — **CONCERNS** (aprovado, com 1 achado não-bloqueante, mas que
  merece atenção maior que os anteriores desta leva). Ver "QA Results" abaixo. Status: InReview
  → **Ready for Review** (pronta pro @devops, aguardando decisão do Junior).

## QA Results

### Review em 2026-08-28 — @qa Quinn

**Gate: CONCERNS** (aprovado — não bloqueia, mas o achado 5 merece decisão consciente, não só
"ok, documentado")

**7 checks:**

1. **Code review** — implementação limpa, reaproveita a estrutura existente (`detected`/`ext`/`mime`)
   sem duplicar o fluxo de validação. A decisão de pular a checagem de MIME do cliente só quando
   `convertidoDeHeic` é precisa e bem comentada. O achado do Step 1 (GPT-4o Vision não aceita HEIC
   e o data URI já sai hardcoded como `image/jpeg`) é a peça mais valiosa desta story — sem essa
   investigação, a implementação óbvia ("só aceitar o byte cru") teria passado no upload e falhado
   silenciosamente no OCR, exatamente o tipo de erro que motivou a S-EMP-AUD-034 existir. Bom
   trabalho de causa raiz antes de codar.
2. **Testes** — sem suíte automatizada (mesmo débito já aceito na S-EMP-AUD-034, não havia
   suíte prévia pra esta rota). Em compensação, o teste manual foi genuíno, não simulado: 3
   arquivos `.heic` já existentes no disco descobertos como JPEG mal-rotulado (achado interessante
   por si só — magic bytes conferidos, não assumidos), 1 HEIC real gerado localmente pra provar a
   conversão de ponta a ponta (447→699 bytes, assinatura JPEG confirmada), e confirmação de que
   texto puro e um `ftyp` não-HEIC (MP4 simulado) continuam rejeitados. É mais rigor de verificação
   manual do que a maioria das stories desta leva teve.
3. **Acceptance Criteria** — AC1 (HEIC real funciona) confirmado com arquivo genuíno, não mock.
   AC2 (arquivo inválido continua rejeitado) confirmado. AC3 (convertido processável pelo mesmo
   OCR sem tratamento especial) — verificado por leitura de código (`cv_processor.py` trata
   qualquer não-PDF via base64+Vision, e o resultado convertido é um JPEG de verdade agora, não
   mais um mismatch de mime) — não testado ponta a ponta com o OCR real (exigiria chamada real à
   OpenAI, fora do alcance razoável desta verificação). AC4 (decisão do Step 1 documentada antes
   do Step 2) — cumprido, com evidência técnica registrada no Change Log v0.3, não só afirmado.
4. **Regressão** — `npx tsc --noEmit` conferido de forma independente, limpo no arquivo tocado
   (mesmos 4 erros pré-existentes em `tests/*.test.ts`). Suíte do worker (272 testes) também
   rodada — sem relação direta com esta story, mas confirma que nada foi quebrado por engano.
5. **Segurança — achado MEDIUM/ALTO, não-bloqueante, mas peço atenção real.** A conversão de HEIC
   decodifica a imagem inteira **localmente, dentro do próprio processo do Next.js**
   (`heic-decode`/`libheif-js`, WASM) — isso é estruturalmente diferente de como o upload trata
   JPEG/PNG hoje, que nunca são decodificados nesta rota (só os primeiros bytes são lidos pra
   checar a assinatura; a decodificação de verdade só acontece depois, do lado da OpenAI, quando o
   OCR roda). **Não há limite de dimensão nem timeout na conversão** — um HEIC malicioso, dentro do
   limite de 10MB de upload, mas com dimensões desproporcionais ao tamanho comprimido (compressão
   HEVC é muito eficiente, isso é factível), poderia forçar a decodificação de uma imagem
   gigantesca em memória (padrão conhecido como "image bomb"), consumindo memória/CPU do processo
   Next.js por requisição — e essa rota, hoje, **não tem rate limit** (confirmei por busca — nada
   de `rate.limit`/`rateLimit` neste arquivo nem em `candidatura/page.tsx`). Não é uma vulnerabilidade
   confirmada (não tentei reproduzir um HEIC malicioso — fora do escopo razoável desta verificação),
   é um vetor plausível que a mudança **introduz de fato**, não um risco pré-existente. Mitigação
   futura recomendada, não bloqueante agora: limite de dimensão pós-decodificação (`heic-decode`
   retorna width/height antes de converter) e/ou timeout na chamada de conversão.
6. Também observo, no mesmo tema (não elevo a severidade por isso sozinho): não há re-checagem de
   `MAX_SIZE_BYTES` **depois** da conversão — HEIC comprime melhor que JPEG, então um HEIC de 9MB
   (dentro do limite) pode virar um JPEG bem maior antes de ir pro R2. Não é falha de segurança,
   é uma inconsistência de expectativa de tamanho que vale um ajuste barato se o achado 5 for
   endereçado junto.
7. **Documentação** — Change Log excepcionalmente completo: acompanha o raciocínio técnico do
   Step 1 (a descoberta do GPT-4o Vision + o achado adjacente do mime hardcoded), a decisão da
   biblioteca com justificativa, e o processo real de teste (incluindo a descoberta dos arquivos
   `.heic` falsos no disco). Referência de qualidade pras próximas stories da leva.

**Resumo:** aprovado para seguir — a lógica está correta, testada com rigor genuíno (não só
unidade), e o achado de segurança (5) é uma introdução real desta mudança, não um bug na
implementação em si. Diferente dos achados anteriores desta leva (testes faltando, nome de
arquivo em log), este eu recomendaria não deixar só como "débito documentado" indefinidamente —
vale ao menos um limite de dimensão antes de considerar a feature 100% fechada, mesmo que não
agora.

- v0.5 (2026-08-28): Junior pede pra tratar o achado 5 antes do push. @dev implementa:
  - `converterHeicParaJpeg` substitui a chamada direta a `heic-convert` — agora usa
    `heic-decode.all()` pra obter width/height do HEIC **antes** de decodificar os pixels (só
    lê o cabeçalho do container HEIF, barato), checando o limite (10.000px por lado, 40
    megapixels no total — generoso acima de qualquer foto/panorama real de celular, mas limita o
    pior caso a ~160MB de buffer) **antes** de chamar a parte cara (`decode()`).
  - Timeout de 15s tanto na leitura do cabeçalho quanto na decodificação dos pixels
    (`Promise.race`), endereçando também a parte de "sem timeout" do achado 5.
  - Reaplica `MAX_SIZE_BYTES` sobre o JPEG resultante (achado 6 do @qa, tratado junto por ser
    barato e do mesmo tema).
  - `heic-convert`/`@types/heic-convert` removidos das dependências — substituídos por
    `heic-decode`/`jpeg-js` (que já eram as libs usadas por trás de `heic-convert`) chamados
    diretamente, porque `heic-convert` não expõe um ponto intermediário na API pública pra
    inserir o gate de dimensão entre ler o cabeçalho e decodificar os pixels de fato.
  - **Verificação:** reproduzido o mesmo teste real do v0.3 (HEIC genuíno gerado localmente,
    64x48px) através do novo caminho de código — conversão continua funcionando, mesma
    assinatura JPEG confirmada, dimensões reais lidas corretamente do cabeçalho antes da
    decodificação completa. Guard de dimensão testado com um caso sintético (20000x20000,
    acima do limite) — bloqueia corretamente. `npx tsc --noEmit` limpo (mesmos 4 erros
    pré-existentes em `tests/*.test.ts`).
  - Status: Ready for Review → **InReview** (aguardando @qa revisar o ajuste).
- v0.6 (2026-08-28): @qa revisa o ajuste v0.5 — **FAIL, não é débito, precisa de correção antes
  do push.** Ver "QA Results (v0.5)" abaixo. Status: InReview → **InProgress** (de volta pro
  @dev).

## QA Results (v0.5) — review do ajuste de dimensão

### Review em 2026-08-28 — @qa Quinn

**Gate: FAIL** (não bloqueia por falta de teste ou observabilidade, como os achados anteriores
desta leva — bloqueia porque a correção do achado 5 introduziu um **vazamento de memória real e
garantido**, em todo upload de HEIC bem-sucedido).

**O achado:** `heic-decode` tem 2 modos — `.one()` (o que a v0.3 usava, via `heic-convert`) faz
`try { decodeImage(data[0]) } finally { dispose() }`, ou seja, **libera os recursos do decoder
WASM automaticamente**. `.all()` (o que a v0.5 passou a usar, pra conseguir ler width/height
antes de decodificar) **não libera nada sozinho** — devolve um array com uma propriedade
`dispose` (não-enumerable, por isso fácil de não notar) que **o chamador precisa invocar
manualmente**. Conferi o código-fonte de `heic-decode/lib.js` linha a linha e confirmei
empiricamente, rodando o pacote real:

```
$ node -e '... await heicDecode.all({buffer}) ...'
tem .dispose? function
```

`converterHeicParaJpeg` (v0.5) chama `heicDecode.all(...)` e **nunca chama `.dispose()`** em
lugar nenhum — nem no caminho de sucesso, nem no de erro. Isso significa: **todo HEIC convertido
com sucesso vaza o decoder WASM e os handles de imagem** (`image.free()`/`decoder.decoder.delete()`
nunca são chamados). Rodando em produção, cada foto de iPhone enviada por um candidato deixa esse
lixo pra trás — é o tipo de coisa que não aparece em teste manual isolado (a memória some quando
o processo Node encerra, então 1 teste manual nunca mostra o problema), só se acumula com uso
real ao longo do tempo até o processo do `cuca-portal` degradar ou reiniciar por OOM.

**Ironia do achado:** a v0.5 existe pra evitar consumo de memória descontrolado (o achado 5
original), e a implementação da correção introduziu um vazamento de memória garantido no
caminho feliz — pior, em certo sentido, que o risco que estava sendo mitigado (aquele era só
teórico/condicional a um HEIC malicioso; este é real e acontece em **toda** conversão bem-sucedida).

**Correção necessária:** envolver o corpo de `converterHeicParaJpeg` (depois de obter `imagens`)
em `try { ... } finally { imagens.dispose?.() }`, chamando dispose tanto no caminho de sucesso
quanto no de erro (rejeição por dimensão, erro de decode, etc.) — só não no caso do próprio
`heicDecode.all()` nunca ter resolvido (timeout no cabeçalho), onde não há `imagens` pra dispor.

**Achado 2 (LOW, não-bloqueante, pode ir junto):** `comTimeout` nunca chama `clearTimeout` no
temporizador perdedor da corrida — quando a promessa principal resolve primeiro, o timer de até
15s continua agendado até disparar sozinho (rejeitando uma `Promise.race` que já resolveu, no-op,
mas ainda assim um timer pendurado por até 15s a cada conversão). Barato de corrigir junto,
guardando a referência do `setTimeout` e limpando no `.finally`/sucesso.

**Achado 3 (nota, não é bug):** `Promise.race` não cancela de fato o trabalho perdedor — se o
timeout de leitura do cabeçalho disparar mas `heicDecode.all()` resolver depois, o `imagens`
resultante fica sem ninguém pra chamar `.dispose()` nele (a variável já saiu de escopo). É uma
limitação inerente a implementar timeout sem `AbortController` de verdade (que `heic-decode` não
oferece) — aceitável como trade-off, só registro pra não parecer que ninguém pensou nisso.

**Resto da verificação (sem problema):** dimensões lidas corretamente antes do decode completo
(confirmado por leitura de código + teste do @dev), guard de threshold correto, conversão real
continua funcionando (mesmo teste do v0.3, revalidado). O problema é especificamente a falta de
`dispose()`, não a lógica de gate em si.

- v0.7 (2026-08-28): @dev corrige os 2 achados do v0.6:
  - `converterHeicParaJpeg` — corpo inteiro (do gate de dimensão até o encode) envolvido em
    `try/finally`, chamando `imagens.dispose?.()` no finally — cobre tanto o caminho de sucesso
    quanto qualquer erro lançado no meio (dimensão acima do limite, timeout de decode, JPEG
    acima do tamanho). Documentado no comentário que o timeout na LEITURA do cabeçalho (a
    primeira `comTimeout`) continua sem cobertura de dispose — se `heicDecode.all()` nunca
    resolve a tempo, não existe `imagens` pra liberar (limitação aceita, sem `AbortController`
    real disponível na lib).
  - `comTimeout` — agora guarda a referência do `setTimeout` e chama `clearTimeout` num
    `.finally()` do `Promise.race`, nos dois usos (leitura de cabeçalho e decode de pixels).
  - **Verificação:** reproduzido o mesmo teste real (HEIC genuíno de 64x48px) através do código
    corrigido — `dispose chamado? true`, conversão continua idêntica (699 bytes, assinatura
    `ffd8ff`). `npx tsc --noEmit` limpo (mesmos 4 erros pré-existentes).
  - Status: InProgress → **InReview** (aguardando @qa revisar a correção).
- v0.8 (2026-08-28): @qa revisa a correção — **PASS**. Ver "QA Results (v0.7)" abaixo. Status:
  InReview → **Ready for Review** (pronta pro @devops).

## QA Results (v0.7) — review da correção do vazamento

### Review em 2026-08-28 — @qa Quinn

**Gate: PASS**

Conferi o diff linha a linha e rodei minha própria verificação independente, indo além do que o
@dev já tinha testado:

1. **Caminho de sucesso** — `imagens.dispose?.()` no `finally` cobre corretamente o retorno
   normal (`return jpeg` dentro do `try` ainda executa o `finally` antes de a função retornar de
   fato — comportamento padrão de JS, sem pegadinha aqui).
2. **Caminho de erro — testei especificamente, o @dev tinha testado só o sucesso.** Forcei uma
   rejeição por dimensão (limite artificialmente baixo) contra o HEIC real e confirmei:
   `dispose()` roda igual, mesmo com a exceção sendo lançada no meio do `try`.
3. **`clearTimeout` — confirmado indiretamente, de um jeito mais forte que só ler o código.**
   Rodei o script de teste sem nenhuma chamada explícita de `process.exit()` e cronometrei: o
   processo Node encerrou sozinho em 9ms. Se o timer não tivesse sido limpo, o processo ficaria
   vivo até 15s (o `setTimeout` não tem `.unref()`, então by default mantém o event loop
   ocupado) — 9ms é prova de que o `clearTimeout` está funcionando de verdade, não só
   sintaticamente presente.
4. **Regressão** — `npx tsc --noEmit` conferido, limpo no arquivo. Comportamento de conversão
   idêntico ao v0.3/v0.5 (mesmo HEIC de teste, mesma saída).
5. **Limitação documentada, aceita** — o timeout na leitura do cabeçalho (1ª `comTimeout`) ainda
   não tem cobertura de dispose se disparar antes de `heicDecode.all()` resolver. Confirmei que
   isso é inerente à falta de `AbortController` na lib, não uma omissão do @dev — documentado no
   código, não escondido.

**Resumo:** correção completa e verificada nos dois caminhos (sucesso e erro), não só no que já
tinha passado antes. Aprovado sem ressalvas novas.
