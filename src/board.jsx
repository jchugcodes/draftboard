import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store.jsx";
import { computeBoard, suggestTierBreaks } from "./compute.js";
import { POS_STYLE, POSITIONS, TAGS, fmt, pct, daysAgo } from "./util.js";
import { newsRSSUrl, fetchRSSHeadlines } from "./fetchers.js";

const posStyle = (pos) => POS_STYLE[pos] || POS_STYLE.DST;

function tierOfIndex(i, breaks) {
  let t = 1;
  for (const b of breaks) if (i >= b) t++;
  return t;
}

const Delta = ({ v, invert = false, d = 1 }) => {
  if (v == null || Number.isNaN(v)) return <span className="text-slate-600">–</span>;
  const good = invert ? v > 0 : v < 0;
  const cls = Math.abs(v) < 0.5 ? "text-slate-400" : good ? "text-emerald-400" : "text-red-400";
  return <span className={cls}>{v > 0 ? "+" : ""}{fmt(v, d)}</span>;
};

const InjuryBadge = ({ p }) => {
  const inj = p.sleeper?.injury;
  if (!inj) return null;
  const short = { Questionable: "Q", Doubtful: "D", Out: "O", IR: "IR", PUP: "PUP", Sus: "SUS" }[inj] || inj.slice(0, 3);
  return <span className="ml-1 rounded bg-red-500/20 px-1 text-[10px] font-bold text-red-300">{short}</span>;
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
  if (!sid) return <span className="text-slate-700">–</span>;
  const add = trending.adds.find((x) => x.player_id === sid);
  const drop = trending.drops.find((x) => x.player_id === sid);
  if (!add && !drop) return <span className="text-slate-700">·</span>;
  return (
    <span className="tabular-nums text-xs">
      {add && <span className="text-emerald-400">▲{(add.count / 1000).toFixed(0)}k</span>}
      {add && drop && " "}
      {drop && <span className="text-red-400">▼{(drop.count / 1000).toFixed(0)}k</span>}
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
            className="rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-sky-300 hover:border-sky-500">
            {l.name} ↗
          </a>
        ))}
      </div>
      {proxy ? (
        <div>
          <button onClick={load} className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">
            {loading ? "Fetching…" : "Fetch headlines inline"}
          </button>
          {err && <div className="mt-1 text-xs text-red-400">Couldn't fetch through your proxy: {err}</div>}
          {headlines && (
            <ul className="mt-2 space-y-1">
              {headlines.map((h, i) => (
                <li key={i} className="text-xs leading-snug">
                  <a className="text-slate-200 hover:text-sky-300" href={h.link} target="_blank" rel="noopener noreferrer">{h.title}</a>
                  <span className="ml-1 text-slate-500">{h.date && new Date(h.date).toLocaleDateString()}</span>
                </li>
              ))}
              {!headlines.length && <li className="text-xs text-slate-500">No headlines returned.</li>}
            </ul>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-slate-500">Add a CORS proxy in Settings to render headlines inline. Links above open in a new tab.</div>
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
  const dot = (v) => (v >= 4 ? "bg-emerald-400" : v <= 2 ? "bg-red-400" : "bg-slate-500");
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Situation scorecard</div>
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          <input type="checkbox" checked={!!sc.projected}
            onChange={(e) => dispatch({ type: "SET_SCORECARD", id: p.id, patch: { projected: e.target.checked } })} />
          projected, not from completed-season data
        </label>
      </div>
      {sc.projected && (
        <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          Projected grades — rookie / new team / offseason guess. No current-year basis.
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {fields.map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-400">{label}</span>
            <span className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${dot(sc[key])}`} />
              <input type="range" min="1" max="5" value={sc[key] ?? 3} className="w-20 accent-sky-400"
                onChange={(e) => dispatch({ type: "SET_SCORECARD", id: p.id, patch: { [key]: +e.target.value } })} />
              <span className="w-3 text-right text-xs tabular-nums text-slate-300">{sc[key] ?? 3}</span>
            </span>
          </div>
        ))}
      </div>
      <input value={sc.note || ""} placeholder="Grade note (e.g. new OC, rookie — projected)"
        onChange={(e) => dispatch({ type: "SET_SCORECARD", id: p.id, patch: { note: e.target.value } })}
        className="mt-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs" />
    </div>
  );
}

// ---------------- advanced stats ----------------
function AdvStats({ p, season }) {
  const n = p.nfl;
  if (!n) return <div className="text-xs text-slate-500">No nflverse data linked. Fetch season stats from the Imports tab.</div>;
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
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {season} season · {n.games} games {n.team ? `· ${n.team}` : ""}
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1">
        {rows.map(([label, v, d]) => (
          <div key={label} className="flex items-baseline justify-between border-b border-slate-800 pb-0.5">
            <span className="text-[11px] text-slate-500">{label}</span>
            <span className="text-xs tabular-nums text-slate-200">{d === "pct" ? pct(v) : fmt(v, d)}</span>
          </div>
        ))}
      </div>
      {p.sleeper?.age != null && (
        <div className="mt-1.5 text-[11px] text-slate-500">
          Age {p.sleeper.age} · Yr {(p.sleeper.yearsExp ?? 0) + 1}
          {p.pos === "WR" && p.sleeper.yearsExp <= 2 && <span className="ml-1 text-purple-300">· inside the yr-1–3 WR breakout window</span>}
          {p.pos === "RB" && p.sleeper.age >= 27 && <span className="ml-1 text-amber-300">· RB age cliff territory</span>}
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
  const rows = (state.sources || [])
    .filter((s) => s.type !== "proj")
    .map((s) => ({ key: s.id, label: s.name, type: s.type, stale: daysAgo(s.date) > 7, v: s.map?.[p.id] ?? null }))
    .filter((r) => r.v != null)
    .sort((a, b) => a.v - b.v);

  if (!rows.length) {
    return (
      <div className="text-xs text-slate-500">
        No ranking sources cover this player yet. Fetch Sleeper or ESPN on the Imports tab.
      </div>
    );
  }

  const vals = rows.map((r) => r.v);
  const consensus = vals.reduce((a, b) => a + b, 0) / vals.length;
  const lo = Math.min(...vals, myRank);
  const hi = Math.max(...vals, myRank);
  const span = Math.max(1, hi - lo);
  const at = (v) => ((v - lo) / span) * 100;
  const spread = Math.max(...vals) - Math.min(...vals);

  const Row = ({ label, value, delta, tone, dot, title, stale }) => (
    <div className="flex items-center gap-2">
      <span className={`w-24 shrink-0 truncate text-[11px] ${tone}`} title={title || label}>
        {label}{stale && <span className="text-amber-400"> *</span>}
      </span>
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-slate-300">{fmt(value, 0)}</span>
      <div className="relative h-1.5 min-w-0 flex-1 rounded bg-slate-800">
        <span className={`absolute -top-[3px] h-2 w-2 -translate-x-1/2 rounded-full ${dot}`} style={{ left: `${at(value)}%` }} />
      </div>
      <span className={`w-9 shrink-0 text-right text-[11px] tabular-nums ${delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-slate-600"}`}>
        {delta == null ? "" : delta > 0 ? `+${fmt(delta, 0)}` : fmt(delta, 0)}
      </span>
    </div>
  );

  return (
    <div className="space-y-1">
      <Row label="My rank" value={myRank} delta={null} tone="font-semibold text-sky-300" dot="bg-sky-400 ring-2 ring-sky-400/30" />
      {rows.map((r) => (
        <Row key={r.key} label={r.label} value={r.v} delta={r.v - myRank} stale={r.stale}
          tone="text-slate-400" dot={r.type === "adp" ? "bg-violet-400" : "bg-slate-400"}
          title={`${r.label} · ${r.type.toUpperCase()}`} />
      ))}
      <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
        <span>consensus {fmt(consensus, 1)} · spread {fmt(spread, 0)} across {rows.length} source{rows.length > 1 ? "s" : ""}</span>
        <span className={myRank < consensus ? "text-rose-400" : myRank > consensus ? "text-emerald-400" : ""}>
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
    <div className="mt-1 text-[11px] text-slate-400">
      <span className="text-slate-500">{proj.name}:</span> {bits.join(" · ")}
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
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-800 bg-slate-950/95 p-3 backdrop-blur">
        <div>
          <div className="flex items-center gap-2">
            <span className={`rounded border px-1.5 py-0.5 text-xs font-bold ${ps.chip}`}>{p.pos}</span>
            <span className="text-base font-semibold">{p.name}</span>
            <InjuryBadge p={p} />
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            {p.team || "FA"} · bye {p.bye ?? "?"}
            {p.handcuffOf && state.players[p.handcuffOf] && <> · handcuff of {state.players[p.handcuffOf].name}</>}
          </div>
        </div>
        <button onClick={onClose} className="rounded p-1.5 text-slate-400 hover:bg-slate-800" aria-label="Close">✕</button>
      </div>
      <div className="space-y-4 p-3">
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map((t) => (
            <button key={t.key}
              onClick={() => dispatch({ type: "TOGGLE_TAG", id: p.id, tag: t.key })}
              className={`rounded-full border px-2.5 py-1 text-xs ${p.tags.includes(t.key) ? t.cls : "border-slate-700 text-slate-500 hover:border-slate-500"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <textarea value={p.notes} placeholder="Notes…" rows={3}
          onChange={(e) => dispatch({ type: "SET_NOTES", id: p.id, notes: e.target.value })}
          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-400">
            Handcuff of
            <select value={p.handcuffOf || ""} onChange={(e) => dispatch({ type: "SET_HANDCUFF", id: p.id, starterId: e.target.value || null })}
              className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-200">
              <option value="">— none —</option>
              {starterOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Bye week
            <input type="number" min="1" max="18" value={p.bye ?? ""} placeholder="?"
              onChange={(e) => dispatch({ type: "SET_BYE", id: p.id, bye: e.target.value === "" ? null : +e.target.value })}
              className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs text-slate-200" />
          </label>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Where the sites have him</div>
          <SourceCompare p={p} />
          <ProjLine p={p} />
        </div>
        <Scorecard p={p} />
        <AdvStats p={p} season={state.nflSeason} />
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">News</div>
          <NewsPanel p={p} />
        </div>
      </div>
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

  const visible = useMemo(() => {
    let rows = board.rows;
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.p.name.toLowerCase().includes(q) || (r.p.team || "").toLowerCase().includes(q));
    if (posFilter) rows = rows.filter((r) => r.p.pos === posFilter);
    if (tagFilter) rows = rows.filter((r) => r.p.tags.includes(tagFilter));
    if (sortKey !== "my") {
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

  if (!board.rows.length) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <div className="text-4xl">📋</div>
        <h2 className="mt-3 text-lg font-semibold">Your board is empty</h2>
        <p className="mt-2 text-sm text-slate-400">
          Import a rankings source, an ADP export, or paste a list from the Imports tab to seed players.
        </p>
        <button onClick={() => dispatch({ type: "SET_TAB", tab: "imports" })}
          className="mt-4 rounded bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500">Go to Imports</button>
      </div>
    );
  }

  const sourceCols = [...board.rankSources, ...board.adpSources];
  const th = "px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap";
  const sortBtn = (key, label, title) => (
    <button title={title} onClick={() => setSortKey(sortKey === key ? "my" : key)}
      className={sortKey === key ? "text-sky-300" : "hover:text-slate-200"}>{label}{sortKey === key ? " ↓" : ""}</button>
  );

  let lastTier = 0;

  // min-h-full, not h-full: a sticky child can only travel inside its
  // containing block, so capping this at one viewport would unstick the
  // toolbar partway down the list. min-h- lets it grow with the content.
  return (
    <div ref={rootRef} className="flex min-h-full"
      style={{ "--panelMax": scrollportH ? `${scrollportH}px` : "100dvh" }}>
      <div className="min-w-0 flex-1">
        {/* toolbar */}
        <div ref={toolbarRef} className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-2 py-2 backdrop-blur md:px-3">
          {staleSources.length > 0 && (
            <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
              ⚠ {staleSources.map((s) => s.name).join(", ")} {staleSources.length > 1 ? "are" : "is"} more than 7 days old — re-import before drafting.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search  ( / )" className="w-36 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm md:w-48" />
            {POSITIONS.map((pos) => (
              <button key={pos} onClick={() => setPosFilter(posFilter === pos ? null : pos)}
                className={`rounded border px-2 py-0.5 text-xs font-bold ${posFilter === pos ? posStyle(pos).chip : "border-slate-800 text-slate-500 hover:border-slate-600"}`}>
                {pos}
              </button>
            ))}
            <span className="mx-1 hidden h-4 w-px bg-slate-800 md:block" />
            {TAGS.map((t) => (
              <button key={t.key} onClick={() => setTagFilter(tagFilter === t.key ? null : t.key)}
                className={`hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] md:inline-flex ${tagFilter === t.key ? t.cls : "border-slate-800 text-slate-500 hover:border-slate-600"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />{t.label}
              </button>
            ))}
            <span className="grow" />
            <span draggable onDragStart={(e) => onDragStart(e, "new", "newTier")}
              title="Drag onto a player to drop a tier divider above him"
              className="hidden cursor-grab select-none items-center gap-1 rounded border border-dashed border-slate-600 px-2 py-1 text-xs text-slate-400 hover:border-sky-500 hover:text-sky-300 active:cursor-grabbing md:inline-flex">
              ⠿ drag divider
            </span>
            <button onClick={autoTiers} title={`Cut tiers on consensus gaps within ${posFilter || "the full board"}`}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-sky-500">
              Suggest {posFilter ? `${posFilter} ` : ""}tiers
            </button>
            {scopeBreaks.length > 0 && (
              <button onClick={() => dispatch({ type: "SET_TIER_BREAKS", scope: tierScope, breaks: [] })}
                title={`Remove the ${scopeBreaks.length} tier break${scopeBreaks.length > 1 ? "s" : ""} in ${posFilter || "the full board"} (other views keep theirs)`}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-rose-500 hover:text-rose-300">
                Clear {posFilter ? `${posFilter} ` : ""}tiers
              </button>
            )}
            <button onClick={startFromConsensus} title="Reorder my ranks to consensus"
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-sky-500">→ consensus order</button>
          </div>
          {sortKey !== "my" && (
            <div className="mt-1 text-[11px] text-slate-500">Sorted by column — drag &amp; tiers paused. <button className="text-sky-400" onClick={() => setSortKey("my")}>Back to my order</button></div>
          )}
        </div>

        {/* -------- desktop table -------- */}
        {/* No overflow-x here: it would become a scroll container in both axes
            (overflow-x:auto forces overflow-y to auto), and the sticky thead
            would anchor to it instead of <main>, pinning below the top of the
            table and covering the first rows. Wide boards scroll on <main>. */}
        <div className="hidden md:block">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky z-10 bg-slate-950" style={{ top: toolbarH }}>
              <tr className="border-b border-slate-800">
                <th className={th}>#</th>
                <th className={th} title="Rank within position, in my order">Pos#</th>
                <th className={th}>Player</th>
                {sourceCols.map((s) => (
                  <th key={s.id} className={th} title={`${s.type.toUpperCase()} · imported ${new Date(s.date).toLocaleDateString()}${daysAgo(s.date) > 7 ? " · STALE" : ""}`}>
                    {s.name}{daysAgo(s.date) > 7 && <span className="text-amber-400">*</span>}
                  </th>
                ))}
                <th className={th}>{sortBtn("consensus", "Cons", "Mean of rankings sources")}</th>
                <th className={th}>{sortBtn("sigma", "σ", "Std-dev across all sources — market disagreement")}</th>
                <th className={th}>{sortBtn("yahooDelta", "Y vs mkt", "Yahoo ADP minus other-source mean. Negative: your room drafts him earlier.")}</th>
                <th className={th}>{sortBtn("adpDelta", "Me−ADP", "My rank minus Yahoo ADP. Negative: I'm higher than the room.")}</th>
                <th className={th}>{sortBtn("pts", board.hasProj ? "Proj" : "Pts≈", board.hasProj ? "From your projections source × your scoring" : "Approximate curve — import projections for real numbers")}</th>
                <th className={th}>{sortBtn("vor", "VOR", "Value over replacement given your roster settings")}</th>
                <th className={th}>Trend</th>
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
                        className="group cursor-grab select-none bg-slate-900/80">
                        <td colSpan={12 + sourceCols.length} className="border-y border-slate-700/60 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0">⠿ Tier {tier}</span>
                            <input value={tierNames[tier] ?? ""} placeholder="name this tier"
                              draggable={false} onDragStart={(e) => e.preventDefault()}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => dispatch({ type: "SET_TIER_NAME", scope: tierScope, tier, name: e.target.value })}
                              className="w-48 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-slate-200 placeholder:font-normal placeholder:text-slate-600 hover:border-slate-700 focus:border-sky-600 focus:bg-slate-950 focus:outline-none" />
                            {breakIdx !== undefined && (
                              <button draggable={false} title="Pull this divider out (merges into the tier above)"
                                onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_TIER_BREAK", scope: tierScope, index: breakIdx }); }}
                                className="rounded px-1 leading-none text-slate-600 opacity-0 transition hover:bg-slate-800 hover:text-rose-300 focus:opacity-100 group-hover:opacity-100">
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
                      className={`cursor-pointer border-b border-slate-800/60 hover:bg-slate-900 ${sel ? "bg-sky-500/10 ring-1 ring-inset ring-sky-500/40" : ""}`}>
                      <td className="px-2 py-1 tabular-nums text-slate-500">{r.myRank}</td>
                      <td className={`px-2 py-1 whitespace-nowrap tabular-nums text-[11px] font-medium ${ps.text}`}>{r.p.pos}{r.posRank}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center">
                          <span className={`mr-2 h-4 w-1 rounded-sm ${ps.rail}`} />
                          <span className="font-medium">{r.p.name}</span>
                          <span className={`ml-1.5 text-[11px] font-bold ${ps.text}`}>{r.p.pos}</span>
                          <span className="ml-1 text-[11px] text-slate-500">{r.p.team || "FA"} · {r.p.bye ?? "?"}</span>
                          <InjuryBadge p={r.p} /><TagDots p={r.p} />
                          {r.p.handcuffOf && <span title={`Handcuff of ${state.players[r.p.handcuffOf]?.name}`} className="ml-1 text-[10px] text-orange-300">⛓</span>}
                          {r.p.notes && <span title={r.p.notes} className="ml-1 text-[10px] text-slate-500">✎</span>}
                        </div>
                      </td>
                      {sourceCols.map((s) => (
                        <td key={s.id} className="px-2 py-1 tabular-nums text-slate-400">{r.perSource[s.id] != null ? fmt(r.perSource[s.id], s.type === "adp" ? 1 : 0) : "–"}</td>
                      ))}
                      <td className="px-2 py-1 tabular-nums">{fmt(r.consensus, 1)}</td>
                      <td className={`px-2 py-1 tabular-nums ${r.sigma > 12 ? "text-fuchsia-300" : "text-slate-400"}`}>{fmt(r.sigma, 1)}</td>
                      <td className="px-2 py-1 tabular-nums"><Delta v={r.yahooDelta} invert /></td>
                      <td className="px-2 py-1 tabular-nums"><Delta v={r.adpDelta} d={0} /></td>
                      <td className="px-2 py-1 tabular-nums text-slate-300">{fmt(r.pts, 0)}</td>
                      <td className={`px-2 py-1 tabular-nums font-medium ${r.vor > 0 ? "text-emerald-300" : "text-slate-500"}`}>{fmt(r.vor, 0)}</td>
                      <td className="px-2 py-1"><Trend p={r.p} trending={state.trending} /></td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <div className="px-3 py-2 text-[11px] text-slate-600">
            Keys: ↑↓ move selection · shift+↑↓ or [ ] re-rank · / search · 1–5 tags · t add/remove a tier break above the selected row · enter detail. Drag rows to reorder; drag ⠿ tier bars to move a cliff; ✕ on a tier bar deletes it.
            {!board.hasProj && " Pts≈ uses a generic curve — import a projections CSV for scoring-aware values."}
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
                  <div className="sticky z-10 border-y border-slate-700/60 bg-slate-900 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-400" style={{ top: toolbarH }}>
                    <div className="flex items-center justify-between">
                      <span className="truncate">Tier {tier}{tierNames[tier] ? ` · ${tierNames[tier]}` : ""}</span>
                      {breakIdx !== undefined && (
                        <button title="Delete this tier break"
                          onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_TIER_BREAK", scope: tierScope, index: breakIdx }); }}
                          className="-my-1 rounded px-2 py-1 text-slate-500 active:text-rose-300">
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div onTouchStart={(e) => onTouchStart(e, r.id)} onTouchEnd={(e) => onTouchEnd(e, r.id)}
                  onClick={() => setDetail(r.id)}
                  className="flex items-center gap-2 border-b border-slate-800/70 px-3 py-2.5 active:bg-slate-900">
                  <span className="w-6 text-right text-sm tabular-nums text-slate-500">{r.myRank}</span>
                  <span className={`h-8 w-1 rounded-sm ${ps.rail}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center truncate">
                      <span className="truncate font-medium">{r.p.name}</span>
                      <InjuryBadge p={r.p} /><TagDots p={r.p} />
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {r.p.pos}{r.posRank} · {r.p.team || "FA"} · bye {r.p.bye ?? "?"} · cons {fmt(r.consensus, 0)} · σ {fmt(r.sigma, 0)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs tabular-nums"><Delta v={r.adpDelta} d={0} /></div>
                    <div className={`text-[11px] tabular-nums ${r.vor > 0 ? "text-emerald-300" : "text-slate-600"}`}>VOR {fmt(r.vor, 0)}</div>
                  </div>
                  <div className="flex flex-col gap-1 pl-1" onClick={(e) => e.stopPropagation()}>
                    <button className="rounded bg-slate-800 px-2 py-1 text-xs" onClick={() => dispatch({ type: "MOVE", id: r.id, delta: -1 })}>▲</button>
                    <button className="rounded bg-slate-800 px-2 py-1 text-xs" onClick={() => dispatch({ type: "MOVE", id: r.id, delta: 1 })}>▼</button>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          <div className="px-3 py-2 text-[11px] text-slate-600">Swipe right → Favorite · swipe left → Avoid · tap for detail.</div>
        </div>
      </div>

      {/* detail: right drawer on desktop, bottom sheet on mobile */}
      {detail && (
        <>
          <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDetail(null)} />
          {/* Desktop: sticky + self-start so it holds its own screenful and
              scrolls internally while the list moves behind it. Mobile keeps
              the fixed bottom-sheet treatment. */}
          <div className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] rounded-t-2xl border-t border-slate-700 bg-slate-950 md:sticky md:top-0 md:z-auto md:max-h-[var(--panelMax)] md:self-start md:w-[380px] md:shrink-0 md:overflow-y-auto md:rounded-none md:border-l md:border-t-0">
            <DetailPanel id={detail} onClose={() => setDetail(null)} />
          </div>
        </>
      )}
    </div>
  );
}
