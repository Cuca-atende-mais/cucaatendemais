# S-EMP-FSL-06 — Reaproveitamento de dados + um currículo canônico (só prevenção, sem apagar)

**Status:** Ready for Review
**Epic:** Fluxo do candidato 100% no WhatsApp (sem link)
**Origem:** `PLANO-EXECUCAO-fluxo-sem-link.md` (FSL-06), sessão 2026-08-29.
**Prioridade:** P1 | **Esforço:** M | **Risco:** BAIXO — **decisão do Junior (2026-08-29): nada é
apagado do R2**. Sai o único ponto de risco alto (deleção em produção). Vira só prevenção.
**Depende de:** FSL-03 (coleta self). Relaciona-se com FSL-05 (chave da verdade).

## Contexto

Dois problemas confirmados na sessão:
1. **Reaproveitamento:** a partir da 2ª candidatura, repetir tudo é atrito desnecessário. Sugestão
   do sócio: "já tenho seus dados, sigo ou quer atualizar?".
2. **Duplicação de arquivo no R2:** cada upload cria um arquivo novo (`upload-cv/route.ts:236`,
   `Date.now()+uuid`). Quando a linha é atualizada, o arquivo antigo fica órfão. A opção 5 (criar
   currículo estruturado) agrava.

**Decisão do Junior (2026-08-29):** esta story **não apaga nada**. A regra de "um currículo por
pessoa" é **só prevenção, para entradas novas** — evita criar duplicata quando dá, mas nunca
deleta arquivo. A limpeza de órfãos (antigos e novos) é **dívida técnica fora deste plano**, a ser
tratada depois de tudo concluído, junto com o buraco da identidade (ver plano, seção Dívida
técnica).

## O que precisa ser implementado

### 1. Reaproveitamento (só no caminho self)
- No início do fluxo self, buscar por **chave da verdade (telefone + nome)** se já há dados
  anteriores (nome, data de nascimento) em candidaturas/talent_bank.
- Se sim: "já tenho seu nome e data de nascimento, sigo com eles? (sim / quero atualizar)".
- **PCD e currículo sempre reperguntados** (PCD é rápido; currículo o lead pode querer atualizar).
- Nunca no caminho "outra pessoa" (FSL-05).

### 2. Um currículo canônico por chave da verdade — só prevenção
- Se a pessoa **já tem** currículo e **não manda outro**, reaproveitar a mesma URL — **não sobe
  arquivo novo**. É aqui que a duplicata é evitada na origem.
- Se a pessoa **manda um novo** (ou gera pela opção 5), a linha passa a apontar pro novo. O
  arquivo antigo **fica no R2, intocado** (não apaga — decisão do Junior). Não é problema desta
  story limpá-lo.
- **Proibido chamar `deleteFromR2` nesta story.** Nenhuma deleção de arquivo, em nenhum fluxo.

### 3. Marcar o órfão pra dívida técnica futura (opcional, se barato)
- Se for simples, registrar de forma leve (log/campo) que um arquivo ficou órfão, pra facilitar a
  futura limpeza. **Sem apagar.** Se não for trivial, pular — a limpeza futura vai varrer o R2 de
  qualquer forma.

## Acceptance Criteria

1. 2ª candidatura self oferece reaproveitar nome/data; PCD e currículo sempre reperguntados.
2. Reaproveitamento nunca roda em "outra pessoa".
3. Pessoa com currículo que não manda outro → reusa a mesma URL, **sem subir arquivo novo** (evita
   duplicata na origem).
4. Pessoa que manda um novo → a linha aponta pro novo; o antigo **permanece no R2** (nada é
   apagado).
5. Opção 5 → aponta pro novo, sem apagar o anterior.
6. **Nenhuma chamada de deleção de arquivo em lugar nenhum** (nem fluxo novo, nem link).
7. Botão off → fluxo do link intacto.

## Escopo

**In:** reaproveitamento self, prevenção de duplicata (reusar URL quando possível). **Out:**
qualquer deleção de arquivo no R2 (dívida técnica, fora deste plano); a chave da verdade em si
(FSL-05); limpeza de órfãos antigos.

## ⚠️ Análise de impacto — por item

### Item 1 — Reaproveitamento
- **Toca:** início do fluxo self; consulta a candidaturas/talent_bank por telefone+nome.
- **Impacto observável:** 2ª candidatura mais curta.
- **De-risk:** confirmar que a busca por telefone+nome não traz a pessoa errada (homônimo no mesmo
  número é o buraco conhecido — aceitar como registrado, não travar).

### Item 2 — Currículo canônico (só prevenção, sem risco de deleção)
- **Toca:** a lógica de decidir se sobe arquivo novo ou reusa o existente. **Não toca** a deleção
  (que não existe nesta story).
- **Consome hoje:** a gravação de currículo é compartilhada com o link, mas como **nada é
  apagado**, o pior caso é um arquivo órfão a mais no R2 — igual ao que já acontece hoje, sem
  piora e sem risco de perder currículo.
- **Impacto observável:** menos duplicatas criadas (quando a pessoa reusa). Órfãos residuais
  seguem existindo até a limpeza futura — aceito.
- **De-risk:** confirmar que reusar a URL existente aponta pro arquivo certo da pessoa certa.
  Como não há deleção, não há risco de perda.

## Test plan

- Automatizado: 2ª candidatura self → oferece reaproveitar; PCD/currículo reperguntados.
- Automatizado: "outra pessoa" → sem reaproveitamento.
- Automatizado: pessoa com currículo que não manda outro → reusa URL, não sobe arquivo.
- Automatizado: pessoa manda novo → aponta pro novo, antigo permanece no R2.
- **Verificação de segurança:** grep/revisão confirmando que esta story não introduz nenhuma
  chamada de `deleteFromR2`.
- Regressão: botão off → link intacto.

## Done criteria

- [x] Reaproveitamento self (nome/data), PCD/currículo reperguntados
- [x] Sem reaproveitamento em "outra pessoa" *(caminho não existe mais desde a FSL-05-REV — só
  self existe, por construção)*
- [x] Reusa URL existente quando a pessoa não manda outro (evita duplicata)
- [x] Novo currículo → linha aponta pro novo, antigo permanece (nada apagado)
- [x] Nenhuma deleção de arquivo em nenhum fluxo do chat/motor (confirmado por teste) *(a "opção
  5", fluxo pré-existente e fora do escopo desta story, mantém sua própria deleção guardada de
  antes — decisão registrada, ver Dev Agent Record)*
- [x] Botão off → link intacto *(por construção: a busca de reaproveitamento só roda dentro de
  `_iniciar_coleta_chat`, alcançável só quando o flag já está ligado)*

## Dev Agent Record

### Decisões-chave

1. **Currículo canônico reaproveitado sem lógica nova** — quando há um currículo anterior
   (`arquivo_cv_url` de uma candidatura/talent_bank encontrada), a URL é semeada quieta em
   `curriculo_r2_url` logo na abertura da coleta. A etapa `coletando_ou_confirmando_curriculo`
   (já construída na FSL-03) já sabe confirmar/substituir sozinha — zero código novo pra essa
   parte, e a regra "reusa se não manda outro, aponta pro novo se manda" já era exatamente o
   comportamento dela.
2. **Data só é OFERECIDA quando existe uma anterior** — a fricção real que a story quer resolver
   é a pergunta de data de nascimento; nome continua sendo digitado a cada candidatura (é a
   própria chave de busca, não faz sentido pular). Nova etapa
   `confirmando_reaproveitamento_dados` só entra quando há `data_nascimento` num registro
   anterior com o MESMO telefone + MESMO nome (case-insensitive) do que acabou de ser digitado —
   evita reaproveitar dado da pessoa errada em número compartilhado (homônimo é o buraco
   conhecido e aceito, não travamos por causa dele, só não afirmamos um match que não existe).
3. **Corte de idade reaplicado sobre dado reaproveitado** — extraí
   `_aplicar_data_nascimento_ou_ofertar_banco` (FSL-04 + FSL-06 compartilham a mesma lógica) pra
   garantir que uma vaga que exige 18+ não seja furada só porque a data veio de um registro
   antigo em vez de digitada agora.
4. **"Opção 5" (montar currículo pelo celular, SQS-57/58/63) ficou fora desta story** — é um
   fluxo pré-existente e não relacionado ao "sem link"; ela já tem sua própria deleção
   (`deleteFromR2`) com salvaguarda própria (só remove o que ela mesma gerou, nunca um arquivo
   enviado pelo candidato), aprovada em outra story (SQS-57 AC3) antes desta epic existir.
   Levantado com o Junior; decisão dele: seguir sem mexer — não é uma pendência, é escopo
   corretamente fora.

### File List

- `worker/empregabilidade_engine.py` — `_buscar_dados_anteriores_self`, `_data_iso_para_br`,
  `_aplicar_data_nascimento_ou_ofertar_banco` (extraído, reusado por FSL-04 e FSL-06); nova etapa
  `confirmando_reaproveitamento_dados`; `_iniciar_coleta_chat` busca dados anteriores antes de
  abrir a coleta; novas entradas nos 3 sets de etapas.
- `worker/tests/test_empregabilidade_engine.py` — 12 testes novos (busca por chave da verdade,
  match/não-match por nome, fallback pro talent_bank, falha de consulta, oferta de
  reaproveitamento, fluxo sem dados anteriores, sim/atualizar/ambíguo, corte de idade sobre dado
  reaproveitado, ausência de deleção confirmada por `inspect.getsource`).

### Validação executada

- `pytest` engine + inbound + portal_client + academia_enem + intencao_detector → **417 passed**
  (12 novos, zero regressão).
- `py_compile` OK.
- Grep + teste dedicado confirmam: nenhuma chamada de `deleteFromR2`/`delete_from_r2` no motor.

## STOP conditions

- Qualquer necessidade de apagar arquivo pra fazer a regra funcionar → **parar**. A decisão do
  Junior é não apagar nada nesta fase; se a prevenção não for possível sem deleção, levantar antes
  de seguir. *(Não ocorreu — a prevenção funcionou 100% por reaproveitamento de URL, sem precisar
  de nenhuma deleção nova.)*

## Change Log

- 2026-08-29 — @dev (Dex): FSL-06 — reaproveitamento de nome/data (chave telefone+nome) +
  currículo canônico reaproveitado via mecanismo já existente da FSL-03. Corte de idade
  reaplicado sobre dado reaproveitado. "Opção 5" mantida fora de escopo por decisão do Junior
  (deleção pré-existente, guardada, de outra story). 417 testes, zero regressão. Ready → Ready
  for Review.

## QA Results (@qa — Quinn)

**Veredito: FAIL.** Achado técnico real, dentro do escopo desta story, verificado no código (não
é a mesma categoria da observação da "opção 5", que era de fato fora de escopo).

### O achado — telefone gravado em 2 formatos diferentes, o reaproveitamento nunca encontra o próprio caminho que ele deveria acelerar

`_finalizar_candidatura_chat` (`empregabilidade_engine.py:4620`, código da FSL-03, não tocado
pela FSL-06) grava a candidatura com:
```python
telefone = re.sub(r"\D", "", fluxo.get("telefone_candidato") or phone)
```
Isso só remove caracteres não-numéricos — **não remove o prefixo "55"**. Rastreei a origem: o
`phone` que chega no motor já vem SEMPRE com "55" (confirmado em
`meta_adapter_outbound._normalizar_telefone_br`, formato canônico "5585981733321", 13 dígitos), e
`telefone_candidato` (`_iniciar_coleta_chat`) herda esse valor sem stripar o "55" também.

Só que **todo o resto do sistema grava `candidaturas.telefone` SEM o "55"**:
- O formulário web (`candidatura/page.tsx:140-146`, `formatPhoneInit`) remove o "55" antes de
  exibir/editar o campo, e manda pro portal já sem ele.
- O próprio motor, em outro caminho (SQS-56, `empregabilidade_engine.py:3793`):
  `phone_local_grav = phone[2:] if phone.startswith("55") ... else phone`.
- A busca de "vagas já candidatadas" que já existe (`_buscar_vagas_abertas_e_candidaturas`,
  `:4080-4081`) também remove o "55" antes de consultar.

Reproduzi com os valores reais: candidatura criada pelo fluxo do chat grava `telefone =
"5585981733321"` (13 dígitos). A busca nova da FSL-06 (`_buscar_dados_anteriores_self`) consulta
por `"85981733321"` (11 dígitos, sem "55") — **os dois nunca batem.**

### Por que isso é FAIL e não uma observação

1. **Quebra a própria FSL-06 pro público-alvo dela.** "A partir da 2ª candidatura" é exatamente o
   caso de alguém que já se candidatou **pelo próprio fluxo novo** — e é justo esse caso que nunca
   vai encontrar o registro anterior, porque o telefone gravado na 1ª candidatura está no formato
   errado pra busca da 2ª. Passa em todos os testes porque os testes usam mocks que nunca
   comparam o formato real do telefone contra o que o próprio motor grava — a suíte prova a lógica
   de busca isoladamente, não a integração ponta a ponta do dado gravado por um caminho sendo lido
   por outro.
2. **Blast radius maior que a FSL-06:** a mesma inconsistência já existe desde a FSL-03 e também
   quebra silenciosamente a checagem de "vagas já candidatadas" (`_buscar_vagas_abertas_e_candidaturas`)
   pra qualquer candidatura criada pelo fluxo sem link — um candidato que já se candidatou por lá
   pode ver a mesma vaga listada de novo, porque a query de "já aplicou" também busca pelo telefone
   sem "55" e não vai achar o registro salvo com "55".
3. **Fix é pequeno e preciso** — não é motivo pra reabrir a arquitetura, só alinhar
   `_finalizar_candidatura_chat` (e `_iniciar_coleta_chat`, pra manter `telefone_candidato`
   consistente desde a origem) com o mesmo padrão já usado em `:3793`:
   `phone[2:] if phone.startswith("55") and len(phone) > 11 else phone`.

### 7 quality checks

1. **Code review — FAIL** no ponto acima. Fora isso, a extração de
   `_aplicar_data_nascimento_ou_ofertar_banco` está limpa e bem reaproveitada entre FSL-04/06; a
   busca por chave da verdade (telefone+nome) tem o cuidado certo de não afirmar match quando o
   nome não bate (evita reaproveitar dado da pessoa errada).
2. **Testes — PASS isolado, mas com lacuna de integração.** 417 passed, mas nenhum teste grava uma
   candidatura via `_finalizar_candidatura_chat` e depois tenta encontrá-la via
   `_buscar_dados_anteriores_self` usando o MESMO `phone` de entrada — esse teste de ponta a ponta
   teria pego o defeito antes de mim. Recomendo esse teste ser adicionado junto com o fix.
3. **Acceptance Criteria — bloqueado pelo achado.** AC1 (oferece reaproveitar) não se sustenta na
   prática até o telefone bater; os demais ACs (currículo canônico, sem deleção, botão off) estão
   corretos e comprovados.
4. **Regressão — achado É a regressão** (afeta também a checagem pré-existente de "vagas já
   candidatadas" pro caminho sem link).
5. **Performance — PASS.** Sem mudança de perfil de custo.
6. **Segurança/LGPD — PASS.** Sem exposição nova de dado.
7. **Docs — PASS.** Dev Agent Record claro sobre as decisões tomadas (a "opção 5" continua
   corretamente registrada como fora de escopo, por decisão sua).

### Recomendação

Voltar pro @dev: normalizar a remoção do "55" em `_finalizar_candidatura_chat` (telefone) e em
`_iniciar_coleta_chat` (telefone_candidato), no mesmo padrão já usado em `:3793`. Fix pequeno,
localizado, sem risco de regressão adicional — só alinha o dado gravado com o formato que o resto
do sistema já espera.

## Fix aplicado (@dev — pós-FAIL)

- **`_iniciar_coleta_chat`:** `telefone_candidato` agora normaliza o "55" na origem, mesmo padrão
  já usado em `phone_local_grav` (SQS-56, `:3793`): `tel[2:] if tel.startswith("55") and
  len(tel) > 11 else tel`.
- **`_finalizar_candidatura_chat`:** mesma normalização aplicada defensivamente no `telefone` do
  payload (cobre o fallback `or phone`, caso `telefone_candidato` esteja ausente por algum motivo).
- **2 testes novos** provando o fix: `_iniciar_coleta_chat` grava `telefone_candidato` sem "55";
  e um teste ponta a ponta comparando o telefone que `_finalizar_candidatura_chat` efetivamente
  grava contra o formato que `_buscar_dados_anteriores_self` usaria pra buscar — confirmando que
  batem agora.
- Suíte combinada → **419 passed** (2 novos), zero regressão. `py_compile` OK.

## QA Results (revalidação — @qa Quinn)

**Veredito: PASS.** Fix confere, reproduzi o cálculo end-to-end com os mesmos valores canônicos
do achado original e agora bate.

- **Reprodução direta:** rodei os 3 pontos (grava em `_iniciar_coleta_chat`, grava em
  `_finalizar_candidatura_chat`, busca em `_buscar_dados_anteriores_self`) com `phone =
  "5585981733321"` fora do pytest — os três convergem em `"85981733321"` agora. Antes do fix, a
  escrita ficava em 13 dígitos e a busca em 11; hoje os dois lados do fix estão simétricos.
- **Código — PASS.** As duas normalizações usam o mesmo idioma já estabelecido no arquivo
  (`:3793`, SQS-56) — não inventou um padrão novo, replicou o existente. Grep confirma que
  `telefone_candidato` só é escrito e lido nesses 2 pontos — sem terceiro consumidor que esperasse
  o formato antigo (com "55") e que o fix pudesse ter quebrado.
- **Testes — PASS.** Os 2 testes novos cobrem exatamente o que faltava: um prova a escrita
  (`_iniciar_coleta_chat` grava sem "55"), o outro é ponta a ponta (compara o telefone
  efetivamente gravado por `_finalizar_candidatura_chat` contra o formato que a busca de
  reaproveitamento usaria) — esse segundo é o tipo de teste que já deveria ter existido antes e
  que agora fecha a lacuna de integração que deixou o defeito passar despercebido da 1ª vez.
- **Regressão — PASS.** 419 passed, suíte combinada, zero regressão. `py_compile` OK.
- Com isso, o efeito colateral que eu tinha registrado no FAIL (a checagem pré-existente de
  "vagas já candidatadas" também quebrando pro caminho sem link) fica resolvido junto — mesma
  causa raiz, mesmo fix.

Story pronta pra `Done` quando o @devops fizer o commit/push.

## Change Log

- 2026-08-29 — @qa (Quinn): revalidação — PASS. Fix confirmado por reprodução direta dos 3 pontos
  (escrita em `_iniciar_coleta_chat`/`_finalizar_candidatura_chat`, leitura em
  `_buscar_dados_anteriores_self`) convergindo pro mesmo formato agora. 419 testes, zero
  regressão. Efeito colateral na checagem de "vagas já candidatadas" resolvido junto (mesma causa
  raiz).
- 2026-08-29 — @dev (Dex): fix do achado do @qa — telefone normalizado (sem "55") na origem
  (`_iniciar_coleta_chat`) e defensivamente em `_finalizar_candidatura_chat`. 2 testes novos
  provando escrita/leitura batendo. 419 testes, zero regressão. Ready → Ready for Review.
- 2026-08-29 — @qa (Quinn): gate FAIL — telefone gravado com "55" pelo fluxo do chat
  (`_finalizar_candidatura_chat`, FSL-03) nunca bate com a busca por telefone sem "55" que todo o
  resto do sistema usa (formulário, SQS-56, checagem de "já candidatou"). Bloqueia a própria FSL-06
  pro público que ela deveria acelerar, e também quebra silenciosamente a checagem pré-existente
  de vagas já candidatadas pro caminho sem link. Recomendado voltar ao @dev com fix pequeno e
  localizado.

## Dívida técnica que esta story deixa registrada (fora de escopo)

- Órfãos de currículo no R2 (antigos + os novos que sobrarem) — limpeza segura ("só apagar o que
  nada mais referencia") será tratada depois de tudo concluído, junto com o buraco da identidade
  (telefone+nome). Ver `PLANO-EXECUCAO-fluxo-sem-link.md`, seção "Dívida técnica".
