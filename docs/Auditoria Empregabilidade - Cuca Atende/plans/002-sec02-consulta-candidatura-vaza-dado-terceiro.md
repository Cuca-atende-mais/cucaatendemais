# Plan 002: Consulta de candidatura para de vazar dado de terceiro

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7b0b326..HEAD -- worker/empregabilidade_engine.py worker/tests/test_empregabilidade_engine.py`
> Se `empregabilidade_engine.py` mudou desde que este plano foi escrito,
> compare os trechos da seção "Current state" contra o código ao vivo antes
> de prosseguir; se não bater, trate como STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — estreita uma busca já existente (deixa de aceitar telefone/nome digitados livremente, passa a exigir bater com quem está mandando a mensagem). Não deveria quebrar uso legítimo: o telefone de quem manda a mensagem é sempre o telefone real dele.
- **Depends on**: none
- **Category**: security (broken access control / PII exposure)
- **Planned at**: commit `7b0b326`, 2026-07-29

## Why this matters

O bot pede explicitamente, na etapa `aguardando_id_candidato`: "*você pode tentar com: número da candidatura, nome completo, ou telefone cadastrado*". As 4 estratégias de busca (CPF, código de referência, telefone, nome) usam o valor **digitado na mensagem**, nunca o `phone` real de quem está mandando a mensagem — que já está disponível como parâmetro da própria função (`_processar_candidato(texto, phone, instance_name, token, lead_id, conversa_id)`). Qualquer pessoa que saiba o nome completo ou telefone de um candidato — ex-empregador, familiar, golpista — consegue puxar o status da candidatura dele e as `observacoes` internas do recrutador, sem provar que é aquela pessoa.

A busca por **código de referência** (6 caracteres alfanuméricos, derivados do final do UUID da candidatura) já é razoavelmente segura — funciona como um token que só quem recebeu a confirmação da candidatura teria. O problema é só nas outras 3 estratégias (CPF, telefone, nome), que aceitam qualquer valor digitado sem checar se bate com quem está perguntando.

## Current state

`worker/empregabilidade_engine.py:1249-1256` (assinatura da função — `phone` já disponível):
```python
async def _processar_candidato(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
):
```

`worker/empregabilidade_engine.py:1298-1336` (as 4 estratégias, dentro da etapa `aguardando_id_candidato`):
```python
        apenas_digitos = re.sub(r"\D", "", texto)
        texto_limpo = texto.strip()

        candidaturas_encontradas = []

        # Busca por CPF (histórico)
        if len(apenas_digitos) == 11:
            cand_pessoa = supabase.table("candidatos").select("id").eq("cpf", apenas_digitos).execute()
            ids_candidatos = [c["id"] for c in (cand_pessoa.data or [])]
            if ids_candidatos:
                cand_res = supabase.table("candidaturas").select(
                    "id, status, vaga_id, created_at, observacoes"
                ).in_("candidato_id", ids_candidatos).order("created_at", desc=True).limit(5).execute()
                candidaturas_encontradas = cand_res.data or []

        # Busca por número de candidatura (6+ chars alfanuméricos)
        elif re.match(r"^[A-Za-z0-9]{6}$", texto_limpo):
            ref = texto_limpo.upper()
            todas = supabase.table("candidaturas").select(
                "id, status, vaga_id, created_at, observacoes"
            ).order("created_at", desc=True).limit(500).execute()
            candidaturas_encontradas = [
                c for c in (todas.data or [])
                if c["id"].replace("-", "")[-6:].upper() == ref
            ]

        # Busca por telefone (10-11 dígitos)
        elif len(apenas_digitos) in (10, 11):
            cand_res = supabase.table("candidaturas").select(
                "id, status, vaga_id, created_at, observacoes"
            ).eq("telefone", apenas_digitos).order("created_at", desc=True).limit(5).execute()
            candidaturas_encontradas = cand_res.data or []

        # Busca por nome (texto com espaço, 5+ chars)
        elif len(texto_limpo) >= 5 and " " in texto_limpo:
            cand_res = supabase.table("candidaturas").select(
                "id, status, vaga_id, created_at, observacoes, nome"
            ).ilike("nome", f"%{texto_limpo}%").order("created_at", desc=True).limit(5).execute()
            candidaturas_encontradas = cand_res.data or []
```

Note que `candidaturas.telefone` normalmente guarda dígitos sem o prefixo internacional (10-11 dígitos, conforme o próprio filtro `len(apenas_digitos) in (10, 11)`), enquanto `phone` (o parâmetro, vindo do webhook Meta) normalmente vem com o prefixo do país. **Confirme o formato real de `phone` antes de comparar** — pode precisar da mesma normalização usada em `campanhas_engine.normalizar_telefone`/`meta_adapter_inbound` (ver `worker/campanhas_engine.py:11-19` como referência) antes de comparar com `candidaturas.telefone`.

**Decisão do sócio (2026-07-29) — normalizar os 2 lados da comparação, não só o `phone`:** verificação ao vivo em produção (`docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção do Plano 002) mostrou que `candidaturas.telefone` **não está uniformemente em dígito puro** — 46 linhas puro-dígito, 78 linhas com formatação (ex.: `"(85) 92146-7046"`). Comparar `phone` normalizado contra um `candidaturas.telefone` cru faria o fix falhar silenciosamente para a maioria dos registros reais (candidato legítimo não encontra a própria candidatura). **A comparação em `Step 1` abaixo precisa normalizar (remover tudo que não é dígito) dos dois lados antes de comparar** — não assumir que `candidaturas.telefone` já está limpo.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Worker test suite | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass, including new tests |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: só o bloco de 4 estratégias de busca dentro de `_processar_candidato`, etapa `aguardando_id_candidato` (`worker/empregabilidade_engine.py:1298-1336`), e os testes novos.

**Out of scope**:
- A busca por **código de referência** (6 chars) — já é razoavelmente segura (token, não PII), não precisa mudar.
- Qualquer outro achado desta auditoria — planos separados.
- Mudar o texto que o bot mostra ao pedir a identificação (`:1272-1277`) além do necessário para refletir a nova regra — só ajuste se a busca por nome for removida (ver Step 1).

## Git workflow

- Branch: `fix/sec02-consulta-candidatura-vaza-dado-terceiro`
- Commit único.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Exigir que telefone/nome batam com quem está perguntando

Substitua as estratégias de **telefone** e **nome** por versões que também filtram pelo `phone` de quem está mandando a mensagem — a busca só retorna candidaturas que **também** pertencem a esse telefone, independente do que foi digitado como critério de busca:

```python
        # Busca por telefone (10-11 dígitos) — SEC-02: só aceita se bater com quem está perguntando.
        # Normaliza os 2 lados (candidaturas.telefone tem formatação inconsistente em produção —
        # 46 linhas puro-dígito, 78 com "(85) 92146-7046" etc., confirmado ao vivo 2026-07-29).
        elif len(apenas_digitos) in (10, 11):
            telefone_quem_pergunta = _telefone_normalizado_para_comparacao(phone)
            cand_res = supabase.table("candidaturas").select(
                "id, status, vaga_id, created_at, observacoes, telefone"
            ).order("created_at", desc=True).limit(5).execute()
            candidaturas_encontradas = [
                c for c in (cand_res.data or [])
                if _telefone_normalizado_para_comparacao(c.get("telefone") or "") == telefone_quem_pergunta
            ]

        # Busca por nome (texto com espaço, 5+ chars) — SEC-02: nome sozinho não basta,
        # tem que bater também com o telefone de quem está perguntando (mesma normalização
        # dos 2 lados usada na busca por telefone acima).
        elif len(texto_limpo) >= 5 and " " in texto_limpo:
            cand_res = supabase.table("candidaturas").select(
                "id, status, vaga_id, created_at, observacoes, nome, telefone"
            ).ilike("nome", f"%{texto_limpo}%").order("created_at", desc=True).limit(5).execute()
            telefone_quem_pergunta = _telefone_normalizado_para_comparacao(phone)
            candidaturas_encontradas = [
                c for c in (cand_res.data or [])
                if _telefone_normalizado_para_comparacao(c.get("telefone") or "") == telefone_quem_pergunta
            ]
```

`_telefone_normalizado_para_comparacao(valor)` é uma função nova (ou reaproveitada, se já existir algo equivalente no arquivo — procure antes de criar) que remove tudo que não é dígito de **qualquer um dos 2 lados** (tanto `phone`, formato do webhook Meta, quanto `candidaturas.telefone`, que tem formatação inconsistente em produção) — não assumir que só um lado precisa de normalização. Nota: a busca por telefone deixa de filtrar direto no banco (`.eq("telefone", ...)`) e passa a trazer as últimas 5 candidaturas por ordem de criação e filtrar em Python — necessário porque a normalização não pode ser expressa como igualdade direta de coluna quando o dado armazenado tem formatação variável; confirme se o volume de candidaturas justifica um `.limit()` maior aqui antes de fechar (dado real: 124 linhas totais na tabela hoje).

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

## Test plan

Modelar em `TestEscapeHatchAguardandoIdCandidato` ou classe irmã já existente em `worker/tests/test_empregabilidade_engine.py` (mesmo padrão `mock_sb`, `monkeypatch.setattr(emp, "supabase", mock_sb)`).

1. `test_busca_por_telefone_so_retorna_candidatura_do_proprio_telefone` — mock `candidaturas` com uma linha cujo `telefone` é **diferente** do `phone` de quem está perguntando; assert que `candidaturas_encontradas` fica vazio (mensagem de "não encontrei", não vaza a candidatura).
2. `test_busca_por_telefone_retorna_quando_bate_com_proprio_telefone` — mesmo mock, mas `phone` do teste **igual** ao telefone da candidatura; assert que retorna normalmente (não regrediu o caso legítimo).
3. `test_busca_por_nome_nao_retorna_candidatura_de_telefone_diferente` — mock `candidaturas` com nome batendo mas telefone diferente do `phone` de quem pergunta; assert vazio.
4. `test_busca_por_nome_retorna_quando_telefone_tambem_bate` — mesmo nome, telefone igual ao `phone`; assert retorna.
5. `test_busca_por_codigo_referencia_continua_funcionando_sem_checar_telefone` — regressão: confirma que a busca por código de 6 caracteres **não muda** (não exige bater telefone, é token-based, fora de escopo deste plano).
6. `test_busca_por_telefone_bate_mesmo_com_candidaturas_telefone_formatado` — decisão do sócio 2026-07-29: mock `candidaturas` com `telefone` **formatado** (ex.: `"(85) 92146-7046"`), `phone` de quem pergunta em dígito puro equivalente (`"5585921467046"` ou o formato real do webhook); assert que a candidatura **é encontrada** — prova que a normalização cobre os 2 lados, não só o lado do `phone`.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, incluindo os 6 novos.

## Done criteria

- [ ] `grep -n "_telefone_normalizado_para_comparacao\|SEC-02" worker/empregabilidade_engine.py` mostra os pontos alterados
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0, incluindo os 6 novos testes
- [ ] Busca por código de referência (6 chars) comprovadamente inalterada (teste #5)
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] `plans/README.md` desta pasta atualizado

## STOP conditions

- O formato real de `phone` (parâmetro) e `candidaturas.telefone` não for o que este plano assume (ex.: um dos dois guarda com o 9º dígito, outro sem) — confirme com dado real antes de escrever a função de normalização, não adivinhe.
- A busca por CPF (`candidatos.cpf`) também parecer vulnerável ao mesmo problema depois de você ler o código — se sim, pare e reporte em vez de expandir o escopo deste plano silenciosamente (o achado original não citou CPF como vetor, mas vale confirmar).

## Maintenance notes

- Se um candidato legítimo mudar de número de telefone depois de se candidatar, ele deixa de conseguir consultar a própria candidatura por telefone/nome (só pelo código de referência continua funcionando) — comportamento esperado deste fix, não um bug novo introduzido.
