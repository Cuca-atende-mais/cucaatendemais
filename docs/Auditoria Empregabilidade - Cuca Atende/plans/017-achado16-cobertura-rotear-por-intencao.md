# Plan 017: `_rotear_por_intencao` só tem teste pro branch `ambiguo` — as outras 4 intenções não têm nenhum (achado #16, escopo reduzido)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `grep -n "_rotear_por_intencao" worker/tests/test_empregabilidade_engine.py`
> deve mostrar só chamadas dentro de `TestFallbackAmbiguoPrimeiroContato`
> (branch `ambiguo`) em 2026-07-29 — se já houver teste pros outros branches,
> reavalie o escopo antes de prosseguir.
>
> **Escopo reduzido deliberadamente**: a auditoria original (achado #16,
> Esforço L) cobre "fluxos candidato/público quase sem teste além dos escape
> hatches" de forma ampla (~30 etapas sem hit). Este plano cobre só a
> recomendação de menor esforço/maior valor da própria auditoria: "priorizar
> as 4 branches de `_rotear_por_intencao` primeiro" — não as ~30 etapas
> inteiras. Se quiser o escopo completo depois, é um plano novo maior.

## Status

- **Priority**: P3
- **Effort**: S (escopo reduzido — 4 testes, não a cobertura completa L da auditoria original)
- **Risk**: LOW — só adiciona testes, nenhuma mudança de código de produção.
- **Depends on**: none
- **Category**: tests (cobertura ausente)
- **Confidence**: HIGH (confirmado ao vivo em 2026-07-29)
- **Planned at**: commit `bc6284d`, 2026-07-29

## Why this matters

`_rotear_por_intencao` (`worker/empregabilidade_engine.py:2493+`) tem 4 branches por intenção classificada: `empresa` (`:2493`), `candidato_vaga` (`:2498`), `banco_talentos` (`:2548`), `upload` (`:2557`) — além do branch `ambiguo`, tratado em outro lugar. Conferi ao vivo: as **3 únicas chamadas** a `_rotear_por_intencao` em `worker/tests/test_empregabilidade_engine.py` (linhas 298, 325, 345) estão **todas** dentro de `TestFallbackAmbiguoPrimeiroContato`, testando exclusivamente `{"intencao": "ambiguo", ...}`. Os 4 branches reais de roteamento por intenção classificada — o caminho mais comum e mais crítico da função — não têm **nenhum** teste direto.

## Current state

`worker/empregabilidade_engine.py` (confirmado ao vivo):
```python
:2493: if intencao == "empresa":
:2498: elif intencao == "candidato_vaga":
:2548: elif intencao == "banco_talentos":
:2557: elif intencao == "upload":
```
`worker/tests/test_empregabilidade_engine.py:283-352` (`TestFallbackAmbiguoPrimeiroContato`) — padrão de mock já estabelecido pra chamar `_rotear_por_intencao` (usar como modelo, não reinventar):
```python
await emp._rotear_por_intencao(
    {"intencao": "ambiguo", "nome": None},
    "bom dia", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
)
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Suíte completa | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass, incluindo os 4 novos |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |

## Scope

**In scope**: 4 testes novos, 1 por branch de `_rotear_por_intencao` não coberto hoje (`empresa`, `candidato_vaga`, `banco_talentos`, `upload`).

**Out of scope**: as ~30 etapas do restante dos fluxos candidato/público (escopo completo do achado #16 original, Esforço L — não este plano); mudança de código de produção.

## Git workflow

- Branch: `test/achado16-cobertura-rotear-por-intencao`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Ler cada branch antes de escrever o teste

Ler `:2493-2570` completo (não confiar só nos números de linha desta consolidação — a auditoria de 17/07 não foi re-verificada linha a linha aqui além da localização dos 4 `if`/`elif`) pra entender o que cada branch faz de fato (mensagem enviada, etapa resultante, efeitos colaterais como escrita em `logs_intencao` ou similar) antes de escrever o assert.

### Step 2: 4 testes, 1 por branch

Seguir o padrão de `TestFallbackAmbiguoPrimeiroContato` (`_fluxo_mock`, mock de `_enviar`). Esqueleto (ajustar asserts conforme o comportamento real confirmado no Step 1):

```python
class TestRotearPorIntencaoBranchesPrincipais:

    @pytest.mark.asyncio
    async def test_intencao_empresa_pede_cnpj(self, monkeypatch):
        estado, fake_get, fake_set = _fluxo_mock("inicio")
        monkeypatch.setattr(emp, "_get_fluxo", fake_get)
        monkeypatch.setattr(emp, "_set_fluxo", fake_set)
        mock_enviar = AsyncMock(return_value=True)
        monkeypatch.setattr(emp, "_enviar", mock_enviar)

        await emp._rotear_por_intencao(
            {"intencao": "empresa", "nome": None},
            "quero cadastrar minha empresa", "558599990000", "PHONE_ID", "token", "lead-1", "conv-1", "Barra",
        )

        texto_enviado = mock_enviar.call_args.args[3]
        assert "CNPJ" in texto_enviado
        assert estado.get("etapa") == "aguardando_cnpj"

    @pytest.mark.asyncio
    async def test_intencao_candidato_vaga_lista_vagas(self, monkeypatch):
        # Precisa mockar supabase.table("vagas")... — ver _mock_sb_multi_tabela
        # do Plan 008 se já estiver implementado, senão MagicMock direto.
        ...

    @pytest.mark.asyncio
    async def test_intencao_banco_talentos_inicia_coleta_de_nome(self, monkeypatch):
        ...

    @pytest.mark.asyncio
    async def test_intencao_upload_trata_arquivo(self, monkeypatch):
        ...
```
Os 2 últimos (`candidato_vaga`, `banco_talentos`, `upload`) provavelmente precisam de mock de `supabase` além de `_get_fluxo`/`_enviar` — reaproveitar `_mock_sb_multi_tabela` do Plan 008 se esse plano já tiver sido executado, senão um `MagicMock()` simples com os retornos necessários.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py::TestRotearPorIntencaoBranchesPrincipais -v` → passa.

## Test plan

Os 4 testes acima **são** o entregável — sem eles, este plano não está feito.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass.

## Done criteria

- [ ] 4 testes novos, 1 por branch (`empresa`, `candidato_vaga`, `banco_talentos`, `upload`)
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0
- [ ] Nenhuma mudança em código de produção
- [ ] `plans/README.md` atualizado

## STOP conditions

- Qualquer um dos 4 testes revelar comportamento inesperado (ex.: um branch não faz o que o texto do bot sugere) — reporte como achado novo, não ajuste o código de produção silenciosamente (fora de escopo).
- Os números de linha não baterem com o código ao vivo.

## Maintenance notes

- Este plano cobre só os 4 branches de topo de `_rotear_por_intencao` — as ~30 etapas restantes do achado #16 original continuam sem cobertura. Se quiser fechar isso por completo depois, é candidato a um plano novo (Esforço L, como a auditoria original já estimou).
