
-- Game results table
CREATE TABLE public.game_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_number TEXT UNIQUE NOT NULL,
  number INT NOT NULL,
  color TEXT NOT NULL,
  premium TEXT,
  sum INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_game_results_issue_desc ON public.game_results (issue_number DESC);

ALTER TABLE public.game_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read game_results"
  ON public.game_results FOR SELECT USING (true);

CREATE POLICY "Service role can insert game_results"
  ON public.game_results FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update game_results"
  ON public.game_results FOR UPDATE
  USING (true);

CREATE POLICY "Service role can delete game_results"
  ON public.game_results FOR DELETE
  USING (true);

-- Predictions table
CREATE TABLE public.predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_number TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('color', 'size')),
  prediction TEXT NOT NULL,
  correct BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issue_number, mode)
);

CREATE INDEX idx_predictions_issue_desc ON public.predictions (issue_number DESC);
CREATE INDEX idx_predictions_mode_created ON public.predictions (mode, created_at DESC);

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read predictions"
  ON public.predictions FOR SELECT USING (true);

CREATE POLICY "Service role can insert predictions"
  ON public.predictions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update predictions"
  ON public.predictions FOR UPDATE
  USING (true);

CREATE POLICY "Service role can delete predictions"
  ON public.predictions FOR DELETE
  USING (true);

-- Trim function for game_results (keep latest 50)
CREATE OR REPLACE FUNCTION public.trim_game_results()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.game_results
  WHERE id NOT IN (
    SELECT id FROM public.game_results
    ORDER BY issue_number DESC
    LIMIT 50
  );
END;
$$;

-- Trim function for predictions (keep latest 10 per mode)
CREATE OR REPLACE FUNCTION public.trim_predictions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.predictions
  WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY mode ORDER BY issue_number DESC) as rn
      FROM public.predictions
    ) sub
    WHERE rn <= 15
  );
END;
$$;

-- Helper function: get history with predictions for a given mode
CREATE OR REPLACE FUNCTION public.get_history_with_predictions(p_mode TEXT)
RETURNS TABLE (
  issue_number TEXT,
  number INT,
  color TEXT,
  premium TEXT,
  prediction TEXT,
  correct BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  LIMIT 10;
END;
$$;
