import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store.jsx";
import { computeBoard, suggestTierBreaks } from "./compute.js";
import { POS_STYLE, POSITIONS, TAGS, fmt, pct, daysAgo, sourceFreshness } from "./util.js";
import RankBar from "./rankbar.jsx";
import { useDataSync } from "./useDataSync.js";
import { newsRSSUrl, fetchRSSHeadlines } from "./fetchers.js";
import Onboard from "./onboard.jsx";
import PlayerCard from "./playercard.jsx";
import { Search, Close, Chevron, Sort, Ellipsis, Grip, Refresh, Warning, Link, Pencil, External, Caret, Dot } from "./icons.jsx";

const posStyle = (pos) => POS_STYLE[pos] || POS_STYLE.DST;

// Every source with an opinion on one player, low rank first. Projections are
// excluded: a stat line is not a placement, so it has no rank to plot.
function sourceOpinions(sources, id) {
  return (sources || [])
    .filter((s) => s.type !== "proj")
    .map((s) => ({ key: s.id, label: s.name, type: s.type, stale: daysAgo(s.date) > 7, value: s.map?.[id] ?? null }))
    .filter((r) => r.value != null)
    .sort((a, b) => a.value - b.value);
}


// Tiers, drawn as depth. A cliff in value is the most important thing on the
// board and it was being said by a thin grey strip, so it is said by size
// instead: tier one is set largest and every tier after it is a step smaller,
// which is the only depth cue the eye needs — a thing that is bigger is nearer.
// It costs less height than the old uniform band rather than more, because only
// the top tier is large and the rest shrink past where the band used to sit.
//
// Three things step together and none of them is a shadow: the block gets
// smaller, it stands less proud of its band, and the rule above the band gets
// thinner. Near tiers therefore read as heavier objects sitting closer to you,
// far ones as marks lying flat on the page.
//
// Five steps and then a floor: past tier six the differences stop being legible
// and another step would only make the text small.
const TIER_DEPTH = [
  { block: "px-3.5 py-2 text-[17px] -my-2",     name: "text-[16px]",   band: "py-1",   ink: 1,    rule: 3, tint: 100 },
  { block: "px-3 py-1.5 text-[14px] -my-1.5",   name: "text-[14px]",   band: "py-1",   ink: 0.9,  rule: 2, tint: 80 },
  { block: "px-2.5 py-1 text-[12px] -my-1",     name: "text-[12.5px]", band: "py-0.5", ink: 0.8,  rule: 1, tint: 62 },
  { block: "px-2 py-0.5 text-[10.5px] -my-0.5", name: "text-[11px]",   band: "py-0.5", ink: 0.7,  rule: 1, tint: 46 },
  { block: "px-2 py-0.5 text-[9.5px]",          name: "text-[10px]",   band: "py-0",   ink: 0.62, rule: 1, tint: 34 },
];
// The band's tint recedes with the block. Mixed to an opaque colour rather than
// set as an alpha, because the band is sticky and a translucent one would show
// the rows sliding along underneath it. bg-band-tier stays on the element as
// the fallback for anything that cannot do color-mix.
const tierBand = (d) => `color-mix(in srgb, rgb(var(--band-tier)) ${d.tint}%, rgb(var(--panel)))`;
const tierDepth = (tier) => TIER_DEPTH[Math.min(tier - 1, TIER_DEPTH.length - 1)];

function tierOfIndex(i, breaks) {
  let t = 1;
  for (const b of breaks) if (i >= b) t++;
  return t;
}

const Delta = ({ v, invert = false, d = 1 }) => {
  if (v == null || Number.isNaN(v)) return <span className="text-ink-ghost">–</span>;
  const good = invert ? v > 0 : v < 0;
  const cls = Math.abs(v) < 0.5 ? "text-ink-muted" : good ? "text-ahead" : "text-behind";
  return <span className={cls}>{v > 0 ? "+" : ""}{fmt(v, d)}</span>;
};

// My rank minus consensus, in the convention the Compare tab established:
// negative means I have him earlier than the room (a reach), positive means the
// room has him earlier than I do (I could wait). Small gaps stay grey — three
// spots of daylight is noise, not an opinion.
const ConsGap = ({ myRank, consensus }) => {
  if (consensus == null || Number.isNaN(consensus)) return null;
  const g = Math.round(myRank - consensus);
  if (g === 0) return <span className="text-[10px] text-ink-ghost">=</span>;
  const cls = Math.abs(g) < 3 ? "text-ink-faint" : g < 0 ? "text-behind" : "text-ahead";
  const title = g < 0
    ? `You have him ${-g} spots higher than consensus — reaching`
    : `Consensus has him ${g} spots higher than you — you could wait`;
  return <span title={title} className={`text-[10px] font-semibold tabular-nums ${cls}`}>{g > 0 ? `+${g}` : g}</span>;
};

// The consensus overlay badge: where the room's ordering would put this player
// among the same rows on screen. Distinct from ConsGap, which compares against
// the consensus *value* — this one is a position you could actually draft at.
const ConsPos = ({ my, theirs }) => {
  const move = my - theirs;
  const cls = Math.abs(move) < 3 ? "border-line text-ink-faint"
    : move < 0 ? "border-behind/40 text-behind"
    : "border-ahead/40 text-ahead";
  const title = move === 0 ? "Consensus would rank him exactly here"
    : move < 0 ? `Consensus would rank him #${theirs} — ${-move} spots later than you have him`
    : `Consensus would rank him #${theirs} — ${move} spots earlier than you have him`;
  return <span title={title} className={`num rounded-[--r-sm] border px-1.5 py-px text-[10px] font-semibold ${cls}`}>c{theirs}</span>;
};

const InjuryBadge = ({ p }) => {
  const inj = p.sleeper?.injury;
  if (!inj) return null;
  const short = { Questionable: "Q", Doubtful: "D", Out: "O", IR: "IR", PUP: "PUP", Sus: "SUS" }[inj] || inj.slice(0, 3);
  return <span className="lean ml-1.5 bg-behind px-1.5 text-[9px] font-bold uppercase tracking-label text-ink-invert"><span>{short}</span></span>;
};

const TagDots = ({ p }) => (
  <span className="ml-1 inline-flex gap-0.5 align-middle">
    {TAGS.filter((t) => p.tags.includes(t.key)).map((t) => (
      <span key={t.key} title={t.label} className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
    ))}
  </span>
);

// Draft-season movement first, waiver churn only as a fallback. "Up fourteen
// spots in a fortnight" is a fact about this draft; Sleeper's 48-hour add count
// is in-season roster噪 noise that happens to be available.
function Trend({ move, p, trending }) {
  if (move) {
    const d = move.delta;
    const feeds = `${move.feeds} feed${move.feeds > 1 ? "s" : ""}`;
    if (Math.abs(d) < 1) {
      return <span title={`Flat across ${feeds} over ${move.days}d`} className="text-ink-ghost"><Dot size={5} /></span>;
    }
    const up = d > 0;
    return (
      <span title={`${up ? "Being drafted earlier" : "Sliding"} by ${fmt(Math.abs(d), 1)} spots over ${move.days}d · ${feeds}`}
        className={`num text-[11px] font-bold ${up ? "text-ahead" : "text-behind"}`}>
        <Caret dir={up ? "up" : "down"} size={8} />{fmt(Math.abs(d), 0)}
      </span>
    );
  }
  const sid = p.sleeper?.sleeperId;
  if (!sid) return <span className="text-ink-ghost">–</span>;
  const add = trending.adds.find((x) => x.player_id === sid);
  const drop = trending.drops.find((x) => x.player_id === sid);
  if (!add && !drop) return <span className="text-ink-ghost"><Dot size={5} /></span>;
  return (
    <span className="num text-[11px]" title="Sleeper adds/drops over 48h — waiver interest, not draft movement">
      {add && <span className="text-ahead"><Caret dir="up" size={8} />{(add.count / 1000).toFixed(0)}k</span>}
      {add && drop && " "}
      {drop && <span className="text-behind"><Caret dir="down" size={8} />{(drop.count / 1000).toFixed(0)}k</span>}
    </span>
  );
}

// ---------------- news links ----------------
function buildNewsLinks(p, settings) {
  const sub = (u) => u.replaceAll("{name}", encodeURIComponent(p.name)).replaceAll("{team}", encodeURIComponent(p.team || ""));
  const links = settings.newsTemplates.map((t) => ({ name: t.name, url: sub(t.url) }));
  const beats = (settings.beatBlogs[p.team] || []).map((b) => ({ name: `Beat · ${b.name}`, url: sub(b.url) }));
  return [...links, ...beats, { name: "Google News RSS", url: newsRSSUrl(p.name, p.team) }];
}

function NewsPanel({ p }) {
  const { state } = useStore();
  const [headlines, setHeadlines] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const links = buildNewsLinks(p, state.settings);
  const proxy = state.settings.corsProxy?.trim();
  const load = async () => {
    setLoading(true); setErr(null);
    try { setHeadlines(await fetchRSSHeadlines(proxy, newsRSSUrl(p.name, p.team))); }
    catch (e) { setErr(String(e.message || e)); }
    finally { setLoading(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {links.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
            className="rounded border border-line bg-band/60 px-2 py-1 text-xs text-accent hover:border-accent">
            {l.name} <External size={11} />
          </a>
        ))}
      </div>
      {proxy ? (
        <div>
          <button onClick={load} className="rounded bg-line px-2 py-1 text-xs hover:bg-line-strong">
            {loading ? "Fetching…" : "Fetch headlines inline"}
          </button>
          {err && <div className="mt-1 text-xs text-behind">Couldn't fetch through your proxy: {err}</div>}
          {headlines && (
            <ul className="mt-2 space-y-1">
              {headlines.map((h, i) => (
                <li key={i} className="text-xs leading-snug">
                  <a className="text-ink hover:text-accent" href={h.link} target="_blank" rel="noopener noreferrer">{h.title}</a>
                  <span className="ml-1 text-ink-faint">{h.date && new Date(h.date).toLocaleDateString()}</span>
                </li>
              ))}
              {!headlines.length && <li className="text-xs text-ink-faint">No headlines returned.</li>}
            </ul>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-ink-faint">Add a CORS proxy in Settings to render headlines inline. Links above open in a new tab.</div>
      )}
    </div>
  );
}

// ---------------- scorecard ----------------
const SCORECARD_FIELDS = {
  QB: [["offense", "Offense"], ["olinePass", "OL pass block"], ["scheme", "Coach / scheme"], ["pace", "Pace / pass rate"], ["sosSeason", "SOS season"], ["sosPlayoff", "SOS wk 15–17"]],
  RB: [["offense", "Offense"], ["olineRun", "OL run block"], ["olinePass", "OL pass block"], ["qb", "QB quality"], ["scheme", "Coach / scheme"], ["pace", "Pace"], ["sosSeason", "SOS season"], ["sosPlayoff", "SOS wk 15–17"]],
  WR: [["offense", "Offense"], ["qb", "QB quality"], ["targetComp", "Target competition"], ["olinePass", "OL pass block"], ["scheme", "Coach / scheme"], ["pace", "Pace / pass rate"], ["sosSeason", "SOS season"], ["sosPlayoff", "SOS wk 15–17"]],
  TE: [["offense", "Offense"], ["qb", "QB quality"], ["targetComp", "Target competition"], ["scheme", "Coach / scheme"], ["sosSeason", "SOS season"], ["sosPlayoff", "SOS wk 15–17"]],
};
function Scorecard({ p }) {
  const { dispatch } = useStore();
  const fields = SCORECARD_FIELDS[p.pos] || SCORECARD_FIELDS.WR;
  const sc = p.scorecard;
  const dot = (v) => (v >= 4 ? "bg-ahead" : v <= 2 ? "bg-behind" : "bg-ink-ghost");
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Situation scorecard</div>
        <label className="flex items-center gap-1 text-[11px] text-ink-muted">
          <input type="checkbox" checked={!!sc.projected}
            onChange={(e) => dispatch({ type: "SET_SCORECARD", id: p.id, patch: { projected: e.target.checked } })} />
          projected, not from completed-season data
        </label>
      </div>
      {sc.projected && (
        <div className="mb-2 rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
          Projected grades — rookie / new team / offseason guess. No current-year basis.
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {fields.map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-muted">{label}</span>
            <span className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${dot(sc[key])}`} />
              <input type="range" min="1" max="5" value={sc[key] ?? 3} className="w-20 accent-accent"
                onChange={(e) => dispatch({ type: "SET_SCORECARD", id: p.id, patch: { [key]: +e.target.value } })} />
              <span className="w-3 text-right text-xs tabular-nums text-ink-muted">{sc[key] ?? 3}</span>
            </span>
          </div>
        ))}
      </div>
      <input value={sc.note || ""} placeholder="Grade note (e.g. new OC, rookie — projected)"
        onChange={(e) => dispatch({ type: "SET_SCORECARD", id: p.id, patch: { note: e.target.value } })}
        className="mt-2 w-full rounded border border-line bg-panel-raised px-2 py-1 text-xs" />
    </div>
  );
}

// ---------------- advanced stats ----------------
function AdvStats({ p, season }) {
  const n = p.nfl;
  if (!n) return <div className="text-xs text-ink-faint">No nflverse data linked. Fetch season stats from the Imports tab.</div>;
  const rows =
    p.pos === "QB" ? [
      ["Dropbacks", n.dropbacks, 0], ["Pass yds", n.passYd, 0], ["Pass TD", n.passTD, 0],
      ["Rush att", n.carries, 0], ["Rush yds", n.rushYd, 0], ["Rush TD", n.rushTD, 0],
    ] : p.pos === "RB" ? [
      ["Carries", n.carries, 0], ["Carry share", n.carryShare, "pct"], ["YPC", n.ypc, 1],
      ["Targets", n.targets, 0], ["Tgt share", n.tgtShare, "pct"], ["Rec", n.rec, 0],
      ["Rush TD", n.rushTD, 0], ["Rec TD", n.recTD, 0], ["Half-PPR/g", n.fpg, 1],
    ] : [
      ["Targets", n.targets, 0], ["Tgt share", n.tgtShare, "pct"], ["Air-yd share", n.airShare, "pct"],
      ["WOPR", n.wopr, 2], ["aDOT", n.adot, 1], ["Yds/tgt", n.ypt, 1],
      ["Rec", n.rec, 0], ["Rec TD", n.recTD, 0], ["Half-PPR/g", n.fpg, 1],
    ];
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {season} season · {n.games} games {n.team ? `· ${n.team}` : ""}
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1">
        {rows.map(([label, v, d]) => (
          <div key={label} className="flex items-baseline justify-between border-b border-line pb-0.5">
            <span className="text-[11px] text-ink-faint">{label}</span>
            <span className="text-xs tabular-nums text-ink">{d === "pct" ? pct(v) : fmt(v, d)}</span>
          </div>
        ))}
      </div>
      {p.sleeper?.age != null && (
        <div className="mt-1.5 text-[11px] text-ink-faint">
          Age {p.sleeper.age} · Yr {(p.sleeper.yearsExp ?? 0) + 1}
          {p.pos === "WR" && p.sleeper.yearsExp <= 2 && <span className="ml-1 text-pos-K">· inside the yr-1–3 WR breakout window</span>}
          {p.pos === "RB" && p.sleeper.age >= 27 && <span className="ml-1 text-warn">· RB age cliff territory</span>}
        </div>
      )}
    </div>
  );
}

// ---------------- detail panel ----------------

// ---------------- rank comparison ----------------
// Every source that has an opinion on this player, on one shared scale next to
// mine. Delta is source minus my rank: positive means the site is lower on him
// than I am, i.e. I could wait.
function SourceCompare({ p }) {
  const { state } = useStore();
  const myRank = state.myRanks.indexOf(p.id) + 1;
  const rows = sourceOpinions(state.sources, p.id);

  if (!rows.length) {
    return (
      <div className="text-xs text-ink-faint">
        No ranking sources cover this player yet. Fetch Sleeper or ESPN on the Imports tab.
      </div>
    );
  }

  const vals = rows.map((r) => r.value);
  const consensus = vals.reduce((a, b) => a + b, 0) / vals.length;
  const spread = Math.max(...vals) - Math.min(...vals);

  return (
    <div className="space-y-1">
      <RankBar myRank={myRank} sources={rows} consensus={consensus} />
      <div className="flex items-center justify-between pt-1 text-[11px] text-ink-faint">
        <span>consensus {fmt(consensus, 1)} · spread {fmt(spread, 0)} across {rows.length} source{rows.length > 1 ? "s" : ""}</span>
        <span className={myRank < consensus ? "text-behind" : myRank > consensus ? "text-ahead" : ""}>
          {myRank < consensus ? `${fmt(consensus - myRank, 0)} higher than the room` : myRank > consensus ? `${fmt(myRank - consensus, 0)} lower than the room` : "on consensus"}
        </span>
      </div>
    </div>
  );
}

// Projected stat line from whichever source carries projections.
function ProjLine({ p }) {
  const { state } = useStore();
  const proj = (state.sources || []).find((s) => s.type === "proj" && s.stats?.[p.id]);
  if (!proj) return null;
  const st = proj.stats[p.id];
  const bits = [];
  if (st.passYd) bits.push(`${fmt(st.passYd, 0)} pass yd`, `${fmt(st.passTD, 0)} pass TD`);
  if (st.rushYd) bits.push(`${fmt(st.rushYd, 0)} rush yd`, `${fmt(st.rushTD, 0)} rush TD`);
  if (st.rec) bits.push(`${fmt(st.rec, 0)} rec`, `${fmt(st.recYd, 0)} rec yd`, `${fmt(st.recTD, 0)} rec TD`);
  if (!bits.length) return null;
  return (
    <div className="mt-1 text-[11px] text-ink-muted">
      <span className="text-ink-faint">{proj.name}:</span> {bits.join(" · ")}
    </div>
  );
}

function DetailPanel({ id, onClose }) {
  const { state, dispatch } = useStore();
  const p = state.players[id];
  if (!p) return null;
  const ps = posStyle(p.pos);
  const starterOptions = Object.values(state.players)
    .filter((x) => x.pos === p.pos && x.team === p.team && x.id !== p.id);
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-ground/95 p-3 backdrop-blur">
        <div>
          <div className="flex items-center gap-2">
            <span className={`rounded border px-1.5 py-0.5 text-xs font-bold ${ps.chip}`}>{p.pos}</span>
            <span className="text-base font-semibold">{p.name}</span>
            <InjuryBadge p={p} />
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {p.team || "FA"} · bye {p.bye ?? "?"}
            {p.handcuffOf && state.players[p.handcuffOf] && <> · handcuff of {state.players[p.handcuffOf].name}</>}
          </div>
        </div>
        <button onClick={onClose} className="rounded p-1.5 text-ink-muted hover:bg-band" aria-label="Close"><Close /></button>
      </div>
      <div className="space-y-4 p-3">
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map((t) => (
            <button key={t.key}
              onClick={() => dispatch({ type: "TOGGLE_TAG", id: p.id, tag: t.key })}
              className={`rounded-full border px-2.5 py-1 text-xs ${p.tags.includes(t.key) ? t.cls : "border-line text-ink-faint hover:border-line-strong"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <textarea value={p.notes} placeholder="Notes…" rows={3}
          onChange={(e) => dispatch({ type: "SET_NOTES", id: p.id, notes: e.target.value })}
          className="w-full rounded border border-line bg-panel-raised px-2 py-1.5 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-ink-muted">
            Handcuff of
            <select value={p.handcuffOf || ""} onChange={(e) => dispatch({ type: "SET_HANDCUFF", id: p.id, starterId: e.target.value || null })}
              className="mt-0.5 w-full rounded border border-line bg-panel-raised px-1.5 py-1 text-xs text-ink">
              <option value="">— none —</option>
              {starterOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            Bye week
            <input type="number" min="1" max="18" value={p.bye ?? ""} placeholder="?"
              onChange={(e) => dispatch({ type: "SET_BYE", id: p.id, bye: e.target.value === "" ? null : +e.target.value })}
              className="mt-0.5 w-full rounded border border-line bg-panel-raised px-1.5 py-1 text-xs text-ink" />
          </label>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Where the sites have him</div>
          <SourceCompare p={p} />
          <ProjLine p={p} />
        </div>
        <Scorecard p={p} />
        <AdvStats p={p} season={state.nflSeason} />
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">News</div>
          <NewsPanel p={p} />
        </div>
      </div>
    </div>
  );
}

// ---------------- board chrome ----------------

// A board is a snapshot of a market that moves daily, so the Board tab says out
// loud how old the snapshot is and offers the refresh in the same breath. This
// is deliberately always present, not only when something has gone stale — "you
// pulled this an hour ago" is the state you most want confirmed before a pick.
//
// It is one line, and it stays one line. Everything in the command bar sits
// above the board inside a sticky block, so a row that wraps is a row of
// players you can no longer see; the source name and count drop out on narrow
// screens rather than pushing the list down.
function FreshnessStrip() {
  const { state } = useStore();
  const { busy, msg, steps, refreshAll } = useDataSync();
  const fresh = sourceFreshness(state.sources);
  if (!fresh) return null;

  const tone = {
    today: "border-ahead/40 bg-ahead/15 text-ahead",
    recent: "border-warn/40 bg-warn/15 text-warn",
    stale: "border-behind/40 bg-behind/15 text-behind",
  }[fresh.level];
  const pill = {
    today: "updated today",
    recent: `${fresh.days}d old`,
    stale: `STALE · ${fresh.days}d`,
  }[fresh.level];
  const running = busy === "all";
  const step = running && steps ? steps.find((x) => x.state === "running") : null;

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[11px] md:px-3">
      <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-label ${tone}`}>{pill}</span>
      <span className="min-w-0 truncate text-ink-muted">
        Consensus as of <span className="text-ink">{new Date(fresh.newest.date).toLocaleDateString()}</span>
        <span className="hidden text-ink-ghost sm:inline"> · {fresh.newest.name} · {state.sources.length} source{state.sources.length > 1 ? "s" : ""}</span>
      </span>
      <span className="grow" />
      {running && step && <span className="hidden truncate text-ink-faint sm:block">{step.label}…</span>}
      {!running && msg && <span className="hidden truncate text-ink-faint sm:block">{msg}</span>}
      <button onClick={() => refreshAll()} disabled={running}
        title="Re-pull every source the app can reach — the same run as Setup's one button"
        className="ctl ctl-quiet hover:border-accent hover:text-accent">
        <Refresh size={12} className={running ? "animate-spin-slow" : ""} />
        {running ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

// The overflow menu. Everything that is neither a filter nor a lens lives here:
// rarely-used, and in one case destructive. "→ consensus order" used to sit in
// the toolbar drawn exactly like a position filter, one stray click away from
// replacing an afternoon of dragging — so it is behind this menu and behind a
// second click that says what it will do.
function OverflowMenu({ onShortcuts, onReset, onClearFilters, filtered }) {
  const [open, setOpen] = useState(false);
  const [arming, setArming] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setArming(false); } };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); setArming(false); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const item = "block w-full px-3 py-2 text-left text-[11px] font-medium text-ink-muted transition-colors hover:bg-band hover:text-ink";
  return (
    <div ref={ref} className="relative">
      <button onClick={() => { setOpen((o) => !o); setArming(false); }}
        aria-haspopup="menu" aria-expanded={open} aria-label="More board actions"
        className={`ctl px-2 py-[7px] ${open ? "border-ink text-ink" : ""}`}><Ellipsis /></button>
      {open && (
        <div role="menu"
          className="animate-rise absolute right-0 top-full z-40 mt-1 w-60 rounded-[--r-md] border border-line bg-panel py-1 shadow-lg shadow-black/10">
          <button role="menuitem" className={item} onClick={() => { setOpen(false); onShortcuts(); }}>
            Keyboard shortcuts <span className="num ml-1 text-ink-ghost">?</span>
          </button>
          {filtered && (
            <button role="menuitem" className={item} onClick={() => { setOpen(false); onClearFilters(); }}>
              Clear every filter
            </button>
          )}
          <div className="my-1 border-t border-line" />
          {arming ? (
            <div className="px-3 py-2">
              <p className="text-[11px] leading-snug text-ink-muted">
                This replaces your whole order with the market's. History keeps a snapshot, so it is undoable.
              </p>
              <div className="mt-2 flex gap-1.5">
                <button className="ctl ctl-danger border-behind/50 text-behind"
                  onClick={() => { setOpen(false); setArming(false); onReset(); }}>Replace my order</button>
                <button className="ctl ctl-quiet" onClick={() => setArming(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button role="menuitem" className={`${item} hover:text-behind`} onClick={() => setArming(true)}>
              Reset order to consensus…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The keys were documented in a paragraph under the table — below a hundred and
// twenty rows, which is to say nowhere. They are a modal on ? instead, grouped
// by what you are trying to do rather than listed by key.
const SHORTCUTS = [
  ["Move around", [["↑ ↓", "or j / k — walk the board"], ["/", "jump to search"], ["enter", "open the player card"], ["esc", "close card, panel or dialog"]]],
  ["Change your order", [["shift+↑ ↓", "move the selected player"], ["[  ]", "the same, one hand on the keys"], ["drag", "a row, to move him anywhere"]]],
  ["Mark players", [["1", "Favorite"], ["2", "Sleeper"], ["3", "Reliable"], ["4", "Avoid"], ["5", "Handcuff"]]],
  ["Tiers", [["t", "cut or heal a tier above the selection"], ["drag", "the tier handle onto a player"], ["?", "this sheet, from anywhere"]]],
];

function ShortcutsModal({ onClose }) {
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      onClick={onClose} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div onClick={(e) => e.stopPropagation()}
        className="animate-rise max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-[--r-lg] border border-line bg-ground shadow-2xl sm:max-w-3xl sm:rounded-[--r-lg]">
        <div className="sticky top-0 flex items-center justify-between rounded-t-[--r-lg] border-b border-line bg-ground px-4 py-3">
          <h2 className="label-lg text-ink">Keyboard</h2>
          <button onClick={onClose} className="ctl ctl-quiet" aria-label="Close">Close</button>
        </div>
        <div className="grid gap-x-8 gap-y-5 p-4 sm:grid-cols-2">
          {SHORTCUTS.map(([group, keys]) => (
            <div key={group}>
              <div className="label mb-2 border-b border-line pb-1.5 text-ink-faint">{group}</div>
              <dl className="space-y-1.5">
                {keys.map(([k, what]) => (
                  <div key={k} className="flex items-baseline gap-3">
                    <dt className="w-24 shrink-0 text-right">
                      <kbd>{k}</kbd>
                    </dt>
                    <dd className="text-[12px] leading-snug text-ink-muted">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ink-faint">
          The bar in <span className="font-semibold text-ink-muted">Cons</span> puts every source on one scale: the grey band is
          where they cluster, the dark tick is the Cons value, the blue tick is you. A wide band with your tick outside it is a
          different decision from a tight one.
        </div>
      </div>
    </div>
  );
}

// The cap strip, shared by the table and the card list because they had grown
// two copies of the same fourteen lines.
function MoreRows({ hidden, total, onMore, onAll }) {
  if (!hidden) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-3">
      <button onClick={onMore} className="ctl">Show 200 more</button>
      <button onClick={onAll} className="ctl ctl-quiet">Show all {total}</button>
      <span className="text-[11px] text-ink-faint">
        <span className="num">{hidden}</span> further down your board — search or a position chip is usually faster than scrolling.
      </span>
    </div>
  );
}

// Filtering to nothing used to render an empty table body — a header, a rule,
// and silence. It is almost always a typo or a filter you forgot was on, so the
// board says which ones are on and offers to drop them.
function EmptyBoard({ query, posFilter, tagFilter, total, onClear }) {
  // Naming each filter as its own chip rather than building a sentence out of
  // them: "matching", "at" and "tagged" do not conjoin into one clause, and the
  // list is what you actually need to read anyway.
  const active = [
    query.trim() && ["Search", `“${query.trim()}”`],
    posFilter && ["Position", posFilter],
    tagFilter && ["Tag", TAGS.find((t) => t.key === tagFilter)?.label],
  ].filter(Boolean);
  return (
    <div className="mx-auto max-w-sm px-6 py-16 text-center sm:py-24">
      <div className="label-lg text-ink-ghost">No players</div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
        None of your <span className="num font-semibold text-ink">{total}</span> players match everything you have on:
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {active.map(([label, value]) => (
          <span key={label} className="inline-flex items-center gap-1.5 rounded-[--r-sm] border border-line bg-panel px-2.5 py-1.5">
            <span className="label text-ink-ghost">{label}</span>
            <span className="text-[12px] font-semibold text-ink">{value}</span>
          </span>
        ))}
      </div>
      <button onClick={onClear} className="ctl mt-5">Clear filters</button>
    </div>
  );
}

// ---------------- main board ----------------
export default function Board() {
  const { state, dispatch } = useStore();
  const board = useMemo(() => computeBoard(state), [state.players, state.myRanks, state.sources, state.settings]);
  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState(null);
  const [tagFilter, setTagFilter] = useState(null);
  const [sortKey, setSortKey] = useState("my"); // 'my' enables drag/tiers
  const [selected, setSelected] = useState(null);
  // Draft-day mode: everything analytical folds away and the board is reduced
  // to rank, position, name, and where the market has him. Both of these live
  // in the store because they are the two settings you would hate to re-pick
  // after a mid-draft reload.
  const compact = state.ui.density === "compact";
  const overlay = !!state.ui.overlay;
  const setUI = (patch) => dispatch({ type: "SET_UI", patch });
  const [detail, setDetail] = useState(null);
  // The card opens under the row rather than beside it, so comparing a player
  // against the two names either side of him never costs you your place.
  const [expanded, setExpanded] = useState(null);
  // A full import runs to several hundred players and every row costs about
  // sixty DOM nodes, so rendering the lot builds a tree the browser then has to
  // lay out and re-reconcile on every keystroke. Search, the position chips and
  // this cap are the three ways the list stays a list.
  const [limit, setLimit] = useState(120);
  // The keys cheat-sheet. It used to be a paragraph under the table, which is
  // to say under a hundred and twenty rows.
  const [shortcuts, setShortcuts] = useState(false);
  // The tools band costs a fifth of a phone screen, and tags, the overlay and
  // tier cutting are prep-time controls — on the sofa in August, not on the
  // clock in a draft room. Collapsed by default below md, always open above it.
  const [toolsOpen, setToolsOpen] = useState(false);
  const toggleExpand = (id) => { setSelected(id); setExpanded((cur) => (cur === id ? null : id)); };
  const searchRef = useRef(null);
  const dragItem = useRef(null);

  // The toolbar is sticky and its height is not fixed — the filter row wraps at
  // narrow widths, and the stale-source banner and "sorted by column" note each
  // add a line. Anything sticking below it has to measure rather than assume, or
  // the header pins too high and the first rows slide under the toolbar.
  const toolbarRef = useRef(null);
  const [toolbarH, setToolbarH] = useState(49);
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const measure = () => setToolbarH(el.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure); // jsdom and older browsers
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Height of the scrollport (<main>) so the desktop detail panel can be
  // exactly one screen tall and scroll its own content instead of sliding away
  // with the list. Measured rather than derived from 100dvh, which would
  // overshoot by the app header.
  const rootRef = useRef(null);
  const [scrollportH, setScrollportH] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current?.parentElement;
    if (!el) return;
    const measure = () => setScrollportH(el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The table head pins under the toolbar, and tier bands pin under both. Two
  // measured heights rather than two guesses, because the toolbar grows a line
  // when a source goes stale and the head is a different height in each density.
  const theadRef = useRef(null);
  const [theadH, setTheadH] = useState(34);
  useLayoutEffect(() => {
    const el = theadRef.current;
    if (!el) return;
    const measure = () => setTheadH(el.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Arrowing down used to move the selection without moving the viewport, so
  // past the fold you were re-ranking a player you could not see. The row holds
  // its own ref while it is the selected one; scroll-margin (set from the two
  // measured heights below) keeps it clear of the sticky chrome.
  const selectedRowRef = useRef(null);
  useEffect(() => {
    const el = selectedRowRef.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const staleSources = state.sources.filter((s) => daysAgo(s.date) > 7);

  // Metadata for the inline rank bars, hoisted out of the row loop: the values
  // themselves already sit on each row as perSource.
  const barSources = useMemo(
    () => (state.sources || [])
      .filter((s) => s.type !== "proj")
      .map((s) => ({ key: s.id, label: s.name, type: s.type, stale: daysAgo(s.date) > 7 })),
    [state.sources]
  );
  // Built once per board rather than per render. A fresh array on every pass
  // would make the bars unmemoizable, so selecting a row would re-render every
  // bar on screen to draw exactly the same picture.
  const opinionsById = useMemo(() => {
    const m = new Map();
    for (const r of board.rows) {
      m.set(r.id, barSources
        .map((s) => ({ ...s, value: r.perSource[s.key] ?? null }))
        .filter((o) => o.value != null)
        .sort((a, b) => a.value - b.value));
    }
    return m;
  }, [board.rows, barSources]);
  const opinionsFor = (r) => opinionsById.get(r.id) || [];

  const visible = useMemo(() => {
    let rows = board.rows;
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.p.name.toLowerCase().includes(q) || (r.p.team || "").toLowerCase().includes(q));
    if (posFilter) rows = rows.filter((r) => r.p.pos === posFilter);
    if (tagFilter) rows = rows.filter((r) => r.p.tags.includes(tagFilter));
    // A lens sorts the board through someone else's eyes. Source lenses are
    // keyed "src:<id>"; everything else is a derived column.
    if (sortKey.startsWith("src:")) {
      const sid = sortKey.slice(4);
      rows = rows.slice().sort((a, b2) => (a.perSource[sid] ?? 1e9) - (b2.perSource[sid] ?? 1e9));
    } else if (sortKey !== "my") {
      const get = {
        consensus: (r) => r.consensus ?? 1e9, sigma: (r) => -(r.sigma ?? -1),
        yahooDelta: (r) => r.yahooDelta ?? 1e9, adpDelta: (r) => r.adpDelta ?? 1e9,
        vor: (r) => -(r.vor ?? -1e9), pts: (r) => -(r.pts ?? -1e9),
      }[sortKey];
      rows = rows.slice().sort((a, b) => get(a) - get(b));
    }
    return rows;
  }, [board, query, posFilter, tagFilter, sortKey]);

  // Reset the cap whenever the list itself changes, so a search never lands you
  // on page four of a different set of players.
  useEffect(() => { setLimit(120); }, [query, posFilter, tagFilter, sortKey]);
  const shown = useMemo(() => visible.slice(0, limit), [visible, limit]);
  const hidden = visible.length - shown.length;

  // Three filters can be on at once and two of them are off-screen once you
  // scroll, so "why is Bijan missing" needs one place that answers it.
  const filtered = !!(query.trim() || posFilter || tagFilter);
  const clearFilters = () => { setQuery(""); setPosFilter(null); setTagFilter(null); };

  const showTiers = sortKey === "my";

  // Tiers belong to the view you cut them in. Indices are positions within the
  // scope's own ordered list, so filtering to RB shows RB tiers rather than
  // whatever the overall board happened to cut across those players. Search and
  // tag filters deliberately do not scope tiers - they hide rows, they don't
  // redefine the list.
  const tierScope = posFilter || "all";
  const scopeOrder = useMemo(
    () => (posFilter ? state.myRanks.filter((id) => state.players[id]?.pos === posFilter) : state.myRanks),
    [state.myRanks, state.players, posFilter]
  );
  const scopeBreaks = state.tierBreaks?.[tierScope] ?? [];
  const tierNames = state.tierNames?.[tierScope] ?? {};

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (e.key === "Escape") document.activeElement.blur();
        return;
      }
      // ? is the one key that works from anywhere, including on top of itself.
      if (e.key === "?") { e.preventDefault(); setShortcuts((s) => !s); return; }
      if (shortcuts) { if (e.key === "Escape") setShortcuts(false); return; }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      // Navigation walks the rendered rows, not the whole filtered list, or the
      // selection would slide off the end of the board into players that are
      // not on screen. Arrowing into the cap reveals the next page instead.
      const idx = shown.findIndex((r) => r.id === selected);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        if (e.shiftKey && selected && showTiers) dispatch({ type: "MOVE", id: selected, delta: 1 });
        else if (idx >= shown.length - 1 && hidden > 0) setLimit((n) => n + 120);
        else setSelected(shown[Math.min(shown.length - 1, idx + 1)]?.id ?? shown[0]?.id);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        if (e.shiftKey && selected && showTiers) dispatch({ type: "MOVE", id: selected, delta: -1 });
        else setSelected(shown[Math.max(0, idx - 1)]?.id ?? shown[0]?.id);
      } else if (e.key === "]" && selected && showTiers) dispatch({ type: "MOVE", id: selected, delta: 1 });
      else if (e.key === "[" && selected && showTiers) dispatch({ type: "MOVE", id: selected, delta: -1 });
      else if (e.key === "Enter" && selected) toggleExpand(selected);
      else if (e.key === "Escape") { if (detail) setDetail(null); else setExpanded(null); }
      else if (e.key === "t" && selected && showTiers) {
        const i = scopeOrder.indexOf(selected);
        if (i > 0) dispatch({ type: "TOGGLE_TIER_BREAK", scope: tierScope, index: i });
      } else {
        const t = TAGS.find((x) => x.num === e.key);
        if (t && selected) dispatch({ type: "TOGGLE_TAG", id: selected, tag: t.key });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, hidden, selected, showTiers, detail, shortcuts, state.myRanks, scopeOrder, tierScope, dispatch]);

  // ---------- drag & drop ----------
  const onDragStart = (e, id, kind) => {
    dragItem.current = { id, kind };
    e.dataTransfer.effectAllowed = "move";
  };
  const onDropRow = (e, targetId) => {
    e.preventDefault();
    const d = dragItem.current;
    if (!d) return;
    const to = state.myRanks.indexOf(targetId);
    if (to < 0) return;
    if (d.kind === "player" && d.id !== targetId) dispatch({ type: "REORDER", id: d.id, to });
    if (d.kind === "tier") {
      const at = scopeOrder.indexOf(targetId);
      if (at > 0) dispatch({ type: "MOVE_TIER_BREAK", scope: tierScope, from: d.id, to: at });
    }
    if (d.kind === "newTier") {
      const at = scopeOrder.indexOf(targetId);
      if (at > 0) dispatch({ type: "TOGGLE_TIER_BREAK", scope: tierScope, index: at });
    }
    dragItem.current = null;
  };

  const autoTiers = () => {
    const items = scopeOrder
      .map((id) => ({ id, value: board.rows.find((r) => r.id === id)?.consensus }))
      .filter((x) => x.value != null);
    const breaks = suggestTierBreaks(items);
    // map break positions (in the consensus-known subset) back to scope indices
    const idxBreaks = breaks.map((b) => scopeOrder.indexOf(items[b].id)).filter((i) => i > 0);
    dispatch({ type: "SET_TIER_BREAKS", scope: tierScope, breaks: idxBreaks });
  };

  const startFromConsensus = () => {
    const ordered = board.rows.slice().sort((a, b) => (a.consensus ?? 1e9) - (b.consensus ?? 1e9)).map((r) => r.id);
    dispatch({ type: "SET_RANKS", ids: ordered });
  };

  // ---------- swipe (mobile cards) ----------
  const touch = useRef(null);
  const onTouchStart = (e, id) => { touch.current = { id, x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e, id) => {
    const t = touch.current;
    if (!t || t.id !== id) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = Math.abs(e.changedTouches[0].clientY - t.y);
    if (dy < 40 && Math.abs(dx) > 70) dispatch({ type: "TOGGLE_TAG", id, tag: dx > 0 ? "favorite" : "avoid" });
    touch.current = null;
  };

  if (!board.rows.length) return <Onboard />;

  const sourceCols = [...board.rankSources, ...board.adpSources];
  // Column headers are signage, not prose: they get read once to locate a
  // column and then never again, so they go small, upper and widely tracked and
  // stop competing with the numbers underneath them.
  // Background and rule live on the cells, not on <thead> or its <tr>. A sticky
  // thead paints its own background unreliably once the table scrolls under it,
  // and the seam it leaves shows a sliver of the row passing behind — cells are
  // the one place every engine agrees to paint.
  // The density switch finally earns its name: Full is the view you browse and
  // think in, so it gets air, and draft day is the one where two more players
  // on screen beats everything else.
  const rowPad = compact ? "py-1" : "py-2";
  const th = "label whitespace-nowrap border-b border-line bg-panel px-2 py-3 text-left text-ink-faint";
  // Numbers right-align, and their headers align with them. A column of 1, 14,
  // 7, 20 set flush left lines the digits up on the tens place, so scanning
  // down it you compare the wrong column of glyphs; flush right puts the units
  // under the units, which is the only reason a mono face was worth loading.
  // Names, ranks and Cons stay left: they are labels and chips, not quantities.
  const thNum = `${th} !px-1.5 !text-right`;
  const tdNum = `px-1.5 ${rowPad} text-right tabular-nums`;

  // A sortable header used to look exactly like an unsortable one until you had
  // already clicked it. The caret is always in the layout — ghosted until hover,
  // solid once the column is driving the board — so the affordance is visible
  // without the header jumping a pixel when you reach for it.
  // The lens and the consensus overlay are two answers to one question — what
  // does this board look like through someone else's eyes — so they sit in the
  // same band, next to each other. The band has two states; the picker is in
  // both, which is why it is a function rather than markup written twice.
  const ViewPicker = () => (
    <label className="flex shrink-0 items-center gap-1.5">
      <span className="label text-ink-faint">View</span>
      <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
        aria-label="Sort the board through a source's eyes"
        className="field py-[5px] text-[11px]">
        <option value="my">My order</option>
        <option value="consensus">Consensus</option>
        {sourceCols.map((s) => <option key={s.id} value={`src:${s.id}`}>{s.name}</option>)}
      </select>
    </label>
  );

  const sortBtn = (key, label, title) => {
    const on = sortKey === key;
    return (
      <button title={title} onClick={() => setSortKey(on ? "my" : key)}
        className={`group/sort inline-flex items-center gap-1 ${on ? "text-accent" : "hover:text-ink"}`}>
        {label}
        <Sort active={on} size={11}
          className={on ? "" : "text-ink-ghost opacity-0 transition-opacity group-hover/sort:opacity-100"} />
      </button>
    );
  };
  const sortTh = (key, label, title) => (
    <th className={thNum} aria-sort={sortKey === key ? "ascending" : "none"}>{sortBtn(key, label, title)}</th>
  );

  // How far this player sits from where I have him, in the current lens.
  // Positive = the lens likes him more than I do.
  const lensPos = new Map(visible.map((r, i) => [r.id, i + 1]));
  const lensMove = (r) => (sortKey === "my" ? null : r.myRank - lensPos.get(r.id));
  const lensName = sortKey === "my" ? null
    : sortKey === "consensus" ? "consensus"
    : sortKey.startsWith("src:") ? (sourceCols.find((s) => `src:${s.id}` === sortKey)?.name ?? "source")
    : sortKey;

  // Consensus overlay: the ordering the room would use over exactly the rows on
  // screen, so it stays comparable when a position filter is on. This is the
  // ordinal, which is a different fact from the consensus value in the Cons
  // cell — one says "the room's 15th player", the other "their mean is 15.4".
  // Rows no source has an opinion on sort last rather than vanishing.
  const showOverlay = overlay && sortKey === "my";
  const { consensusPos, myPos } = useMemo(() => {
    if (!showOverlay) return { consensusPos: null, myPos: null };
    const ordered = visible.slice().sort((a, b) => (a.consensus ?? 1e9) - (b.consensus ?? 1e9));
    return {
      consensusPos: new Map(ordered.map((r, i) => [r.id, r.consensus == null ? null : i + 1])),
      myPos: new Map(visible.map((r, i) => [r.id, i + 1])),
    };
  }, [showOverlay, visible]);

  // Say out loud what Cons is averaging. It used to be "the rankings sources",
  // which on a default board is one site, and naming it is what makes a wrong
  // set obvious instead of silently skewing every row.
  const consLabel = board.consSources.length
    ? `Mean of ${board.consSources.length} source${board.consSources.length > 1 ? "s" : ""}: ${board.consSources.map((s) => s.name).join(", ")}. Change which ones count on the Setup tab.`
    : "No sources are counted toward consensus — pick some on the Setup tab.";

  // Compact drops every source column and every derived analytic; what is left
  // is the question you ask between picks.
  const shownSources = compact ? [] : sourceCols;
  const colCount = 4 + shownSources.length + (compact ? 0 : 6);

  let lastTier = 0;

  // min-h-full, not h-full: a sticky child can only travel inside its
  // containing block, so capping this at one viewport would unstick the
  // toolbar partway down the list. min-h- lets it grow with the content.
  return (
    <div ref={rootRef} className={`flex min-h-full gap-4 py-4 ${compact ? "shell-draft" : "shell-board"}`}
      style={{
        "--panelMax": scrollportH ? `${scrollportH}px` : "100dvh",
        "--stickyH": `${toolbarH + theadH + 8}px`,
      }}>
      {/* The sheet hugs its table. Fourteen columns have a minimum width, and
          on a narrow laptop that minimum is wider than the measure — which
          used to spill invisibly into the page and, now the page is a
          different colour from the sheet, spilled straight across its right
          border. w-max lets the sheet grow to the table instead of being
          crossed by it; <main> is already a horizontal scroll container, so
          the overflow scrolls rather than breaking the frame.

          Only from md up: w-max is max-content, and max-content defeats
          flex-wrap — on a phone it stretched the command bar into one
          unwrapped line running off the side of the screen. Below md there is
          no wide table to hug, so the sheet is simply full width. */}
      <div className={`w-full min-w-0 flex-1 border border-line bg-panel rounded-[--r-lg] shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.10)] ${
        compact ? "" : "md:w-max md:min-w-full md:flex-none"}`}>
        {/* ---------- command bar ----------
            Three bands, in the order you ask the questions: how fresh is this,
            which players am I looking at, and what am I doing to them. It used
            to be one wrapping row of eighteen identically-drawn controls, which
            at laptop widths wrapped to four lines of sticky chrome and put a
            "replace my whole order" button next to the WR filter. */}
        <div ref={toolbarRef} className="sticky top-0 z-20 rounded-t-[--r-lg] border-b border-line bg-panel/95 backdrop-blur">
          <FreshnessStrip />
          {staleSources.length > 0 && (
            <div className="flex items-center gap-2 border-t border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn md:px-3">
              <Warning size={13} className="shrink-0" />
              <span className="min-w-0 truncate">
                {staleSources.map((s) => s.name).join(", ")} {staleSources.length > 1 ? "are" : "is"} more than 7 days old — re-import before drafting.
              </span>
            </div>
          )}

          {/* Which players. Search and the position strip decide what is on
              screen; the lens and the density switch decide how it is drawn,
              so they sit apart at the other end of the row. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line px-2 py-1.5 md:px-3">
            <div className="relative order-1 flex items-center">
              <Search size={13} className="pointer-events-none absolute left-2.5 text-ink-ghost" />
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
                aria-label="Search players" placeholder="Search"
                className="field w-32 pl-7 pr-7 md:w-52" />
              {!query && (
                <kbd className="pointer-events-none absolute right-2 hidden px-1 py-0 text-[9px] font-normal text-ink-ghost md:block">/</kbd>
              )}
              {query && (
                <button onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear search"
                  className="absolute right-1.5 text-ink-ghost transition-colors hover:text-ink"><Close size={13} /></button>
              )}
            </div>

            {/* The position strip is also the colour key: every segment keeps a
                hairline of its own position colour whether or not it is on, so
                the rail beside a player's name never needs a legend. */}
            <div className="seg order-4 md:order-2" role="group" aria-label="Filter by position">
              <button data-on={!posFilter} aria-pressed={!posFilter} onClick={() => setPosFilter(null)}
                className="px-2 md:px-2.5">All</button>
              {POSITIONS.map((pos) => (
                <button key={pos} data-on={posFilter === pos} aria-pressed={posFilter === pos}
                  onClick={() => setPosFilter(posFilter === pos ? null : pos)} className="relative px-2 md:px-2.5">
                  <span aria-hidden className={`absolute inset-x-0 top-0 h-[2px] ${posStyle(pos).rail}`} />
                  {pos}
                </button>
              ))}
            </div>

            <span className="order-5 whitespace-nowrap text-[11px] text-ink-faint md:order-3">
              <span className="num font-bold text-ink">{visible.length}</span>
              {filtered && <> <span className="text-ink-ghost">of</span> <span className="num">{board.rows.length}</span></>}
              <span className="label ml-1 hidden text-ink-ghost sm:inline">players</span>
            </span>
            {filtered && (
              <button onClick={clearFilters} className="ctl ctl-quiet order-5 md:order-3">Clear</button>
            )}
            <button onClick={() => setToolsOpen((t) => !t)} aria-expanded={toolsOpen}
              className={`ctl order-6 ${compact ? "" : "lg:hidden"} ${toolsOpen ? "border-ink text-ink" : ""}`}>
              Tools
              {/* a filter you cannot see is a filter you will not remember */}
              {(tagFilter || overlay) && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              <Chevron dir={toolsOpen ? "up" : "down"} size={12} className="text-ink-ghost" />
            </button>

            <span className="hidden md:order-4 md:block md:grow" />

            {/* Density sits beside search on a phone — line one is the pair you
                touch on the clock — and at the far end on a desktop, where it
                reads as "how is this drawn" rather than "which players". */}
            <span className="order-3 md:order-6">
              <OverflowMenu filtered={filtered} onClearFilters={clearFilters}
                onShortcuts={() => setShortcuts(true)} onReset={startFromConsensus} />
            </span>

            <div className="seg order-2 md:order-5" role="group" aria-label="Density">
              {[["full", "Full"], ["compact", "Draft day"]].map(([k, label]) => (
                <button key={k} data-on={state.ui.density === k} aria-pressed={state.ui.density === k}
                  onClick={() => setUI({ density: k })}
                  title={k === "compact"
                    ? "Rank, position, player, consensus. Everything analytical folds away for while picks are flying."
                    : "Every source column and every derived metric — the prep view."}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* What am I doing to them. A lens pauses dragging, tiers and the
              overlay, so while one is on this band explains the lens instead of
              showing tools that would not respond — the same height either way,
              which is the whole point of putting them in the same slot. */}
          {sortKey !== "my" ? (
            <div className="flex items-center gap-2 border-t border-accent/30 bg-accent/[0.07] px-2 py-1.5 md:px-3">
              <ViewPicker />
              <span className="min-w-0 truncate text-[11px] text-ink-muted">
                Sorted through <span className="font-semibold text-accent">{lensName}</span> — the caret on each row is how
                far that player moves from your order. Dragging, tiers and the overlay are paused.
              </span>
              <span className="grow" />
              <button onClick={() => setSortKey("my")} className="ctl border-accent/40 text-accent hover:border-accent">
                Back to my order
              </button>
            </div>
          ) : (
            // A phone scrolls this band sideways; anything wider wraps it,
            // because a desktop with the room to show "Suggest" should not be
            // hiding it behind a horizontal scroll nobody looks for.
            <div className={`items-center gap-1.5 overflow-x-auto border-t border-line px-2 py-1.5 md:flex-wrap md:gap-y-1.5 md:overflow-x-visible md:px-3 ${
              compact ? "" : "lg:flex"} ${toolsOpen ? "flex" : "hidden"}`}>
                <ViewPicker />
                <button onClick={() => setUI({ overlay: !overlay })}
                  aria-pressed={overlay}
                  title="Keep my order and my dragging, and label each row with where consensus would have him"
                  className={`ctl ${overlay ? "ctl-on" : ""}`}>
                  Consensus overlay
                </button>

                <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />

                <span className="label shrink-0 text-ink-ghost">Tag</span>
                {TAGS.map((t) => (
                  <button key={t.key} aria-pressed={tagFilter === t.key}
                    onClick={() => setTagFilter(tagFilter === t.key ? null : t.key)}
                    title={`Show only players tagged ${t.label} — press ${t.num} on a selected row to tag him`}
                    className={`ctl px-2 ${tagFilter === t.key ? t.cls : ""}`}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
                    <span className="hidden sm:inline">{t.label}</span>
                  </button>
                ))}

                <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />

                <div className="toolgroup">
                  <span className="label shrink-0 text-ink-faint">Tiers{posFilter ? ` · ${posFilter}` : ""}</span>
                  <span draggable onDragStart={(e) => onDragStart(e, "new", "newTier")}
                    title="Drag onto a player to drop a tier divider above him"
                    className="ctl hidden cursor-grab select-none bg-panel text-ink-muted hover:border-accent hover:text-accent active:cursor-grabbing md:inline-flex">
                    <Grip size={13} /><span className="hidden 2xl:inline">divider</span>
                  </span>
                  <button onClick={autoTiers} className="ctl ctl-quiet"
                    title={`Cut tiers on consensus gaps within ${posFilter || "the full board"}`}>Suggest</button>
                  {scopeBreaks.length > 0 && (
                    <button onClick={() => dispatch({ type: "SET_TIER_BREAKS", scope: tierScope, breaks: [] })}
                      title={`Remove the ${scopeBreaks.length} tier break${scopeBreaks.length > 1 ? "s" : ""} in ${posFilter || "the full board"} (other views keep theirs)`}
                      className="ctl ctl-quiet ctl-danger">Clear <span className="num">{scopeBreaks.length}</span></button>
                  )}
                </div>

                {overlay && (
                  <span className="ml-1 hidden shrink-0 text-[11px] text-ink-faint xl:inline">
                    <span className="num font-semibold text-accent">c#</span> is where the room would have him
                  </span>
                )}
            </div>
          )}
        </div>

        {visible.length === 0 ? (
          <EmptyBoard query={query} posFilter={posFilter} tagFilter={tagFilter}
            total={board.rows.length} onClear={clearFilters} />
        ) : (
        <>
        {/* -------- desktop table -------- */}
        {/* No overflow-x here: it would become a scroll container in both axes
            (overflow-x:auto forces overflow-y to auto), and the sticky thead
            would anchor to it instead of <main>, pinning below the top of the
            table and covering the first rows. Wide boards scroll on <main>. */}
        <div className="hidden md:block">
          <table className="w-full border-collapse text-sm">
            <thead ref={theadRef} className="sticky z-10" style={{ top: toolbarH }}>
              <tr>
                <th className={th}>#</th>
                <th className={th} title="Rank within position, in my order">Pos#</th>
                <th className={th}>Player</th>
                {shownSources.map((s) => (
                  <th key={s.id} className={`${thNum} max-w-[5.5rem]`}
                    title={`${s.name} · ${s.type.toUpperCase()} · imported ${new Date(s.date).toLocaleDateString()}${daysAgo(s.date) > 7 ? " · STALE" : ""}`}>
                    <span className="block truncate">{s.name}{daysAgo(s.date) > 7 && <span className="text-warn">*</span>}</span>
                  </th>
                ))}
                {/* Whatever width is spare goes to the last column, so the
                    slack lands as a right margin rather than as a gutter
                    between the name and its numbers. In draft day that last
                    column is Cons, and the difference is a screen's width. */}
                <th className={`${th} ${compact ? "w-full" : ""}`} aria-sort={sortKey === "consensus" ? "ascending" : "none"}>
                  {sortBtn("consensus", "Cons", consLabel)}
                </th>
                {!compact && <>
                  {sortTh("sigma", "σ", "Std-dev across all sources — market disagreement")}
                  {sortTh("yahooDelta", "Y vs mkt", "Yahoo ADP minus other-source mean. Negative: your room drafts him earlier.")}
                  {sortTh("adpDelta", "Me−ADP", "My rank minus Yahoo ADP. Negative: I'm higher than the room.")}
                  {sortTh("pts", board.hasProj ? "Proj" : "Pts≈", board.hasProj ? "From your projections source × your scoring" : "Approximate curve — import projections for real numbers")}
                  {sortTh("vor", "VOR", "Value over replacement given your roster settings")}
                  <th className={`${th} w-full`}>Trend</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const i = scopeOrder.indexOf(r.id);
                const tier = tierOfIndex(i, scopeBreaks);
                const header = showTiers && tier !== lastTier;
                if (header) lastTier = tier;
                const breakIdx = header ? scopeBreaks.find((b) => tierOfIndex(b, scopeBreaks) === tier) : undefined;
                const d = tierDepth(tier);
                const ps = posStyle(r.p.pos);
                const sel = selected === r.id;
                return (
                  <React.Fragment key={r.id}>
                    {header && (
                      <tr draggable={tier > 1}
                        onDragStart={(e) => onDragStart(e, breakIdx ?? 0, "tier")}
                        onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropRow(e, r.id)}
                        className="group cursor-grab select-none bg-band">
                        {/* A tier break is a cliff in value, so it reads as a
                            hard rule with the tier number set in the ink block
                            — the same weight the app gives an active tab. */}
                        <td colSpan={colCount}
                          className={`sticky z-[9] border-y border-b-line border-t-theme bg-band-tier px-2 ${d.band}`}
                          style={{ top: toolbarH + theadH, borderTopWidth: d.rule, backgroundColor: tierBand(d) }}>
                          <div className="flex items-center gap-2.5">
                            {/* -my-1 lets the block stand proud of its own band.
                                A mark that breaks the edge of the thing holding
                                it is the cheapest depth cue there is, and it
                                costs no height because the band closes around it. */}
                            <span style={{ opacity: d.ink }}
                              className={`num lean shrink-0 bg-theme font-bold tracking-[0.06em] text-theme-on ${d.block}`}>
                              <span>{String(tier).padStart(2, "0")}</span>
                            </span>
                            <input value={tierNames[tier] ?? ""} placeholder="Name this tier"
                              draggable={false} onDragStart={(e) => e.preventDefault()}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => dispatch({ type: "SET_TIER_NAME", scope: tierScope, tier, name: e.target.value })}
                              className={`italic-lean w-56 rounded-[--r-sm] border border-transparent bg-transparent px-1.5 py-0.5 font-bold normal-case tracking-[-0.015em] text-theme-ink placeholder:font-normal placeholder:text-theme-ink/45 hover:border-theme focus:border-theme focus:bg-panel focus:outline-none ${d.name}`} />
                            {breakIdx !== undefined && (
                              <button draggable={false} title="Pull this divider out (merges into the tier above)"
                                onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_TIER_BREAK", scope: tierScope, index: breakIdx }); }}
                                className="rounded p-1 text-ink-ghost opacity-0 transition hover:bg-band hover:text-behind focus:opacity-100 group-hover:opacity-100">
                                <Close size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr draggable={showTiers}
                      ref={sel ? selectedRowRef : null}
                      aria-selected={sel}
                      title={showTiers ? "Click to open · drag to re-rank · shift+↑↓ to nudge" : "Click to open"}
                      onDragStart={(e) => onDragStart(e, r.id, "player")}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDropRow(e, r.id)}
                      onClick={() => toggleExpand(r.id)}
                      onDoubleClick={() => setDetail(r.id)}
                      className={`board-row group/row cursor-pointer transition-colors ${
                        sel ? "bg-accent/[0.07]" : "hover:bg-band/50"}`}>
                      {/* My rank and consensus are the two numbers the whole
                          table exists to compare, so they get chip weight and
                          everything else stays plain. */}
                      <td className={`whitespace-nowrap px-2 ${rowPad}`}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="num lean bg-ink px-2 py-1 text-[13px] font-bold text-ink-invert"><span>{String(r.myRank).padStart(2, "0")}</span></span>
                          <ConsGap myRank={r.myRank} consensus={r.consensus} />
                          {showOverlay && consensusPos?.get(r.id) != null && (
                            <ConsPos my={myPos.get(r.id)} theirs={consensusPos.get(r.id)} />
                          )}
                          {/* Silent when the lens agrees with you: ConsGap next
                              door already prints "=" for its own zero, and two
                              of them side by side read as a rendering fault. */}
                          {!!lensMove(r) && (
                            <span title={`${lensMove(r) > 0 ? "This lens has him" : "You have him"} ${Math.abs(lensMove(r))} spots earlier`}
                              className={`text-[10px] ${lensMove(r) > 0 ? "text-ahead" : "text-behind"}`}>
                              <Caret dir={lensMove(r) > 0 ? "up" : "down"} size={7} />{Math.abs(lensMove(r))}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={`num whitespace-nowrap px-2 text-[11px] font-bold ${rowPad} ${ps.text}`}>{r.p.pos}{r.posRank}</td>
                      {/* The position used to be printed here as well as in
                          Pos# and in the colour rail — three sayings of the
                          same thing, and the one that cost the name its second
                          line. nowrap keeps it on one now that it fits. */}
                      <td className={`whitespace-nowrap px-2 ${rowPad}`}>
                        <div className="flex items-center">
                          <span className={`mr-2 h-5 w-[3px] shrink-0 rounded-full ${ps.rail}`} />
                          <span className="text-[14px] font-semibold leading-none tracking-[-0.01em]">{r.p.name}</span>
                          <span className="ml-2 text-[11px] text-ink-faint">{r.p.team || "FA"} · {r.p.bye ?? "?"}</span>
                          <InjuryBadge p={r.p} /><TagDots p={r.p} />
                          {r.p.handcuffOf && <span title={`Handcuff of ${state.players[r.p.handcuffOf]?.name}`} className="ml-1.5 text-pos-TE"><Link size={11} /></span>}
                          {r.p.notes && <span title={r.p.notes} className="ml-1.5 text-ink-faint"><Pencil size={11} /></span>}
                        </div>
                      </td>
                      {shownSources.map((s) => (
                        <td key={s.id} className={`${tdNum} text-ink-muted`}>{r.perSource[s.id] != null ? fmt(r.perSource[s.id], s.type === "adp" ? 1 : 0) : "–"}</td>
                      ))}
                      <td className={`whitespace-nowrap px-2 ${rowPad}`}>
                        <span className="inline-flex items-center gap-2">
                          <span className="num rounded-[--r-sm] border border-line bg-panel-raised px-2 py-0.5 text-[13px] font-semibold text-ink">{fmt(r.consensus, 1)}</span>
                          <RankBar compact myRank={r.myRank} consensus={r.consensus} sources={opinionsFor(r)} />
                        </span>
                      </td>
                      {!compact && <>
                        <td className={`${tdNum} ${r.sigma > 12 ? "text-warn" : "text-ink-muted"}`}>{fmt(r.sigma, 1)}</td>
                        <td className={tdNum}><Delta v={r.yahooDelta} invert /></td>
                        <td className={tdNum}><Delta v={r.adpDelta} d={0} /></td>
                        <td className={`${tdNum} text-ink-muted`}>{fmt(r.pts, 0)}</td>
                        <td className={`${tdNum} font-medium ${r.vor > 0 ? "text-ahead" : "text-ink-faint"}`}>{fmt(r.vor, 0)}</td>
                        <td className={`px-2 ${rowPad}`}><Trend move={r.move} p={r.p} trending={state.trending} /></td>
                      </>}
                    </tr>
                    {expanded === r.id && (
                      <tr>
                        <td colSpan={colCount} className="p-0">
                          <PlayerCard row={r} sources={barSources}
                            onOpenDetail={setDetail} onClose={() => setExpanded(null)} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <MoreRows hidden={hidden} total={visible.length}
            onMore={() => setLimit(limit + 200)} onAll={() => setLimit(visible.length)} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3 py-2.5 text-[11px] text-ink-ghost">
            <button onClick={() => setShortcuts(true)} className="ctl ctl-quiet">Keyboard <span className="num normal-case">?</span></button>
            <span>Drag a row to re-rank · drag the tier handle onto a player to cut a tier · double-click a row for situation, stats and news.</span>
            {!board.hasProj && !compact && (
              <span className="text-warn/80">Pts≈ is a generic curve — import projections for scoring-aware values.</span>
            )}
          </div>
        </div>

        {/* -------- mobile cards -------- */}
        <div className="md:hidden">
          {(() => { lastTier = 0; return null; })()}
          {shown.map((r) => {
            const i = scopeOrder.indexOf(r.id);
            const tier = tierOfIndex(i, scopeBreaks);
            const header = showTiers && tier !== lastTier;
            if (header) lastTier = tier;
            const breakIdx = header ? scopeBreaks.find((b) => tierOfIndex(b, scopeBreaks) === tier) : undefined;
            const d = tierDepth(tier);
            const ps = posStyle(r.p.pos);
            return (
              <React.Fragment key={r.id}>
                {header && (
                  <div className={`sticky z-10 border-y border-b-line border-t-theme bg-band-tier px-3 ${d.band}`}
                    style={{ top: toolbarH, borderTopWidth: d.rule, backgroundColor: tierBand(d) }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span style={{ opacity: d.ink }}
                          className={`num lean shrink-0 bg-theme font-bold tracking-[0.06em] text-theme-on ${d.block}`}>
                          <span>{String(tier).padStart(2, "0")}</span>
                        </span>
                        {tierNames[tier]
                          ? <span className={`italic-lean truncate font-bold tracking-[-0.015em] text-theme-ink ${d.name}`}>{tierNames[tier]}</span>
                          : <span className="label shrink-0 text-theme-ink/60">Tier</span>}
                      </span>
                      {breakIdx !== undefined && (
                        <button title="Delete this tier break"
                          onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_TIER_BREAK", scope: tierScope, index: breakIdx }); }}
                          className="-my-1 rounded px-2 py-1 text-ink-faint active:text-behind">
                          <Close size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {/* Phone rows. The nudge buttons were 28px of hit area on a
                    control you press repeatedly with a thumb while someone else
                    is on the clock; they are a full-height 44px column now, and
                    the derived numbers moved down to the second line so the
                    name has the width it needs at 375px. */}
                <div onTouchStart={(e) => onTouchStart(e, r.id)} onTouchEnd={(e) => onTouchEnd(e, r.id)}
                  onClick={() => toggleExpand(r.id)}
                  className={`board-row flex items-stretch gap-2.5 border-b border-line/40 pl-3 transition-colors active:bg-band/60 ${
                    selected === r.id ? "bg-accent/[0.07]" : ""}`}>
                  <span className={`my-2 w-[3px] shrink-0 rounded-full ${ps.rail}`} />
                  <div className="min-w-0 flex-1 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="num lean shrink-0 bg-ink px-2 py-1 text-[12px] font-bold text-ink-invert">
                        <span>{String(r.myRank).padStart(2, "0")}</span>
                      </span>
                      <span className="truncate text-[15px] font-semibold leading-tight">{r.p.name}</span>
                      <InjuryBadge p={r.p} /><TagDots p={r.p} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
                      <span className={`shrink-0 font-semibold ${ps.text}`}>{r.p.pos}{r.posRank}</span>
                      <span className="shrink-0">{r.p.team || "FA"} · bye {r.p.bye ?? "?"}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="num rounded-[--r-sm] border border-line px-1.5 py-0.5 font-semibold text-ink">{fmt(r.consensus, 0)}</span>
                        <RankBar compact width={44} myRank={r.myRank} consensus={r.consensus} sources={opinionsFor(r)} />
                        <ConsGap myRank={r.myRank} consensus={r.consensus} />
                      </span>
                      {showOverlay && consensusPos?.get(r.id) != null && (
                        <ConsPos my={myPos.get(r.id)} theirs={consensusPos.get(r.id)} />
                      )}
                      {!compact && <span className="shrink-0">σ {fmt(r.sigma, 0)}</span>}
                      {!compact && <span className={`shrink-0 tabular-nums ${r.vor > 0 ? "text-ahead" : "text-ink-ghost"}`}>VOR {fmt(r.vor, 0)}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col border-l border-line/50" onClick={(e) => e.stopPropagation()}>
                    <button aria-label={`Move ${r.p.name} up one`} onClick={() => dispatch({ type: "MOVE", id: r.id, delta: -1 })}
                      className="flex h-1/2 min-h-[34px] w-11 items-center justify-center text-ink-muted active:bg-band"><Caret dir="up" size={10} /></button>
                    <button aria-label={`Move ${r.p.name} down one`} onClick={() => dispatch({ type: "MOVE", id: r.id, delta: 1 })}
                      className="flex h-1/2 min-h-[34px] w-11 items-center justify-center border-t border-line/50 text-ink-muted active:bg-band"><Caret dir="down" size={10} /></button>
                  </div>
                </div>
                {expanded === r.id && (
                  <PlayerCard row={r} sources={barSources}
                    onOpenDetail={setDetail} onClose={() => setExpanded(null)} />
                )}
              </React.Fragment>
            );
          })}
          <MoreRows hidden={hidden} total={visible.length}
            onMore={() => setLimit(limit + 200)} onAll={() => setLimit(visible.length)} />
          <div className="px-3 py-2 text-[11px] text-ink-ghost">Swipe right → Favorite · swipe left → Avoid · tap a row to open it.</div>
        </div>
        </>
        )}
      </div>

      {shortcuts && <ShortcutsModal onClose={() => setShortcuts(false)} />}

      {/* detail: right drawer on desktop, bottom sheet on mobile */}
      {detail && (
        <>
          <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDetail(null)} />
          {/* Desktop: sticky + self-start so it holds its own screenful and
              scrolls internally while the list moves behind it. Mobile keeps
              the fixed bottom-sheet treatment. */}
          <div className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] rounded-t-2xl border-t border-line bg-ground md:sticky md:top-0 md:z-auto md:max-h-[var(--panelMax)] md:self-start md:w-[380px] md:shrink-0 md:overflow-y-auto md:rounded-none md:border-l md:border-t-0">
            <DetailPanel id={detail} onClose={() => setDetail(null)} />
          </div>
        </>
      )}
    </div>
  );
}
