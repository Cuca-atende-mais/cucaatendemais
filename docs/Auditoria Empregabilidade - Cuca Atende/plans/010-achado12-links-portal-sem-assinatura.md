# Plan 010: Links do portal levam dado pessoal cru na URL, sem assinatura nem expiração (achado #12)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7b0b326..HEAD -- worker/empregabilidade_engine.py` e confirme
> que os 4 pontos de geração de link (`:513`, `:1023`, `:1035`, `:2087-2088`
> na numeração de 2026-07-29) ainda existem nesses formatos antes de prosseguir.
>
> **Este plano toca 2 repositórios/camadas** (`worker/` Python e
> `cuca-portal/` Next.js) — não é só um fix no worker. Confirme que consegue
> rodar `npx tsc --noEmit` em `cuca-portal/` antes de começar (rede de
> segurança mínima do lado do portal, já que não há suíte de teste
> automatizado pras páginas envolvidas).

## Status

- **Priority**: P2 (severidade "Média" na auditoria — abaixo dos P1 de 001-009, mas é o único achado de segurança restante sem plano)
- **Effort**: M
- **Risk**: MED — muda a forma como 4 links são gerados e consumidos; se a verificação do portal for implementada errada (ex.: comparação não constant-time, ou `exp` mal calculado), pode trocar um problema de segurança por outro, ou travar usuários legítimos fora dos próprios links que acabaram de receber.
- **Depends on**: none
- **Category**: security (capability URL sem proteção)
- **Confidence**: MED — a parte do worker (geração) foi conferida linha a linha; a parte do portal (consumo) foi só verificada por amostragem (1 página, `vagas/editar`), não as 4.
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

4 pontos em `worker/empregabilidade_engine.py` geram links pro portal Next.js com dado pessoal cru na query string, sem assinatura nem expiração:
- `:513` — `vagas/editar?vaga_id=...&empresa_id=...`
- `:1023` — `vagas/nova?empresa_id=...&unidade_cuca=...&email_responsavel=...&telefone_responsavel=...`
- `:1035` — `selecao/nova?empresa_id=...` (mesmos parâmetros de contato)
- `:2087-2088` — `candidatura?nome=...&origem_tel=...&conversa_id=...&vaga_id=...` (confirmado ao vivo: inclui **nome completo e telefone** do candidato)

Confirmei ao vivo que `cuca-portal/src/app/empregabilidade/vagas/editar/page.tsx` (`:80-136`) lê `vaga_id`/`empresa_id` **direto da URL** via `useSearchParams()`, busca os dados da vaga com eles, e a ação de salvar (`:229`) reenvia o mesmo `empresa_id` lido da URL — sem nenhuma verificação de sessão/posse. É um capability-URL clássico: quem tiver o link pode ver e editar a vaga daquela empresa. WhatsApp é trivialmente encaminhável (print, forward, cola em outro chat) — qualquer pessoa que receba o link por engano, ou que o "vaga_id" seja adivinhável/enumerável, tem acesso total.

O caso mais sensível é `candidatura` (`:2087-2088`): o link carrega **nome e telefone reais do candidato**. Quem interceptar esse link pode enviar um currículo/candidatura *se passando* por essa pessoa.

## Current state

`worker/empregabilidade_engine.py` — os 4 pontos (confirmados ao vivo em 2026-07-29):
```python
# :513 — edição de vaga
link_edicao = f"{PORTAL_URL}/empregabilidade/vagas/editar?vaga_id={vaga_match['id']}{unidade_param}"

# :1023 — nova vaga
link_vaga = f"{PORTAL_URL}/empregabilidade/vagas/nova?empresa_id={empresa_id}{unidade_param}{email_param}{tel_param}"

# :1035 — nova seleção
link_selecao = f"{PORTAL_URL}/empregabilidade/selecao/nova?empresa_id={empresa_id}{unidade_param}{email_param}{tel_param}"

# :2055-2088 — candidatura (função própria _enviar_link_candidatura)
params = {"nome": nome_candidato, "origem_tel": ..., "conversa_id": conversa_id, ...}
query = urllib.parse.urlencode(params)
link = f"{PORTAL_URL}/empregabilidade/candidatura?{query}"
```

`cuca-portal/src/app/empregabilidade/vagas/editar/page.tsx:80-136` (amostra verificada):
```typescript
const searchParams = useSearchParams()
const vagaId = searchParams.get("vaga_id")
const empresaId = searchParams.get("empresa_id")
...
const res = await fetch(`/api/empregabilidade/vagas/${vagaId}?empresa_id=${encodeURIComponent(empresaId)}`)
```
Nenhuma verificação de assinatura antes de usar `vagaId`/`empresaId`.

**Padrão de HMAC já existente no portal** (não é novo pro projeto, só nunca foi aplicado aqui) — `cuca-portal/src/lib/auctaflux/webhook.ts:39,47,56-58`, usa `crypto.createHmac("sha256", secret)` + `crypto.timingSafeEqual` pra verificar assinatura de webhook. Reaproveitar o mesmo princípio (HMAC-SHA256 + comparação constant-time), não inventar um esquema novo.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Sanity import worker | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |
| Teste do worker | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass |
| Typecheck do portal | `cd cuca-portal && npx tsc --noEmit` | sem novos erros (comparar contra baseline antes de editar) |

## Scope

**In scope**:
- `worker/empregabilidade_engine.py`: 1 helper novo (`_assinar_link_portal`) + os 4 pontos de geração de link.
- `cuca-portal/src/lib/`: 1 helper novo de verificação (espelho do helper do worker).
- As 4 páginas/rotas que consomem esses links: `empregabilidade/vagas/editar`, `empregabilidade/vagas/nova`, `empregabilidade/selecao/nova`, `empregabilidade/candidatura` (e as API routes que elas chamam, se a verificação fizer mais sentido lá).
- Variável de ambiente nova compartilhada entre worker e portal (secret do HMAC).

**Out of scope**: qualquer mudança de UX das páginas além de rejeitar link inválido/expirado; revogação de link antes do prazo de expiração (fora de escopo, decisão de produto separada se algum dia for necessário); os outros achados (#6, #9, etc.).

## Git workflow

- Branch: `fix/achado12-links-assinados` (mesma branch cobrindo worker + portal, já que é uma mudança acoplada)
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Variável de ambiente compartilhada

Adicionar `EMPREGABILIDADE_LINK_SECRET` (string aleatória longa, gerada uma vez) tanto no `.env` do worker quanto no `.env.local`/config do portal — **o mesmo valor nos dois lados**. Não commitar o valor real; só documentar a chave em `.env.example` de ambos.

### Step 2: Helper de assinatura no worker

```python
import hashlib
import hmac
import time

_LINK_SECRET = os.getenv("EMPREGABILIDADE_LINK_SECRET", "")

def _assinar_link_portal(path: str, params: dict, ttl_horas: int = 48) -> str:
    """Gera um link assinado (HMAC-SHA256) com expiração — evita que o link
    vire uma capability URL sem proteção (achado #12). `params` não deve
    incluir 'exp' nem 'sig', ambos adicionados aqui."""
    if not _LINK_SECRET:
        logger.error("[link-assinado] EMPREGABILIDADE_LINK_SECRET não configurada — gerando link SEM assinatura")
        query = urllib.parse.urlencode(params)
        return f"{PORTAL_URL}{path}?{query}"
    params = {**params, "exp": str(int(time.time()) + ttl_horas * 3600)}
    canonical = urllib.parse.urlencode(sorted(params.items()))
    sig = hmac.new(_LINK_SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    query = urllib.parse.urlencode({**params, "sig": sig})
    return f"{PORTAL_URL}{path}?{query}"
```
Note o fail-open explícito e logado quando o secret não está configurado — decisão deliberada (não travar todo o fluxo de geração de link em ambiente de dev sem o secret setado), mas visível no log, não silencioso. Confirmar com quem revisar se esse comportamento é aceitável ou se deveria ser fail-closed (recusar gerar o link) — não decidir sozinho, é uma escolha de produto/segurança.

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

### Step 3: Trocar os 4 pontos de geração pra usar o helper

Exemplo (`:513`):
```python
link_edicao = _assinar_link_portal(
    "/empregabilidade/vagas/editar",
    {"vaga_id": vaga_match["id"], "empresa_id": empresa_id},
)
```
Repetir para os outros 3 pontos (`:1023`, `:1035`, `_enviar_link_candidatura` em `:2055-2088` — este último passa o dict `params` já montado direto pro helper em vez de `urllib.parse.urlencode` manual).

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass (nenhum teste existente deveria depender do formato exato da URL — se algum depender, é sinal de acoplamento que vale revisar, não um erro deste plano).

### Step 4: Helper de verificação no portal

`cuca-portal/src/lib/empregabilidade/verificar-link.ts` (novo):
```typescript
import crypto from "crypto"

const SECRET = process.env.EMPREGABILIDADE_LINK_SECRET || ""

export function verificarLinkAssinado(searchParams: URLSearchParams): { valido: boolean; motivo?: string } {
    if (!SECRET) return { valido: true } // mesmo fail-open documentado no worker — mesma decisão, não inventar comportamento diferente aqui
    const sig = searchParams.get("sig")
    const exp = searchParams.get("exp")
    if (!sig || !exp) return { valido: false, motivo: "assinatura ausente" }
    if (Date.now() / 1000 > Number(exp)) return { valido: false, motivo: "link expirado" }

    const params = new URLSearchParams(searchParams)
    params.delete("sig")
    const canonical = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
    const esperado = crypto.createHmac("sha256", SECRET).update(canonical).digest("hex")

    const a = Buffer.from(sig)
    const b = Buffer.from(esperado)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { valido: false, motivo: "assinatura inválida" }
    }
    return { valido: true }
}
```
**Atenção**: `URLSearchParams.toString()`/`urlencode` do Python precisam produzir a **mesma serialização canônica** dos 2 lados (mesma ordem de chaves — por isso `sorted(...)`/`.sort(...)` nos dois, e mesmo esquema de encoding). Testar manualmente gerando um link no worker e verificando no portal antes de considerar pronto — não presumir compatibilidade sem testar de ponta a ponta.

### Step 5: Integrar a verificação nas 4 páginas/rotas

Para cada uma das 4 páginas (`vagas/editar`, `vagas/nova`, `selecao/nova`, `candidatura`), chamar `verificarLinkAssinado` antes de usar qualquer parâmetro da URL; se inválido, mostrar mensagem de erro clara ("Link inválido ou expirado — solicite um novo pelo WhatsApp") em vez de prosseguir. Confira cada página individualmente (`grep -rn "useSearchParams" cuca-portal/src/app/empregabilidade`) — só `vagas/editar` foi lida linha a linha nesta rodada de planejamento; as outras 3 podem ter estrutura de página diferente (client vs server component), ajuste a integração conforme o padrão real de cada uma.

**Verify**: `cd cuca-portal && npx tsc --noEmit` → sem novos erros; teste manual: gerar um link real (ou simulado) pra cada uma das 4 páginas, confirmar que abre normalmente com assinatura válida e mostra erro com assinatura alterada/removida manualmente na URL.

## Test plan

Não há suíte de teste automatizado hoje pras páginas do portal envolvidas (fora de escopo criar do zero uma suíte de teste de frontend neste plano) — a verificação é majoritariamente manual (Step 5). Do lado do worker, adicionar 1 teste novo:

```python
def test_assinar_link_portal_inclui_sig_e_exp(monkeypatch):
    monkeypatch.setattr(emp, "_LINK_SECRET", "segredo-teste")
    link = emp._assinar_link_portal("/empregabilidade/candidatura", {"nome": "Fulano"})
    assert "sig=" in link
    assert "exp=" in link
```

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, incluindo o teste novo.

## Done criteria

- [ ] `EMPREGABILIDADE_LINK_SECRET` configurada nos 2 lados (mesmo valor)
- [ ] `_assinar_link_portal` criado e usado nos 4 pontos de geração
- [ ] `verificarLinkAssinado` criado no portal e integrado nas 4 páginas
- [ ] Teste manual de ponta a ponta: link gerado pelo worker é aceito pelo portal; link com `sig` alterado ou `exp` vencido é rejeitado
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0
- [ ] `cd cuca-portal && npx tsc --noEmit` sem novos erros
- [ ] `plans/README.md` atualizado

## STOP conditions

- A serialização canônica (ordem de chaves, encoding) não bater entre worker (Python `urlencode`) e portal (`URLSearchParams`) — teste manual de ponta a ponta ANTES de considerar pronto, não presuma compatibilidade só lendo o código.
- Alguma das 4 páginas do portal não seguir o padrão de `useSearchParams()` client-side visto em `vagas/editar` (ex.: for server component lendo `searchParams` como prop) — ajuste a integração ao padrão real, não force o mesmo helper cegamente.
- Você não conseguir confirmar se o comportamento fail-open (sem secret configurado) é aceitável — pergunte antes de decidir sozinho entre fail-open e fail-closed.

## Maintenance notes

- TTL de 48h (`ttl_horas=48`) é um valor de partida razoável (tempo de reagir a um convite de vaga/candidatura), mas é uma escolha de produto — confirmar com quem pediu se faz sentido pro fluxo real (ex.: uma vaga pode ficar aberta por semanas, mas o link específico de "editar esta vaga" não precisa durar tanto).
- Revogação antecipada (antes do TTL) não está coberta — se um link vazar e precisar ser invalidado antes da expiração natural, hoje não há mecanismo pra isso (fora de escopo deste plano).
