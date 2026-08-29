// The decision card: what you need to answer "should I move him?", opened in
// place under the row so you never lose your spot in the list.
//
// Two rules hold the layout together. First, the headline strip speaks in
// positional ranks — RB2 is a fact you read, consensus 14.6 is one you decode,
// and against your own Pos# it is directly comparable in a way raw numbers
// never are. Second, anything that is evidence rather than decision — scorecard
// sliders, advanced stats, news — stays one more click away, because pulling it
// in here would rebuild the wall of numbers this card exists to replace.
import React from "react";
import { useStore } from "./store.jsx";
import { POS_STYLE, TAGS, fmt } from "./util.js";
import RankBar from "./rankbar.jsx";

const posStyle = (pos) => POS_STYLE[pos] || POS_STYLE.DST;

// One value, one label, one line of context. Never two numbers in a cell.
const Cell = ({ label, value, sub, tone = "text-ink", title, lead = false }) => (
  <div title={title} className={`px-3 py-2 ${lead ? "bg-ink" : "border border-line bg-panel"}`}>
    <div className={`label ${lead ? "text-ink-invert/60" : "text-ink-faint"}`}>{label}</div>
    <div className={`num mt-1 text-lg font-bold leading-none ${lead ? "text-ink-invert" : tone}`}>{value}</div>
    {sub && <div className={`mt-1 text-[10px] leading-tight ${lead ? "text-ink-invert/50" : "text-ink-faint"}`}>{sub}</div>}
  </div>
);

// A five-segment read, the way a scouting grade is written. Used only where the
// underlying value genuinely is a 1–5 judgement, never to dress up a number
// that already says what it means.
const Meter = ({ label, score, read, tone = "bg-ink" }) => (
  <div className="max-w-md">
    <div className="flex items-baseline justify-between gap-2">
      <span className="label text-ink-faint">{label}</span>
      <span className="text-[10px] font-semibold text-ink">{read}</span>
    </div>
    <div className="mt-1.5 flex gap-1.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-2 flex-1 rounded-full transition-colors ${i <= score ? tone : "bg-band"}`} />
      ))}
    </div>
  </div>
);

// Where the market has moved him, drawn rather than summarised. The y axis is
// inverted because a falling ADP number means rising value — up on this chart
// always means "being taken earlier", which is the only reading that does not
// need a caption to interpret.
const Spark = ({ series, feed, w = 190, h = 44 }) => {
  if (!series || series.length < 2) return null;
  const vals = series.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = Math.max(0.5, hi - lo);
  const pad = 5;
  const x = (i) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = (v) => pad + ((v - lo) / span) * (h - pad * 2);
  const d = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  const rising = last.value < series[0].value;
  const stroke = Math.abs(last.value - series[0].value) < 1 ? "rgb(var(--ink-ghost))"
    : rising ? "rgb(var(--ahead))" : "rgb(var(--behind))";
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  return (
    <div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
        aria-label={`${feed} rank from ${fmtDate(series[0].date)} to ${fmtDate(last.date)}`}
        className="block w-full">
        <line x1="0" y1={y(lo).toFixed(1)} x2={w} y2={y(lo).toFixed(1)} stroke="rgb(var(--line))" strokeWidth="1" />
        <line x1="0" y1={y(hi).toFixed(1)} x2={w} y2={y(hi).toFixed(1)} stroke="rgb(var(--line))" strokeWidth="1" />
        <path d={d} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(series.length - 1)} cy={y(last.value)} r="2.75" fill={stroke} />
      </svg>
      <div className="mt-1 flex justify-between text-[9px] text-ink-faint">
        <span>{fmtDate(series[0].date)}</span>
        <span className="truncate px-1">{feed}</span>
        <span>{fmtDate(last.date)}</span>
      </div>
    </div>
  );
};

const AGREE = [
  { max: 4, read: "Locked in", score: 1 },
  { max: 8, read: "Settled", score: 2 },
  { max: 12, read: "Some split", score: 3 },
  { max: 18, read: "Real split", score: 4 },
  { max: Infinity, read: "Wide open", score: 5 },
];

export default function PlayerCard({ row, sources, onOpenDetail, onClose }) {
  const { state, dispatch } = useStore();
  const p = row.p;
  const ps = posStyle(p.pos);
  const gap = row.consensus == null ? null : row.myRank - row.consensus;
  const hasProj = state.sources?.some((s) => s.type === "proj");

  const opinions = (sources || [])
    .map((s) => ({ ...s, value: row.perSource[s.key] ?? null }))
    .filter((o) => o.value != null)
    .sort((a, b) => a.value - b.value);
  const vals = opinions.map((o) => o.value);
  const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : null;

  const mv = row.move;
  const moveTone = !mv || Math.abs(mv.delta) < 1 ? "text-ink-faint" : mv.delta > 0 ? "text-ahead" : "text-behind";
  const agree = row.sigma == null ? null : AGREE.find((a) => row.sigma <= a.max);

  // The situation scorecard is already a set of 1–5 judgements; the card shows
  // the two that move a ranking most and leaves the rest to the detail panel.
  const sc = p.scorecard || {};
  const opportunity = p.pos === "RB" ? ["olineRun", "OL run block"]
    : p.pos === "QB" ? ["olinePass", "OL pass block"]
    : ["targetComp", "Target share"];

  return (
    <div className="border-y border-ink bg-ground-sunken px-3 py-4 md:px-4">
      {/* identity */}
      <div className="flex flex-wrap items-start gap-3">
        <span className={`mt-0.5 shrink-0 border px-2 py-1 text-[11px] font-bold uppercase tracking-label ${ps.chip}`}>
          {p.pos}{row.posRank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold leading-tight tracking-tight">{p.name}</div>
          <div className="mt-0.5 text-[11px] text-ink-faint">
            {p.team || "FA"} · bye {p.bye ?? "?"}
            {p.sleeper?.age != null && <> · age {p.sleeper.age}</>}
            {p.sleeper?.yearsExp != null && <> · yr {(p.sleeper.yearsExp ?? 0) + 1}</>}
            {p.handcuffOf && state.players[p.handcuffOf] && <> · handcuff of {state.players[p.handcuffOf].name}</>}
          </div>
        </div>
      </div>

      {/* the headline strip: four rank-shaped values on one scale */}
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Cell lead label="Mine" value={`${p.pos}${row.posRank}`} sub={`overall ${row.myRank}`} />
        <Cell label="Market"
          title="Where the sources you count toward consensus have him, ranked inside his position"
          value={row.consPosRank ? `${p.pos}${row.consPosRank}` : "–"}
          sub={row.consensus != null ? `overall ${fmt(row.consensus, 1)}` : "no coverage"} />
        <Cell label="Movement" tone={moveTone}
          title={mv ? `Mean change across ${mv.feeds} feed${mv.feeds > 1 ? "s" : ""} over ${mv.days} days` : "Needs two refreshes of the same feed to compare"}
          value={mv && Math.abs(mv.delta) >= 1 ? `${mv.delta > 0 ? "+" : ""}${fmt(mv.delta, 0)}` : mv ? "0" : "–"}
          sub={mv ? `spots in ${mv.days}d` : "no history yet"} />
        <Cell label="Last year"
          title="Where he actually finished at his position on half-PPR points"
          value={row.lastPosRank ? `${p.pos}${row.lastPosRank}` : "–"}
          sub={p.nfl?.games ? `${fmt(p.nfl.fp, 0)} pts · ${p.nfl.games} g` : "no stats loaded"} />
      </div>

      {/* the read, in words, so the colours are not the only thing carrying it */}
      {gap != null && (
        <p className="mt-3 text-[13px] leading-snug">
          {Math.abs(gap) < 3 ? (
            <span className="text-ink-muted">You and the room agree on him.</span>
          ) : gap < 0 ? (
            <><span className="font-semibold text-behind">You are {Math.round(-gap)} spots higher than the room.</span>{" "}
              <span className="text-ink-muted">He should still be there later — taking him at your slot spends value you did not need to.</span></>
          ) : (
            <><span className="font-semibold text-ahead">The room is {Math.round(gap)} spots higher than you.</span>{" "}
              <span className="text-ink-muted">He will be gone before your board says to take him.</span></>
          )}
        </p>
      )}

      {/* two 1–5 reads and two point totals, kept apart because they are
          different kinds of claim */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-3">
          {agree && <Meter label="Source agreement" score={agree.score} read={agree.read}
            tone={agree.score >= 4 ? "bg-warn" : "bg-ink"} />}
          <Meter label={opportunity[1]} score={sc[opportunity[0]] ?? 3}
            read={["Poor", "Below avg", "Average", "Good", "Elite"][(sc[opportunity[0]] ?? 3) - 1]}
            tone={(sc[opportunity[0]] ?? 3) >= 4 ? "bg-ahead" : (sc[opportunity[0]] ?? 3) <= 2 ? "bg-behind" : "bg-ink"} />
          <Meter label="Schedule" score={sc.sosSeason ?? 3}
            read={["Brutal", "Hard", "Neutral", "Soft", "Easiest"][(sc.sosSeason ?? 3) - 1]}
            tone={(sc.sosSeason ?? 3) >= 4 ? "bg-ahead" : (sc.sosSeason ?? 3) <= 2 ? "bg-behind" : "bg-ink"} />
        </div>
        <div className="space-y-3 self-start">
          <div className="grid grid-cols-2 gap-1.5">
            <Cell label={hasProj ? "Projected" : "Points ≈"} value={fmt(row.pts, 0)}
              sub={hasProj ? "your scoring rules" : "generic curve"} />
            <Cell label="Value over repl." tone={row.vor > 0 ? "text-ahead" : "text-ink-faint"}
              title="Points above the last startable player at his position in your league"
              value={fmt(row.vor, 0)}
              sub={row.vor > 0 ? "above a streamer" : "replaceable"} />
          </div>
          {mv?.series?.length > 1 && (
            <div className="border border-line bg-panel px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="label text-ink-faint">Market drift</span>
                <span className="text-[10px] text-ink-faint">up = drafted earlier</span>
              </div>
              <div className="mt-2">
                <Spark series={mv.series} feed={mv.seriesFeed} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* every source on one scale, which is the actual argument */}
      {opinions.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="label text-ink-faint">Where the sites have him</span>
            <span className="text-[10px] text-ink-faint">
              spread <span className="num font-semibold text-ink-muted">{fmt(spread, 0)}</span> across {opinions.length} source{opinions.length > 1 ? "s" : ""}
            </span>
          </div>
          <RankBar myRank={row.myRank} sources={opinions} consensus={row.consensus} />
        </div>
      )}

      {/* what I think, which is the whole point of the app */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {TAGS.map((t) => (
          <button key={t.key} onClick={() => dispatch({ type: "TOGGLE_TAG", id: p.id, tag: t.key })}
            className={`border px-2 py-1 text-[10px] font-semibold uppercase tracking-label transition-colors ${
              p.tags.includes(t.key) ? t.cls : "border-line text-ink-faint hover:border-ink hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
        <span className="grow" />
        <button onClick={() => onOpenDetail(p.id)}
          className="border border-line px-2.5 py-1 text-[10px] font-semibold uppercase tracking-label text-ink-muted transition-colors hover:border-ink hover:text-ink">
          Situation, stats &amp; news
        </button>
        <button onClick={onClose} aria-label="Collapse"
          className="border border-line px-2.5 py-1 text-[10px] font-semibold uppercase tracking-label text-ink-faint transition-colors hover:border-ink hover:text-ink">
          Close
        </button>
      </div>

      <textarea value={p.notes} rows={2} placeholder="Why do you have him here?"
        onChange={(e) => dispatch({ type: "SET_NOTES", id: p.id, notes: e.target.value })}
        className="mt-2 w-full border border-line bg-panel px-2 py-1.5 text-[12px] placeholder:text-ink-ghost" />
    </div>
  );
}
