import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_URL =
  "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";

// ─── MAIN HANDLER ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Fetch from public API
    const apiRes = await fetch(API_URL);
    const apiJson = await apiRes.json();

    if (apiJson.code !== 0 || !apiJson.data?.list) {
      console.error("API returned unexpected format:", apiJson);
      return new Response(JSON.stringify({ error: "API error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiList = apiJson.data.list;

    // 2. Upsert into game_results
    const rows = apiList.map((item: any) => ({
      issue_number: item.issueNumber,
      number: parseInt(item.number, 10),
      color: item.color,
      premium: item.premium,
      sum: item.sum || 0,
    }));

    const { error: upsertErr } = await supabase
      .from("game_results")
      .upsert(rows, { onConflict: "issue_number", ignoreDuplicates: true });

    if (upsertErr) console.error("Upsert error:", upsertErr);

    // 3. Trim game_results to 10
    await supabase.rpc("trim_game_results");

    // 4. Get stored results
    const { data: allResults, error: fetchErr } = await supabase
      .from("game_results")
      .select("*")
      .order("issue_number", { ascending: true });

    if (fetchErr || !allResults) {
      console.error("Fetch results error:", fetchErr);
      return new Response(JSON.stringify({ error: "DB read error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Get existing predictions
    const { data: existingPreds } = await supabase
      .from("predictions")
      .select("issue_number, mode, prediction, correct");

    const predMap = new Map<string, { prediction: string; correct: boolean | null }>();
    (existingPreds || []).forEach((p: any) => {
      predMap.set(`${p.issue_number}|${p.mode}`, { prediction: p.prediction, correct: p.correct });
    });

    // 6. Update correct field for existing predictions
    const correctUpdates: any[] = [];
    for (const result of allResults) {
      const n = result.number;
      const col = result.color.toLowerCase().includes("red") ? "RED" : "GREEN";
      const sz = n <= 4 ? "SMALL" : "BIG";

      for (const m of ["color", "size"]) {
        const key = `${result.issue_number}|${m}`;
        const existing = predMap.get(key);
        if (existing && existing.correct === null) {
          const actual = m === "color" ? col : sz;
          const isCorrect = existing.prediction === actual;
          correctUpdates.push({ issue_number: result.issue_number, mode: m, correct: isCorrect });
          predMap.set(key, { ...existing, correct: isCorrect });
        }
      }
    }

    for (const upd of correctUpdates) {
      await supabase
        .from("predictions")
        .update({ correct: upd.correct })
        .eq("issue_number", upd.issue_number)
        .eq("mode", upd.mode);
    }

    // 7. Compute next period
    const latestIssue = allResults[allResults.length - 1].issue_number;
    let nextIssue: string;
    try {
      nextIssue = (BigInt(latestIssue) + 1n).toString();
    } catch {
      nextIssue = latestIssue + "?";
    }

    // 8. MATH.RANDOM 50/50 PREDICTION ENGINE
    const newPredictions: any[] = [];

    for (const m of ["color", "size"] as const) {
      const key = `${nextIssue}|${m}`;
      if (predMap.has(key)) continue;

      // Pure 50/50 random prediction
      const pred = m === "color"
        ? (Math.random() < 0.5 ? "RED" : "GREEN")
        : (Math.random() < 0.5 ? "BIG" : "SMALL");

      newPredictions.push({
        issue_number: nextIssue,
        mode: m,
        prediction: pred,
        correct: null,
        formula_applied: {
          id: "random_5050",
          type: "math_random",
          condition: "Math.random() < 0.5",
          prediction: pred,
          confidence: 0.5,
          support: 1,
          description: `50/50 random → ${pred}`,
        },
      });
    }

    // 9. Backfill predictions for historical periods without one
    for (const result of allResults) {
      const n = result.number;
      const col = result.color.toLowerCase().includes("red") ? "RED" : "GREEN";
      const sz = n <= 4 ? "SMALL" : "BIG";

      for (const m of ["color", "size"]) {
        const key = `${result.issue_number}|${m}`;
        if (!predMap.has(key)) {
          const pred = m === "color"
            ? (Math.random() < 0.5 ? "RED" : "GREEN")
            : (Math.random() < 0.5 ? "BIG" : "SMALL");
          const actual = m === "color" ? col : sz;
          newPredictions.push({
            issue_number: result.issue_number,
            mode: m,
            prediction: pred,
            correct: pred === actual,
          });
          predMap.set(key, { prediction: pred, correct: pred === actual });
        }
      }
    }

    // 10. Insert all new predictions
    if (newPredictions.length > 0) {
      const { error: predErr } = await supabase
        .from("predictions")
        .upsert(newPredictions, {
          onConflict: "issue_number,mode",
          ignoreDuplicates: true,
        });
      if (predErr) console.error("Prediction insert error:", predErr);
    }

    // 11. Trim predictions to 10 per mode
    await supabase.rpc("trim_predictions");

    console.log(
      `Engine=random_5050 | Records=${allResults.length} | NewPreds=${newPredictions.length} | CorrectUpdates=${correctUpdates.length}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        engine: "random_5050",
        records: allResults.length,
        newPredictions: newPredictions.length,
        correctUpdates: correctUpdates.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
