
-- Create formula_sets table for storing extracted prediction rules
CREATE TABLE public.formula_sets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mode text NOT NULL, -- 'color' or 'size'
  formulas jsonb NOT NULL DEFAULT '[]'::jsonb,
  accuracy numeric DEFAULT 0,
  total_predictions integer DEFAULT 0,
  correct_predictions integer DEFAULT 0,
  consecutive_failures integer DEFAULT 0,
  is_active boolean DEFAULT true,
  extracted_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.formula_sets ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Public can read formula_sets" ON public.formula_sets FOR SELECT USING (true);
CREATE POLICY "Service role can insert formula_sets" ON public.formula_sets FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update formula_sets" ON public.formula_sets FOR UPDATE USING (true);
CREATE POLICY "Service role can delete formula_sets" ON public.formula_sets FOR DELETE USING (true);

-- Update trim_game_results to keep 1000 records instead of 50
CREATE OR REPLACE FUNCTION public.trim_game_results()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.game_results
  WHERE id NOT IN (
    SELECT id FROM public.game_results
    ORDER BY issue_number DESC
    LIMIT 1000
  );
END;
$$;

-- Update trim_predictions to keep 50 per mode instead of 15
CREATE OR REPLACE FUNCTION public.trim_predictions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.predictions
  WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY mode ORDER BY issue_number DESC) as rn
      FROM public.predictions
    ) sub
    WHERE rn <= 50
  );
END;
$$;

-- Update get_history_with_predictions to return 15 rows
CREATE OR REPLACE FUNCTION public.get_history_with_predictions(p_mode text)
RETURNS TABLE(issue_number text, number integer, color text, premium text, prediction text, correct boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gr.issue_number,
    gr.number,
    gr.color,
    gr.premium,
    p.prediction,
    p.correct
  FROM public.game_results gr
  LEFT JOIN public.predictions p
    ON gr.issue_number = p.issue_number AND p.mode = p_mode
  ORDER BY gr.issue_number DESC
  LIMIT 15;
END;
$$;
