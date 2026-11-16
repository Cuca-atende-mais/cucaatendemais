-- S-INST-QUAL-08 — texto novo do horário de atendimento na base institucional (`servicos_rede`).
--
-- Texto aprovado pelo Junior em 16/11/2026, depois do teste real com a rota de produção (5 de 5
-- perguntas certas). Troca só o parágrafo do horário (seção 2); o resto da base fica igual ao da
-- S-INST-QUAL-07 (7693e78c).
--
-- O que faz, numa transação só (a migration roda inteira ou nada):
--   1. lê o texto da base da S-INST-QUAL-07 (7693e78c), que nunca é alterado, e troca o parágrafo do
--      horário. Para se o parágrafo antigo não estiver lá (alguém mexeu na base: revisar antes);
--   2. grava a base nova (id fixo 7baf17fc) ATIVA. `carregarServicosRede` (motor-agente) lê o
--      `servicos_rede` ativo mais recente; o gatilho `tr_indexar_documento` pula `servicos_rede`;
--   3. só depois de conferir que a nova está ativa, desativa a 7693e78c (fica guardada, para voltar);
--   4. confere que sobrou exatamente 1 `servicos_rede` ativo.
-- Rodar de novo (inclusive depois de um rollback) publica de novo o mesmo texto.
--
-- Para voltar (rollback):
--   update public.documentos_rag set ativo = true  where id = '7693e78c-ae64-4c3c-a1f9-693928823269';
--   update public.documentos_rag set ativo = false where id = '7baf17fc-46b8-449b-9ee2-327953b7c987';

do $do$
declare
  v_origem constant uuid := '7693e78c-ae64-4c3c-a1f9-693928823269';
  v_novo constant uuid := '7baf17fc-46b8-449b-9ee2-327953b7c987';
  v_antigo constant text := $h$As cinco unidades atendem o público de terça a sexta, das 8h às 17h30. No sábado, só há atendimento ao público quando há evento marcado para esse dia, conforme a programação do mês. Segunda-feira, domingo e feriado não há atendimento ao público.$h$;
  v_horario constant text := $h$As cinco unidades atendem o público de terça a sexta, das 8h às 17h30. Segunda-feira, sábado, domingo e feriado não há atendimento ao público. Cursos, esportes e eventos que a programação do mês marcar para o fim de semana acontecem normalmente, mas não são atendimento ao público.$h$;
  v_base text;
  v_meta jsonb;
  v_texto text;
  v_ativos int;
begin
  select conteudo, metadados into v_base, v_meta
  from public.documentos_rag
  where id = v_origem and tipo = 'servicos_rede';
  if v_base is null then
    raise exception 'S-INST-QUAL-08: base da S-INST-QUAL-07 (7693e78c) não encontrada';
  end if;
  if position(v_antigo in v_base) = 0 then
    raise exception 'S-INST-QUAL-08: parágrafo do horário antigo não encontrado na base 7693e78c, revisar antes de aplicar';
  end if;

  v_texto := replace(v_base, v_antigo, v_horario);
  if position('Telefones das unidades' in v_texto) = 0 then
    -- a regra B do motor-agente e o prompt mandam copiar o telefone desta lista
    raise exception 'S-INST-QUAL-08: a base precisa da lista "Telefones das unidades"';
  end if;

  -- 1-2. base nova, ativa
  insert into public.documentos_rag (id, titulo, tipo, conteudo, metadados, unidade_cuca, ativo)
  values (
    v_novo,
    'Base institucional da Rede Cuca (novembro de 2026, horário revisado)',
    'servicos_rede',
    v_texto,
    coalesce(v_meta, '{}'::jsonb)
      || jsonb_build_object(
        'origem', 'S-INST-QUAL-08',
        'substitui', v_origem::text,
        'validacao', coalesce(v_meta->'validacao', '{}'::jsonb)
          || jsonb_build_object('2_horario', 'texto novo aprovado por Junior (Valmir), 16/11/2026, depois do teste real com a rota de produção'),
        'aprovado_por', 'Junior (Valmir)',
        'aprovado_em', '2026-11-16'
      ),
    null,
    true
  )
  on conflict (id) do update
    set titulo = excluded.titulo, conteudo = excluded.conteudo, metadados = excluded.metadados, ativo = true;

  if not exists (select 1 from public.documentos_rag where id = v_novo and tipo = 'servicos_rede' and ativo) then
    raise exception 'S-INST-QUAL-08: a base nova não ficou ativa; nada foi desativado';
  end if;

  -- 3. qualquer outro servicos_rede ativo (a 7693e78c) desativado
  update public.documentos_rag
  set ativo = false
  where tipo = 'servicos_rede' and ativo = true and id <> v_novo;

  -- 4. exatamente uma base ativa
  select count(*) into v_ativos from public.documentos_rag where tipo = 'servicos_rede' and ativo;
  if v_ativos <> 1 then
    raise exception 'S-INST-QUAL-08: % servicos_rede ativos, esperado 1', v_ativos;
  end if;
end
$do$;
