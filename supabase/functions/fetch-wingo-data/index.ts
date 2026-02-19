import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_URL =
  "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";
const ORDER = 5;
const MAX_WRONG = 2;

// ─── MARKOV ENGINE ──────────────────────────────────────────────────
interface MarkovModel {
  [state: string]: { [outcome: string]: number };
}

function mRecord(model: MarkovModel, seq: string[], order: number) {
  if (seq.length < order + 1) return;
  const st = seq.slice(-(order + 1), -1).join("|");
  const nx = seq[seq.length - 1];
  if (!model[st]) model[st] = {};
  model[st][nx] = (model[st][nx] || 0) + 1;
}

function mPredict(
  model: MarkovModel,
  hist: string[],
  order: number
): { outcome: string; confidence: number } | null {
  for (let ord = Math.min(order, hist.length); ord >= 1; ord--) {
    const st = hist.slice(-ord).join("|");
    const cnts = model[st];
    if (!cnts) continue;
    const total = Object.values(cnts).reduce((a, b) => a + b, 0);
    const sorted = Object.entries(cnts).sort((a, b) => b[1] - a[1]);
    return { outcome: sorted[0][0], confidence: sorted[0][1] / total };
  }
  return null;
}

function freqBias(mode: string, hist: string[]): string | null {
  const recent = hist.slice(-6);
  const outs = mode === "color" ? ["RED", "GREEN"] : ["BIG", "SMALL"];
  const cnt: { [k: string]: number } = {};
  outs.forEach((o) => (cnt[o] = 0));
  recent.forEach((r) => {
    if (cnt[r] !== undefined) cnt[r]++;
  });
  const over = outs.find((o) => cnt[o] >= 5);
  return over ? outs.find((o) => o !== over)! : null;
}

function fallbackPred(mode: string, hist: string[]): string {
  if (!hist.length) return mode === "color" ? "RED" : "BIG";
  const last = hist[hist.length - 1];
  return mode === "color"
    ? last === "RED"
      ? "GREEN"
      : "RED"
    : last === "BIG"
    ? "SMALL"
    : "BIG";
}

function ensemble(model: MarkovModel, mode: string, hist: string[]): string {
  const mr = mPredict(model, hist, ORDER);
  const fb = freqBias(mode, hist);
  if (!mr && !fb) return fallbackPred(mode, hist);
  if (!mr) return fb!;
  if (!fb) return mr.outcome;
  return mr.confidence > 0.62 ? mr.outcome : fb;
}

function flipPred(mode: string, pred: string): string {
  return mode === "color"
    ? pred === "RED"
      ? "GREEN"
      : "RED"
    : pred === "BIG"
    ? "SMALL"
    : "BIG";
}

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

    // 3. Trim game_results
    await supabase.rpc("trim_game_results");

    // 4. Get all stored results chronologically (oldest first)
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

    // 5. Get existing predictions (including correct status)
    const { data: existingPreds } = await supabase
      .from("predictions")
      .select("issue_number, mode, prediction, correct");

    const predMap = new Map<string, { prediction: string; correct: boolean | null }>();
    (existingPreds || []).forEach((p: any) => {
      predMap.set(`${p.issue_number}|${p.mode}`, { prediction: p.prediction, correct: p.correct });
    });

    // Build a set of all result issue_numbers for quick lookup
    const resultIssueSet = new Set(allResults.map((r: any) => r.issue_number));

    // 6. Update correct field for existing predictions that have results but correct=null
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
          correctUpdates.push({
            issue_number: result.issue_number,
            mode: m,
            correct: isCorrect,
          });
          // Update local map too
          predMap.set(key, { ...existing, correct: isCorrect });
        }
      }
    }

    // Batch update correct fields
    for (const upd of correctUpdates) {
      await supabase
        .from("predictions")
        .update({ correct: upd.correct })
        .eq("issue_number", upd.issue_number)
        .eq("mode", upd.mode);
    }

    // 7. Process predictions with Markov AI
    const colorModel: MarkovModel = {};
    const sizeModel: MarkovModel = {};
    const colorHist: string[] = [];
    const sizeHist: string[] = [];
    let wrongStreakColor = 0;
    let wrongStreakSize = 0;

    const newPredictions: any[] = [];

    for (const result of allResults) {
      const n = result.number;
      const col = result.color.toLowerCase().includes("red") ? "RED" : "GREEN";
      const sz = n <= 4 ? "SMALL" : "BIG";

      // Generate prediction for this period if not exists
      for (const m of ["color", "size"]) {
        const key = `${result.issue_number}|${m}`;
        if (!predMap.has(key)) {
          const hist = m === "color" ? colorHist : sizeHist;
          const model = m === "color" ? colorModel : sizeModel;
          const wrongStreak = m === "color" ? wrongStreakColor : wrongStreakSize;

          let pred = ensemble(model, m, hist);
          if (wrongStreak >= MAX_WRONG) {
            pred = flipPred(m, pred);
          }

          const actual = m === "color" ? col : sz;
          const correct = pred === actual;

          newPredictions.push({
            issue_number: result.issue_number,
            mode: m,
            prediction: pred,
            correct,
          });
          predMap.set(key, { prediction: pred, correct });
        }
      }

      // Train
      colorHist.push(col);
      mRecord(colorModel, colorHist, ORDER);
      sizeHist.push(sz);
      mRecord(sizeModel, sizeHist, ORDER);

      // Update wrong streaks
      const colorPred = predMap.get(`${result.issue_number}|color`);
      const sizePred = predMap.get(`${result.issue_number}|size`);
      if (colorPred) {
        wrongStreakColor = colorPred.correct ? 0 : wrongStreakColor + 1;
      }
      if (sizePred) {
        wrongStreakSize = sizePred.correct ? 0 : wrongStreakSize + 1;
      }
    }

    // 8. Generate prediction for NEXT period
    const latestIssue = allResults[allResults.length - 1].issue_number;
    let nextIssue: string;
    try {
      nextIssue = (BigInt(latestIssue) + 1n).toString();
    } catch {
      nextIssue = latestIssue + "?";
    }

    for (const m of ["color", "size"]) {
      const key = `${nextIssue}|${m}`;
      if (!predMap.has(key)) {
        const hist = m === "color" ? colorHist : sizeHist;
        const model = m === "color" ? colorModel : sizeModel;
        const wrongStreak = m === "color" ? wrongStreakColor : wrongStreakSize;

        let pred = ensemble(model, m, hist);
        if (wrongStreak >= MAX_WRONG) {
          pred = flipPred(m, pred);
        }

        newPredictions.push({
          issue_number: nextIssue,
          mode: m,
          prediction: pred,
          correct: null,
        });
      }
    }

    // 9. Insert all new predictions
    if (newPredictions.length > 0) {
      const { error: predErr } = await supabase
        .from("predictions")
        .upsert(newPredictions, {
          onConflict: "issue_number,mode",
          ignoreDuplicates: true,
        });
      if (predErr) console.error("Prediction insert error:", predErr);
    }

    // 10. Trim predictions
    await supabase.rpc("trim_predictions");

    console.log(
      `Processed ${allResults.length} results, ${newPredictions.length} new preds, ${correctUpdates.length} correct updates`
    );

    return new Response(
      JSON.stringify({
        success: true,
        results: allResults.length,
        newPredictions: newPredictions.length,
        correctUpdates: correctUpdates.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
