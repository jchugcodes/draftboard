// ---------- generic helpers ----------
export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const fmt = (n, d = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? "–" : Number(n).toFixed(d).replace(/\.0$/, d === 1 ? "" : ".0");
export const pct = (n) => (n === null || n === undefined || Number.isNaN(n) ? "–" : (n * 100).toFixed(1) + "%");
export const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];

export const POS_STYLE = {
  QB: { chip: "bg-rose-500/15 text-rose-300 border-rose-500/30", rail: "bg-rose-400", text: "text-rose-300" },
  RB: { chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", rail: "bg-emerald-400", text: "text-emerald-300" },
  WR: { chip: "bg-sky-500/15 text-sky-300 border-sky-500/30", rail: "bg-sky-400", text: "text-sky-300" },
  TE: { chip: "bg-amber-500/15 text-amber-300 border-amber-500/30", rail: "bg-amber-400", text: "text-amber-300" },
  K: { chip: "bg-violet-500/15 text-violet-300 border-violet-500/30", rail: "bg-violet-400", text: "text-violet-300" },
  DST: { chip: "bg-slate-500/15 text-slate-300 border-slate-500/30", rail: "bg-slate-400", text: "text-slate-300" },
};

export const TAGS = [
  { key: "favorite", label: "Favorite", num: "1", cls: "bg-yellow-400/15 text-yellow-300 border-yellow-400/40", dot: "bg-yellow-400" },
  { key: "sleeper", label: "Sleeper", num: "2", cls: "bg-purple-400/15 text-purple-300 border-purple-400/40", dot: "bg-purple-400" },
  { key: "reliable", label: "Reliable", num: "3", cls: "bg-teal-400/15 text-teal-300 border-teal-400/40", dot: "bg-teal-400" },
  { key: "avoid", label: "Avoid", num: "4", cls: "bg-red-400/15 text-red-300 border-red-400/40", dot: "bg-red-400" },
  { key: "handcuff", label: "Handcuff", num: "5", cls: "bg-orange-400/15 text-orange-300 border-orange-400/40", dot: "bg-orange-400" },
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
const POS_RE = /\b(QB|RB|WR|TE|K|DST|DEF|D\/ST)\s*\d{0,2}\b/i;
export function parsePastedList(text) {
  const out = [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let order = 0;
  for (const raw of lines) {
    let line = raw;
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
    const kept = [];
    for (const t of tokens) {
      const u = normTeam(t);
      if (!team && t === t.toUpperCase() && t.length >= 2 && t.length <= 3 && (NFL_TEAMS.includes(u))) team = u;
      else if (!/^\d+$/.test(t)) kept.push(t);
    }
    const name = kept.join(" ").trim();
    if (!name) continue;
    order++;
    out.push({ name, team, pos, rank: rank ?? order });
  }
  return out;
}
