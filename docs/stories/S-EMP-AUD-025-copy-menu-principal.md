# S-EMP-AUD-025 — Reescreve copy do menu principal (separa Empresa de Candidato)

**Status:** InReview
**Epic:** Auditoria Empregabilidade
**Origem:** demanda direta do Junior, 2026-08-18 ("REFAZER COPY DO MENU PRINCIPAL")
**Prioridade:** P3 | **Esforço:** P | **Risco:** BAIXO — mudança de texto, sem lógica nova

## 1. Copy ATUAL (verbatim do código, `_mostrar_menu_opcoes`, `empregabilidade_engine.py:606-613`)

```
Escolha uma das opções:

1️⃣ *Empresa* — Quero divulgar uma vaga ou marcar seleção
2️⃣ *Candidato* — Quero acompanhar minha candidatura
3️⃣ *Vagas* — Quero ver vagas abertas
4️⃣ *Enviar Currículo* — Quero deixar meu currículo (arquivo pronto) para futuras oportunidades
5️⃣ *Criar meu Currículo agora* — Não tenho currículo pronto, quero montar um pelo celular

Digite *1*, *2*, *3*, *4* ou *5*, ou simplesmente me conte o que você precisa.
```

## 2. Copy nova — como o Junior escreveu originalmente, e a versão FINAL após as respostas

**Como ele escreveu (registro, para rastreabilidade):**

```
Escolha uma das opções:

1️⃣ *Sou Empresa* — Quero divulgar uma vaga ou marcar seleção

--------------------------------------------------------------
2️⃣ *Verificar como esta minha candidatura* - Quero acompanhar minha candidatura

3️⃣ *Ver Vagas Abertas* — Quero ver vagas abertas

4️⃣ *Enviar Currículo Banco de Taletos* — Quero deixar meu currículo (arquivo pronto) para futuras oportunidades

5️⃣ *Criar meu Currículo agora* — Não tenho currículo pronto, quero montar um pelo celular

Digite *1*, *2*, *3*, *4* ou *5*, ou simplesmente me conte o que você precisa.
```

**Versão FINAL, pronta pra implementar** (respostas do Junior aplicadas — seção 4: linha de traços
trocada por linha em branco extra; "Taletos" corrigido pra "Talentos"):

```
Escolha uma das opções:

1️⃣ *Sou Empresa* — Quero divulgar uma vaga ou marcar seleção


2️⃣ *Verificar como esta minha candidatura* - Quero acompanhar minha candidatura

3️⃣ *Ver Vagas Abertas* — Quero ver vagas abertas

4️⃣ *Enviar Currículo Banco de Talentos* — Quero deixar meu currículo (arquivo pronto) para futuras oportunidades

5️⃣ *Criar meu Currículo agora* — Não tenho currículo pronto, quero montar um pelo celular

Digite *1*, *2*, *3*, *4* ou *5*, ou simplesmente me conte o que você precisa.
```

(a linha em branco dupla entre a opção 1 e a 2, acima, é intencional — 1 linha em branco a mais do que
o espaçamento normal entre as outras opções, pra manter o efeito de separação que o Junior pediu, sem
o risco de quebra estranha da linha de traços em tela pequena de celular)

## 3. Achado técnico — existem 2 cópias desse texto no código, as 2 precisam mudar juntas

- `_mostrar_menu_opcoes` (`empregabilidade_engine.py:591-613`) — fonte reutilizada por vários pontos
  (menu inicial, resposta ambígua, bypass "menu"). O comentário do próprio código explica que isso já
  foi centralizado de propósito numa migração anterior (S-WM-20 Task 5) porque, antes, cada ponto
  tinha um texto ligeiramente diferente e isso causava comportamento inconsistente.
- **Cópia solta duplicada** em `empregabilidade_engine.py:1288-1297` — dispara quando o lead diz "não
  sou empresa" no meio da coleta de CNPJ. Tem o texto **antigo** colado ali de novo, fora da função
  centralizada — ou seja, o problema que a S-WM-20 já tinha corrigido uma vez **voltou** nesse ponto
  específico, provavelmente por alguém ter colado o texto na mão em vez de chamar a função. Vou
  corrigir isso: essa 2ª ocorrência vai passar a **chamar `_mostrar_menu_opcoes`** em vez de duplicar
  o texto, prevenindo divergência futura de novo.

## 4. Perguntas — RESPONDIDAS pelo Junior (2026-08-18)

1. ~~**Separador visual**~~ — **RESPONDIDA: linha em branco a mais**, em vez da linha de traços.
   Aplicado na versão final (seção 2).
2. ~~**"Currículo Banco de Taletos"**~~ — **RESPONDIDA: era erro de digitação mesmo, correto é
   "Talentos".** Corrigido na versão final (seção 2).

## 5. Impacto (por item)

| Toca | Consome hoje | Impacto observável | De-risk |
|---|---|---|---|
| `_mostrar_menu_opcoes` | Reusada por: menu inicial, branch ambíguo de `_rotear_por_intencao`, bypass global "menu", fallback de `menu_inicial` | Texto muda em **todos** esses pontos de uma vez — é o comportamento esperado e correto | Nenhum — é o objetivo |
| Cópia solta em `:1288-1297` | Só o fallback "não sou empresa" durante coleta de CNPJ | Troca por chamada a `_mostrar_menu_opcoes` — elimina a duplicação em vez de só atualizar o texto duplicado | Confirmar que os parâmetros dessa chamada (`instance_name, token, phone, conversa_id, lead_id`) já estão todos disponíveis nesse ponto do código (checagem rápida, baixo risco) |
| Roteamento por número (1-5) | `_rotear_por_intencao` e handlers de cada opção | Copy nova mantém as mesmas 5 opções na mesma ordem — **nenhuma mudança de lógica de roteamento necessária** | Confirmar que não mudou quantidade/ordem das opções (não mudou) |

## 6. Valor de negócio

Reduz confusão relatada por usuários reais entre "acompanhar candidatura" (opção 2) e "ver
vagas"/"enviar currículo" (opções 3/4) — separação visual deixa claro que a opção 1 é o único caminho
de empresa, o resto é candidato.

## 7. Acceptance Criteria

1. `_mostrar_menu_opcoes` usa a copy final (seção 2), com linha em branco extra em vez de traços.
2. "Talentos" (corrigido, não "Taletos") na opção 4.
3. A cópia solta em `:1288-1297` passa a chamar `_mostrar_menu_opcoes` em vez de duplicar o texto.
4. Números e comportamento de cada opção permanecem os mesmos de hoje.

## 8. Escopo

**In:** as 2 ocorrências do texto do menu, unificação da 2ª num call à função centralizada.
**Out:** qualquer mudança de lógica de roteamento; qualquer opção nova além das 5 existentes.

## 9. Test plan

- Assert do texto exato final (seção 2) em ambos os pontos de disparo.
- Teste de regressão: opções 1-5 continuam roteando pro mesmo lugar de antes.
- Confirmar visualmente (print/mensagem de teste real, autorizado pelo Junior) como a linha em branco
  extra renderiza num celular real antes de considerar concluído.

## Dev Agent Record

### File List

- `worker/empregabilidade_engine.py`:
  - `_mostrar_menu_opcoes` — copy final (seção 2) aplicada, com linha em branco dupla entre a opção 1
    e a 2, e "Talentos" corrigido.
  - Fallback "não sou empresa" em `aguardando_cnpj` (antiga cópia solta duplicada) — passa a chamar
    `_mostrar_menu_opcoes` com `intro` personalizada, eliminando a duplicação de texto.
- `worker/tests/test_empregabilidade_engine.py`: nova classe `TestS_EMP_AUD_025CopyMenuPrincipal`
  com 4 testes — texto exato da copy final, cópia duplicada consolidada na mesma fonte, opções 1-3
  continuam chamando o handler certo, opções 4-5 continuam indo pra etapas distintas entre si.

### Completion Notes

- AC1/AC2: cobertos por teste de igualdade de string exata (`test_texto_exato_da_copy_final_no_menu_inicial`).
- AC3: coberto — fallback duplicado agora delega pra `_mostrar_menu_opcoes`, testado.
- AC4: coberto — 2 testes de regressão de roteamento (handler chamado certo pra 1-3, etapa certa pra 4-5).
- Suíte completa: 112 passed (108 pré-existentes + 4 novos), 0 falhas.
- Item do test plan "confirmar visualmente como a linha em branco extra renderiza num celular real" —
  não executado (exigiria navegador/WhatsApp real, fora do escopo automatizado e sem autorização
  específica para teste ao vivo nesta sessão).

## Change Log

- v0.1 (2026-08-18): Story criada por @sm a partir de demanda direta do Junior.
- v0.2 (2026-08-18): Reescrita por @sm + @dev a pedido do Junior — copy nova reproduzida verbatim
  (antes só parafraseada), achado de duplicação de código detalhado com localização exata, 2
  perguntas de confirmação levantadas em vez de decididas sozinhas (separador visual, possível erro
  de digitação em "Taletos").
- v0.3 (2026-08-18): As 2 perguntas respondidas pelo Junior — linha em branco no lugar dos traços,
  "Taletos" confirmado como erro de digitação de "Talentos". Copy final travada (seção 2).
- v0.4 (2026-08-18): @po validou — **GO (10/10)**. Baixo risco, copy final fechada e reproduzida
  verbatim (nada a interpretar), achado de duplicação de código com localização exata e correção
  planejada (unificar num só ponto de fonte, evitando repetir a regressão que S-WM-20 já corrigiu uma
  vez). AC testável, escopo mínimo e bem contido. Status Draft → Ready.
- v0.5 (2026-08-18): @dev implementou — copy final aplicada em `_mostrar_menu_opcoes`, cópia duplicada
  em `aguardando_cnpj` consolidada na mesma fonte, 4 testes novos, suíte completa validada
  (112 passed). Status Ready → InReview, aguardando @qa.
