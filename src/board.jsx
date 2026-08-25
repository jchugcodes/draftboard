import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store.jsx";
import { computeBoard, suggestTierBreaks } from "./compute.js";
import { POS_STYLE, POSITIONS, TAGS, fmt, pct, daysAgo, sourceFreshness } from "./util.js";
import RankBar from "./rankbar.jsx";
import { useDataSync } from "./useDataSync.js";
import { newsRSSUrl, fetchRSSHeadlines } from "./fetchers.js";
import Onboard from "./onboard.jsx";

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
  return <span title={title} className={`num taper border px-1.5 py-px text-[10px] font-semibold ${cls}`}>c{theirs}</span>;
};

const InjuryBadge = ({ p }) => {
  const inj = p.sleeper?.injury;
  if (!inj) return null;
  const short = { Questionable: "Q", Doubtful: "D", Out: "O", IR: "IR", PUP: "PUP", Sus: "SUS" }[inj] || inj.slice(0, 3);
  return <span className="taper ml-1.5 bg-behind px-1 text-[9px] font-bold uppercase tracking-label text-ink-invert">{short}</span>;
};

const TagDots = ({ p }) => (
  <span className="ml-1 inline-flex gap-0.5 align-middle">
    {TAGS.filter((t) => p.tags.includes(t.key)).map((t) => (
      <span key={t.key} title={t.label} className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
    ))}
  </span>
);

function Trend({ p, trending }) {
  const sid = p.sleeper?.sleeperId;
  if (!sid) return <span className="text-ink-ghost">–</span>;
  const add = trending.adds.find((x) => x.player_id === sid);
  const drop = trending.drops.find((x) => x.player_id === sid);
  if (!add && !drop) return <span className="text-ink-ghost">·</span>;
  return (
    <span className="tabular-nums text-xs">
      {add && <span className="text-ahead">▲{(add.count / 1000).toFixed(0)}k</span>}
      {add && drop && " "}
      {drop && <span className="text-behind">▼{(drop.count / 1000).toFixed(0)}k</span>}
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
            {l.name} ↗
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
        <button onClick={onClose} className="rounded p-1.5 text-ink-muted hover:bg-band" aria-label="Close">✕</button>
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

// ---------------- freshness ----------------
// A board is a snapshot of a market that moves daily, so the Board tab says out
// loud how old the snapshot is and offers the refresh in the same breath. This
// is deliberately always present, not only when something has gone stale — "you
// pulled this an hour ago" is the state you most want confirmed before a pick.
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
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      <span className={`rounded-full border px-2 py-0.5 font-semibold ${tone}`}>{pill}</span>
      <span className="text-ink-muted">
        Consensus as of <span className="text-ink">{new Date(fresh.newest.date).toLocaleDateString()}</span>
        <span className="text-ink-ghost"> · {fresh.newest.name} · {state.sources.length} source{state.sources.length > 1 ? "s" : ""}</span>
      </span>
      <span className="grow" />
      {running && step && <span className="truncate text-ink-faint">{step.label}…</span>}
      {!running && msg && <span className="truncate text-ink-faint">{msg}</span>}
      <button onClick={() => refreshAll()} disabled={running}
        title="Re-pull every source the app can reach — the same run as Setup's one button"
        className="rounded border border-line px-2 py-0.5 text-ink-muted hover:border-accent hover:text-accent disabled:opacity-40">
        {running ? "Refreshing…" : "Refresh"}
      </button>
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

  const staleSources = state.sources.filter((s) => daysAgo(s.date) > 7);

  // Metadata for the inline rank bars, hoisted out of the row loop: the values
  // themselves already sit on each row as perSource.
  const barSources = useMemo(
    () => (state.sources || [])
      .filter((s) => s.type !== "proj")
      .map((s) => ({ key: s.id, label: s.name, type: s.type, stale: daysAgo(s.date) > 7 })),
    [state.sources]
  );
  const opinionsFor = (r) => barSources
    .map((s) => ({ ...s, value: r.perSource[s.key] ?? null }))
    .filter((o) => o.value != null)
    .sort((a, b) => a.value - b.value);

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
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      const idx = visible.findIndex((r) => r.id === selected);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        if (e.shiftKey && selected && showTiers) dispatch({ type: "MOVE", id: selected, delta: 1 });
        else setSelected(visible[Math.min(visible.length - 1, idx + 1)]?.id ?? visible[0]?.id);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        if (e.shiftKey && selected && showTiers) dispatch({ type: "MOVE", id: selected, delta: -1 });
        else setSelected(visible[Math.max(0, idx - 1)]?.id ?? visible[0]?.id);
      } else if (e.key === "]" && selected && showTiers) dispatch({ type: "MOVE", id: selected, delta: 1 });
      else if (e.key === "[" && selected && showTiers) dispatch({ type: "MOVE", id: selected, delta: -1 });
      else if (e.key === "Enter" && selected) setDetail(selected);
      else if (e.key === "Escape") setDetail(null);
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
  }, [visible, selected, showTiers, state.myRanks, scopeOrder, tierScope, dispatch]);

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
  const th = "label whitespace-nowrap px-2 py-2 text-left text-ink-faint";
  const sortBtn = (key, label, title) => (
    <button title={title} onClick={() => setSortKey(sortKey === key ? "my" : key)}
      className={sortKey === key ? "text-accent" : "hover:text-ink"}>{label}{sortKey === key ? " ↓" : ""}</button>
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
    <div ref={rootRef} className="flex min-h-full"
      style={{ "--panelMax": scrollportH ? `${scrollportH}px` : "100dvh" }}>
      <div className="min-w-0 flex-1">
        {/* toolbar */}
        <div ref={toolbarRef} className="sticky top-0 z-20 border-b border-line bg-ground/95 px-2 py-2 backdrop-blur md:px-3">
          <FreshnessStrip />
          {staleSources.length > 0 && (
            <div className="mb-2 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">
              ⚠ {staleSources.map((s) => s.name).join(", ")} {staleSources.length > 1 ? "are" : "is"} more than 7 days old — re-import before drafting.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search  ( / )" className="w-36 border border-line bg-panel px-2.5 py-1.5 text-[13px] placeholder:text-ink-ghost md:w-48" />
            {POSITIONS.map((pos) => (
              <button key={pos} onClick={() => setPosFilter(posFilter === pos ? null : pos)}
                className={`taper border px-2.5 py-1 text-[10px] font-bold uppercase tracking-label transition-colors ${posFilter === pos ? posStyle(pos).chip : "border-line text-ink-faint hover:border-ink hover:text-ink"}`}>
                {pos}
              </button>
            ))}
            <span className="mx-1 hidden h-4 w-px bg-band md:block" />
            {TAGS.map((t) => (
              <button key={t.key} onClick={() => setTagFilter(tagFilter === t.key ? null : t.key)}
                className={`hidden items-center gap-1.5 border px-2 py-1 text-[10px] font-semibold uppercase tracking-label transition-colors md:inline-flex ${tagFilter === t.key ? t.cls : "border-line text-ink-faint hover:border-ink hover:text-ink"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />{t.label}
              </button>
            ))}
            <span className="grow" />
            <label className="flex items-center gap-1.5">
              <span className="label text-ink-faint">View</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
                className="border border-line bg-panel px-2 py-1 text-[11px] text-ink">
                <option value="my">My order</option>
                <option value="consensus">Consensus</option>
                {sourceCols.map((s) => <option key={s.id} value={`src:${s.id}`}>{s.name}</option>)}
              </select>
            </label>
            {/* Not part of the View lens on purpose: the lens replaces the sort,
                this leaves my order alone and writes the room's opinion beside it. */}
            <button onClick={() => setUI({ overlay: !overlay })}
              title="Keep my order and my dragging, and label each row with where consensus would have him"
              className={`taper border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-label transition-colors ${overlay ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-muted hover:border-ink hover:text-ink"}`}>
              {overlay ? "✓ " : ""}Consensus overlay
            </button>
            <div className="flex overflow-hidden border border-line">
              {[["full", "Full"], ["compact", "Draft day"]].map(([k, label]) => (
                <button key={k} onClick={() => setUI({ density: k })}
                  title={k === "compact"
                    ? "Rank, position, player, consensus. Everything analytical folds away for while picks are flying."
                    : "Every source column and every derived metric — the prep view."}
                  className={`px-2 py-1 ${state.ui.density === k ? "bg-band font-medium text-ink" : "text-ink-muted hover:text-ink"}`}>
                  {label}
                </button>
              ))}
            </div>
            <span draggable onDragStart={(e) => onDragStart(e, "new", "newTier")}
              title="Drag onto a player to drop a tier divider above him"
              className="hidden cursor-grab select-none items-center gap-1 rounded border border-dashed border-line-strong px-2 py-1 text-xs text-ink-muted hover:border-accent hover:text-accent active:cursor-grabbing md:inline-flex">
              ⠿ drag divider
            </span>
            <button onClick={autoTiers} title={`Cut tiers on consensus gaps within ${posFilter || "the full board"}`}
              className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-accent">
              Suggest {posFilter ? `${posFilter} ` : ""}tiers
            </button>
            {scopeBreaks.length > 0 && (
              <button onClick={() => dispatch({ type: "SET_TIER_BREAKS", scope: tierScope, breaks: [] })}
                title={`Remove the ${scopeBreaks.length} tier break${scopeBreaks.length > 1 ? "s" : ""} in ${posFilter || "the full board"} (other views keep theirs)`}
                className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-behind hover:text-behind">
                Clear {posFilter ? `${posFilter} ` : ""}tiers
              </button>
            )}
            <button onClick={startFromConsensus} title="Reorder my ranks to consensus"
              className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-accent">→ consensus order</button>
          </div>
          {sortKey !== "my" && (
            <div className="mt-1 text-[11px] text-ink-muted">
              Viewing through <span className="text-accent">{lensName}</span> — ▲▼ shows how far each player moves from your order.
              Dragging and tiers are paused{overlay ? ", and the overlay badge is off while a lens is doing the same job" : ""}.
              {" "}<button className="text-accent" onClick={() => setSortKey("my")}>Back to my order</button>
            </div>
          )}
          {showOverlay && (
            <div className="mt-1 text-[11px] text-ink-muted">
              Your order, your tiers, your dragging — <span className="text-accent">c#</span> on each row is where consensus
              would have him among these players instead. <button className="text-accent" onClick={() => setUI({ overlay: false })}>Hide overlay</button>
            </div>
          )}
        </div>

        {/* -------- desktop table -------- */}
        {/* No overflow-x here: it would become a scroll container in both axes
            (overflow-x:auto forces overflow-y to auto), and the sticky thead
            would anchor to it instead of <main>, pinning below the top of the
            table and covering the first rows. Wide boards scroll on <main>. */}
        <div className="hidden md:block">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky z-10 bg-ground" style={{ top: toolbarH }}>
              <tr className="border-b border-line">
                <th className={th}>#</th>
                <th className={th} title="Rank within position, in my order">Pos#</th>
                <th className={th}>Player</th>
                {shownSources.map((s) => (
                  <th key={s.id} className={th} title={`${s.type.toUpperCase()} · imported ${new Date(s.date).toLocaleDateString()}${daysAgo(s.date) > 7 ? " · STALE" : ""}`}>
                    {s.name}{daysAgo(s.date) > 7 && <span className="text-warn">*</span>}
                  </th>
                ))}
                <th className={th}>{sortBtn("consensus", "Cons", consLabel)}</th>
                {!compact && <>
                  <th className={th}>{sortBtn("sigma", "σ", "Std-dev across all sources — market disagreement")}</th>
                  <th className={th}>{sortBtn("yahooDelta", "Y vs mkt", "Yahoo ADP minus other-source mean. Negative: your room drafts him earlier.")}</th>
                  <th className={th}>{sortBtn("adpDelta", "Me−ADP", "My rank minus Yahoo ADP. Negative: I'm higher than the room.")}</th>
                  <th className={th}>{sortBtn("pts", board.hasProj ? "Proj" : "Pts≈", board.hasProj ? "From your projections source × your scoring" : "Approximate curve — import projections for real numbers")}</th>
                  <th className={th}>{sortBtn("vor", "VOR", "Value over replacement given your roster settings")}</th>
                  <th className={th}>Trend</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const i = scopeOrder.indexOf(r.id);
                const tier = tierOfIndex(i, scopeBreaks);
                const header = showTiers && tier !== lastTier;
                if (header) lastTier = tier;
                const breakIdx = header ? scopeBreaks.find((b) => tierOfIndex(b, scopeBreaks) === tier) : undefined;
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
                        <td colSpan={colCount} className="border-y border-line px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="num taper shrink-0 bg-ink px-2 py-0.5 text-[10px] font-bold tracking-label text-ink-invert">
                              {String(tier).padStart(2, "0")}
                            </span>
                            <span className="label shrink-0 text-ink-faint">Tier</span>
                            <input value={tierNames[tier] ?? ""} placeholder="name this tier"
                              draggable={false} onDragStart={(e) => e.preventDefault()}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => dispatch({ type: "SET_TIER_NAME", scope: tierScope, tier, name: e.target.value })}
                              className="w-48 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-ink placeholder:font-normal placeholder:text-ink-ghost hover:border-line focus:border-accent focus:bg-ground focus:outline-none" />
                            {breakIdx !== undefined && (
                              <button draggable={false} title="Pull this divider out (merges into the tier above)"
                                onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_TIER_BREAK", scope: tierScope, index: breakIdx }); }}
                                className="rounded px-1 leading-none text-ink-ghost opacity-0 transition hover:bg-band hover:text-behind focus:opacity-100 group-hover:opacity-100">
                                ✕
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr draggable={showTiers}
                      onDragStart={(e) => onDragStart(e, r.id, "player")}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDropRow(e, r.id)}
                      onClick={() => setSelected(r.id)}
                      onDoubleClick={() => setDetail(r.id)}
                      className={`cursor-pointer border-b border-line hover:bg-panel-raised ${sel ? "bg-accent/10 ring-1 ring-inset ring-accent/40" : ""}`}>
                      {/* My rank and consensus are the two numbers the whole
                          table exists to compare, so they get chip weight and
                          everything else stays plain. */}
                      <td className="px-2 py-1 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <span className="num taper bg-ink px-2 py-0.5 text-[13px] font-bold text-ink-invert">{String(r.myRank).padStart(2, "0")}</span>
                          <ConsGap myRank={r.myRank} consensus={r.consensus} />
                          {showOverlay && consensusPos?.get(r.id) != null && (
                            <ConsPos my={myPos.get(r.id)} theirs={consensusPos.get(r.id)} />
                          )}
                          {lensMove(r) != null && (
                            <span className={`text-[10px] ${lensMove(r) > 0 ? "text-ahead" : lensMove(r) < 0 ? "text-behind" : "text-ink-ghost"}`}>
                              {lensMove(r) > 0 ? `▲${lensMove(r)}` : lensMove(r) < 0 ? `▼${-lensMove(r)}` : "="}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={`num whitespace-nowrap px-2 py-1 text-[11px] font-semibold ${ps.text}`}>{r.p.pos}{r.posRank}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center">
                          <span className={`mr-2 h-4 w-1 rounded-sm ${ps.rail}`} />
                          <span className="text-[13px] font-semibold tracking-tight">{r.p.name}</span>
                          <span className={`ml-1.5 text-[11px] font-bold ${ps.text}`}>{r.p.pos}</span>
                          <span className="ml-1 text-[11px] text-ink-faint">{r.p.team || "FA"} · {r.p.bye ?? "?"}</span>
                          <InjuryBadge p={r.p} /><TagDots p={r.p} />
                          {r.p.handcuffOf && <span title={`Handcuff of ${state.players[r.p.handcuffOf]?.name}`} className="ml-1 text-[10px] text-pos-TE">⛓</span>}
                          {r.p.notes && <span title={r.p.notes} className="ml-1 text-[10px] text-ink-faint">✎</span>}
                        </div>
                      </td>
                      {shownSources.map((s) => (
                        <td key={s.id} className="px-2 py-1 tabular-nums text-ink-muted">{r.perSource[s.id] != null ? fmt(r.perSource[s.id], s.type === "adp" ? 1 : 0) : "–"}</td>
                      ))}
                      <td className="px-2 py-1 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="num taper border border-line bg-panel px-2 py-0.5 text-[13px] font-semibold text-ink">{fmt(r.consensus, 1)}</span>
                          <RankBar compact myRank={r.myRank} consensus={r.consensus} sources={opinionsFor(r)} />
                        </span>
                      </td>
                      {!compact && <>
                        <td className={`px-2 py-1 tabular-nums ${r.sigma > 12 ? "text-warn" : "text-ink-muted"}`}>{fmt(r.sigma, 1)}</td>
                        <td className="px-2 py-1 tabular-nums"><Delta v={r.yahooDelta} invert /></td>
                        <td className="px-2 py-1 tabular-nums"><Delta v={r.adpDelta} d={0} /></td>
                        <td className="px-2 py-1 tabular-nums text-ink-muted">{fmt(r.pts, 0)}</td>
                        <td className={`px-2 py-1 tabular-nums font-medium ${r.vor > 0 ? "text-ahead" : "text-ink-faint"}`}>{fmt(r.vor, 0)}</td>
                        <td className="px-2 py-1"><Trend p={r.p} trending={state.trending} /></td>
                      </>}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <div className="px-3 py-2 text-[11px] text-ink-ghost">
            Keys: ↑↓ move selection · shift+↑↓ or [ ] re-rank · / search · 1–5 tags · t add/remove a tier break above the selected row · enter detail. Drag rows to reorder; drag ⠿ tier bars to move a cliff; ✕ on a tier bar deletes it.
            {" The bar in Cons puts every source on one scale: the grey band is where they cluster, the pale tick is the Cons value, the blue tick is you."}
            {!board.hasProj && !compact && " Pts≈ uses a generic curve — import a projections CSV for scoring-aware values."}
          </div>
        </div>

        {/* -------- mobile cards -------- */}
        <div className="md:hidden">
          {(() => { lastTier = 0; return null; })()}
          {visible.map((r) => {
            const i = scopeOrder.indexOf(r.id);
            const tier = tierOfIndex(i, scopeBreaks);
            const header = showTiers && tier !== lastTier;
            if (header) lastTier = tier;
            const breakIdx = header ? scopeBreaks.find((b) => tierOfIndex(b, scopeBreaks) === tier) : undefined;
            const ps = posStyle(r.p.pos);
            return (
              <React.Fragment key={r.id}>
                {header && (
                  <div className="sticky z-10 border-y border-line bg-band px-3 py-1.5" style={{ top: toolbarH }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="num taper shrink-0 bg-ink px-2 py-0.5 text-[10px] font-bold tracking-label text-ink-invert">
                          {String(tier).padStart(2, "0")}
                        </span>
                        <span className="label shrink-0 text-ink-faint">Tier</span>
                        {tierNames[tier] && <span className="truncate text-[11px] font-semibold text-ink">{tierNames[tier]}</span>}
                      </span>
                      {breakIdx !== undefined && (
                        <button title="Delete this tier break"
                          onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_TIER_BREAK", scope: tierScope, index: breakIdx }); }}
                          className="-my-1 rounded px-2 py-1 text-ink-faint active:text-behind">
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div onTouchStart={(e) => onTouchStart(e, r.id)} onTouchEnd={(e) => onTouchEnd(e, r.id)}
                  onClick={() => setDetail(r.id)}
                  className="flex items-center gap-2 border-b border-line px-3 py-2.5 active:bg-panel-raised">
                  <span className="flex w-9 shrink-0 flex-col items-end gap-0.5">
                    <span className="num taper bg-ink px-2 py-0.5 text-[13px] font-bold text-ink-invert">{String(r.myRank).padStart(2, "0")}</span>
                    <ConsGap myRank={r.myRank} consensus={r.consensus} />
                  </span>
                  <span className={`h-8 w-1 rounded-sm ${ps.rail}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center truncate">
                      <span className="truncate font-medium">{r.p.name}</span>
                      <InjuryBadge p={r.p} /><TagDots p={r.p} />
                      {showOverlay && consensusPos?.get(r.id) != null && (
                        <span className="ml-1 shrink-0"><ConsPos my={myPos.get(r.id)} theirs={consensusPos.get(r.id)} /></span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
                      <span className="shrink-0">{r.p.pos}{r.posRank} · {r.p.team || "FA"} · bye {r.p.bye ?? "?"}</span>
                      <span className="num taper border border-line px-1.5 py-0.5 font-semibold text-ink">{fmt(r.consensus, 0)}</span>
                      <RankBar compact width={44} myRank={r.myRank} consensus={r.consensus} sources={opinionsFor(r)} />
                      {!compact && <span className="shrink-0">σ {fmt(r.sigma, 0)}</span>}
                    </div>
                  </div>
                  {!compact && (
                    <div className="text-right">
                      <div className="text-xs tabular-nums"><Delta v={r.adpDelta} d={0} /></div>
                      <div className={`text-[11px] tabular-nums ${r.vor > 0 ? "text-ahead" : "text-ink-ghost"}`}>VOR {fmt(r.vor, 0)}</div>
                    </div>
                  )}
                  <div className="flex flex-col gap-1 pl-1" onClick={(e) => e.stopPropagation()}>
                    <button className="rounded bg-band px-2 py-1 text-xs" onClick={() => dispatch({ type: "MOVE", id: r.id, delta: -1 })}>▲</button>
                    <button className="rounded bg-band px-2 py-1 text-xs" onClick={() => dispatch({ type: "MOVE", id: r.id, delta: 1 })}>▼</button>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          <div className="px-3 py-2 text-[11px] text-ink-ghost">Swipe right → Favorite · swipe left → Avoid · tap for detail.</div>
        </div>
      </div>

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
