-- As tabelas categorias_interesse e lead_interesses já existem no Supabase.
-- Esta migration limpa categorias antigas (mockadas) e insere a nova taxonomia minimalista.

-- 1. Limpar dados antigos (como lead_interesses está vazi, é seguro)
DELETE FROM public.categorias_interesse;

-- Seeds com a taxonomia minimalista
DO $$
DECLARE
    eixo_esporte UUID := gen_random_uuid();
    eixo_cultura UUID := gen_random_uuid();
    eixo_curso UUID := gen_random_uuid();
BEGIN
    -- Insert Eixos
    INSERT INTO public.categorias_interesse (id, nome, pai_id, ordem) VALUES
        (eixo_esporte, 'Esportes', NULL, 1),
        (eixo_cultura, 'Cultura', NULL, 2),
        (eixo_curso, 'Cursos (Formação e Qualificação)', NULL, 3);

    -- Modalidades Esportes
    INSERT INTO public.categorias_interesse (nome, pai_id, ordem) VALUES
        ('Artes Marciais', eixo_esporte, 1),
        ('Basquete', eixo_esporte, 2),
        ('Capoeira', eixo_esporte, 3),
        ('Condicionamento Físico', eixo_esporte, 4),
        ('Futsal', eixo_esporte, 5),
        ('Ginástica', eixo_esporte, 6),
        ('Handebol', eixo_esporte, 7),
        ('Jiu-Jitsu', eixo_esporte, 8),
        ('Judô', eixo_esporte, 9),
        ('Karatê', eixo_esporte, 10),
        ('Natação', eixo_esporte, 11),
        ('Hidroginástica', eixo_esporte, 12),
        ('Pilates', eixo_esporte, 13),
        ('Vôlei', eixo_esporte, 14);

    -- Modalidades Cultura
    INSERT INTO public.categorias_interesse (nome, pai_id, ordem) VALUES
        ('Dança', eixo_cultura, 1),
        ('Teatro', eixo_cultura, 2),
        ('Fotografia e Audiovisual', eixo_cultura, 3),
        ('Música — Instrumento', eixo_cultura, 4),
        ('Música — Canto e Banda', eixo_cultura, 5);

    -- Modalidades Cursos
    INSERT INTO public.categorias_interesse (nome, pai_id, ordem) VALUES
        ('Informática Básica', eixo_curso, 1),
        ('Programação TI', eixo_curso, 2),
        ('Manutenção de Sistemas e Celulares', eixo_curso, 3),
        ('Infraestrutura e Elétrica', eixo_curso, 4),
        ('Design e Edição', eixo_curso, 5),
        ('Libras', eixo_curso, 6),
        ('Gestão e Empreendedorismo', eixo_curso, 7);
END $$;
