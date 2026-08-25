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

const dotFor = (type) => (type === "adp" ? "bg-ink-ghost" : "bg-ink-ghost");

// sources: [{key, label, value, type, stale}]
function RankBar({ myRank, sources, consensus, compact = false, width = 60 }) {
  const values = sources.map((s) => s.value).filter((v) => v != null);
  // A player nobody has ranked has no scale to draw — the empty Cons cell next
  // to it already says so.
  if (!values.length) return null;
  const scale = rankScale(values, myRank);
  if (!scale) return null;

  if (compact) {
    return <CompactBar scale={scale} sources={sources} values={values} myRank={myRank} consensus={consensus} width={width} />;
  }
  return <FullBar scale={scale} sources={sources} myRank={myRank} />;
}

// One mark, drawn as a hard-stopped gradient layer rather than an element.
// Background layers cost nothing in the DOM, and the inline bar repeats on
// every row of a board that can run to seven hundred players — at eight nodes
// apiece that was five thousand elements doing the work of a picture.
const mark = (pct, color, w = 3) =>
  `linear-gradient(90deg, transparent calc(${pct}% - ${w / 2}px), ${color} calc(${pct}% - ${w / 2}px), ${color} calc(${pct}% + ${w / 2}px), transparent calc(${pct}% + ${w / 2}px))`;

function CompactBar({ scale, sources, values, myRank, consensus, width }) {
  // The pale tick is whatever number sits in the Cons cell beside this bar, so
  // the two never contradict each other. When no rankings source covers him
  // there is no Cons value, and the mean of the ADP columns stands in — named
  // differently in the tooltip so it is not mistaken for the same thing.
  const cons = consensus ?? (values.reduce((a, b) => a + b, 0) / values.length);
  const consLabel = consensus == null ? "market mean" : "Cons";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const title = `You #${fmt(myRank, 0)} · ${consLabel} ${fmt(cons, 1)} · ${sources.length} source${sources.length > 1 ? "s" : ""} spread ${fmt(min, 0)}–${fmt(max, 0)}`;

  // Track, the band the sources occupy, every source mark and the Cons tick all
  // paint as background layers on one element. Only my own tick stays a real
  // node, because it stands proud of the track and a background cannot overflow
  // the box it paints in.
  const lo = scale.at(min);
  const hi = scale.at(max);
  const layers = [
    ...sources.filter((s) => s.value != null).map((s) => mark(scale.at(s.value), "rgb(var(--ink-ghost))")),
    mark(scale.at(cons), "rgb(var(--ink))"),
    `linear-gradient(90deg, transparent ${lo}%, rgb(var(--line)) ${lo}%, rgb(var(--line)) ${hi}%, transparent ${hi}%)`,
  ];
  return (
    <span title={title} className="relative inline-block h-1.5 rounded-full bg-band align-middle"
      style={{ width, backgroundImage: layers.join(",") }}>
      <span className="absolute -top-[3px] h-[12px] w-[3px] -translate-x-1/2 rounded-full bg-accent"
        style={{ left: `${scale.at(myRank)}%` }} />
    </span>
  );
}

function FullBar({ scale, sources, myRank }) {
  const Row = ({ label, value, delta, tone, dot, title, stale }) => (
    <div className="flex items-center gap-3">
      <span className={`w-28 shrink-0 truncate text-[11px] ${tone}`} title={title || label}>
        {label}{stale && <span className="text-warn"> *</span>}
      </span>
      <span className="num w-8 shrink-0 text-right text-[11px] text-ink-muted">{fmt(value, 0)}</span>
      <div className="relative h-1.5 min-w-0 flex-1 rounded-full bg-band">
        <span className={`absolute -top-[3px] h-2 w-2 -translate-x-1/2 rounded-full ${dot}`} style={{ left: `${scale.at(value)}%` }} />
      </div>
      <span className={`num w-8 shrink-0 text-right text-[11px] ${delta > 0 ? "text-ahead" : delta < 0 ? "text-behind" : "text-ink-ghost"}`}>
        {delta == null ? "" : delta > 0 ? `+${fmt(delta, 0)}` : fmt(delta, 0)}
      </span>
    </div>
  );

  // The track carries no more information at 900px than at 400, and stretched
  // that far the dots stop reading as a cluster at all. Capped at a measure the
  // eye can take in without tracking across.
  return (
    <div className="max-w-xl space-y-1.5">
      <Row label="My rank" value={myRank} delta={null} tone="font-semibold text-accent" dot="bg-accent ring-2 ring-accent/30" />
      {sources.map((s) => (
        <Row key={s.key} label={s.label} value={s.value} delta={s.value - myRank} stale={s.stale}
          tone="text-ink-muted" dot={dotFor(s.type)} title={`${s.label} · ${String(s.type).toUpperCase()}`} />
      ))}
    </div>
  );
}

// Memoised because the board renders one of these per row: with the opinions
// array held stable upstream, selecting a row no longer redraws every bar.
export default React.memo(RankBar);
