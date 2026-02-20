import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_URL =
  "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_CONSECUTIVE_FAILURES = 3;
const MIN_FORMULA_CONFIDENCE = 0.55;
const MIN_SUPPORT_PCT = 0.03;

// ─── TYPES ──────────────────────────────────────────────────────────
interface GameRecord {
  issue_number: string;
  number: number;
  color: string;
}

interface Formula {
  id: string;
  type: string;
  condition: string;
  prediction: string;
  confidence: number;
  support: number;
  description: string;
}

interface FormulaSet {
  formulas: Formula[];
  accuracy: number;
  total_predictions: number;
  correct_predictions: number;
  consecutive_failures: number;
}

// ─── FEATURE EXTRACTION ─────────────────────────────────────────────
function extractFeatures(history: GameRecord[], mode: "color" | "size") {
  const seq = history.map((r) =>
    mode === "color"
      ? r.color.toLowerCase().includes("red") ? "RED" : "GREEN"
      : r.number <= 4 ? "SMALL" : "BIG"
  );
  const nums = history.map((r) => r.number);
  return { seq, nums };
}

// ─── RULE EXTRACTION ENGINE ─────────────────────────────────────────
// Analyzes up to 1000 records and extracts IF-THEN formulas
function extractRules(
  history: GameRecord[],
  mode: "color" | "size"
): Formula[] {
  const { seq, nums } = extractFeatures(history, mode);
  const outs = mode === "color" ? ["RED", "GREEN"] : ["BIG", "SMALL"];
  const formulas: Formula[] = [];
  const totalLen = seq.length;
  if (totalLen < 10) return formulas;

  // ── RULE 1: Streak Reversal Rules (length 3,4,5,6+) ──
  for (const streakLen of [3, 4, 5, 6]) {
    for (const val of outs) {
      let matches = 0, correct = 0;
      for (let i = streakLen; i < totalLen; i++) {
        let isStreak = true;
        for (let j = 1; j <= streakLen; j++) {
          if (seq[i - j] !== val) { isStreak = false; break; }
        }
        if (isStreak) {
          matches++;
          const opposite = val === outs[0] ? outs[1] : outs[0];
          if (seq[i] === opposite) correct++;
        }
      }
      if (matches >= totalLen * MIN_SUPPORT_PCT) {
        const conf = matches > 0 ? correct / matches : 0;
        if (conf >= MIN_FORMULA_CONFIDENCE) {
          const opposite = val === outs[0] ? outs[1] : outs[0];
          formulas.push({
            id: `streak_rev_${streakLen}_${val}`,
            type: "streak_reversal",
            condition: `IF last ${streakLen} results = ${val}`,
            prediction: opposite,
            confidence: Math.round(conf * 1000) / 1000,
            support: matches,
            description: `After ${streakLen}+ consecutive ${val}, predict ${opposite} (reversal)`,
          });
        }
      }
    }
  }

  // ── RULE 2: N-gram Pattern Rules (2,3,4,5-gram) ──
  for (const n of [2, 3, 4, 5]) {
    if (totalLen < n + 1) continue;
    const patternCounts: Record<string, Record<string, number>> = {};
    for (let i = 0; i <= totalLen - n - 1; i++) {
      const pattern = seq.slice(i, i + n).join(",");
      const next = seq[i + n];
      if (!patternCounts[pattern]) {
        patternCounts[pattern] = {};
        outs.forEach((o) => (patternCounts[pattern][o] = 0));
      }
      patternCounts[pattern][next]++;
    }
    for (const [pattern, counts] of Object.entries(patternCounts)) {
      const total = outs.reduce((s, o) => s + (counts[o] || 0), 0);
      if (total < totalLen * MIN_SUPPORT_PCT) continue;
      for (const out of outs) {
        const conf = total > 0 ? (counts[out] || 0) / total : 0;
        if (conf >= MIN_FORMULA_CONFIDENCE) {
          formulas.push({
            id: `ngram_${n}_${pattern}_${out}`,
            type: `${n}gram_pattern`,
            condition: `IF last ${n} = [${pattern}]`,
            prediction: out,
            confidence: Math.round(conf * 1000) / 1000,
            support: total,
            description: `Pattern [${pattern}] → ${out} (${n}-gram)`,
          });
        }
      }
    }
  }

  // ── RULE 3: Frequency Imbalance Rules (window 5,8,10,15) ──
  for (const window of [5, 8, 10, 15]) {
    if (totalLen < window + 1) continue;
    for (const threshold of [0.7, 0.8, 0.9]) {
      for (const dominantVal of outs) {
        let matches = 0, correct = 0;
        for (let i = window; i < totalLen; i++) {
          const windowSlice = seq.slice(i - window, i);
          const dominantCount = windowSlice.filter((v) => v === dominantVal).length;
          if (dominantCount / window >= threshold) {
            matches++;
            const opposite = dominantVal === outs[0] ? outs[1] : outs[0];
            if (seq[i] === opposite) correct++;
          }
        }
        if (matches >= totalLen * MIN_SUPPORT_PCT) {
          const conf = matches > 0 ? correct / matches : 0;
          if (conf >= MIN_FORMULA_CONFIDENCE) {
            const opposite = dominantVal === outs[0] ? outs[1] : outs[0];
            formulas.push({
              id: `freq_imb_${window}_${Math.round(threshold * 100)}_${dominantVal}`,
              type: "frequency_imbalance",
              condition: `IF ${dominantVal} ≥ ${Math.round(threshold * 100)}% in last ${window}`,
              prediction: opposite,
              confidence: Math.round(conf * 1000) / 1000,
              support: matches,
              description: `${dominantVal} dominates last ${window} (≥${Math.round(threshold * 100)}%) → ${opposite}`,
            });
          }
        }
      }
    }
  }

  // ── RULE 4: Alternation Rules ──
  for (const altLen of [3, 4, 5, 6]) {
    if (totalLen < altLen + 1) continue;
    let matches = 0, correct = 0;
    for (let i = altLen; i < totalLen; i++) {
      let isAlt = true;
      for (let j = 1; j < altLen; j++) {
        if (seq[i - j] === seq[i - j - 1]) { isAlt = false; break; }
      }
      if (isAlt) {
        matches++;
        const expected = seq[i - 1] === outs[0] ? outs[1] : outs[0];
        if (seq[i] === expected) correct++;
      }
    }
    if (matches >= totalLen * MIN_SUPPORT_PCT) {
      const conf = matches > 0 ? correct / matches : 0;
      if (conf >= MIN_FORMULA_CONFIDENCE) {
        formulas.push({
          id: `alt_${altLen}`,
          type: "alternation",
          condition: `IF last ${altLen} alternate perfectly`,
          prediction: "CONTINUE_ALT",
          confidence: Math.round(conf * 1000) / 1000,
          support: matches,
          description: `${altLen}-length alternation detected → continue pattern`,
        });
      }
    }
  }

  // ── RULE 5: Transition Probability Rules ──
  const transitions: Record<string, Record<string, number>> = {};
  outs.forEach((o) => {
    transitions[o] = {};
    outs.forEach((p) => (transitions[o][p] = 0));
  });
  for (let i = 1; i < totalLen; i++) {
    transitions[seq[i - 1]][seq[i]]++;
  }
  for (const from of outs) {
    const total = outs.reduce((s, to) => s + transitions[from][to], 0);
    for (const to of outs) {
      const conf = total > 0 ? transitions[from][to] / total : 0;
      if (conf >= MIN_FORMULA_CONFIDENCE && total >= totalLen * MIN_SUPPORT_PCT) {
        formulas.push({
          id: `trans_${from}_${to}`,
          type: "transition",
          condition: `IF last result = ${from}`,
          prediction: to,
          confidence: Math.round(conf * 1000) / 1000,
          support: total,
          description: `${from} → ${to} transition (P=${Math.round(conf * 100)}%)`,
        });
      }
    }
  }

  // ── RULE 6: Number Range Clustering (size mode) ──
  if (mode === "size" && totalLen >= 20) {
    for (const window of [5, 8, 10]) {
      if (totalLen < window + 1) continue;
      let matches = 0, correct = 0;
      for (let i = window; i < totalLen; i++) {
        const avgNum = nums.slice(i - window, i).reduce((a, b) => a + b, 0) / window;
        if (avgNum <= 3) {
          matches++;
          if (seq[i] === "SMALL") correct++;
        } else if (avgNum >= 6) {
          matches++;
          if (seq[i] === "BIG") correct++;
        }
      }
      if (matches >= totalLen * MIN_SUPPORT_PCT) {
        const conf = matches > 0 ? correct / matches : 0;
        if (conf >= MIN_FORMULA_CONFIDENCE) {
          formulas.push({
            id: `num_cluster_${window}`,
            type: "number_clustering",
            condition: `IF avg(last ${window} numbers) extreme`,
            prediction: "FOLLOW_TREND",
            confidence: Math.round(conf * 1000) / 1000,
            support: matches,
            description: `Number clustering in last ${window} → follow trend`,
          });
        }
      }
    }
  }

  // ── RULE 7: Double/Triple Repeat Rules ──
  for (const repeatLen of [2, 3]) {
    if (totalLen < repeatLen * 2 + 1) continue;
    for (const val of outs) {
      let matches = 0, correct = 0;
      for (let i = repeatLen * 2; i < totalLen; i++) {
        // Check if pattern X repeated twice
        let isDoubleRepeat = true;
        for (let j = 0; j < repeatLen; j++) {
          if (seq[i - 1 - j] !== val || seq[i - 1 - j - repeatLen] !== val) {
            isDoubleRepeat = false;
            break;
          }
        }
        if (isDoubleRepeat) {
          matches++;
          const opposite = val === outs[0] ? outs[1] : outs[0];
          if (seq[i] === opposite) correct++;
        }
      }
      if (matches >= totalLen * MIN_SUPPORT_PCT * 0.5) {
        const conf = matches > 0 ? correct / matches : 0;
        if (conf >= MIN_FORMULA_CONFIDENCE) {
          const opposite = val === outs[0] ? outs[1] : outs[0];
          formulas.push({
            id: `dbl_repeat_${repeatLen}_${val}`,
            type: "double_repeat",
            condition: `IF ${val} repeated ${repeatLen}x twice`,
            prediction: opposite,
            confidence: Math.round(conf * 1000) / 1000,
            support: matches,
            description: `Double ${repeatLen}-repeat of ${val} → ${opposite}`,
          });
        }
      }
    }
  }

  // Sort by confidence * support (weighted score)
  formulas.sort((a, b) => (b.confidence * b.support) - (a.confidence * a.support));
  return formulas.slice(0, 30); // Keep top 30 rules
}

// ─── APPLY FORMULA SET TO PREDICT ───────────────────────────────────
function applyFormulas(
  formulas: Formula[],
  history: GameRecord[],
  mode: "color" | "size"
): { prediction: string; formula: Formula | null } {
  const { seq, nums } = extractFeatures(history, mode);
  const outs = mode === "color" ? ["RED", "GREEN"] : ["BIG", "SMALL"];

  for (const formula of formulas) {
    switch (formula.type) {
      case "streak_reversal": {
        const match = formula.condition.match(/last (\d+) results = (\w+)/);
        if (match) {
          const len = parseInt(match[1]);
          const val = match[2];
          if (seq.length >= len) {
            const tail = seq.slice(-len);
            if (tail.every((v) => v === val)) {
              return { prediction: formula.prediction, formula };
            }
          }
        }
        break;
      }
      case "2gram_pattern":
      case "3gram_pattern":
      case "4gram_pattern":
      case "5gram_pattern": {
        const nMatch = formula.type.match(/(\d+)gram/);
        if (nMatch) {
          const n = parseInt(nMatch[1]);
          if (seq.length >= n) {
            const lastN = seq.slice(-n).join(",");
            const condPattern = formula.condition.match(/\[(.+)\]/)?.[1];
            if (condPattern === lastN) {
              return { prediction: formula.prediction, formula };
            }
          }
        }
        break;
      }
      case "frequency_imbalance": {
        const fiMatch = formula.condition.match(/(\w+) ≥ (\d+)% in last (\d+)/);
        if (fiMatch) {
          const val = fiMatch[1];
          const threshold = parseInt(fiMatch[2]) / 100;
          const window = parseInt(fiMatch[3]);
          if (seq.length >= window) {
            const windowSlice = seq.slice(-window);
            const count = windowSlice.filter((v) => v === val).length;
            if (count / window >= threshold) {
              return { prediction: formula.prediction, formula };
            }
          }
        }
        break;
      }
      case "alternation": {
        const altMatch = formula.condition.match(/last (\d+) alternate/);
        if (altMatch) {
          const len = parseInt(altMatch[1]);
          if (seq.length >= len) {
            const tail = seq.slice(-len);
            let isAlt = true;
            for (let i = 1; i < tail.length; i++) {
              if (tail[i] === tail[i - 1]) { isAlt = false; break; }
            }
            if (isAlt) {
              const pred = seq[seq.length - 1] === outs[0] ? outs[1] : outs[0];
              return { prediction: pred, formula };
            }
          }
        }
        break;
      }
      case "transition": {
        const trMatch = formula.condition.match(/last result = (\w+)/);
        if (trMatch && seq.length > 0 && seq[seq.length - 1] === trMatch[1]) {
          return { prediction: formula.prediction, formula };
        }
        break;
      }
      case "number_clustering": {
        const ncMatch = formula.condition.match(/last (\d+) numbers/);
        if (ncMatch) {
          const window = parseInt(ncMatch[1]);
          if (nums.length >= window) {
            const avg = nums.slice(-window).reduce((a, b) => a + b, 0) / window;
            if (avg <= 3) return { prediction: "SMALL", formula };
            if (avg >= 6) return { prediction: "BIG", formula };
          }
        }
        break;
      }
      case "double_repeat": {
        const drMatch = formula.condition.match(/(\w+) repeated (\d+)x twice/);
        if (drMatch) {
          const val = drMatch[1];
          const repLen = parseInt(drMatch[2]);
          if (seq.length >= repLen * 2) {
            const tail = seq.slice(-repLen * 2);
            if (tail.every((v) => v === val)) {
              return { prediction: formula.prediction, formula };
            }
          }
        }
        break;
      }
    }
  }

  // No formula matched - use best transition rule as default
  if (seq.length > 0) {
    const last = seq[seq.length - 1];
    return { prediction: last === outs[0] ? outs[1] : outs[0], formula: null };
  }
  return { prediction: outs[0], formula: null };
}

// ─── AI-ENHANCED RULE VALIDATION ────────────────────────────────────
async function aiEnhanceRules(
  apiKey: string,
  formulas: Formula[],
  history: GameRecord[],
  mode: "color" | "size"
): Promise<string | null> {
  try {
    const topFormulas = formulas.slice(0, 10).map((f) =>
      `${f.description} [confidence: ${f.confidence}, support: ${f.support}]`
    ).join("\n");

    const last20 = history.slice(-20).map((r, i) => {
      const col = r.color.toLowerCase().includes("red") ? "RED" : "GREEN";
      const sz = r.number <= 4 ? "SMALL" : "BIG";
      return `${i + 1}: Num=${r.number}, Col=${col}, Size=${sz}`;
    }).join("\n");

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
          {
            role: "system",
            content: `You are an expert pattern recognition AI. You have extracted statistical rules from 1000 game results. Now use these rules PLUS the recent sequence to make the best prediction.

EXTRACTED RULES (sorted by reliability):
${topFormulas}

Apply the most relevant rule to the recent data. If multiple rules conflict, weight by confidence × support.
You MUST respond with ONLY the function call.`,
          },
          {
            role: "user",
            content: `Last 20 results:\n${last20}\n\nPredict the NEXT ${mode} result.`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: toolName,
            description: `Predict next ${mode} using extracted rules`,
            parameters: {
              type: "object",
              properties: {
                prediction: { type: "string", enum: enumValues },
                confidence: { type: "number" },
                applied_rule: { type: "string", description: "Which rule was applied" },
              },
              required: ["prediction", "confidence", "applied_rule"],
              additionalProperties: false,
            },
          },
        }],
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
      console.log(`AI-enhanced prediction (${mode}): ${args.prediction} [rule: ${args.applied_rule}] (confidence: ${args.confidence})`);
      return args.prediction;
    }
    return null;
  } catch (err) {
    console.error("AI enhancement error:", err);
    return null;
  }
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

    // 3. Trim game_results to 1000
    await supabase.rpc("trim_game_results");

    // 4. Get ALL stored results chronologically (oldest first)
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

    // 8. SELF-ADAPTIVE FORMULA ENGINE
    const newPredictions: any[] = [];
    let engineStatus = "formula_cached";
    let activeFormulaCount = 0;

    for (const m of ["color", "size"] as const) {
      const key = `${nextIssue}|${m}`;
      if (predMap.has(key)) continue;

      // Get active formula set for this mode
      const { data: activeSet } = await supabase
        .from("formula_sets")
        .select("*")
        .eq("mode", m)
        .eq("is_active", true)
        .order("extracted_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let formulas: Formula[] = [];
      let needsRetrain = false;

      if (activeSet) {
        formulas = activeSet.formulas as Formula[];
        activeFormulaCount += formulas.length;

        // Check if consecutive failures exceeded threshold
        if (activeSet.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
          console.log(`[${m}] ${activeSet.consecutive_failures} consecutive failures → RETRAINING`);
          needsRetrain = true;
        }

        // Update consecutive failures based on last prediction
        const lastPredKey = `${latestIssue}|${m}`;
        const lastPred = predMap.get(lastPredKey);
        if (lastPred && lastPred.correct !== null) {
          const newFailures = lastPred.correct ? 0 : (activeSet.consecutive_failures + 1);
          const newCorrect = lastPred.correct ? (activeSet.correct_predictions + 1) : activeSet.correct_predictions;
          const newTotal = activeSet.total_predictions + 1;

          await supabase.from("formula_sets").update({
            consecutive_failures: newFailures,
            correct_predictions: newCorrect,
            total_predictions: newTotal,
            accuracy: newTotal > 0 ? newCorrect / newTotal : 0,
          }).eq("id", activeSet.id);

          if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
            needsRetrain = true;
            console.log(`[${m}] Failure threshold reached → RETRAINING`);
          }
        }
      } else {
        needsRetrain = true;
        console.log(`[${m}] No active formula set → INITIAL TRAINING`);
      }

      // RETRAIN: Extract new rules from all history
      if (needsRetrain) {
        engineStatus = "retraining";
        console.log(`[${m}] Extracting rules from ${allResults.length} records...`);

        // Deactivate old formula sets
        await supabase.from("formula_sets")
          .update({ is_active: false })
          .eq("mode", m);

        // Extract new formulas
        formulas = extractRules(allResults, m);
        activeFormulaCount = formulas.length;
        console.log(`[${m}] Extracted ${formulas.length} rules`);

        // Store new formula set
        await supabase.from("formula_sets").insert({
          mode: m,
          formulas: formulas as any,
          accuracy: 0,
          total_predictions: 0,
          correct_predictions: 0,
          consecutive_failures: 0,
          is_active: true,
        });
      }

      // PREDICT using formula set
      let pred: string | null = null;

      let appliedFormula: Formula | null = null;

      // Try AI-enhanced prediction first (uses extracted rules as context)
      if (lovableApiKey && formulas.length > 0) {
        pred = await aiEnhanceRules(lovableApiKey, formulas, allResults, m);
        if (pred) {
          // Find matching formula for display
          appliedFormula = formulas.find(f => f.prediction === pred) || null;
        }
      }

      // Fallback to direct formula application
      if (!pred && formulas.length > 0) {
        const result = applyFormulas(formulas, allResults, m);
        pred = result.prediction;
        appliedFormula = result.formula;
        if (result.formula) {
          console.log(`[${m}] Applied formula: ${result.formula.description}`);
        } else {
          console.log(`[${m}] No formula matched, using default`);
        }
      }

      // Final fallback
      if (!pred) {
        const { seq } = extractFeatures(allResults, m);
        pred = seq[seq.length - 1] === (m === "color" ? "RED" : "BIG")
          ? (m === "color" ? "GREEN" : "SMALL")
          : (m === "color" ? "RED" : "BIG");
      }

      newPredictions.push({
        issue_number: nextIssue,
        mode: m,
        prediction: pred,
        correct: null,
        formula_applied: appliedFormula ? {
          id: appliedFormula.id,
          type: appliedFormula.type,
          condition: appliedFormula.condition,
          prediction: appliedFormula.prediction,
          confidence: appliedFormula.confidence,
          support: appliedFormula.support,
          description: appliedFormula.description,
        } : null,
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
          const idx = allResults.indexOf(result);
          const prior = allResults.slice(0, idx);
          if (prior.length >= 3) {
            const { seq } = extractFeatures(prior, m as "color" | "size");
            const pred = seq[seq.length - 1] === (m === "color" ? "RED" : "GREEN")
              ? (m === "color" ? "GREEN" : "SMALL")
              : (m === "color" ? "RED" : "BIG");
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

    // 11. Trim predictions
    await supabase.rpc("trim_predictions");

    console.log(
      `Engine=${engineStatus} | Records=${allResults.length} | NewPreds=${newPredictions.length} | CorrectUpdates=${correctUpdates.length} | ActiveFormulas=${activeFormulaCount}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        engine: engineStatus,
        records: allResults.length,
        activeFormulas: activeFormulaCount,
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
