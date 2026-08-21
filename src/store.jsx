import React, { createContext, useContext, useEffect, useReducer } from "react";
import { uid, playerKey, normName, normTeam, findCandidates, similarity, migrateTierBreaks, consensusOrder, addTierBreak, removeTierBreak, moveTierBreak, boardSnapshot, diffSnapshots, MAX_HISTORY } from "./util.js";
import { DEFAULT_SCORING, DEFAULT_ROSTER, targetCompRating } from "./compute.js";

const LS_KEY = "draftboard-v1";

export const DEFAULT_NEWS_TEMPLATES = [
  { id: "wk", name: "Google · past week", url: "https://www.google.com/search?q={name}+{team}+fantasy&tbs=qdr:w" },
  { id: "ath", name: "The Athletic", url: "https://www.google.com/search?q=site:theathletic.com+{name}&tbs=qdr:m" },
  { id: "espn", name: "ESPN", url: "https://www.google.com/search?q=site:espn.com+{name}+fantasy&tbs=qdr:m" },
  { id: "x", name: "X", url: "https://www.google.com/search?q=site:x.com+{name}+{team}&tbs=qdr:w" },
  { id: "roto", name: "Rotoworld", url: "https://www.google.com/search?q=site:rotoworld.com+OR+site:nbcsports.com+{name}&tbs=qdr:m" },
];

const initialState = {
  settings: {
    roster: { ...DEFAULT_ROSTER },
    scoring: { ...DEFAULT_SCORING },
    corsProxy: "",
    newsTemplates: DEFAULT_NEWS_TEMPLATES,
    beatBlogs: {}, // team -> [{name, url template with {name} {team}}]
    byeWeeks: {},  // team -> week number (manual/paste; imports can also fill per player)
  },
  players: {},   // id -> {id, name, pos, team, bye, tags:[], notes, handcuffOf, scorecard, sleeper:{}, nfl:{}}
  myRanks: [],   // ordered player ids
  // Tier breaks are scoped to the view you cut them in: "all" for the unfiltered
  // board, or a position key. Values are indices into that scope's ordered list
  // (myRanks, or myRanks filtered to the position), so a position's tiers stay
  // put instead of inheriting cuts from the overall order.
  tierBreaks: { all: [] },
  tierNames: {}, // scope -> {tierOrdinal: label}
  history: [],   // [{id, at, label, auto, snapshot}] newest last
  manualOrder: false, // true once the user drags/nudges a row themselves
  sources: [],   // {id, name, type: 'ranks'|'adp'|'proj', date, map:{playerId:number}, stats?:{playerId:{...}}}
  mergeQueue: [],// [{srcId, name, team, pos, value, stats?, candidates:[{id,score}]}]
  trending: { adds: [], drops: [], at: null },
  vacated: null, // {team:{targets,carries,tds,names}}
  nflSeason: null,
  ui: { tab: "board" },
};

function ensurePlayer(draft, { name, team, pos }) {
  const id = playerKey(name, pos);
  if (!draft.players[id]) {
    draft.players[id] = {
      id, name, pos: pos || "?", team: normTeam(team) || null, bye: null,
      tags: [], notes: "", handcuffOf: null,
      scorecard: { offense: 3, olineRun: 3, olinePass: 3, qb: 3, targetComp: 3, scheme: 3, pace: 3, sosSeason: 3, sosPlayoff: 3, projected: true, note: "" },
      sleeper: null, nfl: null,
    };
    if (!draft.myRanks.includes(id)) draft.myRanks.push(id);
  } else if (team && !draft.players[id].team) {
    draft.players[id].team = normTeam(team);
  }
  return id;
}

// Attach imported rows to players; unresolved names go to the merge queue.
function applyImport(draft, { name, srcType: type, rows, stats }) {
  const src = { id: uid(), name, type, date: new Date().toISOString(), map: {}, stats: type === "proj" ? {} : undefined };
  const havePlayers = Object.keys(draft.players).length > 0;
  for (const row of rows) {
    const exactId = playerKey(row.name, row.pos);
    let target = null;
    if (draft.players[exactId]) target = exactId;
    else if (havePlayers) {
      const cands = findCandidates(row.name, row.pos, draft.players);
      if (cands.length && cands[0].score >= 0.92) target = cands[0].id;
      else if (cands.length) {
        draft.mergeQueue.push({ qid: uid(), srcId: src.id, ...row, candidates: cands });
        continue;
      }
    }
    if (!target) target = ensurePlayer(draft, row);
    src.map[target] = row.rank;
    if (row.bye != null) draft.players[target].bye = row.bye;
    if (row.team) draft.players[target].team = normTeam(row.team);
    if (type === "proj" && row.statLine) src.stats[target] = row.statLine;
  }
  draft.sources.push(src);
  return src.id;
}

function reducer(state, action) {
  const draft = structuredClone(state);
  switch (action.type) {
    case "HYDRATE": return migrateTierBreaks({ ...initialState, ...action.state, ui: { ...initialState.ui, ...(action.state.ui || {}) } });
    case "SET_TAB": draft.ui.tab = action.tab; return draft;
    case "SET_SETTINGS": draft.settings = { ...draft.settings, ...action.patch }; return draft;
    case "SET_ROSTER": draft.settings.roster = { ...draft.settings.roster, ...action.patch }; return draft;
    case "SET_SCORING": draft.settings.scoring = { ...draft.settings.scoring, ...action.patch }; return draft;

    case "IMPORT": {
      applyImport(draft, action);
      // Until you have reordered anything yourself, a fresh import should land
      // in consensus order rather than whatever order the file happened to be in.
      if (!draft.manualOrder) draft.myRanks = consensusOrder(draft.myRanks, draft.sources);
      return draft;
    }
    case "DELETE_SOURCE": {
      draft.sources = draft.sources.filter((s) => s.id !== action.id);
      draft.mergeQueue = draft.mergeQueue.filter((q) => q.srcId !== action.id);
      return draft;
    }
    case "RESOLVE_MERGE": {
      const q = draft.mergeQueue.find((x) => x.qid === action.qid);
      if (!q) return draft;
      const src = draft.sources.find((s) => s.id === q.srcId);
      let target = action.targetId;
      if (action.createNew) target = ensurePlayer(draft, q);
      if (src && target) {
        src.map[target] = q.rank;
        if (q.bye != null) draft.players[target].bye = q.bye;
        if (src.type === "proj" && q.statLine) src.stats[target] = q.statLine;
      }
      draft.mergeQueue = draft.mergeQueue.filter((x) => x.qid !== action.qid);
      return draft;
    }
    case "SKIP_MERGE": draft.mergeQueue = draft.mergeQueue.filter((x) => x.qid !== action.qid); return draft;

    case "REORDER": { // move player id to index
      const { id, to } = action;
      draft.manualOrder = true;
      const from = draft.myRanks.indexOf(id);
      if (from < 0) return draft;
      draft.myRanks.splice(from, 1);
      draft.myRanks.splice(to, 0, id);
      return draft;
    }
    case "MOVE": { // delta move
      draft.manualOrder = true;
      const i = draft.myRanks.indexOf(action.id);
      const j = Math.max(0, Math.min(draft.myRanks.length - 1, i + action.delta));
      if (i < 0 || i === j) return draft;
      draft.myRanks.splice(i, 1);
      draft.myRanks.splice(j, 0, action.id);
      return draft;
    }
    case "SET_RANKS": draft.myRanks = action.ids; return draft;
    case "SORT_BY_CONSENSUS": {
      const order = action.order; // precomputed ids
      draft.myRanks = order;
      return draft;
    }
    // Wholesale replacement (Suggest / Clear) drops the labels with them —
    // there is no honest way to map old names onto a fresh set of cuts.
    case "SET_TIER_BREAKS": {
      const scope = action.scope || "all";
      draft.tierBreaks[scope] = [...new Set(action.breaks)].sort((a, b) => a - b);
      draft.tierNames = draft.tierNames || {};
      draft.tierNames[scope] = {};
      return draft;
    }
    case "TOGGLE_TIER_BREAK": {
      const scope = action.scope || "all";
      const cur = draft.tierBreaks[scope] ?? [];
      draft.tierNames = draft.tierNames || {};
      const names = draft.tierNames[scope] ?? {};
      const next = cur.includes(action.index)
        ? removeTierBreak(cur, names, action.index)
        : addTierBreak(cur, names, action.index);
      draft.tierBreaks[scope] = next.breaks;
      draft.tierNames[scope] = next.names;
      return draft;
    }
    case "MOVE_TIER_BREAK": {
      const scope = action.scope || "all";
      draft.tierNames = draft.tierNames || {};
      const next = moveTierBreak(draft.tierBreaks[scope] ?? [], draft.tierNames[scope] ?? {}, action.from, action.to);
      draft.tierBreaks[scope] = next.breaks;
      draft.tierNames[scope] = next.names;
      return draft;
    }
    case "SET_TIER_NAME": {
      const scope = action.scope || "all";
      draft.tierNames = draft.tierNames || {};
      const names = { ...(draft.tierNames[scope] ?? {}) };
      if (action.name) names[action.tier] = action.name; else delete names[action.tier];
      draft.tierNames[scope] = names;
      return draft;
    }

    case "TOGGLE_TAG": {
      const p = draft.players[action.id];
      if (!p) return draft;
      p.tags = p.tags.includes(action.tag) ? p.tags.filter((t) => t !== action.tag) : [...p.tags, action.tag];
      return draft;
    }
    case "SET_NOTES": draft.players[action.id].notes = action.notes; return draft;
    case "SET_HANDCUFF": draft.players[action.id].handcuffOf = action.starterId; return draft;
    case "SET_BYE": draft.players[action.id].bye = action.bye; return draft;
    case "SET_SCORECARD": {
      const p = draft.players[action.id];
      p.scorecard = { ...p.scorecard, ...action.patch };
      return draft;
    }
    case "SET_TEAM_BYES": {
      draft.settings.byeWeeks = action.map;
      for (const p of Object.values(draft.players)) {
        if (p.team && action.map[p.team] != null) p.bye = action.map[p.team];
      }
      return draft;
    }

    case "SLEEPER_META": {
      for (const p of Object.values(draft.players)) {
        const meta = action.meta[`${normName(p.name)}|${p.pos}`];
        if (meta) { p.sleeper = meta; if (!p.team && meta.team) p.team = meta.team; }
      }
      draft.sleeperMeta = action.meta; // keep for vacated calc
      draft.sleeperAt = new Date().toISOString();
      return draft;
    }
    case "TRENDING": draft.trending = { adds: action.adds, drops: action.drops, at: new Date().toISOString() }; return draft;
    case "NFLVERSE": {
      draft.nflSeason = action.season;
      draft.nflAgg = action.agg;
      for (const p of Object.values(draft.players)) {
        const line = action.agg.players[`${normName(p.name)}|${p.pos}`];
        if (line) p.nfl = line;
      }
      return draft;
    }
    case "VACATED": draft.vacated = action.vacated; return draft;

    // Apply generated per-team situation ratings (see fetch-situation.mjs) to
    // every player's scorecard. Only the derived fields are touched: "scheme"
    // has no statistical basis and an existing grade note is left alone.
    case "APPLY_SITUATION": {
      const { teams, meta } = action;
      let applied = 0, missing = 0;
      for (const p of Object.values(draft.players)) {
        const t = p.team ? teams[p.team] : null;
        if (!t) { missing++; continue; }
        const patch = { ...t };
        const tc = targetCompRating(p.nfl?.tgtShare);
        if (tc != null) patch.targetComp = tc;
        p.scorecard = {
          ...p.scorecard,
          ...patch,
          projected: false,
          note: p.scorecard?.note || `auto: ${meta.statsSeason} team data, SOS ${meta.scheduleSeason}`,
        };
        applied++;
      }
      draft.situation = { ...meta, applied, missing, at: new Date().toISOString() };
      return draft;
    }

    // ---------- board history ----------
    case "SAVE_VERSION": {
      const snapshot = boardSnapshot(draft);
      const list = [...(draft.history || []), {
        id: uid(), at: new Date().toISOString(),
        label: action.label || "", auto: !!action.auto, snapshot,
      }];
      // Named versions are milestones; only auto entries get culled.
      while (list.length > MAX_HISTORY) {
        const victim = list.findIndex((v) => v.auto);
        if (victim === -1) break;
        list.splice(victim, 1);
      }
      draft.history = list;
      return draft;
    }
    case "RESTORE_VERSION": {
      const v = (draft.history || []).find((x) => x.id === action.id);
      if (!v) return draft;
      // Snapshot the pre-restore board first, so restoring is itself undoable.
      draft.history = [...draft.history, {
        id: uid(), at: new Date().toISOString(), label: "before restore", auto: true, snapshot: boardSnapshot(draft),
      }];
      draft.myRanks = [...v.snapshot.myRanks].filter((id) => draft.players[id]);
      for (const id of Object.keys(draft.players)) if (!draft.myRanks.includes(id)) draft.myRanks.push(id);
      draft.tierBreaks = structuredClone(v.snapshot.tierBreaks || { all: [] });
      draft.tierNames = structuredClone(v.snapshot.tierNames || {});
      for (const [id, saved] of Object.entries(v.snapshot.players || {})) {
        const p = draft.players[id];
        if (!p) continue;
        p.tags = [...(saved.tags || [])];
        p.notes = saved.notes || "";
        p.handcuffOf = saved.handcuffOf ?? null;
        if (saved.scorecard) p.scorecard = { ...saved.scorecard };
      }
      return draft;
    }
    case "DELETE_VERSION": draft.history = (draft.history || []).filter((v) => v.id !== action.id); return draft;
    case "RENAME_VERSION": {
      const v = (draft.history || []).find((x) => x.id === action.id);
      if (v) { v.label = action.label; v.auto = false; }
      return draft;
    }

    case "IMPORT_BOARD": return { ...migrateTierBreaks(action.state), ui: draft.ui };
    case "RESET": return structuredClone(initialState);
    default: return state;
  }
}

const Ctx = createContext(null);
export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return migrateTierBreaks({ ...init, ...JSON.parse(raw) });
    } catch (e) { console.warn("load failed", e); }
    return init;
  });
  useEffect(() => {
    const t = setTimeout(() => {
      // sleeperMeta/nflAgg are large re-fetchable caches; keeping them out of
      // localStorage is what leaves room for the version history.
      const { ui, sleeperMeta, nflAgg, ...persist } = state;
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(persist));
      } catch (e) {
        try {
          const keep = (persist.history || []).filter((v) => !v.auto).slice(-10);
          localStorage.setItem(LS_KEY, JSON.stringify({ ...persist, history: keep }));
          console.warn("storage full — trimmed auto versions", e);
        } catch (e2) { console.warn("save failed", e2); }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [state]);

  // Auto-version: after the board settles, append a snapshot if anything a
  // person edits actually changed. Debounced so a burst of drags is one entry.
  useEffect(() => {
    if (!state.myRanks?.length) return;
    const t = setTimeout(() => {
      const snap = boardSnapshot(state);
      const last = state.history?.[state.history.length - 1]?.snapshot;
      if (last && JSON.stringify(last) === JSON.stringify(snap)) return;
      dispatch({ type: "SAVE_VERSION", auto: true });
    }, 4000);
    return () => clearTimeout(t);
  }, [state]);
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}
export const useStore = () => useContext(Ctx);

export function exportBoard(state) {
  const { ui, sleeperMeta, nflAgg, ...persist } = state;
  return JSON.stringify({ app: "draftboard", version: 1, exported: new Date().toISOString(), ...persist }, null, 2);
}
