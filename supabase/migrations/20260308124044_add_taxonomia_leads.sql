CREATE TABLE IF NOT EXISTS public.categorias_interesse (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    parent_id UUID REFERENCES public.categorias_interesse(id) ON DELETE CASCADE,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Relação NxN entre leads e categorias_interesse
CREATE TABLE IF NOT EXISTS public.lead_interesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
    categoria_id UUID REFERENCES public.categorias_interesse(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(lead_id, categoria_id)
);

-- RLS
ALTER TABLE public.categorias_interesse ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_interesses ENABLE ROW LEVEL SECURITY;

-- Policies for categorias_interesse
CREATE POLICY "Leitura irrestrita para categorias_interesse" 
ON public.categorias_interesse FOR SELECT 
USING (true);

-- Policies for lead_interesses
CREATE POLICY "Colaboradores podem ler e alterar lead_interesses" 
ON public.lead_interesses FOR ALL 
TO authenticated 
USING (true) WITH CHECK (true);

-- Seeds
DO $$
DECLARE
    eixo_esporte UUID := gen_random_uuid();
    eixo_cultura UUID := gen_random_uuid();
    eixo_curso UUID := gen_random_uuid();
BEGIN
    -- Insert Eixos
    INSERT INTO public.categorias_interesse (id, nome, parent_id) VALUES
        (eixo_esporte, 'Esportes', NULL),
        (eixo_cultura, 'Cultura', NULL),
        (eixo_curso, 'Cursos (Formação e Qualificação)', NULL);

    -- Modalidades Esportes
    INSERT INTO public.categorias_interesse (nome, parent_id) VALUES
        ('Artes Marciais', eixo_esporte),
        ('Basquete', eixo_esporte),
        ('Capoeira', eixo_esporte),
        ('Condicionamento Físico', eixo_esporte),
        ('Futsal', eixo_esporte),
        ('Ginástica', eixo_esporte),
        ('Handebol', eixo_esporte),
        ('Jiu-Jitsu', eixo_esporte),
        ('Judô', eixo_esporte),
        ('Karatê', eixo_esporte),
        ('Natação', eixo_esporte),
        ('Hidroginástica', eixo_esporte),
        ('Pilates', eixo_esporte),
        ('Vôlei', eixo_esporte);

    -- Modalidades Cultura
    INSERT INTO public.categorias_interesse (nome, parent_id) VALUES
        ('Dança', eixo_cultura),
        ('Teatro', eixo_cultura),
        ('Fotografia e Audiovisual', eixo_cultura),
        ('Música — Instrumento', eixo_cultura),
        ('Música — Canto e Banda', eixo_cultura);

    -- Modalidades Cursos
    INSERT INTO public.categorias_interesse (nome, parent_id) VALUES
        ('Informática Básica', eixo_curso),
        ('Programação TI', eixo_curso),
        ('Manutenção de Sistemas e Celulares', eixo_curso),
        ('Infraestrutura e Elétrica', eixo_curso),
        ('Design e Edição', eixo_curso),
        ('Libras', eixo_curso),
        ('Gestão e Empreendedorismo', eixo_curso);
END $$;
