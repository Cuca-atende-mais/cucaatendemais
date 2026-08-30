# S-EMP-FSL-05 — "É pra outra pessoa": chave própria, sem colisão

**Status:** Cancelada — substituída por decisão de produto

> **Decisão do Junior (2026-08-29), durante a implementação desta story:** eliminar por
> completo a opção de candidatura "pra outra pessoa" — o lead só pode se candidatar por si
> mesmo, sempre. Essa decisão **torna toda a premissa desta story obsoleta**: não existe mais
> "chave própria pro terceiro" pra calibrar, porque não existe mais candidatura de terceiro pra
> colidir com ninguém. O bug de colisão que esta story ia corrigir (`(vaga_id, telefone,
> cargo_escolhido)` sobrescrevendo 2 parentes) deixa de existir pela raiz — não porque foi
> corrigido, mas porque o caminho que causava o bug foi removido.
>
> Avaliado com o @dev antes de implementar: essa mudança não é um ajuste de escopo da FSL-05
> (não dá pra só recalibrar a chave), é uma **remoção de comportamento já em produção**, com
> alcance maior que a epic "sem link" (afeta o fluxo do link hoje, não só o fluxo novo sob
> flag). Por decisão do Junior (opção 1 apresentada pelo @dev), foi implementada diretamente,
> sem abrir uma story formal nova — documentada aqui, na própria FSL-05, como o registro do que
> aconteceu com este item do backlog.
>
> **Implementação real:** ver `S-EMP-FSL-05-REV` no Dev Agent Record abaixo (dentro desta mesma
> story, não um arquivo separado).

## Dev Agent Record — remoção da candidatura de terceiro (S-EMP-FSL-05-REV)

### O que foi feito

1. **`coletando_nome_candidato`** deixou de perguntar "esse currículo é para você mesmo(a) ou
   para outra pessoa?" — depois de coletar o nome, vai direto pra
   `_finalizar_candidatura_self` (o mesmo dispatcher da FSL-03/04), como se a resposta já fosse
   sempre "eu".
2. **Etapas `confirmando_terceiro` e `coletando_nome_terceiro` removidas** do motor — código
   morto eliminado, não só desativado. Saíram de `_ETAPAS_PUBLICO` e da tupla de exceção de
   `_quer_encerrar`.
3. **Rede de segurança:** uma conversa que porventura estivesse parada numa dessas 2 etapas no
   momento do deploy não trava — o fallback padrão de `_processar_publico` (fora do bloco
   if/elif de etapas reconhecidas) já trata qualquer etapa não reconhecida como "vagas", sem
   erro. Testado explicitamente.
4. **Limpeza de comentários/docstrings** que referenciavam o fluxo de terceiro (docstring de
   `_quer_sair_semantico`, prompt do classificador de IA de troca de rota,
   `confirmando_presenca_nome`) — sem código morto nem documentação desatualizada apontando pra
   um caminho que não existe mais.

### File List

- `worker/empregabilidade_engine.py` — `coletando_nome_candidato` vai direto pra
  `_finalizar_candidatura_self`; etapas `confirmando_terceiro`/`coletando_nome_terceiro`
  removidas; `_ETAPAS_PUBLICO` e exceção de `_quer_encerrar` atualizadas; comentários/prompt
  limpos.
- `worker/tests/test_empregabilidade_engine.py` — 6 testes que exercitavam as etapas removidas
  ajustados/adaptados (nova expectativa: segue direto pra `aguardando_confirmacao_candidatura`),
  2 testes que só faziam sentido pra etapa removida foram deletados, 3 testes novos
  (`TestEliminacaoCandidaturaTerceiro`): pergunta "outra pessoa" não sai mais, as 2 etapas não
  estão mais em `_ETAPAS_PUBLICO`, e a rede de segurança pra conversa dormente na etapa removida
  não trava.

### Validação executada

- `pytest` engine + inbound + portal_client + academia_enem + intencao_detector → **405 passed**
  (zero regressão; 2 testes obsoletos removidos, 6 adaptados, 3 novos).
- `py_compile` OK.
- Confirmado por grep: nenhuma referência funcional a "terceiro" sobrou no motor (só comentários
  explicando a remoção, deixados de propósito como rastro).

## QA Results (@qa — Quinn)

**Veredito: PASS** (2026-08-29). Remoção limpa, sem código morto, sem rota compartilhada tocada
à toa.

### 7 quality checks

1. **Code review — PASS.** Confirmei que `coletando_nome_candidato` chama
   `_finalizar_candidatura_self` com os mesmos 4 argumentos posicionais (`nome_coletado, phone,
   vaga_id_ref, eh_banco_talentos`) que o antigo ramo "eu" de `confirmando_terceiro` usava —
   comportamento idêntico ao caminho self que já existia, só sem a pergunta binária no meio. As
   duas guardas que já protegiam a coleta de nome (`_quer_sair_semantico`,
   `_escape_literal_ou_none`) continuam intactas antes da finalização. Não sobrou código morto:
   grep confirma que as únicas menções a "terceiro" no motor são comentários explicando a
   remoção, de propósito.
2. **Testes — PASS.** 405 testes, zero regressão. Gostei da cobertura específica desta mudança:
   um teste prova que a pergunta "outra pessoa" não sai mais, outro prova que as 2 etapas saíram
   de `_ETAPAS_PUBLICO`, e um terceiro prova que uma conversa hipoteticamente presa numa etapa
   removida não trava (cai no fallback padrão de "vagas") — essa é exatamente a rede de segurança
   que eu esperaria ver documentada, e ela está testada, não só descrita em prosa.
3. **Acceptance Criteria — decisão de produto atendida.** Não existem mais ACs formais da FSL-05
   original (ela foi corretamente aposentada, não reaproveitada com escopo forçado). O que
   importa aqui é a intenção do Junior — "eliminar por completo, só a própria pessoa" — e ela
   está implementada sem meio-termo: não há nenhum caminho remanescente (link ou chat) que ainda
   ofereça candidatura de terceiro.
4. **Regressão — PASS.** Validei o ponto que mais me preocupava antes de ler o código: se a
   rota compartilhada `candidaturas/route.ts` precisaria de ajuste. Não precisou — o diff
   pendente nesse arquivo é só o bypass de token do worker (FSL-01), anterior a esta mudança.
   Isso confere com o raciocínio do @dev: sem candidatura de terceiro, não há mais chave pra
   calibrar, então a rota fica fora do escopo real desta remoção.
5. **Performance — PASS.** Uma etapa a menos no fluxo (self chega à finalização mais rápido, sem
   round-trip extra de "eu ou outra pessoa").
6. **Segurança/LGPD — PASS.** Reduz superfície: já não é mais possível um lead submeter dado de
   terceiro (nome/currículo de outra pessoa) via este canal — estritamente menos exposição de
   dado de terceiros, não mais.
7. **Docs — PASS.** A forma como a FSL-05 foi documentada (Status "Cancelada", motivo explicado,
   implementação real registrada na própria story como REV, conteúdo original preservado como
   histórico) é exatamente o rastro que eu precisaria pra entender, meses depois, por que essa
   story não seguiu o caminho que o título dela sugere.

### Observação (não bloqueia)

- Vale só registrar pro futuro: `S-EMP-FSL-06` (reaproveitamento de dados) e `S-EMP-FSL-07`
  (banco de talentos) não mencionam terceiro diretamente, então não preciso reabrir nada nelas
  por causa desta mudança — conferi rapidamente e o escopo das duas já era só sobre o candidato
  self.

## Change Log

- 2026-08-29 — @qa (Quinn): gate PASS na remoção da candidatura de terceiro — código morto
  confirmado ausente por grep, rota compartilhada corretamente não tocada, rede de segurança pra
  etapa removida testada. 405 testes.
- 2026-08-29 — @dev (Dex): candidatura "pra outra pessoa" eliminada por decisão do Junior — a
  FSL-05 original (chave própria pro terceiro) fica obsoleta e é cancelada; o comportamento real
  implementado é a remoção completa do caminho. `coletando_nome_candidato` vai direto pra self;
  etapas de terceiro removidas do motor. 405 testes, zero regressão.

---

## Conteúdo original da story (obsoleto — mantido só como histórico)

**Status:** Ready
**Epic:** Fluxo do candidato 100% no WhatsApp (sem link)
**Origem:** `PLANO-EXECUCAO-fluxo-sem-link.md` (FSL-05), sessão 2026-08-29.
**Prioridade:** P1 | **Esforço:** M | **Risco:** MÉDIO — corrige um bug de colisão que já existe
em produção; mexer errado pode piorar.
**Depende de:** FSL-03 (a sequência de coleta).

## Contexto

Achado da sessão: a trava anti-duplicação de candidatura usa a chave `(vaga_id, telefone,
cargo_escolhido)`, onde `telefone` = **número do remetente** (`candidaturas/route.ts:96`,
`empregabilidade_engine.py:3768`). Consequência real, **hoje, no fluxo do link**: uma mãe que
manda o currículo do filho **e** da filha pra **mesma vaga** → mesmo número, mesma vaga → a segunda
candidatura é entendida como "pessoa repetida" e **sobrescreve/bloqueia a primeira**. Um dos dois
some, em silêncio.

O fluxo já distingue "é pra você" de "outra pessoa" e já coleta o nome do terceiro
(`coletando_nome_terceiro`) e o telefone de contato (`telefone_contato`,
`empregabilidade_engine.py:3774`). Esta story usa isso pra dar ao terceiro uma **chave própria**,
sem colidir com o remetente.

## O que precisa ser implementado

1. **Coletar telefone de contato do terceiro** (já existe o campo `telefone_contato`) — confirmar
   que está sendo pedido no fluxo novo e é gravado.
2. **Nunca oferecer o atalho "já tenho seus dados"** (FSL-06) no caminho "outra pessoa" — a coleta
   é sempre do zero.
3. **Chave própria na gravação:** a candidatura do terceiro é registrada de forma que **não colida
   com o remetente nem com outros terceiros** do mesmo número na mesma vaga. Definir a chave: nome
   do terceiro + telefone de contato (quando informado). Ajustar a trava anti-duplicação pra
   considerar isso — dois terceiros distintos no mesmo número/vaga deixam de sobrescrever um ao
   outro.
4. **Gatear pelo botão.**

## Acceptance Criteria

1. "É pra outra pessoa" coleta nome do terceiro + telefone de contato, e grava ambos.
2. Duas candidaturas de terceiros diferentes, mesmo número, mesma vaga → **duas candidaturas
   distintas**, nenhuma sobrescreve a outra (corrige o bug atual).
3. O atalho de reaproveitamento de dados (FSL-06) nunca roda no caminho "outra pessoa".
4. Candidatura própria (self) continua com a chave telefone+nome (não regride).
5. Botão off → comportamento de hoje (inclusive o bug atual permanece só no fluxo antigo até a
   correção transversal ser avaliada — ver nota).

## Escopo

**In:** chave própria pro terceiro na gravação, coleta do telefone de contato, bloqueio do atalho
de reaproveitamento nesse caminho. **Out:** o reaproveitamento em si (FSL-06); a limpeza de R2
(FSL-06).

**Nota de transversalidade (decisão do Junior, 2026-08-29):** a chave nova vale **só para entradas
novas, daqui pra frente** — não mexe retroativamente em candidatura já gravada. Como só muda o
comportamento de **novas** inserções (não deleta nem reescreve dado antigo), pode tocar a trava
compartilhada (`candidaturas/route.ts` + `empregabilidade_engine.py`) com segurança: o pior caso é
uma inserção nova ser tratada certo. As colisões **já existentes** no banco (parentes que já se
sobrescreveram) fazem parte da dívida técnica futura (ver plano, seção "Dívida técnica"), não são
consertadas aqui.

## ⚠️ Análise de impacto — por item

### Item — Chave própria pro terceiro
- **Toca:** a lógica de trava anti-duplicação na rota `candidaturas` (que o formulário também
  usa). Como a mudança vale **só para inserções novas** (decisão do Junior), não reescreve nem
  apaga nenhuma linha existente — muda apenas como uma candidatura nova é chaveada.
- **Consome hoje:** o formulário e o worker gravam candidatura pela mesma regra. A chave nova vale
  pros dois daqui pra frente, sem tocar no que já está gravado.
- **Impacto observável:** parentes deixam de se sobrescrever. **Risco:** se a chave nova for larga
  demais, poderia deixar passar duplicata real (mesma pessoa 2x); se estreita demais, ainda
  colide. Calibrar.
- **De-risk:** reproduzir o cenário real (2 terceiros, mesmo número, mesma vaga) antes e depois;
  confirmar 2 registros distintos. Confirmar que a candidatura self legítima repetida (mesma
  pessoa reenviando) ainda é tratada como atualização, não duplicata.

## Test plan

- Automatizado: 2 terceiros distintos, mesmo número, mesma vaga → 2 candidaturas.
- Automatizado: self reenviando a mesma vaga → atualiza, não duplica (não regride a trava).
- Automatizado: atalho de reaproveitamento não roda em "outra pessoa".
- Se transversal: regressão do fluxo do formulário (link) com a chave nova.
- Botão off → comportamento de hoje.

## Done criteria

- [ ] Terceiro gravado com chave própria (nome + telefone de contato)
- [ ] 2 terceiros mesmo número/vaga → 2 candidaturas
- [ ] Self repetido ainda atualiza (não duplica)
- [ ] Atalho de reaproveitamento bloqueado em "outra pessoa"
- [ ] Decisão transversal vs. só-novo registrada e aplicada
- [ ] Botão off → hoje intacto

## STOP conditions

- Ajustar a chave na rota compartilhada `candidaturas` mostrar risco de duplicata real no fluxo do
  link → parar e calibrar a chave com o Junior antes de aplicar em produção.
