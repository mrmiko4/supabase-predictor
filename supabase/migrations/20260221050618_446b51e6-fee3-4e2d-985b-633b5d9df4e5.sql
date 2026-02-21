
-- Update trim_game_results to keep only 10 records
CREATE OR REPLACE FUNCTION public.trim_game_results()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.game_results
  WHERE id NOT IN (
    SELECT id FROM public.game_results
    ORDER BY issue_number DESC
    LIMIT 10
  );
END;
$function$;

-- Update trim_predictions to keep only 10 per mode
CREATE OR REPLACE FUNCTION public.trim_predictions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.predictions
  WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY mode ORDER BY issue_number DESC) as rn
      FROM public.predictions
    ) sub
    WHERE rn <= 10
  );
END;
$function$;

-- Update get_history_with_predictions to return 10 rows
CREATE OR REPLACE FUNCTION public.get_history_with_predictions(p_mode text)
 RETURNS TABLE(issue_number text, number integer, color text, premium text, prediction text, correct boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
