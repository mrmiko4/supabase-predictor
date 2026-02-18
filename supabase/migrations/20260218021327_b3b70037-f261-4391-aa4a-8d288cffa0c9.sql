
-- Fix RLS policies: change from RESTRICTIVE to PERMISSIVE
DROP POLICY IF EXISTS "Public can read game_results" ON public.game_results;
DROP POLICY IF EXISTS "Service role can delete game_results" ON public.game_results;
DROP POLICY IF EXISTS "Service role can insert game_results" ON public.game_results;
DROP POLICY IF EXISTS "Service role can update game_results" ON public.game_results;

DROP POLICY IF EXISTS "Public can read predictions" ON public.predictions;
DROP POLICY IF EXISTS "Service role can delete predictions" ON public.predictions;
DROP POLICY IF EXISTS "Service role can insert predictions" ON public.predictions;
DROP POLICY IF EXISTS "Service role can update predictions" ON public.predictions;

-- Recreate as PERMISSIVE (default)
CREATE POLICY "Public can read game_results" ON public.game_results FOR SELECT USING (true);
CREATE POLICY "Service role can insert game_results" ON public.game_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update game_results" ON public.game_results FOR UPDATE USING (true);
CREATE POLICY "Service role can delete game_results" ON public.game_results FOR DELETE USING (true);

CREATE POLICY "Public can read predictions" ON public.predictions FOR SELECT USING (true);
CREATE POLICY "Service role can insert predictions" ON public.predictions FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update predictions" ON public.predictions FOR UPDATE USING (true);
CREATE POLICY "Service role can delete predictions" ON public.predictions FOR DELETE USING (true);
