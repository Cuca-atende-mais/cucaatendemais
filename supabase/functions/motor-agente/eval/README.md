# Gabarito do Institucional (`eval/`)

Mede se as respostas do canal Institucional estão certas, caso a caso. O executor roda cada caso de `casos/` contra o `handler` do `motor-agente`:

- **Banco:** um cliente falso lê o catálogo congelado. Nada vai ao banco real.
- **Busca vetorial:** é calculada localmente, com os mesmos filtros e a mesma ordem de `buscar_chunks_similares`.
- **Data:** cada caso roda na sua própria data simulada.
- **OpenAI:** a de verdade, ou uma simulada com `--simulado`.

Um caso passa quando acerta pelo menos 2 de 3 execuções. Uma mudança está **sem piora** quando nenhuma categoria cai na taxa de acerto e nenhum caso que passava na base passa a falhar.

## Como rodar

```bash
# 1. Gerar o catálogo congelado (uma vez; só leitura no banco, sem OpenAI). Fica em eval/dados/, fora do git.
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-net --allow-env --allow-read --allow-write eval/scripts/exportar_catalogo.ts

# 2a. Rodada sem custo, só para conferir o encanamento (OpenAI simulada, sem rede):
deno run --allow-read --allow-write --allow-env eval/run_eval.ts --rotulo teste --simulado --repeticoes 1

# 2b. Rodada real (gasta OpenAI; combine antes, ver a regra do projeto sobre API paga):
OPENAI_API_KEY=... deno run --allow-all eval/run_eval.ts --rotulo baseline --teto-usd 1

# 3. Comparar uma mudança com a linha de base:
OPENAI_API_KEY=... deno run --allow-all eval/run_eval.ts --rotulo minha-mudanca --comparar eval/resultados/AAAA-MM-DD-baseline.json
```

O relatório sai em `eval/resultados/AAAA-MM-DD-<rotulo>.md`, com a tabela caso a caso e a taxa por categoria. O dado bruto sai em `.json`, com resposta, rota, trechos da busca, data no prompt e custo de cada execução. Os embeddings das perguntas ficam em cache em `eval/dados/`, então repetir uma rodada não paga embedding de novo.

## Como acrescentar um caso

Crie um arquivo `casos/<CATEGORIA>-<NN>.json` copiando um caso parecido. Os campos são:

- `categoria`: uma de `F1`, `F3`, `F4`, `F5`, `F6`, `busca_unidade`, `conteudo_fixo`, `seguranca_encaminhamento`, `atendente`;
- `data_simulada` e `mes_catalogo`: o mês da programação que vale para o caso;
- `estado.metadata`: estado da conversa, por exemplo `unidade_selecionada`;
- `historico`: mensagens anteriores, com `minutos_antes`;
- `mensagem`: a mensagem atual;
- `esperado`, que pode ter:
  - `rota`: camadas aceitas;
  - `handover`;
  - `deve_conter` e `nao_deve_conter`: expressões regulares, comparadas sem acento e sem diferença de maiúscula;
- `depois_da_07`: marque `true` se o caso depende da base nova da story 07. Esses casos ficam fora das taxas.

Se o caso veio de uma conversa real, coloque `conversa_curta` (só os 8 primeiros caracteres do id) e `extrair.alvo` (um trecho da mensagem). Depois rode `eval/scripts/extrair_historico.ts`: ele preenche o histórico real e troca nome, telefone e e-mail por marcadores.

O teste `eval/eval.test.ts` confere a estrutura de todos os casos e falha se aparecer dado pessoal.
