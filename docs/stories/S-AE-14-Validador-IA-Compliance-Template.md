# S-AE-14 — IA Validadora de Compliance (categoria `UTILITY`) do Texto de Aviso

## Status
Ready

## Contexto (por que esta story existe)
Nasceu de um split da **S-AE-09** (2026-08-20, decisão do Junior): a story original misturava 3
blocos de risco muito diferente — fila/envio (reuso de infra existente), IA validadora (novo) e
ciclo de submissão de template Meta (novo). O @dev investigou antes de implementar e confirmou
que **não existe hoje** nenhuma lógica de validação automática de compliance `UTILITY` no
projeto — seria uma integração de LLM nova, não reuso de nada existente. Separada para não virar
um "validador stub" só pra fingir a AC pronta na S-AE-09.

## Story
**Como** responsável pela Academia Enem,
**quero** que uma IA avalie meu texto de aviso ANTES de eu submeter à Meta como template,
**para que** eu não gaste um ciclo de submissão (lento, assíncrono, com limite de tentativas
rejeitadas na conta) em um texto que a Meta claramente vai rejeitar por conteúdo promocional/venda.

## Regras Meta (não inventar)
- Categoria `UTILITY` = comunicação de utilidade/transacional, **sem** promoção, venda, oferta,
  desconto, CTA de compra. A Meta rejeita (ou reclassifica, com penalidade de qualidade) templates
  que fogem disso.
- Esta story **não** submete nada à Meta — só valida o texto ANTES. A submissão em si é a
  **S-AE-15**.

## Escopo
### IN
- Campo de texto na tela de criação de disparo (S-AE-09) onde o operador escreve o aviso.
- Botão "Validar com IA" (ou validação automática ao tentar avançar) que chama um LLM,
  reaproveitando o padrão de chamada já usado em `worker/intencao_detector.py` (lazy import
  `from openai import AsyncOpenAI` dentro da função — `openai` não está instalado no ambiente de
  teste, mesmo cuidado dos módulos existentes).
- Prompt claro, versionado no código (não hardcoded inline sem explicação), que classifica o
  texto como conforme/não-conforme com `UTILITY` e, se não-conforme, explica o motivo e sugere
  uma reformulação (a sugestão é só uma sugestão — o operador decide o texto final).
- Persistência do texto validado e do veredito da IA associado ao disparo em rascunho (para a
  S-AE-15 poder reaproveitar sem re-perguntar).

### OUT
- Submissão do texto à Meta como template (S-AE-15).
- Fila/envio/público (S-AE-09, já implementada nesta sequência).
- Aprender/re-treinar a partir de rejeições reais da Meta (fora de escopo — não há dado
  histórico suficiente ainda).

## Critérios de Aceite (Given/When/Then)
1. **Given** um texto com viés promocional ("aproveite", "desconto", "compre agora", oferta,
   etc.), **when** o operador pede validação, **then** a IA reprova, explica o motivo em
   linguagem simples e sugere uma reformulação.
2. **Given** um texto claramente de utilidade (aviso de prova, lembrete de presença, informação
   institucional), **when** validado, **then** a IA aprova e o fluxo libera o avanço para a
   submissão (S-AE-15).
3. **Given** a chamada ao LLM falhar (erro de rede/API), **then** o operador vê um erro claro
   (não um "aprovado" ou "reprovado" silencioso por fallback) e pode tentar de novo.
4. **Given** um texto ambíguo, **then** a IA pode pedir mais contexto ou marcar como "revisar
   manualmente" em vez de forçar um veredito binário quando não tem confiança suficiente — a
   decisão exata do formato de resposta (binário vs. 3 estados) fica para o @architect/@dev
   definir na implementação, documentando a escolha.

## Dev Notes — análise de impacto (item por item)
1. **Toca:** novo LLM call (nenhuma tabela/coluna tocada nesta story).
   **Depende disso hoje:** nada — código novo, sem consumidor externo além da própria tela da
   S-AE-09.
   **Impacto real:** nenhum em outros módulos. Custo de API OpenAI por validação — considerar no
   dimensionamento (baixo volume esperado, avisos não são diários).
2. **Toca:** possível persistência do rascunho validado (tabela a definir — pode reaproveitar
   `disparos_academia_enem` da S-AE-09 com um campo `status='rascunho'`/`texto_validado_ia`, em
   vez de tabela nova).
   **De-risk:** antes de implementar, confirmar com o @architect se a S-AE-09 já estará mergeada
   (para reaproveitar a tabela dela) ou se esta story precisa de um rascunho independente.

## Tasks
- [ ] Prompt de validação `UTILITY` (versionado, testável).
- [ ] Função de chamada ao LLM (lazy import, mesmo padrão de `intencao_detector.py`).
- [ ] UI: campo de texto + botão de validação + exibição de veredito/motivo/sugestão.
- [ ] Tratamento de erro de rede/API (AC3).
- [ ] Testes com casos reais de texto promocional vs. utilidade (fixtures, sem depender de
  chamada real à OpenAI nos testes automatizados).

## Dependências
Depende de **S-AE-09** (tela de disparo onde este validador é embutido). Alimenta **S-AE-15**
(o texto aprovado aqui é o que se submete lá).

## Quality Gate
- Tipo: backend (LLM) + front. Agentes: @qa. CodeRabbit: foco em no-invention do prompt (não
  inventar critérios de compliance além do que a Meta documenta publicamente), tratamento de
  falha de API, e se o import do `openai` é lazy (não quebra collection de testes).

## File List
_A preencher pelo @dev._

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-08-20 | @sm (River) | Criação da story — extraída da S-AE-09 original por decisão do Junior (split de escopo, ver Change Log da S-AE-09). Status: Draft, aguardando @po. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 9/10) → Status Draft→Ready.** Escopo bem isolado (só valida, não submete), reuso correto do padrão de LLM já existente (`intencao_detector.py`) sinalizado explicitamente, com o cuidado de import lazy já registrado como requisito (evita quebrar a suíte de testes, mesma lição já aprendida em stories anteriores desta sessão). Ponto não-bloqueante: AC4 deixa a decisão binário-vs-3-estados para o @dev/@architect documentarem na implementação — aceitável, é uma decisão técnica sem impacto de escopo/segurança. Dependência de ordem com a S-AE-09 (Dev Notes item 2) já está corretamente refletida em Dependências. |
