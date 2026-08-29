import React, { useMemo, useRef, useState } from "react";
import { useStore, exportBoard, DEFAULT_NEWS_TEMPLATES } from "./store.jsx";
import { rowsFromCSV, rowsFromJSON, parseCSV, mapHeaders, parsePastedList, normTeam, NFL_TEAMS, TAGS, POS_STYLE, fmt, daysAgo, uid, boardSnapshot, diffSnapshots, summarizeDiff, MAX_HISTORY } from "./util.js";
import { computeBoard } from "./compute.js";
import Onboard from "./onboard.jsx";
import { useDataSync } from "./useDataSync.js";
import { Close, Check } from "./icons.jsx";

const card = "border border-line bg-panel p-3 md:p-4";
const h2 = "label-lg text-ink";
// Primary action is the ink block, not a coloured pill: on a white ground the
// strongest thing available is solid black, and it keeps the accent reserved
// for the one meaning it carries everywhere else — this is mine.
const btn = "taper bg-ink px-4 py-2 text-[11px] font-semibold uppercase tracking-label text-ink-invert transition-opacity hover:opacity-80 disabled:opacity-30";
const btn2 = "border border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-label text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40";
const input = "border border-line bg-ground px-2 py-1 text-sm";

// Each source type reads differently at a glance: a ranking is an opinion, ADP
// is what a room actually did, projections are neither.
const SRC_BADGE = {
  ranks: "border-accent/40 bg-accent/10 text-accent",
  adp: "border-ink/25 bg-band text-ink-muted",
  proj: "border-ahead/40 bg-ahead/10 text-ahead",
};

// ---------------- IMPORTS ----------------
export function DataView() {
  const { state, dispatch } = useStore();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("ranks");
  const fileRef = useRef(null);
  // Shared with the Board's freshness strip — one implementation of every pull.
  const { busy, msg, setMsg, syncSleeper, fetchStats, loadStatsFile, syncProjections, syncEspn } = useDataSync();
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

  const lastSeason = new Date().getFullYear() - 1;
  const thisSeason = new Date().getFullYear();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 md:p-4">
      <section className={card}>
        <h2 className={h2}>Data</h2>
        <p className="mt-1 mb-3 text-xs text-ink-faint">
          One pass over every source that can be reached. Consensus ADP and situation grades ship with the app and
          refresh on each deploy; ESPN, Sleeper, injuries and trending are pulled live.
        </p>
        <Onboard compact />
      </section>
      {msg && <div className="rounded border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">{msg}</div>}

      <MergeQueue />

      <details className="rounded-lg border border-line bg-panel-raised">
        <summary className="cursor-pointer px-3 py-2 text-xs uppercase tracking-wide text-ink-muted hover:text-ink">Import a file, paste a list, or load a CSV export</summary>
        <div className="p-1">
      <section className={card}>
        <h2 className={h2}>Import rankings / ADP / projections</h2>
        <p className="mt-1 text-xs text-ink-faint">
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
          className="mt-2 w-full rounded border border-line bg-ground p-2 font-mono text-xs" />
        <div className="mt-2 flex items-center gap-3">
          <button className={btn} disabled={!preview?.rows?.length} onClick={doImport}>
            Import{preview?.rows?.length ? ` ${preview.rows.length} rows` : ""}
          </button>
          {preview?.kind && <span className="text-xs text-ink-faint">Detected: {preview.kind}</span>}
          {preview?.error && <span className="text-xs text-behind">Parse error: {preview.error}</span>}
        </div>
      </section>
        </div>
      </details>

      <section className={card}>
        <h2 className={h2}>Sources on the board</h2>
        {!state.sources.length && <p className="mt-1 text-xs text-ink-faint">Nothing imported yet.</p>}
        {state.sources.length > 0 && (
          <p className="mt-1 text-xs text-ink-faint">
            Tick a source to count it toward <strong className="text-ink-muted">Cons</strong> — the number every row on
            the board is measured against. Untick the ones whose scoring format is not your league's. Projections are
            never included: they carry stat lines, not placements.
          </p>
        )}
        <ul className="mt-2 divide-y divide-line">
          {state.sources.map((s) => {
            const eligible = s.type !== "proj";
            const on = eligible && s.consensus !== false;
            return (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <input type="checkbox" checked={on} disabled={!eligible}
                  title={eligible ? "Count this source toward Cons" : "Projections never feed Cons"}
                  onChange={(e) => dispatch({ type: "SET_SOURCE_CONSENSUS", id: s.id, on: e.target.checked })}
                  className="h-3.5 w-3.5 shrink-0 accent-accent disabled:opacity-30" />
                <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-label ${SRC_BADGE[s.type] || SRC_BADGE.adp}`}>{s.type}</span>
                <span className={`font-medium ${on || !eligible ? "" : "text-ink-faint line-through decoration-line-strong"}`}>{s.name}</span>
                <span className="text-xs text-ink-faint">{Object.keys(s.map).length} players · {new Date(s.date).toLocaleDateString()}</span>
                {daysAgo(s.date) > 7 && <span className="rounded bg-warn/20 px-1.5 py-0.5 text-[10px] font-bold text-warn">STALE · {daysAgo(s.date)}d</span>}
                <span className="grow" />
                <button className="text-xs text-behind hover:underline" onClick={() => dispatch({ type: "DELETE_SOURCE", id: s.id })}>remove</button>
              </li>
            );
          })}
        </ul>
        {state.sources.length > 0 && (
          <p className="mt-2 text-[11px] text-ink-faint">
            {board.consSources.length === 0
              ? "Nothing feeds Cons right now — the column will read “–” for every player."
              : `Cons averages ${board.consSources.length} source${board.consSources.length > 1 ? "s" : ""}: ${board.consSources.map((s) => s.name).join(", ")}.`}
          </p>
        )}
      </section>

      <details className="rounded-lg border border-line bg-panel-raised">
        <summary className="cursor-pointer px-3 py-2 text-xs uppercase tracking-wide text-ink-muted hover:text-ink">Fetch one source at a time</summary>
        <div className="p-1">
      <section className={card}>
        <h2 className={h2}>Live market data</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn2} onClick={syncSleeper} disabled={busy === "sleeper"}>
            {busy === "sleeper" ? "Syncing…" : "Sync Sleeper (injuries · trending · metadata)"}
          </button>
          {state.sleeperAt && <span className="text-xs text-ink-faint">last {new Date(state.sleeperAt).toLocaleString()}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn2} onClick={() => fetchStats(lastSeason)} disabled={busy === "nfl"}>
            {busy === "nfl" ? "Loading…" : `Fetch nflverse ${lastSeason} player stats`}
          </button>
          <label className="text-xs text-ink-muted">
            or load CSV: <input type="file" accept=".csv" className="text-xs" onChange={(e) => e.target.files[0] && loadStatsFile(e.target.files[0], lastSeason)} />
          </label>
          {state.nflSeason && <span className="inline-flex items-center gap-1 text-xs text-ahead"><Check size={12} /> {state.nflSeason} loaded</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={btn2} onClick={() => syncProjections(thisSeason)} disabled={busy === "proj"}>
            {busy === "proj" ? "Fetching…" : `Fetch Sleeper ${thisSeason} projections + ADP`}
          </button>
          <button className={btn2} onClick={() => syncEspn(thisSeason)} disabled={busy === "espn"}>
            {busy === "espn" ? "Fetching…" : `Fetch ESPN ${thisSeason} ranks + ADP`}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Sleeper feeds injury status + trending adds/drops on the board. nflverse feeds the advanced-stats panel (target share, WOPR, aDOT, snap context) and vacated-opportunity math. Sync Sleeper first — vacated opportunity compares last-season teams against current rosters.
        </p>
        <p className="mt-1 text-[11px] text-ink-faint">
          Sources that can be pulled directly: <strong className="text-ink-muted">Sleeper</strong> and
          <strong className="text-ink-muted"> ESPN</strong> in-app, plus <strong className="text-ink-muted">Fantasy Football
          Calculator</strong> consensus ADP via <code className="text-ink-muted">npm run adp</code>. Yahoo requires an
          OAuth app, and FantasyPros requires a paid API key — both refuse anonymous requests, and their terms forbid
          scraping the pages instead. Export a CSV from either and load it above and it becomes just another column.
        </p>
        <p className="mt-1 text-[11px] text-ink-faint">
          Projections import as two sources: a stat projection that drives Proj + VOR under <em>your</em> scoring rules
          (replacing the approximate curve), and a half-PPR ADP column. Re-fetching adds new sources rather than
          replacing the old ones — delete the stale ones above.
        </p>
      </section>
        </div>
      </details>


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
    <section className={`${card} border-warn/40`}>
      <h2 className={h2}>Name matches to resolve · {state.mergeQueue.length}</h2>
      <p className="mt-1 text-xs text-ink-faint">These imported names didn't confidently match an existing player. Merge into a match or create a new player.</p>
      <ul className="mt-2 divide-y divide-line">
        {state.mergeQueue.slice(0, 25).map((q) => (
          <li key={q.qid} className="py-2">
            <div className="text-sm font-medium">{q.name} <span className="text-xs text-ink-faint">{q.pos || "?"} · {q.team || "?"} · value {fmt(q.rank, 1)}</span></div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {q.candidates.map((c) => {
                const p = state.players[c.id];
                return p && (
                  <button key={c.id} onClick={() => dispatch({ type: "RESOLVE_MERGE", qid: q.qid, targetId: c.id })}
                    className="rounded border border-line px-2 py-1 text-xs hover:border-ahead">
                    ≈ {p.name} ({p.pos} {p.team || "?"}) · {(c.score * 100).toFixed(0)}%
                  </button>
                );
              })}
              <button onClick={() => dispatch({ type: "RESOLVE_MERGE", qid: q.qid, createNew: true })} className="rounded border border-line px-2 py-1 text-xs hover:border-accent">+ new player</button>
              <button onClick={() => dispatch({ type: "SKIP_MERGE", qid: q.qid })} className="rounded px-2 py-1 text-xs text-ink-faint hover:text-behind">skip</button>
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
        <p className="mt-1 text-xs text-ink-faint">Players tagged ★ Favorite, grouped by bye. Two-plus favorites at the same position on the same bye is a roster-construction problem before it's a draft-day one.</p>
        {!favs.length && <p className="mt-3 text-sm text-ink-faint">Tag some favorites (key 1 on the board) to populate this view.</p>}
        <div className="mt-3 space-y-3">
          {weeks.map((w) => {
            const ps = byWeek[w];
            const posCount = {};
            ps.forEach((p) => (posCount[p.pos] = (posCount[p.pos] || 0) + 1));
            const collision = Object.values(posCount).some((c) => c >= 2);
            return (
              <div key={w} className={`rounded border p-2 ${collision ? "border-behind/50 bg-behind/5" : "border-line"}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  Week {w} bye
                  {collision && <span className="rounded bg-behind/20 px-1.5 py-0.5 text-[10px] font-bold text-behind">POSITION COLLISION</span>}
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
            <div className="text-xs text-warn">
              No bye on file for: {favs.filter((p) => p.bye == null).map((p) => p.name).join(", ")}. Set team byes in Settings or import a source with a bye column.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------- VACATED ----------------
// ---------------- HISTORY ----------------
export function HistoryView() {
  const { state, dispatch } = useStore();
  const [label, setLabel] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const nameOf = (id) => state.players[id]?.name || id;

  // Newest first, each compared against the version before it.
  const rows = useMemo(() => {
    const h = state.history || [];
    return h.map((v, i) => ({ v, diff: i > 0 ? diffSnapshots(h[i - 1].snapshot, v.snapshot) : null })).reverse();
  }, [state.history]);

  const live = useMemo(() => {
    const h = state.history || [];
    if (!h.length) return null;
    return diffSnapshots(h[h.length - 1].snapshot, boardSnapshot(state));
  }, [state]);
  const liveText = live ? summarizeDiff(live, nameOf) : "no changes";

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 md:p-4">
      <section className={card}>
        <h2 className={h2}>Save a version</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={input + " w-64"} value={label} placeholder="e.g. after mock draft 2"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && label.trim()) { dispatch({ type: "SAVE_VERSION", label: label.trim() }); setLabel(""); } }} />
          <button className={btn} disabled={!label.trim()}
            onClick={() => { dispatch({ type: "SAVE_VERSION", label: label.trim() }); setLabel(""); }}>
            Save version
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Versions are also captured automatically a few seconds after you stop editing. Uncommitted since the last
          version: <span className="text-ink-muted">{liveText}</span>.
        </p>
        <p className="mt-1 text-[11px] text-ink-faint">
          A version stores your order, tiers and labels, tags, notes, and scorecards — not imported sources, which stay
          shared across versions. Auto versions are culled past {MAX_HISTORY}; named ones are kept.
        </p>
      </section>

      <section className={card}>
        <h2 className={h2}>History ({(state.history || []).length})</h2>
        {!rows.length && <p className="mt-2 text-sm text-ink-faint">No versions yet. Edit the board, or save one above.</p>}
        <ul className="mt-2 space-y-1.5">
          {rows.map(({ v, diff }, i) => (
            <li key={v.id} className="rounded border border-line bg-ground/60 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs tabular-nums text-ink-faint">{new Date(v.at).toLocaleString()}</span>
                {i === 0 && <span className="rounded bg-ahead/15 px-1.5 text-[10px] font-bold text-ahead">LATEST</span>}
                {v.auto
                  ? <span className="text-[10px] uppercase tracking-wide text-ink-ghost">auto</span>
                  : <span className="text-xs font-medium text-accent">{v.label || "saved"}</span>}
                <span className="grow" />
                {confirmId === v.id ? (
                  <>
                    <span className="text-[11px] text-warn">Replace the board with this version?</span>
                    <button className="rounded border border-warn px-2 py-0.5 text-xs text-warn"
                      onClick={() => { dispatch({ type: "RESTORE_VERSION", id: v.id }); setConfirmId(null); }}>Confirm</button>
                    <button className="rounded border border-line px-2 py-0.5 text-xs text-ink-muted"
                      onClick={() => setConfirmId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="rounded border border-line px-2 py-0.5 text-xs text-ink-muted hover:border-accent"
                      onClick={() => setConfirmId(v.id)}>Restore</button>
                    {v.auto && (
                      <button title="Keep this one permanently" className="rounded border border-line px-2 py-0.5 text-xs text-ink-muted hover:border-accent"
                        onClick={() => { const l = prompt("Name this version"); if (l) dispatch({ type: "RENAME_VERSION", id: v.id, label: l }); }}>Keep</button>
                    )}
                    <button title="Delete this version" className="rounded px-1 text-xs text-ink-ghost hover:text-behind"
                      onClick={() => dispatch({ type: "DELETE_VERSION", id: v.id })} aria-label="Delete this version"><Close size={12} /></button>
                  </>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-faint">{diff ? summarizeDiff(diff, nameOf) : "starting point"}</div>
              {diff?.moved?.length > 0 && (
                <div className="mt-0.5 text-[11px] text-ink-ghost">
                  {diff.moved.slice(0, 4).map((m) => `${nameOf(m.id)} ${m.from}→${m.to}`).join(" · ")}
                  {diff.moved.length > 4 ? ` · +${diff.moved.length - 4} more` : ""}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function VacatedView() {
  const { state } = useStore();
  const v = state.vacated;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 md:p-4">
      <section className={card}>
        <h2 className={h2}>Vacated opportunity by team</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Last-season targets, carries, and TDs from players no longer on that roster (per current Sleeper metadata). Requires both a Sleeper sync and nflverse stats — Imports tab.
        </p>
        {!v && <p className="mt-3 text-sm text-ink-faint">Not computed yet. Sync Sleeper, then fetch nflverse stats.</p>}
        {v && (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="py-1 pr-2">Team</th><th className="py-1 pr-2">Targets</th><th className="py-1 pr-2">Carries</th><th className="py-1 pr-2">TDs</th><th className="py-1">Who left</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(v).sort((a, b) => b[1].targets - a[1].targets).map(([team, x]) => (
                <tr key={team} className="border-b border-line align-top">
                  <td className="py-1.5 pr-2 font-semibold">{team}</td>
                  <td className={`py-1.5 pr-2 tabular-nums ${x.targets >= 120 ? "text-ahead font-medium" : ""}`}>{x.targets}</td>
                  <td className={`py-1.5 pr-2 tabular-nums ${x.carries >= 150 ? "text-ahead font-medium" : ""}`}>{x.carries}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{x.tds}</td>
                  <td className="py-1.5 text-xs text-ink-faint">{x.names.slice(0, 4).join(", ")}</td>
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
    <label key={key} className="flex flex-col text-[11px] text-ink-muted">
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
          <label className="flex flex-col text-[11px] text-ink-muted">
            flex type
            <select value={r.flexType} onChange={(e) => dispatch({ type: "SET_ROSTER", patch: { flexType: e.target.value } })} className={`${input} mt-0.5`}>
              <option value="WRT">W/R/T</option><option value="WR/RB">W/R</option><option value="WR/TE">W/T</option>
            </select>
          </label>
        </div>
        <div className="mt-3 rounded border border-line bg-ground p-2 text-xs text-ink-muted">
          <span className="font-semibold text-ink-muted">Replacement level from these settings: </span>
          {Object.entries(board.replRank).filter(([p]) => board.replacement[p] > 0).map(([p, rk]) => (
            <span key={p} className="mr-3">{p}{rk} ≈ {fmt(board.replacement[p], 0)} pts</span>
          ))}
          <span className="text-ink-ghost">· VOR on the board is measured against these baselines{board.hasProj ? "" : " (approximate curve until you import projections)"}.</span>
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>Scoring (Yahoo defaults · half PPR)</h2>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          {Object.keys(sc).map((k) => numField(sc, k, (p) => dispatch({ type: "SET_SCORING", patch: p }), 0.05, "w-20"))}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">These weights re-score any imported stat-projection source, which drives Proj and VOR. TE premium is added per TE reception on top of ppr.</p>
      </section>

      <section className={card}>
        <h2 className={h2}>Team bye weeks</h2>
        <p className="mt-1 text-xs text-ink-faint">Paste "TEAM week" pairs (one per line, e.g. <code>DET 5</code>). Applied to every player on that team; imports with a bye column also fill this in.</p>
        <div className="mt-2 flex gap-2">
          <textarea value={byePaste} onChange={(e) => setByePaste(e.target.value)} rows={3} placeholder={"DET 5\nKC 10"} className="w-48 rounded border border-line bg-ground p-2 font-mono text-xs" />
          <button className={btn2} onClick={applyByePaste}>Apply</button>
        </div>
        {Object.keys(state.settings.byeWeeks).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-ink-muted">
            {Object.entries(state.settings.byeWeeks).map(([t, w]) => <span key={t} className="rounded bg-band px-1.5 py-0.5">{t} {w}</span>)}
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className={h2}>News source templates</h2>
        <p className="mt-1 text-xs text-ink-faint">{"{name}"} and {"{team}"} are substituted per player. These render as link-outs on every player's news panel.</p>
        <div className="mt-2 space-y-1.5">
          {state.settings.newsTemplates.map((t, i) => (
            <div key={t.id} className="flex gap-2">
              <input value={t.name} onChange={(e) => setTemplate(i, { name: e.target.value })} className={`${input} w-40`} />
              <input value={t.url} onChange={(e) => setTemplate(i, { url: e.target.value })} className={`${input} flex-1 font-mono text-xs`} />
              <button className="text-xs text-behind" onClick={() => dispatch({ type: "SET_SETTINGS", patch: { newsTemplates: state.settings.newsTemplates.filter((_, j) => j !== i) } })} aria-label="Remove"><Close size={12} /></button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button className={btn2} onClick={() => dispatch({ type: "SET_SETTINGS", patch: { newsTemplates: [...state.settings.newsTemplates, { id: uid(), name: "New source", url: "https://www.google.com/search?q=site:example.com+{name}" }] } })}>+ Add template</button>
          <button className={btn2} onClick={() => dispatch({ type: "SET_SETTINGS", patch: { newsTemplates: DEFAULT_NEWS_TEMPLATES } })}>Restore defaults</button>
        </div>
        <div className="mt-4">
          <div className="text-xs font-semibold text-ink-muted">Local beat blogs per team</div>
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
                <button className="text-xs text-behind" onClick={() => setBeats(beats.filter((_, j) => j !== i))} aria-label="Remove"><Close size={12} /></button>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <label className="text-xs font-semibold text-ink-muted">CORS proxy (optional)</label>
          <input value={state.settings.corsProxy} onChange={(e) => dispatch({ type: "SET_SETTINGS", patch: { corsProxy: e.target.value } })}
            placeholder="https://your-proxy.example/?url={url}   (or a prefix the RSS URL is appended to)"
            className={`${input} mt-1 w-full font-mono text-xs`} />
          <p className="mt-1 text-[11px] text-ink-faint">If set, player news panels can fetch and render Google News RSS headlines inline. Empty = link-outs only.</p>
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>Move between devices</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={btn} onClick={doExport}>Export board JSON</button>
          <button className={btn2} onClick={() => importRef.current?.click()}>Import board JSON</button>
          <input ref={importRef} type="file" accept=".json" hidden onChange={(e) => e.target.files[0] && doImportBoard(e.target.files[0])} />
          <span className="grow" />
          <button className="rounded border border-behind/40 px-3 py-1.5 text-sm text-behind hover:bg-behind/10"
            onClick={() => confirm("Wipe everything — settings, sources, ranks, notes?") && dispatch({ type: "RESET" })}>Reset all data</button>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">Everything lives in this browser's storage — no server. Export before clearing site data.</p>
      </section>
    </div>
  );
}
