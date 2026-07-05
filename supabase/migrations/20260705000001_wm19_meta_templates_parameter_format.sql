-- S-WM-19 Task 3: coluna parameter_format ausente em meta_templates (débito
-- registrado em S-WM-18). Todos os 6 templates hoje em uso são NAMED — confirmado
-- por: (1) _montar_parametros_named() é o único caminho de envio real no worker,
-- sempre emite parameter_name; (2) S-WM-18 confirmou institucional_programacao_mensal_v1
-- como NAMED direto no Business Manager. Nenhum código lê esta coluna ainda
-- (grep vazio) — adição puramente aditiva, sem risco de contrato quebrado.

alter table public.meta_templates
  add column if not exists parameter_format text not null default 'NAMED'
  check (parameter_format in ('NAMED', 'NUMBERED'));
