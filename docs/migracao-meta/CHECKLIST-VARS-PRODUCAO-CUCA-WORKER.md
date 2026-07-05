# Checklist Final — Variáveis de Ambiente a Criar em Produção (cuca-worker)

> **Autor:** @devops (Gage) · **Data:** 2026-07-05 · **Natureza:** documentação, preparação para cutover. **Nada aplicado, produção não tocada.**
>
> Confirma e fecha o levantamento do **Relatório 2** (`RELATORIO-2-diff-variaveis-ambiente.md`) com uma varredura exaustiva de código, antes do merge para produção.

---

## Método de confirmação

Grep exaustivo por toda leitura de env var relacionada a `META_` no worker, duas formas de acesso:

```
os.getenv("META_...")          → git grep -noE "os\.(getenv|environ\.get)\(['\"]META_[A-Z_]+['\"]" worker/*.py
os.environ["META_..."]         → git grep -noE "os\.environ\[['\"]META_[A-Z_]+['\"]\]" worker/*.py
```

Também confirmado: **não existe classe de settings (pydantic `BaseSettings` ou similar)** no worker que pudesse ler env vars por nome de campo sem uma chamada explícita `os.getenv` — o grep acima é exaustivo, não uma amostra.

**Resultado: exatamente 3 variáveis `META_*` são lidas pelo código do worker hoje.** Nenhuma quarta apareceu.

---

## ✅ Checklist final — 3 variáveis a criar em produção

| # | Variável | Onde é lida | Papel | Ação |
|---|---|---|---|---|
| 1 | `META_SYSTEM_USER_TOKEN` | `worker/main.py:327`, `worker/campanhas_engine.py:134`, `worker/meta_adapter_inbound.py:123,388,566`, `worker/empregabilidade_engine.py:93,102` | Bearer da Graph API — todo envio Meta (outbound de template, transbordo, inbound) depende disto. **Sem ela, 100% dos envios falham.** | Criar em produção com o mesmo valor de staging |
| 2 | `META_APP_SECRET` | `worker/main.py:186` | Valida HMAC-SHA256 do webhook Meta inbound. **Sem ela, o webhook rejeita tudo.** | Criar em produção com o mesmo valor de staging |
| 3 | `META_VERIFY_TOKEN` | `worker/main.py:187` | Handshake de verificação do webhook Meta (challenge/response no setup do endpoint). | Criar em produção com o mesmo valor de staging |

Nenhuma outra variável `META_*` precisa ser criada em produção para o worker.

---

## 🔴 Correção ao pedido original — `META_TEMPLATES_APROVADOS` NÃO entra na lista

Foi levantada a hipótese de incluir `META_TEMPLATES_APROVADOS=true` no cutover como "pendência conhecida". **Investigação mostrou que essa variável é código morto, removida deliberadamente — não uma pendência de valor (true/false).**

**Evidência (histórico de commits/stories, não suposição):**

- **S-WM-09** introduziu `META_TEMPLATES_APROVADOS` como gate global boolean: se `!= "true"`, `campanhas_loop()` suspendia todos os disparos e apenas logava.
- **S-WM-13** ("Gestão Dinâmica de Templates Meta") **removeu essa flag do código de propósito**. Da própria story:
  - AC6: *"Given `META_TEMPLATES_APROVADOS` env var, when migration completa, then não existe mais referência à env var no código (removida)."*
  - Dev Agent Record: *"`campanhas_loop()` em `campanhas_engine.py` tinha guard `META_TEMPLATES_APROVADOS != "true"` que suspendia todo o loop. Removido — o comportamento graceful de pular disparo sem template aprovado substitui o guard global."*
  - QA Results: *"META_TEMPLATES_APROVADOS removida do código, testes verdes."*
- O controle de aprovação de template **hoje é por template individual**, via `meta_templates.status = 'aprovado'` na própria tabela — não mais uma flag global de ambiente.
- Confirmado via grep nesta investigação: **zero ocorrências de `META_TEMPLATES_APROVADOS` em qualquer arquivo `.py`/`.ts`/`.tsx` do `develop` atual.**

**Conclusão:** criar essa variável em produção (com qualquer valor) não teria efeito algum — nenhum código a lê.

**Débito real, de baixa prioridade, que NÃO bloqueia o cutover:** `worker/.env.example:38` ainda tem a linha `META_TEMPLATES_APROVADOS=false`, um resíduo que a própria QA da S-WM-13 já tinha sinalizado (*"LOW C1: worker/.env.example ainda referencia META_TEMPLATES_APROVADOS=false — remover em PR de limpeza"*) e que nunca foi removido. Recomenda-se apagar essa linha do `.env.example` numa limpeza futura, para não confundir quem configurar um novo ambiente lendo o arquivo de exemplo — mas isso é higiene de repositório, não algo que afeta produção.

---

## Referências

- `RELATORIO-2-diff-variaveis-ambiente.md` — levantamento original de env vars (staging vs produção)
- `docs/stories/S-WM-09-Transbordo-Completo-Worker-Notificacao-Colaborador.md` — introdução da flag
- `docs/stories/S-WM-13-Gestao-Dinamica-Templates-Meta.md` — remoção da flag (AC6, Dev Agent Record, QA Results)
