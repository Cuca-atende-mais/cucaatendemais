# Auditoria — `cv_processor.py` + `talent_bank_matcher.py` + `import_curriculos.py` (foco correção/segurança/performance/testes/tech-debt)

**Data:** 2026-07-17
**Autor:** Auditoria independente (João/sócio + Claude Code), não-implementação — este documento reporta diagnóstico, não aplica fixes.
**Escopo:** `worker/cv_processor.py` (473 linhas, PRIMÁRIO), `worker/talent_bank_matcher.py` (416 linhas, PRIMÁRIO), `worker/import_curriculos.py` (305 linhas, SECUNDÁRIO — script CLI manual, não é caminho de tráfego ao vivo). Terceira rodada de auditoria do canal Empregabilidade, mesmo recorte das duas anteriores (`docs/qa/AUDITORIA-motor-agente-2026-07-16.md` para Institucional, `docs/qa/AUDITORIA-empregabilidade-2026-07-17.md` para o motor de estados). Este é o pedaço que ficou explicitamente fora de escopo na rodada anterior: processamento de currículo/PDF, banco de talentos, importação em massa.
**Fora de escopo nesta rodada:** o portal Next.js (`cuca-portal`) que chama esses endpoints — só foi lido o suficiente para confirmar/refutar 2 achados de segurança (rastreei a cadeia de autorização até lá porque era necessário pra avaliar SEC-01 e SEC-02 honestamente), não uma auditoria completa do portal.
**Método:** leitura completa dos 3 arquivos (4 subagents paralelos, um por categoria, mais vetting pessoal — confirmei diretamente no código os 2 achados mais graves antes de incluir aqui). **Não executei nada** (sem suíte de teste pra esses módulos — ver TEST-01) nem chamei a API da OpenAI pra confirmar exploits.
**Ferramenta usada:** skill `improve`, mesma das duas rodadas anteriores.

**Nota sobre esta entrega**: igual na rodada anterior, **não foram gerados `plans/`** por pedido explícito — este documento é diagnóstico completo e vetado pra você (Claude do Valmir) avaliar com o contexto de produto que só vocês têm, e decidir prioridade/plano.

---

## Diagnóstico

### 🔴 Achados de maior severidade/leverage

#### SEC-01 — Triagem do banco de talentos não verifica se a vaga pertence a quem está pedindo

**Arquivo:** `talent_bank_matcher.py:194-244` (`triar_banco_talentos`), `worker/main.py:513-534` (endpoint HTTP)

```python
@app.post("/triar-banco-talentos")
async def triar_banco_talentos_endpoint(request: Request):
    payload = await request.json()
    vaga_id = payload.get("vaga_id")
    ...
    candidatos = await triar_banco_talentos(vaga_id, quantidade=..., ...)
    return {"candidatos": candidatos}
```

Esse endpoint **não tem nenhuma checagem de autenticação** — compare com `worker/main.py:431-439`, que exige header `x-internal-token` pra outra rota M2M; essa não tem nada equivalente. `triar_banco_talentos` (a função em si) busca a vaga só por `id` e depois varre a tabela `talent_bank` inteira filtrando só por setor/demografia — nunca confirma que `vaga_id` pertence à empresa de quem está chamando. Segui a cadeia até o portal Next.js (`cuca-portal/src/app/api/empregabilidade/vagas/[id]/triar-banco-talentos/route.ts:12-24`) pra ver se a checagem existe lá — **também não existe**: o portal só confirma que *algum* usuário está logado, nunca que aquele usuário é dono daquele `vaga_id`.

- **Impacto:** ALTO — qualquer conta de empresa logada no portal pode pedir triagem contra um `vaga_id` arbitrário/inventado e receber nome, telefone, data de nascimento, currículo e dados demográficos sensíveis (`pcd`, `pcd_tipo`, `genero`) de candidatos do banco de talentos inteiro, não só dos que se candidataram à vaga dela. Combina com o SEC-01 da rodada anterior (autenticação fraca de empresa por CNPJ) — quem sequestrar uma sessão de empresa daquele jeito herda esse acesso irrestrito também.
- **Esforço do fix:** M — resolver `vaga_id` → `empresa_id` e rejeitar se não bater com a empresa autenticada da sessão (não a que vier no corpo da requisição); replicar a checagem no FastAPI como defesa em profundidade.
- **Risco do fix:** BAIXO/MÉDIO — precisa confirmar que toda vaga (inclusive `selecao_evento`) tem `empresa_id` populado de forma confiável.
- **Confiança:** HIGH (rastreei a cadeia de autorização inteira, do FastAPI até a rota Next.js — não existe checagem em nenhuma camada).

#### BUG-01 — `process_cv_espontaneo` nunca lê o conteúdo do PDF — GPT inventa dado de currículo a partir do nada

**Arquivo:** `cv_processor.py:322-354`

```python
file_b64 = await download_file_as_base64(cv_url)   # baixa o arquivo...
...
is_pdf = cv_url.lower().endswith(".pdf")
messages = [
    {"role": "system", "content": prompt_sys},
    {"role": "user", "content": [
        {"type": "text", "text": "Extraia as informações deste currículo:"},
        {
            "type": "image_url" if not is_pdf else "text",
            **({"image_url": {"url": f"data:{media_type};base64,{file_b64}", "detail": "high"}}
               if not is_pdf else {"text": f"[Currículo PDF em base64 - URL: {cv_url}]"}),  # ← nunca usa file_b64!
        },
    ]}
]
```

O arquivo É baixado (`file_b64`), mas quando é PDF, a mensagem enviada ao GPT é só o texto literal `"[Currículo PDF em base64 - URL: ...]"` — nem o texto extraído do PDF (diferente de `process_cv_ocr`, que chama `extract_text_from_pdf` corretamente), nem os bytes baixados. Confirmei pessoalmente: `file_b64` é calculado e nunca referenciado de novo no branch PDF.

- **Impacto:** ALTO — toda candidatura espontânea (currículo avulso, sem vaga associada) enviada como PDF — provavelmente a maioria — faz o GPT **inventar** escolaridade, habilidades, experiência do zero (o schema de resposta é rígido, então ele sempre retorna um JSON "válido"), e isso é gravado em `talent_bank.skills_jsonb` com `"ocr_processado": True`, indistinguível de um OCR real. Corrompe silenciosamente dado de candidato real, e alimenta a triagem (`triar_banco_talentos`) que empresas usam pra decidir quem entrevistar.
- **Esforço do fix:** S — reusar `extract_text_from_pdf(pdf_bytes)` (já existe no mesmo módulo) no branch PDF, mesmo padrão de `process_cv_ocr`.
- **Risco do fix:** BAIXO — aditivo, o caminho atual já está quebrado.
- **Confiança:** HIGH (confirmei pessoalmente lendo o código — `file_b64` é provadamente não usado no branch PDF).

#### BUG-02/PERF-01 — Chamadas síncronas ao banco travam o worker inteiro — e aqui o worker é **um único processo**

**Arquivo:** `cv_processor.py:168,172,283,303,308,310,372,455`, `talent_bank_matcher.py:207-209,250` (todas sem `asyncio.to_thread`), `worker/Dockerfile` (confirma `gunicorn -w 1 -k uvicorn.workers.UvicornWorker`)

Mesmo padrão já achado no `empregabilidade_engine.py` na rodada anterior — mas aqui é mais grave, porque confirmei no `Dockerfile` que o worker roda como **um único processo** (`-w 1`), um único event loop pra tudo. `triar_banco_talentos` sozinha emite mais de 10 chamadas sequenciais ao Supabase (busca de vaga, busca de banco de talentos, updates por candidato dentro do loop de OCR) — cada uma trava o processo inteiro, não só aquela requisição. Isso significa: enquanto uma triagem está rodando, **nenhuma mensagem de WhatsApp de nenhum canal está sendo processada**.

- **Impacto:** ALTO — afeta a responsividade de todo o worker (não só Empregabilidade), agrava sob volume, e come parte do orçamento de 30s do Cloudflare (ver achado seguinte) com tempo morto que nem é processamento de GPT.
- **Esforço do fix:** M — migrar pro client assíncrono do supabase-py, ou envolver cada `.execute()` em `asyncio.to_thread`.
- **Risco do fix:** MÉDIO — API do client assíncrono é ligeiramente diferente; precisa de teste depois da troca.
- **Confiança:** HIGH.

#### PERF-02 — Loop de "buscar currículo sob demanda" na triagem não tem orçamento de tempo próprio — risco real de estourar os 30s do Cloudflare

**Arquivo:** `talent_bank_matcher.py:358-386`

O código já documenta explicitamente (`:313-321`) que existe um teto de 30s de wall-clock imposto pelo Cloudflare na rota que chama essa função, e por isso o loop principal de varredura (`MAX_VARRER`) é limitado de propósito. Mas o **passo 6** — completar candidatos faltantes fazendo OCR sob demanda — não tem esse mesmo limite: itera até `slots_restantes * 3` candidatos (pode ser 15), cada um fazendo download + 1 chamada GPT (OCR) + outra chamada GPT (ranking) + uma pausa de 0.3s, sequencialmente, sem checar quanto tempo já passou.

- **Impacto:** ALTO — usando a própria estimativa do código (~4-6s por chamada GPT), passar por só 2-3 candidatos nesse loop já pode estourar o que sobrou do orçamento de 30s (o loop principal já pode ter consumido 10-15s sozinho). Quando estoura, o Cloudflare mata a requisição no meio — o trabalho de OCR já feito fica gravado no banco, mas a empresa nunca recebe resposta, sem sinal de que foi timeout e não "zero candidatos".
- **Esforço do fix:** M — adicionar checagem de tempo decorrido (`time.monotonic()`) dentro do loop, parando antes de estourar o orçamento, mesmo espírito do `MAX_VARRER` que já existe pro passo principal.
- **Risco do fix:** BAIXO — só retorna menos resultados sob pressão de tempo em vez de nenhum.
- **Confiança:** HIGH que não existe limite (lido diretamente); MED na estimativa exata de tempo por candidato (não instrumentado).

#### TEST-01 — Zero testes nos 4 módulos, e `triar_banco_talentos` já teve regressão real em produção

**Arquivo:** todos os 4 (confirmado por busca — não existe `test_cv_processor*`, `test_talent_bank*`, `test_import_curriculos*`, `test_category_extractor*` em `worker/tests/`)

O histórico do git mostra 5 dos últimos 10 commits em `talent_bank_matcher.py` sendo `fix(talent-bank):` retunando `MAX_VARRER`/timeout/batching — inclusive um commit chamado literalmente `fix(talent-bank): corrige regressão zero resultados`. Isso é evidência direta de que essa função **já quebrou em produção sem teste nenhum pra pegar**, e continua sem.

- **Impacto:** ALTO — qualquer mudança futura de prompt, schema ou threshold é uma aposta sem rede de segurança nessa função que empresas usam pra decidir quem entrevistar.
- **Esforço do fix:** M — mockar `supabase`/`AsyncOpenAI` e escrever testes de caracterização pra: consolidação de score entre batches, truncamento por `MAX_VARRER`, e os 4 pontos de entrada do `cv_processor.py` (parsing de JSON do GPT com resposta válida/truncada/faltando chave).
- **Risco do fix:** BAIXO — só teste novo.
- **Confiança:** HIGH.

#### BUG-03 — No OCR sob demanda, PDF "escaneado" (pouco texto) é enviado como imagem num formato que a API provavelmente rejeita

**Arquivo:** `cv_processor.py:392-402`

```python
if len(texto_pdf) > 200:
    prompt_content = [{"type": "text", "text": f"...{texto_pdf[:6000]}"}]
else:
    file_b64 = base64.b64encode(pdf_bytes).decode("utf-8")
    prompt_content = [
        ...,
        {"type": "image_url", "image_url": {"url": f"data:application/pdf;base64,{file_b64}", ...}},
    ]
```

Quando a extração de texto do PDF rende pouco (o caso clássico de currículo escaneado como imagem — exatamente o cenário que mais precisa do fallback visual), o código manda os bytes crus do PDF como `image_url` com mimetype `application/pdf`. A API de visão da OpenAI documenta aceitar só formatos de imagem (`png`/`jpeg`/`gif`/`webp`) nesse campo — não confirmei isso com uma chamada real (fora do escopo desta auditoria estática), mas é o tipo de coisa que vale um teste rápido antes de confiar. Se a chamada falhar, cai no `except Exception` amplo e retorna `None` — o candidato é silenciosamente excluído da triagem, sem sinal de que era um problema de formato e não "não deu match".

- **Impacto:** MÉDIO-ALTO — atinge justamente os candidatos com currículo escaneado/foto, que são os que mais precisam desse fallback.
- **Esforço do fix:** M — ou mandar o texto curto mesmo (com aviso de baixa confiança), ou converter a página do PDF pra imagem de verdade antes de mandar como `image_url` (nova dependência, tipo `pdf2image`).
- **Confiança:** MED-HIGH (baseado no que a API documenta aceitar, não testado ao vivo — recomendo confirmar com uma chamada real antes de priorizar).

---

### 🟠 Demais achados vetados

| # | Achado | Categoria | Evidência | Esforço | Confiança |
|---|---|---|---|---|---|
| 7 | Download de currículo sem timeout, sem limite de tamanho, sem validar o domínio de destino — SSRF + risco de travar processando PDF malicioso/gigante | segurança | `cv_processor.py:34-39`, `48-54` | S/M | HIGH (falta do limite) / MED (exploração real depende de camada que não li, o portal) |
| 8 | Prompt não instrui o GPT a se abster quando gênero/PCD não está explícito no currículo — risco de fabricar dado sensível sobre pessoa real | segurança | `cv_processor.py:90-93,204-208,415-418` (contraste com telefone, que tem instrução explícita de retornar null) | S | MED |
| 9 | Threshold "score >= 30" só existe como texto de prompt no caminho principal de triagem — nada em Python garante isso, e o log já assume que sim | tech-debt | `talent_bank_matcher.py:116,147` (prompt) vs. `:333-350` (sem filtro em Python) vs. `:377` (só o fallback tem o filtro) | S | HIGH |
| 10 | Sem retry/backoff em nenhum dos 4 pontos de entrada do `cv_processor.py` — falha transiente (rede, rate limit) vira erro permanente sem re-tentativa automática | correção | `cv_processor.py:153-157,315-319,382-383,471-473` | M | HIGH |
| 11 | Falha de um batch de ranqueamento (`_ranquear_batch`) retorna lista vazia, indistinguível de "GPT não achou match nenhum" — sem retry, sem sinalização | correção | `talent_bank_matcher.py:162-186` vs. chamador em `:333-339` | M | HIGH |
| 12 | `MAX_VARRER` (40/60) já foi retunado às cegas pelo menos 4 vezes via commit de fix, sem teste que trave a matemática de tempo/batch | tech-debt | git log de `talent_bank_matcher.py` — 4 commits `fix(talent-bank)` mexendo nesse valor | S/M | HIGH |
| 13 | Corte de crase de markdown (```json) é um slice cego sem validar se a resposta realmente termina em crase — quebra silenciosamente em resposta truncada por `max_tokens` | correção | `cv_processor.py:126-129,268-271,364-367,447-450` (4 cópias quase idênticas) | S | HIGH |
| 14 | Taxonomia de setor/categoria mantida independentemente em 3+ lugares (2 arquivos Python + o frontend Next.js) com formatos de dado diferentes | tech-debt | `talent_bank_matcher.py:22-43` vs. `import_curriculos.py:50-91` vs. 6 arquivos TS no `cuca-portal` | L | HIGH |
| 15 | Bloco de schema JSON do prompt duplicado quase-idêntico 3x; texto de contexto `selecao_evento` duplicado 2x — mudar um campo exige editar em vários lugares em sincronia | tech-debt | `cv_processor.py:86-107,201-222,413-428` (schema); `:64-73,176-185` (selecao_evento) | M | HIGH |
| 16 | Telefone completo do candidato em log a nível INFO | segurança | `cv_processor.py:311` | S | HIGH |
| 17 | Trecho da resposta do GPT (contém nome/skills do candidato) logado a nível WARNING em toda triagem | segurança | `talent_bank_matcher.py:173` | S | MED |
| 18 | Reconsulta desnecessária de telefone logo depois de já ter os dados em mãos | performance | `cv_processor.py:168-169,303,306-311` | S | HIGH |
| 19 | `limpar_nome` pode produzir nome vazio pra arquivo cujo nome é só underscore/espaço; parâmetro `nome` de `ja_existe()` nunca é usado; regex de limpeza tem 2 entradas específicas pra arquivos de pessoas reais (`CVLeticia`, `Rai_curriculo`) em vez de padrão geral | correção/tech-debt | `import_curriculos.py:104-157,172-175` | S | MED |

**Considerados e rebaixados:**

- Cópia redundante de dict (`{**candidatos_map}`) dentro do loop de recomputação de top-matches (`talent_bank_matcher.py:378-382`) — não é bug, só desperdício pequeno (O(n²) num n pequeno). Trivial, não vale plano isolado.
- Path traversal em `import_curriculos.py` (`sanitizar_path`/`subir_arquivo`) — checado especificamente, sem problema: a sanitização remove `/`/`\` antes de montar o destino no Storage. Sem achado.
- `category_extractor.py` — checado por sobreposição com a taxonomia de setor (achado #14) — é uma taxonomia completamente diferente (atividades mensais tipo "Esportes"/"Cultura", não setor de vaga). Sem sobreposição, sem achado.

---

## Perguntas em aberto para o Valmir

1. **SEC-01 (triagem sem checar dono da vaga)** — existe alguma checagem de autorização que eu não vi (talvez em middleware do Next.js que não li a fundo)? Rastreei até a rota específica e não achei nada, mas não fiz uma auditoria completa do portal.
2. **Achado #7 (download sem validação de destino)** — só quem conhece a infraestrutura sabe se o worker está isolado de acesso público direto, e se `cv_url` realmente só pode vir do Storage do próprio Supabase em todos os caminhos (WhatsApp, formulário público, disparo de IA do portal). Isso muda bastante a prioridade real desse achado.
3. **BUG-03 (PDF como image_url)** — vale a pena uma chamada de teste real contra a API da OpenAI antes de priorizar, pra confirmar se de fato falha ou se funciona de um jeito não documentado.
