-- Suporte a header de imagem em templates Meta + sincronizacao de
-- programacao_agosto_v6 (mudanca urgente pedida pelo Junior/socio, 2026-08-07).
--
-- GAP ESTRUTURAL CONFIRMADO: meta_templates nunca teve coluna pra header de
-- midia -- toda a modelagem ate hoje era corpo de texto puro (variaveis/
-- corpo_texto/corpo_texto_aprovado). O template programacao_agosto_v6 foi
-- editado direto no WhatsApp Manager pelo socio e tem um componente HEADER
-- tipo IMAGE, aprovado -- confirmado via Graph API (nao so pelo print do
-- WhatsApp Manager):
--   GET /{waba_id}/message_templates?name=programacao_agosto_v6
--   -> status=APPROVED, category=MARKETING, quality_score=UNKNOWN (normal,
--      template novo/editado sem volume de envio ainda -- nao bloqueia envio)
--   -> components: HEADER(IMAGE) + BODY (0 variaveis, texto 100% estatico,
--      com **negrito** Markdown e link com sufixo /1) + FOOTER
--      ("Participacao 100% gratuita. A Rede Cuca nunca cobra nada").
--
-- header_media_id: mídia ja foi enviada UMA VEZ pro endpoint de upload da
-- Meta (POST /{phone_number_id}/media, phone_number_id=1291080677418758,
-- arquivo docs/disparo_agosto/WhatsApp Image 2026-08-07 at 14.40.12.jpeg,
-- 1080x1350 JPEG, 262834 bytes) e o id resultante fica gravado aqui --
-- reusado em TODO envio, sem re-upload por lead (upload por link exigiria a
-- Meta buscar a imagem de novo a cada mensagem, mais fragil em disparo de
-- centenas de leads). Confirmado via GET /{media_id} que o handle e valido
-- (sha256/file_size batem com o arquivo original).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + UPSERT por nome+phone_number_ids
-- (nao existe unique constraint em meta_templates hoje -- usa DELETE+INSERT
-- condicional pra nao duplicar linha se a migration for reaplicada).

ALTER TABLE public.meta_templates
  ADD COLUMN IF NOT EXISTS header_tipo text,
  ADD COLUMN IF NOT EXISTS header_media_id text,
  ADD COLUMN IF NOT EXISTS header_media_origem text;

-- Desativa v3 (superado pelo v6) -- mantido na tabela, so ativo=false, pra
-- preservar historico (mesmo padrao ja usado pelos outros templates _v1/_v2).
UPDATE public.meta_templates
SET ativo = false,
    observacoes = COALESCE(observacoes, '') || ' | Substituido por programacao_agosto_v6 em 2026-08-07 (mudanca de conteudo + header de imagem, pedido direto do socio).'
WHERE nome = 'programacao_agosto_v3' AND ativo = true;

-- Remove qualquer linha previa de v6 antes de inserir (idempotencia de
-- reaplicacao da migration, ja que nao ha unique constraint em (nome)).
DELETE FROM public.meta_templates WHERE nome = 'programacao_agosto_v6';

INSERT INTO public.meta_templates (
  nome, categoria, status, variaveis, automacoes, waba_ids, phone_number_ids,
  observacoes, ativo, corpo_texto, corpo_texto_aprovado, parameter_format,
  header_tipo, header_media_id, header_media_origem
) VALUES (
  'programacao_agosto_v6',
  'MARKETING',
  'aprovado',
  '[]'::jsonb,
  ARRAY['Institucional'],
  ARRAY['1035278895899806'],
  ARRAY['1291080677418758'],
  'Meta template_id=1549725859978969 (confirmado APPROVED via Graph API 2026-08-07). '
    || 'Editado diretamente no WhatsApp Manager pelo socio, a pedido da Rede Cuca -- '
    || 'corpo 100% estatico (sem variaveis), com header de imagem e footer proprios. '
    || 'Substitui programacao_agosto_v3 (desativado). header_media_id valido no momento '
    || 'do cadastro -- se expirar/for removido do lado Meta, precisa reupload antes do '
    || 'proximo disparo.',
  true,
  E'Olá! 👋\n\n*E aí, beleza?*\n\nEstamos estreando o nosso canal oficial da Rede Cuca no WhatsApp! 💜\n\nPor aqui, você poderá acompanhar novidades, cursos, eventos e oportunidades da Rede Cuca. Além disso, este também será um canal para tirar dúvidas e receber informações sobre nossos serviços.\n\n*E para começar, a programação de Agosto já está disponível!*\n\nNeste mês, celebramos as juventudes com uma programação especial que reforça o protagonismo juvenil e reúne atividades de cultura, esporte, lazer, qualificação e cidadania.\n\nEntre os destaques estão as batalhas de rima, o Festival de Música da Juventude, os encontros de K-pop e o Viradão da Juventude, com 35 horas ininterruptas de atividades gratuitas em cada unidade.\n\n*Confira tudo em:*\n\nhttps://portaldajuventude.fortaleza.ce.gov.br/portal-web/#/1\n\nEsperamos você! 💜\n\nSe não desejar mais receber mensagens por este canal, responda *SAIR*\n\n— Participação 100% gratuita. A Rede Cuca nunca cobra nada',
  E'Olá! 👋\n\n*E aí, beleza?*\n\nEstamos estreando o nosso canal oficial da Rede Cuca no WhatsApp! 💜\n\nPor aqui, você poderá acompanhar novidades, cursos, eventos e oportunidades da Rede Cuca. Além disso, este também será um canal para tirar dúvidas e receber informações sobre nossos serviços.\n\n*E para começar, a programação de Agosto já está disponível!*\n\nNeste mês, celebramos as juventudes com uma programação especial que reforça o protagonismo juvenil e reúne atividades de cultura, esporte, lazer, qualificação e cidadania.\n\nEntre os destaques estão as batalhas de rima, o Festival de Música da Juventude, os encontros de K-pop e o Viradão da Juventude, com 35 horas ininterruptas de atividades gratuitas em cada unidade.\n\n*Confira tudo em:*\n\nhttps://portaldajuventude.fortaleza.ce.gov.br/portal-web/#/1\n\nEsperamos você! 💜\n\nSe não desejar mais receber mensagens por este canal, responda *SAIR*\n\n— Participação 100% gratuita. A Rede Cuca nunca cobra nada',
  'NAMED',
  'image',
  '1047489034359204',
  'docs/disparo_agosto/WhatsApp Image 2026-08-07 at 14.40.12.jpeg (upload manual via Graph API em 2026-08-07)'
);
