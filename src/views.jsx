import React, { useMemo, useRef, useState } from "react";
import { useStore, exportBoard, DEFAULT_NEWS_TEMPLATES } from "./store.jsx";
import { parseCSV, mapHeaders, parsePastedList, normTeam, NFL_TEAMS, TAGS, POS_STYLE, fmt, daysAgo, uid } from "./util.js";
import { computeBoard } from "./compute.js";
import { fetchSleeperPlayers, fetchSleeperTrending, nflverseURL, aggregateNflverse, computeVacated } from "./fetchers.js";

const card = "rounded-lg border border-slate-800 bg-slate-900/50 p-3 md:p-4";
const h2 = "text-sm font-semibold uppercase tracking-wide text-slate-300";
const btn = "rounded bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-40";
const btn2 = "rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-sky-500";
const input = "rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm";

// ---------------- IMPORTS ----------------
function rowsFromCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return null;
  const H = mapHeaders(rows[0]);
  if (H.name === undefined) return null;
  const statKeys = ["passYd", "passTD", "passInt", "rushYd", "rushTD", "rec", "recYd", "recTD", "fumbles", "firstDowns"];
  const hasStats = statKeys.some((k) => H[k] !== undefined);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = r[H.name]?.trim();
    if (!name) continue;
    const row = {
      name,
      team: H.team !== undefined ? normTeam(r[H.team]) : null,
      pos: H.pos !== undefined ? (r[H.pos] || "").toUpperCase().replace(/\d+/g, "").replace("DEF", "DST").trim() || null : null,
      bye: H.bye !== undefined && r[H.bye] !== "" ? parseInt(r[H.bye], 10) || null : null,
      rank: H.rank !== undefined ? parseFloat(r[H.rank]) : i,
    };
    if (Number.isNaN(row.rank)) row.rank = i;
    if (hasStats) {
      row.statLine = {};
      for (const k of statKeys) if (H[k] !== undefined) row.statLine[k] = parseFloat(r[H[k]]) || 0;
    }
    out.push(row);
  }
  return { rows: out, hasStats };
}

function rowsFromJSON(text) {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : data.players || data.rows || [];
  return arr.map((x, i) => ({
    name: x.name || x.player || x.full_name,
    team: normTeam(x.team || x.tm),
    pos: (x.pos || x.position || "").toUpperCase().replace(/\d+/g, "") || null,
    bye: x.bye ?? null,
    rank: x.rank ?? x.adp ?? x.overall ?? i + 1,
  })).filter((x) => x.name);
}

export function ImportsView() {
  const { state, dispatch } = useStore();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("ranks");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const fileRef = useRef(null);
  const board = useMemo(() => computeBoard(state), [state]);

  const preview = useMemo(() => {
    const t = text.trim();
    if (!t) return null;
    try {
      if (t.startsWith("[") || t.startsWith("{")) return { rows: rowsFromJSON(t), kind: "JSON" };
      const csv = rowsFromCSV(t);
      if (csv) return { rows: csv.rows, kind: csv.hasStats ? "CSV + stat projections" : "CSV" };
      return { rows: parsePastedList(t), kind: "pasted list" };
    } catch (e) { return { error: String(e.message || e) }; }
  }, [text]);

  const doImport = () => {
    if (!preview?.rows?.length) return;
    const effType = preview.kind.includes("projections") && type !== "proj" ? type : type;
    dispatch({ type: "IMPORT", name: name || `${type} ${new Date().toLocaleDateString()}`, srcType: effType, rows: preview.rows });
    setMsg(`Imported ${preview.rows.length} rows as "${name || type}".`);
    setText(""); setName("");
  };

  const loadFile = (f) => {
    const rd = new FileReader();
    rd.onload = () => setText(String(rd.result));
    rd.readAsText(f);
  };

  const syncSleeper = async () => {
    setBusy("sleeper");
    try {
      const meta = await fetchSleeperPlayers();
      dispatch({ type: "SLEEPER_META", meta });
      const [adds, drops] = await Promise.all([fetchSleeperTrending("add"), fetchSleeperTrending("drop")]);
      dispatch({ type: "TRENDING", adds, drops });
      setMsg("Sleeper metadata, injuries, and trending synced.");
    } catch (e) { setMsg("Sleeper sync failed: " + e.message); }
    setBusy(null);
  };

  const fetchStats = async (season) => {
    setBusy("nfl");
    try {
      const res = await fetch(nflverseURL(season));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const agg = aggregateNflverse(await res.text());
      dispatch({ type: "NFLVERSE", season, agg });
      if (state.sleeperMeta) dispatch({ type: "VACATED", vacated: computeVacated(agg, state.sleeperMeta) });
      setMsg(`nflverse ${season} stats loaded (${Object.keys(agg.players).length} players).`);
    } catch (e) {
      setMsg(`nflverse fetch failed (${e.message}). Download stats_player_week_${season}.csv from the nflverse-data GitHub release and load it below.`);
    }
    setBusy(null);
  };
  const loadStatsFile = (f, season) => {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const agg = aggregateNflverse(String(rd.result));
        dispatch({ type: "NFLVERSE", season, agg });
        if (state.sleeperMeta) dispatch({ type: "VACATED", vacated: computeVacated(agg, state.sleeperMeta) });
        setMsg(`Stats file loaded for ${season}.`);
      } catch (e) { setMsg("Stats file parse failed: " + e.message); }
    };
    rd.readAsText(f);
  };

  const loadSituation = (f) => {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(String(rd.result));
        if (data.app !== "draftboard-situation" || !data.teams) throw new Error("not a situation file");
        const n = Object.keys(data.teams).length;
        if (!n) throw new Error("no teams in file");
        dispatch({ type: "APPLY_SITUATION", teams: data.teams, meta: { statsSeason: data.statsSeason, scheduleSeason: data.scheduleSeason } });
        setMsg(`Situation ratings applied from ${n} teams (${data.statsSeason} data, SOS ${data.scheduleSeason}).`);
      } catch (e) { setMsg("Situation file failed: " + e.message); }
    };
    rd.readAsText(f);
  };

  const lastSeason = new Date().getFullYear() - 1;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 md:p-4">
      {msg && <div className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{msg}</div>}

      <MergeQueue />

      <section className={card}>
        <h2 className={h2}>Import rankings / ADP / projections</h2>
        <p className="mt-1 text-xs text-slate-500">
          CSV or JSON with name/team/pos/bye/rank columns, or paste an unformatted list ("1. Justin Jefferson MIN WR"). Each import becomes a named column. Name ADP sources by site — a source named "Yahoo" becomes the reference ADP.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
            <option value="ranks">Rankings source</option>
            <option value="adp">ADP source</option>
            <option value="proj">Stat projections</option>
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Source name (Yahoo, ESPN, Sleeper, FantasyPros, Underdog, NFFC…)" className={`${input} w-72`} />
          <button className={btn2} onClick={() => fileRef.current?.click()}>Load file…</button>
          <input ref={fileRef} type="file" accept=".csv,.json,.txt" hidden onChange={(e) => e.target.files[0] && loadFile(e.target.files[0])} />
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6}
          placeholder={"Paste CSV, JSON, or a plain list here…"}
          className="mt-2 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs" />
        <div className="mt-2 flex items-center gap-3">
          <button className={btn} disabled={!preview?.rows?.length} onClick={doImport}>
            Import{preview?.rows?.length ? ` ${preview.rows.length} rows` : ""}
          </button>
          {preview?.kind && <span className="text-xs text-slate-500">Detected: {preview.kind}</span>}
          {preview?.error && <span className="text-xs text-red-400">Parse error: {preview.error}</span>}
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>Sources on the board</h2>
        {!state.sources.length && <p className="mt-1 text-xs text-slate-500">Nothing imported yet.</p>}
        <ul className="mt-2 divide-y divide-slate-800">
          {state.sources.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${s.type === "adp" ? "bg-indigo-500/20 text-indigo-300" : s.type === "proj" ? "bg-emerald-500/20 text-emerald-300" : "bg-sky-500/20 text-sky-300"}`}>{s.type}</span>
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-slate-500">{Object.keys(s.map).length} players · {new Date(s.date).toLocaleDateString()}</span>
              {daysAgo(s.date) > 7 && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">STALE · {daysAgo(s.date)}d</span>}
              <span className="grow" />
              <button className="text-xs text-red-400 hover:underline" onClick={() => dispatch({ type: "DELETE_SOURCE", id: s.id })}>remove</button>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className={h2}>Live market data</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn2} onClick={syncSleeper} disabled={busy === "sleeper"}>
            {busy === "sleeper" ? "Syncing…" : "Sync Sleeper (injuries · trending · metadata)"}
          </button>
          {state.sleeperAt && <span className="text-xs text-slate-500">last {new Date(state.sleeperAt).toLocaleString()}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn2} onClick={() => fetchStats(lastSeason)} disabled={busy === "nfl"}>
            {busy === "nfl" ? "Loading…" : `Fetch nflverse ${lastSeason} player stats`}
          </button>
          <label className="text-xs text-slate-400">
            or load CSV: <input type="file" accept=".csv" className="text-xs" onChange={(e) => e.target.files[0] && loadStatsFile(e.target.files[0], lastSeason)} />
          </label>
          {state.nflSeason && <span className="text-xs text-emerald-400">✓ {state.nflSeason} loaded</span>}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Sleeper feeds injury status + trending adds/drops on the board. nflverse feeds the advanced-stats panel (target share, WOPR, aDOT, snap context) and vacated-opportunity math. Sync Sleeper first — vacated opportunity compares last-season teams against current rosters.
        </p>
      </section>

      <section className={card}>
        <h2 className={h2}>Situation scorecards</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-400">
            Load situation JSON: <input type="file" accept=".json" className="text-xs"
              onChange={(e) => e.target.files[0] && loadSituation(e.target.files[0])} />
          </label>
          {state.situation && (
            <span className="text-xs text-emerald-400">
              ✓ {state.situation.applied} players · {state.situation.statsSeason} data · SOS {state.situation.scheduleSeason}
            </span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Generate with <code className="text-slate-400">node fetch-situation.mjs</code>. Fills offense, QB, OL run/pass,
          pace, target competition, and both SOS fields for every player whose team is known. Coach/scheme is never
          auto-filled — it has no statistical basis. Existing grade notes are kept.
        </p>
        <p className="mt-1 text-[11px] text-amber-300/80">
          Team quality reflects the last completed season, so it cannot see coaching changes, roster moves, or a QB who
          switched teams. Only SOS is grounded in the upcoming schedule. Applying overwrites those seven sliders.
        </p>
      </section>

      <section className={card}>
        <h2 className={h2}>My rank order</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={btn2} onClick={() => {
            const ordered = board.rows.slice().sort((a, b) => (a.consensus ?? 1e9) - (b.consensus ?? 1e9)).map((r) => r.id);
            dispatch({ type: "SET_RANKS", ids: ordered });
          }}>Reset my order to consensus</button>
        </div>
      </section>
    </div>
  );
}

function MergeQueue() {
  const { state, dispatch } = useStore();
  if (!state.mergeQueue.length) return null;
  return (
    <section className={`${card} border-amber-500/40`}>
      <h2 className={h2}>Name matches to resolve · {state.mergeQueue.length}</h2>
      <p className="mt-1 text-xs text-slate-500">These imported names didn't confidently match an existing player. Merge into a match or create a new player.</p>
      <ul className="mt-2 divide-y divide-slate-800">
        {state.mergeQueue.slice(0, 25).map((q) => (
          <li key={q.qid} className="py-2">
            <div className="text-sm font-medium">{q.name} <span className="text-xs text-slate-500">{q.pos || "?"} · {q.team || "?"} · value {fmt(q.rank, 1)}</span></div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {q.candidates.map((c) => {
                const p = state.players[c.id];
                return p && (
                  <button key={c.id} onClick={() => dispatch({ type: "RESOLVE_MERGE", qid: q.qid, targetId: c.id })}
                    className="rounded border border-slate-700 px-2 py-1 text-xs hover:border-emerald-500">
                    ≈ {p.name} ({p.pos} {p.team || "?"}) · {(c.score * 100).toFixed(0)}%
                  </button>
                );
              })}
              <button onClick={() => dispatch({ type: "RESOLVE_MERGE", qid: q.qid, createNew: true })} className="rounded border border-slate-700 px-2 py-1 text-xs hover:border-sky-500">+ new player</button>
              <button onClick={() => dispatch({ type: "SKIP_MERGE", qid: q.qid })} className="rounded px-2 py-1 text-xs text-slate-500 hover:text-red-400">skip</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------- BYE COLLISIONS ----------------
export function ByesView() {
  const { state } = useStore();
  const favs = Object.values(state.players).filter((p) => p.tags.includes("favorite"));
  const weeks = [...new Set(favs.map((p) => p.bye).filter((b) => b != null))].sort((a, b) => a - b);
  const byWeek = {};
  for (const p of favs) if (p.bye != null) (byWeek[p.bye] ||= []).push(p);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 md:p-4">
      <section className={card}>
        <h2 className={h2}>Bye collisions across favorites</h2>
        <p className="mt-1 text-xs text-slate-500">Players tagged ★ Favorite, grouped by bye. Two-plus favorites at the same position on the same bye is a roster-construction problem before it's a draft-day one.</p>
        {!favs.length && <p className="mt-3 text-sm text-slate-500">Tag some favorites (key 1 on the board) to populate this view.</p>}
        <div className="mt-3 space-y-3">
          {weeks.map((w) => {
            const ps = byWeek[w];
            const posCount = {};
            ps.forEach((p) => (posCount[p.pos] = (posCount[p.pos] || 0) + 1));
            const collision = Object.values(posCount).some((c) => c >= 2);
            return (
              <div key={w} className={`rounded border p-2 ${collision ? "border-red-500/50 bg-red-500/5" : "border-slate-800"}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  Week {w} bye
                  {collision && <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300">POSITION COLLISION</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {ps.map((p) => (
                    <span key={p.id} className={`rounded border px-2 py-0.5 text-xs ${(POS_STYLE[p.pos] || POS_STYLE.DST).chip}`}>{p.name} · {p.pos}</span>
                  ))}
                </div>
              </div>
            );
          })}
          {favs.some((p) => p.bye == null) && (
            <div className="text-xs text-amber-300">
              No bye on file for: {favs.filter((p) => p.bye == null).map((p) => p.name).join(", ")}. Set team byes in Settings or import a source with a bye column.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------- VACATED ----------------
export function VacatedView() {
  const { state } = useStore();
  const v = state.vacated;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 md:p-4">
      <section className={card}>
        <h2 className={h2}>Vacated opportunity by team</h2>
        <p className="mt-1 text-xs text-slate-500">
          Last-season targets, carries, and TDs from players no longer on that roster (per current Sleeper metadata). Requires both a Sleeper sync and nflverse stats — Imports tab.
        </p>
        {!v && <p className="mt-3 text-sm text-slate-500">Not computed yet. Sync Sleeper, then fetch nflverse stats.</p>}
        {v && (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-2">Team</th><th className="py-1 pr-2">Targets</th><th className="py-1 pr-2">Carries</th><th className="py-1 pr-2">TDs</th><th className="py-1">Who left</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(v).sort((a, b) => b[1].targets - a[1].targets).map(([team, x]) => (
                <tr key={team} className="border-b border-slate-800/60 align-top">
                  <td className="py-1.5 pr-2 font-semibold">{team}</td>
                  <td className={`py-1.5 pr-2 tabular-nums ${x.targets >= 120 ? "text-emerald-300 font-medium" : ""}`}>{x.targets}</td>
                  <td className={`py-1.5 pr-2 tabular-nums ${x.carries >= 150 ? "text-emerald-300 font-medium" : ""}`}>{x.carries}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{x.tds}</td>
                  <td className="py-1.5 text-xs text-slate-500">{x.names.slice(0, 4).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ---------------- SETTINGS ----------------
export function SettingsView() {
  const { state, dispatch } = useStore();
  const r = state.settings.roster, sc = state.settings.scoring;
  const board = useMemo(() => computeBoard(state), [state]);
  const [byePaste, setByePaste] = useState("");
  const importRef = useRef(null);

  const numField = (obj, key, onChange, step = 1, w = "w-16") => (
    <label key={key} className="flex flex-col text-[11px] text-slate-400">
      {key}
      <input type="number" step={step} value={obj[key]} onChange={(e) => onChange({ [key]: parseFloat(e.target.value) || 0 })}
        className={`${input} ${w} mt-0.5 tabular-nums`} />
    </label>
  );

  const applyByePaste = () => {
    const map = {};
    byePaste.split(/\n+/).forEach((line) => {
      const m = line.trim().match(/^([A-Za-z]{2,3})\s*[,:\s]\s*(\d{1,2})$/);
      if (m) map[normTeam(m[1])] = parseInt(m[2], 10);
    });
    if (Object.keys(map).length) dispatch({ type: "SET_TEAM_BYES", map: { ...state.settings.byeWeeks, ...map } });
    setByePaste("");
  };

  const doExport = () => {
    const blob = new Blob([exportBoard(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `draftboard-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImportBoard = (f) => {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(String(rd.result));
        if (data.app !== "draftboard") throw new Error("Not a draftboard export");
        const { app, version, exported, ...rest } = data;
        dispatch({ type: "IMPORT_BOARD", state: rest });
      } catch (e) { alert("Import failed: " + e.message); }
    };
    rd.readAsText(f);
  };

  const setTemplate = (i, patch) => {
    const t = state.settings.newsTemplates.slice();
    t[i] = { ...t[i], ...patch };
    dispatch({ type: "SET_SETTINGS", patch: { newsTemplates: t } });
  };
  const [beatTeam, setBeatTeam] = useState("DET");
  const beats = state.settings.beatBlogs[beatTeam] || [];
  const setBeats = (arr) => dispatch({ type: "SET_SETTINGS", patch: { beatBlogs: { ...state.settings.beatBlogs, [beatTeam]: arr } } });

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 md:p-4">
      <section className={card}>
        <h2 className={h2}>League (Yahoo · manual entry)</h2>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          {numField(r, "teams", (p) => dispatch({ type: "SET_ROSTER", patch: p }))}
          {numField(r, "slot", (p) => dispatch({ type: "SET_ROSTER", patch: p }))}
          {["QB", "RB", "WR", "TE", "FLEX", "SFLEX", "K", "DST", "BN", "IR"].map((k) => numField(r, k, (p) => dispatch({ type: "SET_ROSTER", patch: p })))}
          <label className="flex flex-col text-[11px] text-slate-400">
            flex type
            <select value={r.flexType} onChange={(e) => dispatch({ type: "SET_ROSTER", patch: { flexType: e.target.value } })} className={`${input} mt-0.5`}>
              <option value="WRT">W/R/T</option><option value="WR/RB">W/R</option><option value="WR/TE">W/T</option>
            </select>
          </label>
        </div>
        <div className="mt-3 rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-400">
          <span className="font-semibold text-slate-300">Replacement level from these settings: </span>
          {Object.entries(board.replRank).filter(([p]) => board.replacement[p] > 0).map(([p, rk]) => (
            <span key={p} className="mr-3">{p}{rk} ≈ {fmt(board.replacement[p], 0)} pts</span>
          ))}
          <span className="text-slate-600">· VOR on the board is measured against these baselines{board.hasProj ? "" : " (approximate curve until you import projections)"}.</span>
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>Scoring (Yahoo defaults · half PPR)</h2>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          {Object.keys(sc).map((k) => numField(sc, k, (p) => dispatch({ type: "SET_SCORING", patch: p }), 0.05, "w-20"))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">These weights re-score any imported stat-projection source, which drives Proj and VOR. TE premium is added per TE reception on top of ppr.</p>
      </section>

      <section className={card}>
        <h2 className={h2}>Team bye weeks</h2>
        <p className="mt-1 text-xs text-slate-500">Paste "TEAM week" pairs (one per line, e.g. <code>DET 5</code>). Applied to every player on that team; imports with a bye column also fill this in.</p>
        <div className="mt-2 flex gap-2">
          <textarea value={byePaste} onChange={(e) => setByePaste(e.target.value)} rows={3} placeholder={"DET 5\nKC 10"} className="w-48 rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs" />
          <button className={btn2} onClick={applyByePaste}>Apply</button>
        </div>
        {Object.keys(state.settings.byeWeeks).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-slate-400">
            {Object.entries(state.settings.byeWeeks).map(([t, w]) => <span key={t} className="rounded bg-slate-800 px-1.5 py-0.5">{t} {w}</span>)}
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className={h2}>News source templates</h2>
        <p className="mt-1 text-xs text-slate-500">{"{name}"} and {"{team}"} are substituted per player. These render as link-outs on every player's news panel.</p>
        <div className="mt-2 space-y-1.5">
          {state.settings.newsTemplates.map((t, i) => (
            <div key={t.id} className="flex gap-2">
              <input value={t.name} onChange={(e) => setTemplate(i, { name: e.target.value })} className={`${input} w-40`} />
              <input value={t.url} onChange={(e) => setTemplate(i, { url: e.target.value })} className={`${input} flex-1 font-mono text-xs`} />
              <button className="text-xs text-red-400" onClick={() => dispatch({ type: "SET_SETTINGS", patch: { newsTemplates: state.settings.newsTemplates.filter((_, j) => j !== i) } })}>✕</button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button className={btn2} onClick={() => dispatch({ type: "SET_SETTINGS", patch: { newsTemplates: [...state.settings.newsTemplates, { id: uid(), name: "New source", url: "https://www.google.com/search?q=site:example.com+{name}" }] } })}>+ Add template</button>
          <button className={btn2} onClick={() => dispatch({ type: "SET_SETTINGS", patch: { newsTemplates: DEFAULT_NEWS_TEMPLATES } })}>Restore defaults</button>
        </div>
        <div className="mt-4">
          <div className="text-xs font-semibold text-slate-300">Local beat blogs per team</div>
          <div className="mt-1.5 flex items-center gap-2">
            <select value={beatTeam} onChange={(e) => setBeatTeam(e.target.value)} className={input}>
              {NFL_TEAMS.map((t) => <option key={t}>{t}</option>)}
            </select>
            <button className={btn2} onClick={() => setBeats([...beats, { name: "Beat blog", url: "https://www.google.com/search?q=site:example.com+{name}" }])}>+ Add for {beatTeam}</button>
          </div>
          <div className="mt-1.5 space-y-1.5">
            {beats.map((b, i) => (
              <div key={i} className="flex gap-2">
                <input value={b.name} onChange={(e) => setBeats(beats.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={`${input} w-40`} />
                <input value={b.url} onChange={(e) => setBeats(beats.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} className={`${input} flex-1 font-mono text-xs`} />
                <button className="text-xs text-red-400" onClick={() => setBeats(beats.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <label className="text-xs font-semibold text-slate-300">CORS proxy (optional)</label>
          <input value={state.settings.corsProxy} onChange={(e) => dispatch({ type: "SET_SETTINGS", patch: { corsProxy: e.target.value } })}
            placeholder="https://your-proxy.example/?url={url}   (or a prefix the RSS URL is appended to)"
            className={`${input} mt-1 w-full font-mono text-xs`} />
          <p className="mt-1 text-[11px] text-slate-500">If set, player news panels can fetch and render Google News RSS headlines inline. Empty = link-outs only.</p>
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>Move between devices</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={btn} onClick={doExport}>Export board JSON</button>
          <button className={btn2} onClick={() => importRef.current?.click()}>Import board JSON</button>
          <input ref={importRef} type="file" accept=".json" hidden onChange={(e) => e.target.files[0] && doImportBoard(e.target.files[0])} />
          <span className="grow" />
          <button className="rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
            onClick={() => confirm("Wipe everything — settings, sources, ranks, notes?") && dispatch({ type: "RESET" })}>Reset all data</button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Everything lives in this browser's storage — no server. Export before clearing site data.</p>
      </section>
    </div>
  );
}
