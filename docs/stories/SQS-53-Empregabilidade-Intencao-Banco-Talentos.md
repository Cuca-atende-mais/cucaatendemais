# SQS-53 — Empregabilidade: Correção Dinâmica de Intenção para Banco de Talentos

**Status:** InProgress
**Tipo:** Bugfix crítico em produção
**Epic:** Sprint 37 (estabilização produção)
**Branch:** `main`

---

## 1. Contexto

No WhatsApp de Empregabilidade, leads que desejam enviar currículo para o banco de talentos às vezes erram a opção inicial:

- opção correta: `4` — Enviar Currículo / Banco de Talentos;
- erro comum: digitam `3` — Ver vagas abertas.

Depois disso, o fluxo entra em `listou_categorias` ou `listou_vagas`. Quando o lead tenta corrigir escrevendo `banco de talentos`, `enviar currículo`, `opção 4` ou frases equivalentes, o motor pode continuar preso no menu de vagas/categorias porque o roteamento original do menu inicial não roda mais.

Como o módulo está em produção, a correção deve ser mínima e restrita ao fluxo público de navegação.

---

## 2. Diagnóstico

Arquivo afetado:

- `worker/empregabilidade_engine.py`

Causa raiz:

- `processar_mensagem_empregabilidade()` interpreta `4` corretamente apenas quando `etapa_atual == "menu_inicial"`.
- Após o lead digitar `3`, o estado muda para `perfil=publico` e `etapa=listou_categorias`.
- Em `listou_categorias`, o código tenta interpretar números como categoria e retorna antes de chegar ao bloco geral de intenção de banco de talentos.
- Logo, a correção de intenção não é aplicada após o primeiro erro de menu.

---

## 3. Solução Implementada

Adicionar detecção explícita de intenção de banco de talentos no início de `_processar_publico()`, antes dos handlers específicos de etapa.

Escopo intencionalmente limitado:

- aplica apenas a etapas públicas de navegação: `inicio`, `listou_categorias`, `listou_vagas`, `aguardando_escolha_unidade`, `listando_cargos_selecao`, `pos_candidatura`, `candidatura_confirmada`, `oferta_banco_talentos`;
- não altera fluxo de empresa;
- não altera consulta de candidatura;
- não altera handover;
- não altera confirmação de entrevista;
- não intercepta etapas de coleta de nome, confirmação de terceiro ou upload.

Tratamento de ambiguidade:

- Frases como `banco de talentos`, `enviar currículo`, `deixar currículo`, `opção 4`, `menu 4` sempre redirecionam para banco de talentos.
- `4` puro só redireciona quando não existe uma opção `4` válida no menu dinâmico atual, evitando quebrar categorias/vagas/cargos/unidades reais numeradas como 4.

---

## 4. Acceptance Criteria

- [x] Se o lead digitar `3` no menu inicial e depois escrever `banco de talentos`, o fluxo deve pedir o nome completo para cadastro no banco de talentos.
- [x] Se o lead digitar `3` e depois escrever `enviar currículo` ou `opção 4`, o fluxo deve pedir o nome completo para banco de talentos.
- [x] Se o lead estiver em um menu dinâmico com uma opção `4` válida e digitar apenas `4`, o sistema não deve roubar a escolha para banco de talentos.
- [x] A correção deve preservar `historico_vagas_aplicadas` e `nome_candidato_prefill`.
- [x] A correção não deve alterar fluxos de empresa, candidato ativo, convite de entrevista ou transbordo humano.

---

## 5. File List

- [x] `worker/empregabilidade_engine.py`
- [x] `docs/stories/SQS-53-Empregabilidade-Intencao-Banco-Talentos.md`

---

## 6. QA Gate

**Validação local @dev (2026-05-12):**

- [x] `python3 -m py_compile worker/empregabilidade_engine.py`
- [ ] Smoke manual em produção após deploy do worker:
  - [ ] limpar/usar conversa nova;
  - [ ] bot mostra menu inicial;
  - [ ] responder `3`;
  - [ ] responder `banco de talentos`;
  - [ ] confirmar que bot pede nome completo para cadastro no banco de talentos;
  - [ ] repetir com `opção 4`;
  - [ ] validar que uma opção `4` real em categoria/vaga ainda funciona quando digitada como `4` puro.

---

## 7. Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-12 | @dev | Diagnóstico e implementação de bypass seguro de intenção para banco de talentos no fluxo público |
