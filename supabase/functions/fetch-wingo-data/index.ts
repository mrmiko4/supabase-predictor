import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_URL =
  "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

// ─── AI PREDICTION ENGINE ───────────────────────────────────────────
async function aiPredict(
  apiKey: string,
  gameHistory: { number: number; color: string }[],
  mode: "color" | "size"
): Promise<string | null> {
  try {
    const historyStr = gameHistory
      .map((r, i) => {
        const col = r.color.toLowerCase().includes("red") ? "RED" : "GREEN";
        const sz = r.number <= 4 ? "SMALL" : "BIG";
        return `Period ${i + 1}: Number=${r.number}, Color=${col}, Size=${sz}`;
      })
      .join("\n");

    const systemPrompt = mode === "color"
      ? `You are an expert pattern recognition AI specialized in sequential data analysis.
You analyze game result sequences to detect hidden patterns, cycles, streaks, mean-reversion tendencies, and momentum shifts.

Your task: Given the chronological history of game results (oldest to newest), predict whether the NEXT result's color will be RED or GREEN.

Analysis techniques to apply:
- Streak analysis: detect consecutive same-color runs and predict reversals
- Cycle detection: identify repeating color patterns (RRGGRRGG, etc.)
- Frequency imbalance: if one color is overrepresented recently, expect correction
- Transition probability: analyze color-to-color transition frequencies
- Momentum vs mean-reversion: determine current regime

You MUST respond with ONLY the function call. No explanation.`
      : `You are an expert pattern recognition AI specialized in sequential data analysis.
You analyze game result sequences to detect hidden patterns, cycles, streaks, mean-reversion tendencies, and momentum shifts.

Your task: Given the chronological history of game results (oldest to newest), predict whether the NEXT result's size will be BIG (5-9) or SMALL (0-4).

Analysis techniques to apply:
- Streak analysis: detect consecutive same-size runs and predict reversals
- Cycle detection: identify repeating size patterns
- Frequency imbalance: if one size is overrepresented recently, expect correction
- Transition probability: analyze size-to-size transition frequencies
- Number clustering: detect if numbers tend to cluster in ranges

You MUST respond with ONLY the function call. No explanation.`;

    const toolName = mode === "color" ? "predict_color" : "predict_size";
    const enumValues = mode === "color" ? ["RED", "GREEN"] : ["BIG", "SMALL"];

    const response = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Here are the last ${gameHistory.length} game results (oldest first):\n\n${historyStr}\n\nPredict the NEXT result.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: toolName,
              description: `Predict the next game result ${mode}`,
              parameters: {
                type: "object",
                properties: {
                  prediction: {
                    type: "string",
                    enum: enumValues,
                    description: `The predicted ${mode} for the next period`,
                  },
                  confidence: {
                    type: "number",
                    description: "Confidence score between 0 and 1",
                  },
                },
                required: ["prediction", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: toolName } },
      }),
    });

    if (!response.ok) {
      console.error("AI Gateway error:", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall) {
      const args = JSON.parse(toolCall.function.arguments);
      console.log(`AI prediction (${mode}): ${args.prediction} (confidence: ${args.confidence})`);
      return args.prediction;
    }
    return null;
  } catch (err) {
    console.error("AI prediction error:", err);
    return null;
  }
}

// ─── FALLBACK: Enhanced Statistical Engine ──────────────────────────
function statisticalPredict(
  history: { number: number; color: string }[],
  mode: "color" | "size"
): string {
  if (history.length === 0) return mode === "color" ? "RED" : "BIG";

  const seq = history.map((r) =>
    mode === "color"
      ? r.color.toLowerCase().includes("red") ? "RED" : "GREEN"
      : r.number <= 4 ? "SMALL" : "BIG"
  );

  const outs = mode === "color" ? ["RED", "GREEN"] : ["BIG", "SMALL"];

  // 1. Streak reversal
  let streakLen = 1;
  for (let i = seq.length - 2; i >= 0; i--) {
    if (seq[i] === seq[seq.length - 1]) streakLen++;
    else break;
  }
  if (streakLen >= 4) {
    return seq[seq.length - 1] === outs[0] ? outs[1] : outs[0];
  }

  // 2. Frequency imbalance (last 8)
  const recent = seq.slice(-8);
  const cnt: Record<string, number> = {};
  outs.forEach((o) => (cnt[o] = 0));
  recent.forEach((r) => { if (cnt[r] !== undefined) cnt[r]++; });
  if (cnt[outs[0]] >= 6) return outs[1];
  if (cnt[outs[1]] >= 6) return outs[0];

  // 3. Pattern matching (look for 3-gram patterns)
  if (seq.length >= 4) {
    const last3 = seq.slice(-3).join(",");
    let matchCount: Record<string, number> = {};
    outs.forEach((o) => (matchCount[o] = 0));
    for (let i = 0; i <= seq.length - 4; i++) {
      const pattern = seq.slice(i, i + 3).join(",");
      if (pattern === last3 && i + 3 < seq.length) {
        matchCount[seq[i + 3]]++;
      }
    }
    const total = matchCount[outs[0]] + matchCount[outs[1]];
    if (total >= 2) {
      return matchCount[outs[0]] > matchCount[outs[1]] ? outs[0] : outs[1];
    }
  }

  // 4. Alternation detection
  if (seq.length >= 4) {
    const last4 = seq.slice(-4);
    let alternating = true;
    for (let i = 1; i < last4.length; i++) {
      if (last4[i] === last4[i - 1]) { alternating = false; break; }
    }
    if (alternating) {
      return seq[seq.length - 1] === outs[0] ? outs[1] : outs[0];
    }
  }

  // 5. Simple transition probability
  const transitions: Record<string, Record<string, number>> = {};
  outs.forEach((o) => {
    transitions[o] = {};
    outs.forEach((p) => (transitions[o][p] = 0));
  });
  for (let i = 1; i < seq.length; i++) {
    transitions[seq[i - 1]][seq[i]]++;
  }
  const lastVal = seq[seq.length - 1];
  const t = transitions[lastVal];
  const tTotal = t[outs[0]] + t[outs[1]];
  if (tTotal > 0) {
    return t[outs[0]] > t[outs[1]] ? outs[0] : outs[1];
  }

  // Default: alternate
  return seq[seq.length - 1] === outs[0] ? outs[1] : outs[0];
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
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

    // 5. Get existing predictions
    const { data: existingPreds } = await supabase
      .from("predictions")
      .select("issue_number, mode, prediction, correct");

    const predMap = new Map<string, { prediction: string; correct: boolean | null }>();
    (existingPreds || []).forEach((p: any) => {
      predMap.set(`${p.issue_number}|${p.mode}`, { prediction: p.prediction, correct: p.correct });
    });

    // 6. Update correct field for existing predictions with results but correct=null
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

    // 7. Generate predictions for historical periods that don't have one
    const newPredictions: any[] = [];
    for (const result of allResults) {
      const n = result.number;
      const col = result.color.toLowerCase().includes("red") ? "RED" : "GREEN";
      const sz = n <= 4 ? "SMALL" : "BIG";

      for (const m of ["color", "size"]) {
        const key = `${result.issue_number}|${m}`;
        if (!predMap.has(key)) {
          // Use statistical fallback for backfill (AI is for next-period only)
          const idx = allResults.indexOf(result);
          const priorHistory = allResults.slice(0, idx);
          const pred = statisticalPredict(priorHistory, m as "color" | "size");
          const actual = m === "color" ? col : sz;
          const correct = pred === actual;
          newPredictions.push({ issue_number: result.issue_number, mode: m, prediction: pred, correct });
          predMap.set(key, { prediction: pred, correct });
        }
      }
    }

    // 8. Generate AI prediction for NEXT period
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
        let pred: string | null = null;

        // Try AI prediction first
        if (lovableApiKey) {
          pred = await aiPredict(lovableApiKey, allResults, m as "color" | "size");
        }

        // Fallback to statistical engine
        if (!pred) {
          pred = statisticalPredict(allResults, m as "color" | "size");
          console.log(`Using statistical fallback for ${m}: ${pred}`);
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
        engine: lovableApiKey ? "AI Neural Network" : "Statistical",
        results: allResults.length,
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
