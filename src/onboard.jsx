import React, { useState } from "react";
import { useStore } from "./store.jsx";
import { runBootstrap, bootstrapSteps } from "./bootstrap.js";
import { Check, Close, Dot } from "./icons.jsx";

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

  const icon = {
    waiting: <Dot size={5} />,
    running: <span className="inline-block animate-pulse"><Dot size={5} /></span>,
    done: <Check size={12} />,
    failed: <Close size={11} />,
  };
  const tone = { waiting: "text-ink-ghost", running: "text-accent", done: "text-ahead", failed: "text-warn" };

  return (
    <div className={compact ? "" : "mx-auto max-w-lg px-6 py-16 text-center sm:py-24"}>
      {/* This screen opened on a clipboard emoji, which is a picture drawn by
          whichever vendor made the reader's font — the one element in the app
          whose look we did not choose. It is the app's own mark instead: the
          four position colours stacked, which is what a tier is. */}
      {!compact && (
        <span aria-hidden className="mx-auto grid h-12 w-12 grid-rows-4 overflow-hidden rounded-[7px]">
          <span className="bg-pos-QB" /><span className="bg-pos-RB" />
          <span className="bg-pos-WR" /><span className="bg-pos-TE" />
        </span>
      )}
      {!compact && <h2 className="mt-5 text-xl font-bold tracking-tight">Set up your board</h2>}
      {!compact && (
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-muted">
          One button pulls rankings, ADP, projections, injuries and situation grades from every source
          the app can reach. Each step reports on its own, so a provider being down costs you that
          column and nothing else.
        </p>
      )}

      {!steps && (
        <button onClick={start} disabled={running}
          className={`rounded-[--r-sm] bg-ink px-5 py-2.5 text-[13px] font-semibold text-ink-invert transition-opacity hover:opacity-90 disabled:opacity-40 ${compact ? "" : "mt-6"}`}>
          {state.sources?.length ? "Refresh all data" : "Load everything"}
        </button>
      )}
      {!compact && !steps && (
        <p className="mt-3 text-[11px] text-ink-ghost">A few seconds · about 10&nbsp;MB · nothing leaves your browser</p>
      )}

      {steps && (
        <ul className={`mx-auto max-w-sm space-y-1.5 text-left ${compact ? "" : "mt-7"}`}>
          {steps.map((s) => (
            <li key={s.key} className="flex items-baseline gap-2 text-sm">
              <span className={`flex w-3 shrink-0 justify-center ${tone[s.state]}`}>{icon[s.state]}</span>
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
          <button onClick={() => { setSteps(null); setDone(false); }} className="ctl mt-2">Run again</button>
        </div>
      )}
    </div>
  );
}
