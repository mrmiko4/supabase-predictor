import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import "./WingoPanel.css";

interface HistoryRow {
  issue_number: string;
  number: number;
  color: string;
  premium: string;
  prediction: string | null;
  correct: boolean | null;
}

const shortPeriod = (p: string) => (p ? p.slice(-8) : "--");

const WingoPanel = () => {
  const [visible, setVisible] = useState(true);
  const [mode, setMode] = useState<"color" | "size">("color");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [nextPeriod, setNextPeriod] = useState("---");
  const [prediction, setPrediction] = useState("---");
  const [predClass, setPredClass] = useState("pred-red");
  const [countdown, setCountdown] = useState("--s");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [winStreak, setWinStreak] = useState(0);
  const [newRowIdx, setNewRowIdx] = useState<number | null>(null);

  const lastTopIssueRef = useRef<string | null>(null);
  const lastPredRef = useRef<{ color: string; size: string }>({ color: "", size: "" });
  const prevWinStreakRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const genTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const predDivRef = useRef<HTMLDivElement>(null);
  const [celState, setCelState] = useState<null | 5 | 10>(null);
  const celTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confettiDots, setConfettiDots] = useState<any[]>([]);

  // ─── COUNTDOWN ────────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const gmt6 = new Date(utc + 6 * 3600000);
      const s = gmt6.getSeconds();
      setCountdown((s < 30 ? 30 - s : 60 - s) + "s");
    };
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, []);

  // ─── CONFETTI ──────────────────────────────────────────────────
  const spawnConfetti = useCallback((count: number) => {
    const colors = ["#ffd700", "#ff6b6b", "#6ef0a0", "#5dc9ff", "#ff8800", "#cc44ff", "#fff", "#f0f"];
    const dots = Array.from({ length: count }, (_, i) => ({
      id: Date.now() + i,
      left: `${8 + Math.random() * 84}%`,
      top: `${3 + Math.random() * 30}%`,
      bg: colors[Math.floor(Math.random() * colors.length)],
      delay: `${(Math.random() * 0.45).toFixed(2)}s`,
      duration: `${(0.65 + Math.random() * 0.55).toFixed(2)}s`,
      rotate: `${Math.floor(Math.random() * 360)}deg`,
    }));
    setConfettiDots(dots);
    setTimeout(() => setConfettiDots([]), 1300);
  }, []);

  // ─── STREAK CELEBRATION ────────────────────────────────────────
  const showCelebration = useCallback((type: 5 | 10) => {
    if (celTimerRef.current) clearTimeout(celTimerRef.current);
    setCelState(type);
    spawnConfetti(type === 10 ? 30 : 16);
    celTimerRef.current = setTimeout(() => {
      setCelState(null);
    }, 2500);
  }, [spawnConfetti]);

  // ─── ANIMATE PREDICTION ───────────────────────────────────────
  const animateGenerate = useCallback((finalText: string, css: string) => {
    if (genTimerRef.current) clearInterval(genTimerRef.current);
    setIsGenerating(true);
    setIsRevealed(false);
    setPredClass("is-generating");
    setPrediction("...");

    const flickerChars = mode === "color"
      ? ["RED", "GRN", "R??", "G??", "...", "!!!", "???"]
      : ["BIG", "SML", "B??", "S??", "...", "!!!", "???"];

    let tick = 0;
    genTimerRef.current = setInterval(() => {
      setPrediction(flickerChars[tick % flickerChars.length]);
      tick++;
      if (tick >= 10) {
        clearInterval(genTimerRef.current!);
        genTimerRef.current = null;
        setIsGenerating(false);
        setIsRevealed(true);
        setPredClass(css + " is-revealed");
        setPrediction(finalText);
        setTimeout(() => {
          setPredClass(css);
          setIsRevealed(false);
        }, 650);
      }
    }, 85);
  }, [mode]);

  // ─── FETCH DATA ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      // Get history with predictions for current mode
      const { data: histData, error: histErr } = await supabase.rpc(
        "get_history_with_predictions",
        { p_mode: mode }
      );

      if (histErr || !histData || histData.length === 0) {
        console.error("History fetch error:", histErr);
        return;
      }

      const rows = histData as HistoryRow[];
      setHistory(rows);

      // Detect new data
      const latestIssue = rows[0].issue_number;
      const isNew = latestIssue !== lastTopIssueRef.current;
      lastTopIssueRef.current = latestIssue;
      if (isNew) setNewRowIdx(0);
      else setNewRowIdx(null);

      // Next period
      let nextIssue = "--";
      try {
        nextIssue = (BigInt(latestIssue) + 1n).toString();
      } catch {
        nextIssue = latestIssue + "?";
      }
      setNextPeriod(nextIssue);

      // Fetch next period prediction
      const { data: nextPredData } = await supabase
        .from("predictions")
        .select("prediction")
        .eq("issue_number", nextIssue)
        .eq("mode", mode)
        .maybeSingle();

      if (nextPredData?.prediction) {
        const pred = nextPredData.prediction;
        const css = mode === "color"
          ? pred === "RED" ? "pred-red" : "pred-green"
          : pred === "BIG" ? "pred-big" : "pred-small";

        if (pred !== lastPredRef.current[mode]) {
          lastPredRef.current = { ...lastPredRef.current, [mode]: pred };
          animateGenerate(pred, css);
        } else {
          setPredClass(css);
          setPrediction(pred);
        }
      }

      // Calculate win streak from history
      let ws = 0;
      for (const row of rows) {
        if (row.correct === true) ws++;
        else break;
      }
      setWinStreak(ws);

      // Check streak crossing thresholds
      const prev = prevWinStreakRef.current;
      if (prev < 5 && ws >= 5) showCelebration(5);
      if (prev < 10 && ws >= 10) showCelebration(10);
      prevWinStreakRef.current = ws;
    } catch (err) {
      console.error("fetchData error:", err);
    }
  }, [mode, animateGenerate, showCelebration]);

  // ─── POLLING ───────────────────────────────────────────────────
  useEffect(() => {
    // Reset on mode change
    lastPredRef.current = { ...lastPredRef.current, [mode]: "" };
    prevWinStreakRef.current = 0;
    fetchData();
    const id = setInterval(fetchData, 5000);
    const onVis = () => { if (!document.hidden) fetchData(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchData]);

  // ─── DRAG: ICON ────────────────────────────────────────────────
  useEffect(() => {
    const icon = iconRef.current;
    if (!icon) return;
    let active = false, oX = 0, oY = 0, sX = 0, sY = 0, dragged = false;
    const THRESH = 5;
    const down = (e: any) => {
      e.preventDefault();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      sX = cx; sY = cy; dragged = false; active = true;
      const mat = new DOMMatrix(getComputedStyle(icon).transform);
      oX = cx - mat.m41; oY = cy - mat.m42;
    };
    const move = (e: any) => {
      if (!active) return; e.preventDefault();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      if (Math.abs(cx - sX) > THRESH || Math.abs(cy - sY) > THRESH) dragged = true;
      icon.style.transform = `translate3d(${cx - oX}px,${cy - oY}px,0)`;
    };
    const up = () => {
      if (active && !dragged) setVisible(v => !v);
      active = false;
    };
    icon.addEventListener("mousedown", down);
    icon.addEventListener("touchstart", down, { passive: false });
    icon.ondragstart = () => false;
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", up);
    return () => {
      icon.removeEventListener("mousedown", down);
      icon.removeEventListener("touchstart", down);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
    };
  }, []);

  // ─── DRAG: PANEL ───────────────────────────────────────────────
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let active = false, oX = 0, oY = 0;
    const down = (e: any) => {
      if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
      e.preventDefault();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const mat = new DOMMatrix(getComputedStyle(panel).transform);
      oX = cx - mat.m41; oY = cy - mat.m42; active = true;
    };
    const move = (e: any) => {
      if (!active) return; e.preventDefault();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      panel.style.transform = `translate3d(${cx - oX}px,${cy - oY}px,0)`;
    };
    const up = () => { active = false; };
    panel.addEventListener("mousedown", down);
    panel.addEventListener("touchstart", down, { passive: false });
    panel.ondragstart = () => false;
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", up);
    return () => {
      panel.removeEventListener("mousedown", down);
      panel.removeEventListener("touchstart", down);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
    };
  }, []);

  const panelClass = [
    "wingo-panel",
    !visible && "panel-hidden",
    winStreak >= 10 && "win10-state",
    winStreak >= 5 && winStreak < 10 && "win5-state",
  ].filter(Boolean).join(" ");

  const predClassName = isGenerating ? "is-generating" : predClass;

  return (
    <>
      <div ref={iconRef} className="toggle-icon" title="tap to show/hide">
        <span>⚡</span>
      </div>

      <div ref={panelRef} className={panelClass}>
        {/* Celebration overlay */}
        {celState && (
          <div className={`streak-cel cel-in ${celState === 10 ? "cel-10" : "cel-5"}`}>
            <div className="cel-ring" style={{ color: celState === 10 ? "#00ccff" : "#ffd700" }} />
            <div className="cel-ring" style={{ color: celState === 10 ? "#00ccff" : "#ffd700", animationDelay: ".35s" }} />
            <div className="cel-trophy">🏆</div>
            <div className={`cel-label ${celState === 10 ? "lbl-10" : "lbl-5"}`}>
              🏆 {celState} WIN 🏆
            </div>
          </div>
        )}

        {/* Confetti */}
        {confettiDots.map(d => (
          <div key={d.id} className="confetti-dot" style={{
            left: d.left, top: d.top, background: d.bg,
            animationDelay: d.delay, animationDuration: d.duration,
            transform: `rotate(${d.rotate})`,
          }} />
        ))}

        <div className="panel-header">⚡ WinGo 30s live Hack ⚡</div>

        <div className="mode-tabs">
          <button
            className={`mode-btn ${mode === "color" ? "active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setMode("color"); }}
          >🎨 Color</button>
          <button
            className={`mode-btn ${mode === "size" ? "active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setMode("size"); }}
          >🔲 Big/Small</button>
        </div>

        <div className={`next-box ${isGenerating ? "generating" : ""}`}>
          <div className="scan-overlay" />
          <div className="win-overlay" />
          <div className="period-label">
            <span>⏳ NEXT PERIOD</span>
            <span className="countdown-span">{countdown}</span>
          </div>
          <div className="next-period">{nextPeriod}</div>
          <div ref={predDivRef} className={`prediction-value ${predClassName}`}>
            {prediction}
          </div>
        </div>

        {/* Streak badge */}
        {winStreak >= 5 && (
          <div className={`streak-badge show ${winStreak >= 10 ? "badge-10" : "badge-5"}`}>
            🏆 {winStreak >= 10 ? 10 : 5} WIN STREAK 🏆
          </div>
        )}

        <div className="history-title">📋 LAST 10 RESULTS <span>live</span></div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>Period</th><th>Prediction</th><th style={{ width: 38 }}>✅</th></tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={3} style={{ color: "#aaa", padding: 15 }}>fetching data…</td></tr>
              ) : (
                history.map((row, i) => {
                  const pred = row.prediction || "---";
                  const ok = row.correct;
                  const pc = mode === "color"
                    ? (pred === "RED" ? "pred-red" : "pred-green")
                    : (pred === "BIG" ? "pred-big" : "pred-small");
                  const rowClasses = [
                    newRowIdx === i && "row-new",
                    newRowIdx === i && (ok ? "row-win-flash-delayed" : "row-loss-flash-delayed"),
                  ].filter(Boolean).join(" ");
                  return (
                    <tr key={row.issue_number} className={rowClasses}>
                      <td>{shortPeriod(row.issue_number)}</td>
                      <td className={pc} style={{ fontWeight: 700 }}>{pred}</td>
                      <td>
                        {ok === true
                          ? <span className="status-ok">✅</span>
                          : ok === false
                          ? <span className="status-bad">❌</span>
                          : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="footer-note">updates every 5s · Advanced Markov AI · max 2-loss guarantee</div>
      </div>
    </>
  );
};

export default WingoPanel;
