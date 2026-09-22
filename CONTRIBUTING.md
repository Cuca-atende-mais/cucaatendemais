# Como trabalhar neste repositório

Guia prático do Cuca Atende+. Curto de propósito — se uma regra não estiver aqui, ela não existe.

---

## O fluxo

**Tudo vai direto para a `main`, via Pull Request.** Não há branch de integração: a `develop` está parada
desde julho de 2026 e não deve ser usada.

```
branch a partir da main  →  commits  →  PR para a main  →  esteira verde  →  revisão  →  merge
```

### Nome de branch

| Prefixo | Quando |
|---|---|
| `fix/` | corrige comportamento errado |
| `feat/` | funcionalidade nova |
| `chore/` | configuração, limpeza, dependências |
| `docs/` | só documentação versionada |
| `ci/` | mudanças na esteira |

### Mensagem de commit

Padrão convencional, com o ID da story quando houver:

```
fix(empregabilidade): não repete pergunta de CNPJ já confirmado [S-EMP-AUD-032]
```

O corpo é onde o trabalho fica: **explique o porquê, não o quê**. O diff já mostra o quê. Se você mediu
alguma coisa (antes/depois, contagem de testes, tempo), registre o número.

---

## Antes de abrir o PR

Rode os mesmos checks que a esteira roda:

```bash
npm test                 # worker (750) + portal (302)
npm run typecheck        # portal — tem que dar 0 erros
npm run build            # portal — onde atualização de framework quebra
npm run test:edge        # Edge Functions (deno)
```

O worker precisa de variáveis de ambiente **falsas** para importar. Sem elas a suíte nem coleta:

```bash
OPENAI_API_KEY=dummy SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=dummy \
SUPABASE_ANON_KEY=dummy WHATSAPP_TOKEN=dummy WHATSAPP_PHONE_ID=dummy \
META_VERIFY_TOKEN=dummy META_APP_SECRET=dummy REDIS_URL=redis://localhost:6379 \
ENCRYPTION_KEY=dummy JWT_SECRET=dummy python -m pytest -q
```

---

## A esteira

Roda sozinha em todo PR para a `main` e em todo push na `main`. Leva ~3 minutos.

| Job | O que verifica | Trava o merge? |
|---|---|---|
| Worker — pytest | 750 testes | sim |
| Portal — vitest, tipos, lint, build | 302 testes, tipos, build | sim |
| Edge Functions — deno | 284 testes nas 2 funções | sim |
| Auditoria de dependências | `npm audit` | não — informativo |

**Três verificações são informativas de propósito** e não travam ninguém, porque são dívida conhecida
com correção planejada à parte: o **ESLint** (267 erros de estilo), o **`npm audit`** e o
**`deno check`** (52 erros de tipo). Ver vermelho nelas é esperado.

---

## Restrições que parecem sobra mas não são

**A suíte do worker roda em processo único, sem paralelismo.** Não adicione `pytest -n`, não divida por
arquivo, não rode "só o teste alterado". A suíte depende da ordem de coleta:
`test_academia_enem_engine.py` substitui o módulo `supabase` por um dublê que os arquivos seguintes
herdam. Rodar um arquivo isolado hoje quebra na coleta com `Invalid API key`. A correção de verdade é
tirar a criação de clientes do momento da importação em `worker/talent_bank_matcher.py` — enquanto isso
não for feito, a restrição vale.

**Teste não pode depender do relógio.** Se o código que você testa consulta horário — como
`_dentro_horario_atendimento()`, que define a janela de atendimento humano — **congele o relógio no
teste**:

```python
patch("empregabilidade_engine._dentro_horario_atendimento", lambda agora=None: True)
```

Um teste que depende da hora fica vermelho em todo PR aberto à noite ou no fim de semana, sem nada estar
errado no código. Já aconteceu uma vez.

**Versões seguem produção, não preferência.** Python 3.11 (`worker/Dockerfile`), Node 20
(`cuca-portal/Dockerfile`), Deno 2 (`supabase/config.toml`). Se a esteira testasse outra versão, "verde
no CI" não significaria "verde no servidor".

---

## O que vai para o git e o que não vai

O `.gitignore` ignora **todo arquivo `.md` por padrão**, com exceções nominais. Isso protege os documentos
internos de sessão num repositório público.

| Vai | Não vai |
|---|---|
| `docs/stories/` — stories numeradas | Levantamentos e relatórios de sessão |
| `README.md`, `CONTRIBUTING.md`, este guia | `.claude/` — contexto local de cada um |
| `.github/PULL_REQUEST_TEMPLATE.md` | `.mcp.json` — contém token |
| `supabase/migrations/` | Qualquer arquivo com credencial |

**Nunca escreva credencial em arquivo do repositório**, mesmo que gitignorado hoje. Uma pasta de build
já vazou uma chave da OpenAI por esse caminho. O *push protection* está ligado e bloqueia o push se
detectar segredo — mas não conte com ele como única defesa.

Segredo de produção vive **só** nas variáveis de ambiente do EasyPanel.

---

## Deploy

**Não é automático.** Nenhum serviço tem `autoDeploy` ligado: depois do merge, alguém precisa redeployar
manualmente no EasyPanel.

| Você mexeu em | Redeploy |
|---|---|
| `worker/` | `cuca-worker` (e `cuca-academia-enem`, se for código compartilhado) |
| `cuca-portal/` | `portal` |
| `supabase/functions/` | deploy da Edge Function no Supabase |

Se o PR exige redeploy, **diga isso na descrição** — senão ele fica meio aplicado e ninguém percebe.

---

## Migrations

Ficam em `supabase/migrations/`, versionadas. Devem ser **idempotentes** e **retrocompatíveis**: o código
antigo precisa continuar funcionando depois da migration, porque há uma janela entre aplicar o banco e
redeployar o código.

Se a migration mexe em dado existente, **faça backup na própria migration** e diga na descrição do PR
quantos registros foram afetados.

---

## Revisão

Todo PR precisa da aprovação de outra pessoa. A regra existe porque **teste automatizado não pega tudo**:
os problemas mais caros deste projeto foram encontrados lendo conversas reais, não rodando suíte.

**O que o revisor olha, além do diff:**
- A descrição responde "o que quebra?" — não só "o que muda"
- Mudança de tela foi verificada no navegador (a esteira não faz isso)
- Migration tem backup e é retrocompatível
- Precisa de redeploy? Está escrito?

**Emergência:** se produção está fora do ar e a outra pessoa não responde, pode mergear sem aprovação —
e avisar depois, explicando o que foi. O gatilho é **a urgência da situação, não a indisponibilidade da
outra pessoa**. PR não urgente com alguém viajando simplesmente espera.
