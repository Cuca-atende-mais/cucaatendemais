# Auditoria — canal Empregabilidade (`empregabilidade_engine.py`), 2026-07-09

**Natureza:** primeira auditoria de código deste canal — nenhum `docs/qa/*.md` anterior tocou nele. Leitura completa do arquivo (2799 linhas), sem teste ao vivo (não foi enviada nenhuma mensagem real no número de teste).

**Escopo importante, confirmado por leitura de código antes de auditar:** ao contrário do canal Institucional (que roda em `supabase/functions/motor-agente/index.ts`, Deno/Edge Function), a Empregabilidade **não passa por ali**. O worker (`meta_adapter_inbound.py:546-561`) desvia mensagens com `agente_tipo == "Empregabilidade"` direto para `worker/empregabilidade_engine.py` — uma máquina de estados própria em Python (`conversas.metadata["empreg_fluxo"]`), com 3 fluxos principais: **empresa** (CNPJ, criação/edição/cancelamento de vaga), **candidato** (consulta de candidatura já feita) e **público** (navegação de vagas abertas, candidatura, banco de talentos). O `agente_tipo === "julia"` que existe em `motor-agente/index.ts:11` é código morto — nenhuma chamada real chega lá.

**Todos os 4 achados abaixo têm teste automatizado vermelho, provando o bug contra o código atual** — ver seção de testes ao final. 52 testes pré-existentes continuam verdes (nenhuma regressão introduzida pela auditoria).

---

### EMP-01 — Filtro de setor por substring ingênua pode esconder vagas já na 1ª mensagem

**Onde:** `intencao_detector.py:270-285` (`extrair_setor_da_mensagem`), usado em `empregabilidade_engine.py:2500` (primeira mensagem de um candidato, dentro de `_rotear_por_intencao`).

**O que acontece:** a keyword `"entrega"` (mapeada para o setor **Logística**) é buscada como substring simples, sem checar limite de palavra — e bate dentro de **"entregar"**. "Quero **entregar** meu currículo pra alguma vaga" é uma frase natural e comum de um candidato na primeira mensagem. O sistema filtra silenciosamente só vagas de Logística e, se não houver nenhuma, responde "Não temos vagas de *entrega* no momento" — mesmo havendo vagas de sobra em outras áreas.

**Mesma classe de bug já corrigida no canal Institucional** (AUD-05, "barragem" continha "barra", corrigido com regex de limite de palavra) — aqui nunca foi corrigida.

**Teste:** `worker/tests/test_intencao_detector.py::test_entregar_curriculo_nao_deveria_disparar_filtro_de_logistica`

**Sugestão de correção:** usar regex com limite de palavra (`\bentrega\b`) em vez de substring pura, mesma técnica já aplicada no Institucional.

---

### EMP-02 — "Quer encerrar" por substring sem limite de palavra, corrigido só em alguns fluxos

**Onde:** `empregabilidade_engine.py:191-193` (`_quer_encerrar`), lista `_PALAVRAS_ENCERRAR` inclui `"obrigado"`, `"obrigada"`, `"valeu"`, `"pronto"` — checados via `any(p in t for p in _PALAVRAS_ENCERRAR)`, substring pura.

**O que acontece:** qualquer mensagem que contenha uma dessas palavras em qualquer lugar do texto — não só como frase isolada — encerra a conversa. Isso é checado em 3 fluxos:
- **Candidato** (`:1267`): **zero exceção de etapa**. E mais grave: esse check roda **antes** de `candidato_consultado` (`:1379-1394`) ter qualquer chance de rodar seu próprio escape semântico (que já existe e trataria isso melhor) — o check genérico intercepta primeiro.
- **Empresa** (`:374`): exceção cobre só 3 de ~14 etapas do fluxo.
- **Público** (`:1494`): exceção cobre só 3 etapas.

O próprio código tem comentários confirmando que a equipe já identificou esse padrão duas vezes e corrigiu pontualmente (`S37C-03` em `pos_candidatura`; um trecho do fluxo empresa) — mas nunca resolveu na raiz. Um "muito obrigado! mas ainda tenho uma dúvida sobre X" em qualquer etapa não coberta encerra a conversa sem aviso.

**Teste:** `worker/tests/test_empregabilidade_engine.py::TestQuerEncerrarSubstringSemLimiteDePalavra::test_obrigado_no_meio_de_pergunta_nao_deveria_encerrar_candidato`

**Sugestão de correção:** resolver na raiz — `_quer_encerrar` deveria considerar só mensagens curtas/isoladas (ex.: a mensagem inteira, após strip, é uma das frases de despedida — não uma substring dentro de uma frase maior), ou usar o classificador semântico (`avaliar_mensagem_contextual`, já usado em outros pontos) em vez de substring cega.

---

### EMP-03 — Negação ignorada em `pos_candidatura` — mesma classe de bug corrigida na etapa vizinha, não aplicada de volta

**Onde:** `empregabilidade_engine.py:1585-1601` (etapa `pos_candidatura`).

**O que acontece:** `quer_mais_vagas = any(p in t_lower for p in (..., "quero", "ok"))` não checa negação. "**Não** quero mais vagas, obrigado" contém "quero" → é lido como pedido de mais vagas, e o fluxo reabre a busca de vagas (mensagem final: "No momento não há vagas abertas nesta unidade... Deseja? Responda *sim* ou *não*") — uma resposta completamente descolada do que o lead disse.

**A etapa seguinte já tem a correção certa:** `oferta_banco_talentos` (`:1626-1629`) checa `tem_negacao` antes de aceitar `quer_banco`, com comentário explicando exatamente esse padrão de bug (referenciando um achado de QA anterior, "bug 5 do relatório"). A correção não foi replicada de volta em `pos_candidatura`.

**Teste:** `worker/tests/test_empregabilidade_engine.py::TestPosCandidaturaNegacaoIgnorada::test_nao_quero_mais_vagas_nao_deveria_reabrir_busca_de_vagas`

**Sugestão de correção:** aplicar o mesmo padrão de `oferta_banco_talentos` — checar negação (`"não"`/`"nao"` no texto) antes de aceitar o fast-path de `quer_mais_vagas`, e nesse caso deixar o classificador semântico (`_escape_semantico_ou_none`) decidir.

---

### EMP-04 — `menu_pos_vaga` reinterpreta a resposta do usuário contra um menu diferente

**Onde:** `empregabilidade_engine.py:1101-1106`.

**O que acontece:** depois de criar uma vaga, o menu oferecido é:
```
1️⃣ Divulgar outra vaga
2️⃣ Acompanhar candidatos desta vaga
3️⃣ Encerrar
```
Mas o dispatch dessa etapa não interpreta a resposta contra essas opções — só troca a etapa para `menu_empresa_acoes` e reprocessa o **mesmo texto**, cujo menu tem opções diferentes:
```
1️⃣ Cadastrar nova vaga
2️⃣ Consultar status de uma vaga
3️⃣ Editar uma vaga
4️⃣ Cancelar uma vaga
```
Uma empresa que responde **"3"** pensando em **"Encerrar"** acaba, sem perceber, no fluxo de **edição de vaga**. (Opções 1 e 2 coincidem por acaso — "3" é a única que diverge de forma perigosa.)

**Teste:** `worker/tests/test_empregabilidade_engine.py::TestMenuPosVagaReinterpretaResposta::test_resposta_3_para_encerrar_e_reinterpretada_como_editar_vaga`

**Sugestão de correção:** `menu_pos_vaga` precisa do próprio dispatch (1=nova vaga, 2=consulta, 3=encerrar), em vez de delegar cegamente pra `menu_empresa_acoes`.

---

## Achado menor / cosmético (sem teste, baixo risco)

**O parâmetro `token` de `_enviar()` (`:96`) nunca é usado dentro da função** — ela sempre lê o token via `os.getenv("META_SYSTEM_USER_TOKEN", "")` diretamente, ignorando o argumento recebido. Não causa bug funcional (o valor certo é usado de qualquer forma), mas é enganoso pra quem for mexer no código depois, achando que passar um token diferente teria efeito.

**Também notado durante o scoping (não é bug ativo):** o mapeamento `RAG_FONTES_POR_AGENTE["julia"] = ["FAQ", "vagas"]` em `motor-agente/index.ts:11` é código morto (nenhuma chamada real usa `agente_tipo: "julia"`), e mesmo se fosse usado, o tipo real de RAG gravado pelo trigger de vagas é `"job_posting"`, não `"vagas"` — mais um resquício morto, sem efeito hoje.

---

## O que ainda não foi auditado

Cobertura desta rodada: helpers/escape hatches, fluxo empresa completo (CNPJ → cadastro → criação/edição/cancelamento de vaga), fluxo candidato completo, fluxo público completo (navegação de vagas, candidatura, banco de talentos), roteamento de entrada (`processar_mensagem_empregabilidade`, `_rotear_por_intencao`, `_processar_menu_inicial`) e o loop de notificação proativa (`empregabilidade_notify_loop`). Isso é essencialmente o arquivo inteiro.

**Não coberto por esta rodada** (fora do escopo de leitura estática de código):
- Teste ao vivo no número de WhatsApp de Empregabilidade — nenhuma mensagem real foi enviada.
- Comportamento real do classificador semântico (`avaliar_mensagem_contextual`) em produção — os testes existentes mockam o GPT; a qualidade real de classificação de frases ambíguas reais depende de validação com a API key de verdade.
- Módulos adjacentes citados na auditoria de escopo mas não lidos a fundo: `talent_bank_matcher.py`, `cv_processor.py`, `import_curriculos.py`.
- O trigger de indexação RAG de vagas (`cuca-portal/supabase/migrations/20260512154109_fix_vaga_rag_conteudo_not_null.sql`) — já sinalizado como área instável em outra story (SQS-54), fora do escopo desta engine de WhatsApp.

---

## Resumo executivo

| ID | Achado | Severidade | Teste vermelho |
|---|---|---|---|
| EMP-01 | Filtro de setor por substring ("entrega" em "entregar") esconde vagas na 1ª mensagem | Alta | ✅ |
| EMP-02 | "Quer encerrar" por substring sem limite de palavra, sem exceção no fluxo candidato | Alta | ✅ |
| EMP-03 | Negação ignorada em `pos_candidatura` — mesmo bug corrigido na etapa vizinha | Média-alta | ✅ |
| EMP-04 | `menu_pos_vaga` reinterpreta resposta contra menu errado ("3=Encerrar" → "3=Editar vaga") | Média-alta | ✅ |
| — | Parâmetro `token` morto em `_enviar()` | Cosmético | — |

**Suíte de teste:** `pytest worker/tests/test_intencao_detector.py worker/tests/test_empregabilidade_engine.py` → **4 failed, 52 passed** (os 4 são os achados acima; os 52 pré-existentes continuam verdes, sem regressão).
