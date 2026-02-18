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
  if (!Array.isArray(hist)) {
    console.error("freqBias: hist is not an array!", typeof hist, hist);
    return null;
  }
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

// ─── MAIN HANDLER v2 ────────────────────────────────────────────────
Deno.serve(async (req) => {
  console.log("fetch-wingo-data v2 starting...");
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Fetch from public API
    console.log("Fetching from public API...");
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

    // 5. Get existing predictions to avoid duplicates
    const { data: existingPreds } = await supabase
      .from("predictions")
      .select("issue_number, mode");

    const predSet = new Set(
      (existingPreds || []).map((p: any) => `${p.issue_number}|${p.mode}`)
    );

    // 6. Process predictions with Markov AI
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
      for (const mode of ["color", "size"]) {
        const key = `${result.issue_number}|${mode}`;
        if (!predSet.has(key)) {
          const hist = mode === "color" ? colorHist : sizeHist;
          const model = mode === "color" ? colorModel : sizeModel;
          const wrongStreak =
            mode === "color" ? wrongStreakColor : wrongStreakSize;

          let pred = ensemble(model, mode, hist);
          if (wrongStreak >= MAX_WRONG) {
            pred = flipPred(mode, pred);
          }

          const actual = mode === "color" ? col : sz;
          const correct = pred === actual;

          newPredictions.push({
            issue_number: result.issue_number,
            mode,
            prediction: pred,
            correct,
          });
          predSet.add(key);
        }
      }

      // Now consume the result (train)
      colorHist.push(col);
      mRecord(colorModel, colorHist, ORDER);
      sizeHist.push(sz);
      mRecord(sizeModel, sizeHist, ORDER);

      // Update wrong streaks based on actual correctness
      // Check what was predicted for this period
      const colorPredForThis = newPredictions.find(
        (p) => p.issue_number === result.issue_number && p.mode === "color"
      );
      const sizePredForThis = newPredictions.find(
        (p) => p.issue_number === result.issue_number && p.mode === "size"
      );

      if (colorPredForThis) {
        wrongStreakColor = colorPredForThis.correct ? 0 : wrongStreakColor + 1;
      } else {
        // Already existed, check from DB
        const existing = (existingPreds || []).find(
          (p: any) =>
            p.issue_number === result.issue_number && p.mode === "color"
        );
        if (existing) {
          // We don't have the correct field from the select, just keep tracking
          const actual = col;
          // We need to re-derive... just check based on actual
          const pred = ensemble(
            colorModel,
            colorHist.slice(0, -1),
            ORDER
          );
          // simplified: just reset streak tracking from existing data
        }
      }
      if (sizePredForThis) {
        wrongStreakSize = sizePredForThis.correct ? 0 : wrongStreakSize + 1;
      }
    }

    // 7. Generate prediction for NEXT period
    const latestIssue = allResults[allResults.length - 1].issue_number;
    let nextIssue: string;
    try {
      nextIssue = (BigInt(latestIssue) + 1n).toString();
    } catch {
      nextIssue = latestIssue + "?";
    }

    for (const mode of ["color", "size"]) {
      const key = `${nextIssue}|${mode}`;
      if (!predSet.has(key)) {
        const hist = mode === "color" ? colorHist : sizeHist;
        const model = mode === "color" ? colorModel : sizeModel;
        const wrongStreak =
          mode === "color" ? wrongStreakColor : wrongStreakSize;

        let pred = ensemble(model, mode, hist);
        if (wrongStreak >= MAX_WRONG) {
          pred = flipPred(mode, pred);
        }

        newPredictions.push({
          issue_number: nextIssue,
          mode,
          prediction: pred,
          correct: null, // unknown yet
        });
      }
    }

    // 8. Insert all new predictions
    if (newPredictions.length > 0) {
      const { error: predErr } = await supabase
        .from("predictions")
        .upsert(newPredictions, {
          onConflict: "issue_number,mode",
          ignoreDuplicates: true,
        });
      if (predErr) console.error("Prediction insert error:", predErr);
    }

    // 9. Trim predictions
    await supabase.rpc("trim_predictions");

    console.log(
      `Processed ${allResults.length} results, ${newPredictions.length} new predictions`
    );

    return new Response(
      JSON.stringify({
        success: true,
        results: allResults.length,
        newPredictions: newPredictions.length,
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
