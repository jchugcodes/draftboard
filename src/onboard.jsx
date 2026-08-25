import React, { useState } from "react";
import { useStore } from "./store.jsx";
import { runBootstrap, bootstrapSteps } from "./bootstrap.js";

// The whole setup: one button. Steps report individually so a provider being
// down reads as "that column is missing", not "setup broke".
export default function Onboard({ compact = false }) {
  const { state, dispatch } = useStore();
  const [steps, setSteps] = useState(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const season = new Date().getFullYear();

  const start = async () => {
    setRunning(true); setDone(false);
    const initial = bootstrapSteps(season).map((s) => ({ key: s.key, label: s.label, state: "waiting" }));
    setSteps(initial);
    await runBootstrap(dispatch, season, (u) => {
      setSteps((cur) => (cur || initial).map((s) => (s.key === u.key ? { ...s, ...u } : s)));
    });
    setRunning(false); setDone(true);
  };

  const icon = { waiting: "·", running: "…", done: "✓", failed: "✕" };
  const tone = { waiting: "text-ink-ghost", running: "text-accent", done: "text-ahead", failed: "text-warn" };

  return (
    <div className={compact ? "" : "mx-auto max-w-lg p-8 text-center"}>
      {!compact && <div className="text-4xl">📋</div>}
      {!compact && <h2 className="mt-3 text-lg font-semibold">Set up your board</h2>}
      {!compact && (
        <p className="mt-2 text-sm text-ink-muted">
          Pulls rankings, ADP, projections, injuries, and situation grades from every source available.
          Takes a few seconds and about 10&nbsp;MB.
        </p>
      )}

      {!steps && (
        <button onClick={start} disabled={running}
          className={`rounded bg-accent px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40 ${compact ? "" : "mt-4"}`}>
          {state.sources?.length ? "Refresh all data" : "Load everything"}
        </button>
      )}

      {steps && (
        <ul className={`space-y-1 text-left ${compact ? "" : "mt-5"}`}>
          {steps.map((s) => (
            <li key={s.key} className="flex items-baseline gap-2 text-sm">
              <span className={`w-3 shrink-0 ${tone[s.state]}`}>{icon[s.state]}</span>
              <span className={s.state === "waiting" ? "text-ink-ghost" : "text-ink-muted"}>{s.label}</span>
              {s.detail && (
                <span className={`truncate text-[11px] ${s.state === "failed" ? "text-warn/80" : "text-ink-faint"}`}>
                  {s.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {done && (
        <div className={compact ? "mt-2" : "mt-4"}>
          <p className="text-xs text-ink-faint">
            Anything that failed can be retried, or imported by hand from Settings → Data.
          </p>
          <button onClick={() => { setSteps(null); setDone(false); }}
            className="mt-2 rounded border border-line px-3 py-1 text-xs text-ink-muted hover:border-accent">
            Run again
          </button>
        </div>
      )}
    </div>
  );
}
