// ---------- generic helpers ----------
export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const fmt = (n, d = 1) => {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const s = Number(n).toFixed(d);
  // toFixed rounds -0.4 to "-0" — a minus sign in front of nothing, which read
  // as a column of "-0" down the Me−ADP cells. Drop the sign when every digit
  // that survived rounding is a zero.
  const signed = /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
  return signed.replace(/\.0$/, d === 1 ? "" : ".0");
};
export const pct = (n) => (n === null || n === undefined || Number.isNaN(n) ? "–" : (n * 100).toFixed(1) + "%");
export const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

// How current the board is, as one summary of every imported source. The
// newest source is what "as of" means: a board is only as fresh as its most
// recent pull, and the per-source STALE markers cover the laggards.
// `now` is injectable so this is testable without freezing the clock.
export function sourceFreshness(sources, now = Date.now()) {
  const dated = (sources || []).filter((s) => s && s.date && !Number.isNaN(new Date(s.date).getTime()));
  if (!dated.length) return null;
  const newest = dated.reduce((a, b) => (new Date(b.date) > new Date(a.date) ? b : a));
  const days = Math.max(0, Math.floor((now - new Date(newest.date).getTime()) / 86400000));
  // Same 7-day threshold the per-source STALE badge uses, just with a positive
  // state at the other end instead of only an absence of warning.
  const level = days === 0 ? "today" : days < 7 ? "recent" : "stale";
  return { newest, days, level, stale: (sources || []).filter((s) => daysAgo(s.date) > 7) };
}

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];

// One colour per position, resolved through theme tokens so a position reads
// the same on either ground. `rail` is the spine down the left of a row — the
// fastest positional cue there is, because it needs no reading at all.
//
// Spelled out rather than built from a template: Tailwind finds classes by
// scanning source text, so a name assembled at runtime is a name it purges.
export const POS_STYLE = {
  QB: { chip: "bg-pos-QB/12 text-pos-QB border-pos-QB/40", rail: "bg-pos-QB", text: "text-pos-QB" },
  RB: { chip: "bg-pos-RB/12 text-pos-RB border-pos-RB/40", rail: "bg-pos-RB", text: "text-pos-RB" },
  WR: { chip: "bg-pos-WR/12 text-pos-WR border-pos-WR/40", rail: "bg-pos-WR", text: "text-pos-WR" },
  TE: { chip: "bg-pos-TE/12 text-pos-TE border-pos-TE/40", rail: "bg-pos-TE", text: "text-pos-TE" },
  K:  { chip: "bg-pos-K/12 text-pos-K border-pos-K/40",    rail: "bg-pos-K",  text: "text-pos-K" },
  DST:{ chip: "bg-pos-DST/12 text-pos-DST border-pos-DST/40", rail: "bg-pos-DST", text: "text-pos-DST" },
};

export const TAGS = [
  { key: "favorite", label: "Favorite", num: "1", cls: "bg-tag-favorite/15 text-tag-favorite border-tag-favorite/40", dot: "bg-tag-favorite" },
  { key: "sleeper", label: "Sleeper", num: "2", cls: "bg-tag-sleeper/15 text-tag-sleeper border-tag-sleeper/40", dot: "bg-tag-sleeper" },
  { key: "reliable", label: "Reliable", num: "3", cls: "bg-tag-reliable/15 text-tag-reliable border-tag-reliable/40", dot: "bg-tag-reliable" },
  { key: "avoid", label: "Avoid", num: "4", cls: "bg-tag-avoid/15 text-tag-avoid border-tag-avoid/40", dot: "bg-tag-avoid" },
  { key: "handcuff", label: "Handcuff", num: "5", cls: "bg-tag-handcuff/15 text-tag-handcuff border-tag-handcuff/40", dot: "bg-tag-handcuff" },
];

export const NFL_TEAMS = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC","LAC","LAR","LV","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"];

const TEAM_ALIASES = {
  JAC: "JAX", WSH: "WAS", WFT: "WAS", GNB: "GB", KAN: "KC", NOR: "NO", NWE: "NE",
  SFO: "SF", TAM: "TB", LVR: "LV", OAK: "LV", SD: "LAC", SDG: "LAC", STL: "LAR", LA: "LAR", HST: "HOU", BLT: "BAL", CLV: "CLE", ARZ: "ARI",
};
export const normTeam = (t) => {
  if (!t) return "";
  const u = String(t).trim().toUpperCase();
  return TEAM_ALIASES[u] || (NFL_TEAMS.includes(u) ? u : u);
};

// ---------- persisted-state migrations ----------
// tierBreaks used to be a flat index array over the whole board. Saved boards
// and exported JSON from before tiers became per-position still carry that
// shape; normalize them to {scope: indices}.
export function migrateTierBreaks(s) {
  if (!s || typeof s !== "object") return s;
  const tb = s.tierBreaks;
  if (Array.isArray(tb)) return { ...s, tierBreaks: { all: tb } };
  if (!tb || typeof tb !== "object") return { ...s, tierBreaks: { all: [] } };
  return s;
}


// Order ids by mean rank across every opinion source. Players nobody ranked sink
// to the bottom in their existing order rather than jumping to the top.
// Honours the same per-source consensus flag the Cons column reads, so the order
// a fresh board arrives in and the number it is measured against agree.
export function consensusOrder(ids, sources) {
  const vals = {};
  for (const s of sources || []) {
    if (s.type === "proj" || s.consensus === false) continue;
    for (const [pid, v] of Object.entries(s.map || {})) {
      if (v == null) continue;
      (vals[pid] ||= []).push(Number(v));
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return ids
    .map((id, i) => ({ id, i, v: vals[id]?.length ? avg(vals[id]) : Infinity }))
    .sort((a, b) => (a.v - b.v) || (a.i - b.i))
    .map((x) => x.id);
}

// ---------- board history ----------
// Snapshots keep only what a person actually edits. Sources, Sleeper metadata
// and nflverse aggregates are re-fetchable bulk and would blow the localStorage
// budget within a handful of versions.
export const MAX_HISTORY = 30;

export function boardSnapshot(state) {
  const players = {};
  for (const [id, p] of Object.entries(state.players || {})) {
    players[id] = { tags: p.tags || [], notes: p.notes || "", handcuffOf: p.handcuffOf ?? null, scorecard: p.scorecard };
  }
  return {
    myRanks: [...(state.myRanks || [])],
    tierBreaks: structuredClone(state.tierBreaks || {}),
    tierNames: structuredClone(state.tierNames || {}),
    players,
  };
}

// What changed between two snapshots, in the terms the board thinks in.
export function diffSnapshots(prev, next) {
  if (!prev || !next) return { moved: [], tagged: 0, tiers: 0, noted: 0, scored: 0 };
  const prevPos = new Map(prev.myRanks.map((id, i) => [id, i]));
  const moved = [];
  next.myRanks.forEach((id, i) => {
    const was = prevPos.get(id);
    if (was != null && was !== i) moved.push({ id, from: was + 1, to: i + 1, delta: was - i });
  });
  moved.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const countBreaks = (tb) => Object.values(tb || {}).reduce((n, arr) => n + (arr?.length || 0), 0);
  const countNames = (tn) => Object.values(tn || {}).reduce((n, o) => n + Object.keys(o || {}).length, 0);

  let tagged = 0, noted = 0, scored = 0;
  for (const [id, p] of Object.entries(next.players || {})) {
    const q = prev.players?.[id];
    if (!q) continue;
    if (JSON.stringify(p.tags) !== JSON.stringify(q.tags)) tagged++;
    if (p.notes !== q.notes) noted++;
    if (JSON.stringify(p.scorecard) !== JSON.stringify(q.scorecard)) scored++;
  }
  return {
    moved,
    added: next.myRanks.filter((id) => !prevPos.has(id)).length,
    removed: prev.myRanks.filter((id) => !next.myRanks.includes(id)).length,
    tiers: countBreaks(next.tierBreaks) - countBreaks(prev.tierBreaks),
    tierLabels: countNames(next.tierNames) - countNames(prev.tierNames),
    tagged, noted, scored,
  };
}

export function summarizeDiff(d, nameOf = (id) => id) {
  if (!d) return "no changes";
  const bits = [];
  if (d.moved?.length) {
    const top = d.moved[0];
    bits.push(d.moved.length === 1
      ? `${nameOf(top.id)} ${top.delta > 0 ? "up" : "down"} ${Math.abs(top.delta)}`
      : `${d.moved.length} moved (${nameOf(top.id)} ${top.delta > 0 ? "up" : "down"} ${Math.abs(top.delta)})`);
  }
  if (d.added) bits.push(`+${d.added} player${d.added > 1 ? "s" : ""}`);
  if (d.removed) bits.push(`-${d.removed} player${d.removed > 1 ? "s" : ""}`);
  if (d.tiers) bits.push(`${d.tiers > 0 ? "+" : ""}${d.tiers} tier${Math.abs(d.tiers) > 1 ? "s" : ""}`);
  if (d.tierLabels) bits.push(`${d.tierLabels > 0 ? "+" : ""}${d.tierLabels} tier label${Math.abs(d.tierLabels) > 1 ? "s" : ""}`);
  if (d.tagged) bits.push(`${d.tagged} tag${d.tagged > 1 ? "s" : ""}`);
  if (d.noted) bits.push(`${d.noted} note${d.noted > 1 ? "s" : ""}`);
  if (d.scored) bits.push(`${d.scored} scorecard${d.scored > 1 ? "s" : ""}`);
  return bits.length ? bits.join(" · ") : "no changes";
}

// ---------- tier dividers ----------
// A tier break is a divider dropped between two rows, like the stick on a
// checkout belt. Breaks stay a plain sorted index list; names hang off the tier
// ORDINAL (1-based), so inserting or pulling a divider has to renumber the
// labels below it or they detach from the group they described.
export const tierOrdinalAt = (breaks, index) => breaks.filter((b) => index >= b).length + 1;

export function addTierBreak(breaks, names, at) {
  if (at <= 0 || breaks.includes(at)) return { breaks, names };
  const split = tierOrdinalAt(breaks, at); // tier being cut in two
  const nextNames = {};
  for (const [ord, nm] of Object.entries(names || {})) {
    const o = Number(ord);
    nextNames[o > split ? o + 1 : o] = nm; // everything below shifts down a slot
  }
  return { breaks: [...breaks, at].sort((a, b) => a - b), names: nextNames };
}

export function removeTierBreak(breaks, names, at) {
  if (!breaks.includes(at)) return { breaks, names };
  const gone = tierOrdinalAt(breaks, at); // tier that started here, now merged up
  const nextNames = {};
  for (const [ord, nm] of Object.entries(names || {})) {
    const o = Number(ord);
    if (o === gone) continue;
    nextNames[o > gone ? o - 1 : o] = nm;
  }
  return { breaks: breaks.filter((b) => b !== at), names: nextNames };
}

// Drag a divider somewhere else and its label rides along.
export function moveTierBreak(breaks, names, from, to) {
  if (from === to || to <= 0) return { breaks, names };
  const label = (names || {})[tierOrdinalAt(breaks, from)];
  const pulled = removeTierBreak(breaks, names, from);
  const placed = addTierBreak(pulled.breaks, pulled.names, to);
  if (label) placed.names[tierOrdinalAt(placed.breaks, to)] = label;
  return placed;
}

// ---------- name normalization + fuzzy matching ----------
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
export function normName(name) {
  if (!name) return "";
  let s = String(name)
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[.,'’\-]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SUFFIXES.has(w));
  return s.join(" ");
}

export const playerKey = (name, pos) => `${normName(name).replace(/ /g, "_")}|${pos || "?"}`;

// Dice coefficient on character bigrams — fast, order-tolerant enough for names.
function bigrams(s) {
  const out = new Map();
  const t = s.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    out.set(b, (out.get(b) || 0) + 1);
  }
  return out;
}
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  for (const [g, c] of A) { total += c; if (B.has(g)) inter += Math.min(c, B.get(g)); }
  for (const [, c] of B) total += c;
  return total ? (2 * inter) / total : 0;
}

// Find best matches for an imported row against the current player pool.
export function findCandidates(name, pos, players) {
  const n = normName(name);
  const scored = [];
  for (const p of Object.values(players)) {
    if (pos && p.pos && pos !== p.pos) continue;
    const s = similarity(n, normName(p.name));
    if (s > 0.55) scored.push({ id: p.id, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}

// ---------- CSV ----------
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const normHeader = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, "");

// Header aliases → canonical field names
const HEADER_MAP = {
  name: ["player", "playername", "name", "fullname"],
  team: ["team", "tm", "nflteam"],
  pos: ["pos", "position"],
  bye: ["bye", "byeweek"],
  rank: ["rank", "rk", "overall", "overallrank", "ecr", "adp", "avg", "averagepick", "avgpick", "consensus"],
  // projection stat columns
  passYd: ["passyds", "passyd", "passingyards", "passyards", "py", "payds"],
  passTD: ["passtd", "passtds", "passingtds", "patd"],
  passInt: ["int", "ints", "interceptions", "passint"],
  rushYd: ["rushyds", "rushyd", "rushingyards", "rushyards", "ruyds"],
  rushTD: ["rushtd", "rushtds", "rushingtds", "rutd"],
  rec: ["rec", "receptions", "recs", "catches"],
  recYd: ["recyds", "recyd", "receivingyards", "recyards", "reyds"],
  recTD: ["rectd", "rectds", "receivingtds", "retd"],
  fumbles: ["fum", "fumbles", "fumbleslost", "fl"],
  firstDowns: ["fd", "firstdowns", "1d"],
};
export function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const n = normHeader(h);
    for (const [canon, aliases] of Object.entries(HEADER_MAP)) {
      if (aliases.includes(n) && map[canon] === undefined) map[canon] = idx;
    }
  });
  return map;
}

// ---------- paste-a-list parser ----------
// Handles lines like: "1. Justin Jefferson MIN WR1", "Bijan Robinson, ATL RB",
// "12) CeeDee Lamb - DAL (7)". Rank = value found or line order.
//
// Also handles what you get from copying a rendered table — Yahoo's draft
// analysis page in particular, which writes "Jahmyr Gibbs Det - RB" with the
// team in title case and ADP, auction cost and "% drafted" in trailing cells.
// Title-case teams and stat columns both used to end up glued onto the name.
//
// No \s* before the digits: a positional suffix is written "RB1", never "RB 1",
// and allowing the gap let the parser swallow the leading digit of an ADP
// sitting in the next cell.
const POS_RE = /\b(QB|RB|WR|TE|K|DST|DEF|D\/ST)\d{0,2}\b/i;
// A bare number, an auction price, or a percentage: a stat cell, never a name.
const STAT_TOKEN = /^[$+]?\d+(\.\d+)?%?$/;
export function parsePastedList(text) {
  const out = [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let order = 0;
  for (const raw of lines) {
    // A copied table row puts the player in the first cell and the numbers
    // after it, so keeping only that cell is what stops ADP and auction cost
    // from being read as part of the name.
    let line = raw.includes("\t") ? raw.split("\t")[0].trim() : raw;
    if (!line) continue;
    let rank = null;
    const rm = line.match(/^\s*(\d{1,3})[.)\-:\s]+/);
    if (rm) { rank = parseInt(rm[1], 10); line = line.slice(rm[0].length); }
    line = line.replace(/[|•·]+/g, " ");
    let pos = null;
    const pm = line.match(POS_RE);
    if (pm) {
      pos = pm[0].replace(/\d+/g, "").toUpperCase().trim();
      if (pos === "DEF" || pos === "D/ST") pos = "DST";
      line = line.replace(pm[0], " ");
    }
    let team = null;
    const tokens = line.split(/[\s,\-()]+/).filter(Boolean);
    const looksTeam = (t) => /^[A-Za-z]{2,3}$/.test(t) && NFL_TEAMS.includes(normTeam(t));

    // A line holding nothing but a team and a position belongs to the player
    // above it — that is a card layout wrapping, not a new entry. Deciding this
    // up front is what lets the name path stay strict about leading tokens.
    const continuation = tokens.length > 0 && tokens.every((t) => looksTeam(t) || STAT_TOKEN.test(t));
    if (continuation || !tokens.length) {
      const prev = out[out.length - 1];
      const t = tokens.find(looksTeam);
      if (prev && (t || pos)) {
        prev.team = prev.team ?? (t ? normTeam(t) : null);
        prev.pos = prev.pos ?? pos;
      }
      continue;
    }

    const kept = [];
    for (const t of tokens) {
      // Team codes match case-insensitively so "Det" reads the same as "DET",
      // but never from the first token: a leading "No" or "Ne" is far more
      // likely to be the start of a name than New Orleans or New England.
      if (!team && kept.length > 0 && looksTeam(t)) team = normTeam(t);
      else if (!STAT_TOKEN.test(t)) kept.push(t);
    }
    const name = kept.join(" ").trim();
    if (!name) continue;
    order++;
    out.push({ name, team, pos, rank: rank ?? order });
  }
  return out;
}

// ---------- import row parsing (shared by the Imports tab and the loader) ----------
export function rowsFromCSV(text) {
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

export function rowsFromJSON(text) {
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
