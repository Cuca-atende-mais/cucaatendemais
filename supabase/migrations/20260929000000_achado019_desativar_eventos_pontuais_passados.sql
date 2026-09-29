-- ACHADO-019 (frente custo-llm) — higiene da base: 9 eventos pontuais que já aconteceram
-- continuavam ativos e podiam aparecer na busca do Institucional (bot citando evento passado).
-- Decisão de 28/09/2026 (Junior + sócio): desativar agora.
--
-- Por que ficaram ativos: a rotina oficial `desativar_eventos_pontuais_passados()` só desativa
-- evento com `metadados.data_fim`, e estes 9 foram cadastrados sem data (metadados nulos).
--   Conexão Futuro CUCA Barra ×3 (mar–abr) · Corrida da Juventude ×4 (jul) ·
--   Academia Enem - Simulado / SIMULADO ACADEMIA ENEM 2026 (evento em 20 e 27/09)
--
-- Reversível: `update documentos_rag set ativo = true where id in (...)`. Mudar só `ativo` não
-- dispara reindexação (o gatilho olha titulo/conteudo). Idempotente.
update public.documentos_rag
   set ativo = false, updated_at = now()
 where tipo = 'eventos_pontuais'
   and ativo = true
   and id in (
     '24318832-3d9b-48a2-a43e-ee0d38a4b58d', 'b8e6297e-c845-4fab-a860-b872ff0c7cf9',
     '0315c98c-8d95-42fa-9bb8-6d1ca6c0724b', 'ba6d5494-bcb1-45b4-9b59-68ab31e19141',
     '3c05191e-c554-43f1-9d7d-e1c1a1466a90', '2158047f-1a6f-454f-b021-9a7b3a6bf1c9',
     'ff804306-fbb1-4920-8ad5-ab669f783dd4', '45f81391-210d-470e-94e6-7c10366e400d',
     'c0cd4697-67dd-4949-b1d8-9d8f5188ec46'
   );
