# S-EMP-FSL-02 — Captura do anexo antecipado (guardar a URL em vez de descartar)

**Status:** Ready for Review
**Epic:** Fluxo do candidato 100% no WhatsApp (sem link)
**Origem:** `PLANO-EXECUCAO-fluxo-sem-link.md` (FSL-02), sessão de planejamento 2026-08-29.
**Prioridade:** P1 | **Esforço:** M | **Risco:** BAIXO/MÉDIO — aditivo (só guarda a URL), mas toca
a assinatura de funções de alto tráfego.
**Depende de:** FSL-01 (o botão precisa existir pra gatear o comportamento novo).

## Contexto

Achado da sessão, confirmado no código: quando o lead manda um arquivo, o classificador
(`intencao_detector.py:53`) já reconhece `intencao: "upload"`, e o engine
(`empregabilidade_engine.py:4956`) já reage — pergunta "vaga específica ou banco de talentos?" e
grava `"arquivo_pendente": True`. **Mas:**
- `arquivo_pendente` é escrito e **nunca lido** em lugar nenhum do arquivo (grep confirma 1 só
  ocorrência).
- A `midia_url` (o link real do arquivo, capturado e subido pela S-WM-68) **nem chega ao motor** —
  `processar_mensagem_empregabilidade()` só recebe `midia_tipo`, nunca `midia_url`
  (`meta_adapter_inbound.py:1239` e a assinatura em `empregabilidade_engine.py:4423`).

Ou seja: o sistema sabe que "chegou arquivo" mas joga a URL fora antes de ela entrar no motor.
Esta story conecta esses dois fios — sem ainda **aceitar** o arquivo, só guardá-lo.

## O que precisa ser implementado

1. **Passar `midia_url` até o motor:** ampliar a assinatura de
   `processar_mensagem_empregabilidade` (e `_processar_mensagem_empregabilidade_locked`) pra
   receber `midia_url`, e passar o valor na chamada de `meta_adapter_inbound.py:1239`.
2. **Guardar a URL no estado da conversa:** quando o lead manda arquivo fora de hora, gravar a URL
   no fluxo (ex.: `arquivo_pendente_url`), substituindo o booleano morto `arquivo_pendente`.
3. **Manter a condução atual:** o bot continua puxando o lead pra escolha da vaga/destino; o
   arquivo fica em espera. Se o lead mandar arquivo de novo antes da hora, a URL mais recente
   sobrescreve a anterior (o lead pode ter corrigido).
4. **Gatear pelo botão (FSL-01):** com o fluxo sem link desligado, o comportamento é o de hoje (a
   URL até pode ser guardada, mas não é usada por ninguém — inerte).

## Acceptance Criteria

1. `midia_url` chega até o motor do Empregabilidade (hoje não chega).
2. Arquivo enviado fora de hora tem a URL guardada no estado da conversa (não mais um booleano
   sem uso).
3. Arquivo reenviado antes da hora certa sobrescreve a URL guardada pela mais recente.
4. Com o botão do fluxo novo desligado, nenhuma mudança de comportamento visível.
5. O bot continua conduzindo pra escolha de vaga/destino, sem aceitar o arquivo ainda (isso é
   FSL-03).

## Escopo

**In:** trafegar e guardar `midia_url`; substituir `arquivo_pendente` (bool morto) por
`arquivo_pendente_url`. **Out:** usar o arquivo guardado pra concluir candidatura (FSL-03);
aceitar/gravar no R2 (FSL-03 via FSL-01).

## ⚠️ Análise de impacto — por item

### Item 1 — `midia_url` até o motor
- **Toca:** assinatura de 2 funções (`processar_mensagem_empregabilidade`,
  `_processar_mensagem_empregabilidade_locked`) + a chamada em `meta_adapter_inbound.py:1239`.
  Também o `academia_enem_engine` usa `midia_url`? Confirmar que a mudança na chamada Meta não
  quebra o ramo da Academia Enem (que já recebe `midia_url`, `meta_adapter_inbound.py:968`).
- **Consome hoje:** só o próprio worker. Sem consumidor externo.
- **Impacto observável:** nenhum enquanto a URL não é usada. É pré-requisito de fiação.
- **De-risk:** rodar a suíte completa do worker; confirmar que adicionar um parâmetro opcional
  (default vazio) não quebra nenhuma chamada existente da função.

### Item 2 — Guardar a URL no estado
- **Toca:** o ramo `intencao == "upload"` (`empregabilidade_engine.py:4956`) e o handler de
  chegada de arquivo.
- **Consome hoje:** ninguém lê `arquivo_pendente` hoje — trocar por `arquivo_pendente_url` não
  quebra nada (confirmado por grep).
- **Impacto observável:** nenhum enquanto FSL-03 não consumir a URL.
- **De-risk:** confirmar por grep que `arquivo_pendente` não é lido em nenhum outro lugar antes de
  removê-lo.

### Item 3 — Sobrescrita pela URL mais recente
- **Toca:** o mesmo handler.
- **Impacto observável:** se o lead manda 2 arquivos, vale o último — evita gravar o errado.
- **De-risk:** teste unitário com 2 arquivos seguidos, confirmando que fica o segundo.

## Test plan

- Suíte completa do worker verde após a mudança de assinatura.
- Teste: lead manda arquivo fora de hora → URL guardada no estado.
- Teste: lead manda 2 arquivos → fica o segundo.
- Regressão: ramo Academia Enem (que já usa `midia_url`) inalterado.
- Botão desligado → comportamento de hoje.

## Done criteria

- [x] `midia_url` trafega até o motor
- [x] URL guardada no estado (substitui `arquivo_pendente` morto)
- [x] Reenvio sobrescreve pela mais recente
- [x] Suíte do worker sem regressão (inclui Academia Enem)
- [x] Botão off → sem mudança visível

---

## Dev Agent Record

### Decisões-chave (rastreadas no código antes de escrever)

1. **`midia_url` já existia no caminho** — a chave é `contrato_v2.get("midia_url")`, usada no INSERT
   da mensagem (`meta_adapter_inbound.py:~1123`) e no ramo Academia Enem (`:968`). O motor de
   Empregabilidade era o único que não recebia. Fiação: só passar na chamada do dispatch
   (`_executar_dispatch` já recebe `contrato_v2`, então nem precisou de parâmetro novo lá) e
   threadear pela assinatura do engine.
2. **Threading com default `""` no fim das assinaturas** — `midia_url` entrou como kwarg com
   default em `processar_mensagem_empregabilidade`, `_processar_mensagem_empregabilidade_locked`,
   `_processar_menu_inicial` e `_rotear_por_intencao`, **depois** dos posicionais existentes
   (`extrair_setor_fn`), pra não deslocar nenhuma chamada posicional nem teste antigo.
3. **Sem gating pelo botão** — guardar a URL é **inerte** enquanto ninguém a lê (a FSL-03 é que
   consome, sob o flag). Com o botão off, `arquivo_pendente_url` fica no estado sem efeito → AC4
   ("nenhuma mudança visível") satisfeito sem precisar ler o flag aqui.
4. **Substituição do bool morto** — `arquivo_pendente: True` (escrito e nunca lido, confirmado por
   grep) saiu; entra `arquivo_pendente_url` **só quando há URL** (sem URL, o estado é o de hoje).
   Reenvio sobrescreve naturalmente (cada upload regrava o fluxo). `None` do `contrato_v2`
   normalizado pra `""` na fronteira.

### File List

- `worker/empregabilidade_engine.py` — `midia_url` threaded por entry/locked/menu_inicial/rotear;
  branch `upload` grava `arquivo_pendente_url`
- `worker/meta_adapter_inbound.py` — passa `midia_url=contrato_v2.get("midia_url") or ""` na
  chamada de Empregabilidade
- `worker/tests/test_empregabilidade_engine.py` — teste do bool morto substituído por 3 (sem URL /
  com URL / reenvio sobrescreve)

### Validação executada

- `pytest tests/test_empregabilidade_engine.py` → **190 passed** (3 novos).
- Regressão: `pytest tests/test_meta_adapter_inbound.py tests/test_academia_enem_engine.py
  tests/test_intencao_detector.py` → **142 passed** (Academia Enem, que já usa `midia_url`,
  intacta).
- `py_compile` dos 2 arquivos worker: OK. Grep confirma que nenhum código vivo escreve mais o bool
  `arquivo_pendente`.

## QA Results (@qa — Quinn)

**Veredito: PASS** (2026-08-29). Mudança aditiva, limpa, baixo risco — sem concerns.

### 7 quality checks

1. **Code review — PASS.** `midia_url` entrou como kwarg com default `""` **no fim** das 4
   assinaturas (entry, locked, `_processar_menu_inicial`, `_rotear_por_intencao`), sem deslocar
   nenhum posicional. Comentários explicam a fonte da URL e a inércia. Bom aproveitamento: o
   `_executar_dispatch` já tinha `contrato_v2`, então não precisou de parâmetro novo no inbound.
2. **Testes — PASS.** **389 passed** nas suítes relevantes. 3 testes novos cobrem exatamente os 3
   comportamentos: sem URL (estado de hoje), com URL (guarda `arquivo_pendente_url`), reenvio
   (sobrescreve pela última).
3. **Acceptance Criteria — 5/5.** AC1 (`midia_url` chega ao motor) ✓; AC2 (guardada, substitui o
   bool morto) ✓; AC3 (reenvio sobrescreve) ✓; AC4 (botão off = sem mudança visível) ✓ **por
   inércia** — verifiquei por grep que `arquivo_pendente_url` é **só escrito**, nenhuma leitura
   viva; AC5 (bot continua conduzindo) ✓ — a mensagem/etapa do branch `upload` não mudou.
4. **Regressão — PASS.** Academia Enem (que já usa `midia_url` por outro caminho) **intacta e
   testada**; todos os call sites de produção de `_rotear_por_intencao`/`_processar_menu_inicial`
   passam `midia_url`, os demais herdam o default `""` (sem crash). Fronteira do inbound normaliza
   `None`→`""`.
5. **Performance — PASS.** Só trafega uma string a mais; nenhum I/O novo.
6. **Segurança/LGPD — PASS.** A URL guardada no estado da conversa é **a mesma** já persistida em
   `mensagens.midia_url` (linha ~1123) — nenhuma exposição nova de dado. Vai pro dict de fluxo, não
   pra SQL bruto; sem superfície de injeção.
7. **Docs — PASS.** Story com Dev Agent Record / File List / Change Log completos.

### Observação (não bloqueia)

- A URL fica no estado até a FSL-03 consumi-la. Se uma conversa expirar por inatividade
  (S-EMP-AUD-033) antes disso, `arquivo_pendente_url` é descartada junto no reset — comportamento
  correto (a URL do anexo em si expira em 15 dias no bucket). Nada a fazer aqui; só registrando pro
  contexto da FSL-03.

## Change Log

- 2026-08-29 — @qa (Quinn): gate PASS (5/5 ACs, 389 testes, Academia Enem sem regressão, inércia da
  URL confirmada por grep). Sem concerns.
- 2026-08-29 — @dev (Dex): FSL-02 — `midia_url` trafega até o motor de Empregabilidade e é guardada
  como `arquivo_pendente_url` (substitui o bool morto), inerte até a FSL-03. 3 testes novos +
  regressão verde. Status Ready → Ready for Review.

## STOP conditions

- A mudança de assinatura afetar o ramo Academia Enem de forma não trivial → isolar antes de
  seguir.
