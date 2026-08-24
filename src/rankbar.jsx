// Where every source has a player, on one shared scale next to my rank.
//
// Two renderings of the same data: the labelled row stack in the detail panel,
// and a ~60px inline track for the main table. The compact one exists because a
// bare consensus number tells you the middle but not the argument — a wide
// spread with my dot outside it is a different decision from a tight cluster.
import React from "react";
import { fmt } from "./util.js";

// Shared domain math: every value plus my rank. The drawable range is inset a
// little at both ends so a marker sitting on the minimum or maximum reads as a
// whole mark on the track rather than a half-mark hanging off the edge.
const PAD = 4;
export function rankScale(values, myRank) {
  const all = [...values, ...(myRank != null ? [myRank] : [])].filter((v) => v != null && !Number.isNaN(v));
  if (!all.length) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(1, hi - lo);
  return {
    lo, hi, span,
    spread: values.length ? Math.max(...values) - Math.min(...values) : 0,
    at: (v) => PAD + ((v - lo) / span) * (100 - 2 * PAD),
  };
}

const dotFor = (type) => (type === "adp" ? "bg-violet-400" : "bg-slate-400");

// sources: [{key, label, value, type, stale}]
export default function RankBar({ myRank, sources, consensus, compact = false, width = 60 }) {
  const values = sources.map((s) => s.value).filter((v) => v != null);
  // A player nobody has ranked has no scale to draw — the empty Cons cell next
  // to it already says so.
  if (!values.length) return null;
  const scale = rankScale(values, myRank);
  if (!scale) return null;

  if (compact) {
    // The pale tick is whatever number sits in the Cons cell beside this bar, so
    // the two never contradict each other. When no rankings source covers him
    // there is no Cons value, and the mean of the ADP columns stands in — named
    // differently in the tooltip so it is not mistaken for the same thing.
    const cons = consensus ?? (values.reduce((a, b) => a + b, 0) / values.length);
    const consLabel = consensus == null ? "market mean" : "Cons";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const title = `You #${fmt(myRank, 0)} · ${consLabel} ${fmt(cons, 1)} · ${sources.length} source${sources.length > 1 ? "s" : ""} spread ${fmt(min, 0)}–${fmt(max, 0)}`;
    return (
      <span title={title} className="relative inline-block h-1.5 rounded bg-slate-800 align-middle"
        style={{ width }}>
        {/* the band the sources actually occupy — its width is the disagreement */}
        <span className="absolute inset-y-0 rounded bg-slate-700"
          style={{ left: `${scale.at(min)}%`, width: `${Math.max(2, scale.at(max) - scale.at(min))}%` }} />
        {sources.map((s) => s.value == null ? null : (
          <span key={s.key} className={`absolute top-0 h-1.5 w-[3px] -translate-x-1/2 rounded-sm opacity-70 ${dotFor(s.type)}`}
            style={{ left: `${scale.at(s.value)}%` }} />
        ))}
        <span className="absolute -top-[1px] h-[9px] w-[3px] -translate-x-1/2 rounded-sm bg-slate-200"
          style={{ left: `${scale.at(cons)}%` }} />
        <span className="absolute -top-[3px] h-[13px] w-[3px] -translate-x-1/2 rounded-sm bg-sky-400 ring-1 ring-sky-400/40"
          style={{ left: `${scale.at(myRank)}%` }} />
      </span>
    );
  }

  const Row = ({ label, value, delta, tone, dot, title, stale }) => (
    <div className="flex items-center gap-2">
      <span className={`w-24 shrink-0 truncate text-[11px] ${tone}`} title={title || label}>
        {label}{stale && <span className="text-amber-400"> *</span>}
      </span>
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-slate-300">{fmt(value, 0)}</span>
      <div className="relative h-1.5 min-w-0 flex-1 rounded bg-slate-800">
        <span className={`absolute -top-[3px] h-2 w-2 -translate-x-1/2 rounded-full ${dot}`} style={{ left: `${scale.at(value)}%` }} />
      </div>
      <span className={`w-9 shrink-0 text-right text-[11px] tabular-nums ${delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-slate-600"}`}>
        {delta == null ? "" : delta > 0 ? `+${fmt(delta, 0)}` : fmt(delta, 0)}
      </span>
    </div>
  );

  return (
    <div className="space-y-1">
      <Row label="My rank" value={myRank} delta={null} tone="font-semibold text-sky-300" dot="bg-sky-400 ring-2 ring-sky-400/30" />
      {sources.map((s) => (
        <Row key={s.key} label={s.label} value={s.value} delta={s.value - myRank} stale={s.stale}
          tone="text-slate-400" dot={dotFor(s.type)} title={`${s.label} · ${String(s.type).toUpperCase()}`} />
      ))}
    </div>
  );
}
