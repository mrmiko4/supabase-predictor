
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS formula_applied jsonb DEFAULT NULL;
