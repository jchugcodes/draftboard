// Build per-team situation-scorecard ratings from nflverse open data and write
// a JSON the Imports tab can apply to every player's scorecard.
//
// Runs locally, not in the browser: the nflverse release host sends no CORS
// headers, same as the season-stats fetch.
//
//   node fetch-situation.mjs                    → situation-2026.json
//   node fetch-situation.mjs --season=2026      # schedule season to rate SOS for
//   node fetch-situation.mjs --keep             # keep the downloaded CSVs
//
// Team quality comes from the last COMPLETED season; SOS uses the upcoming
// schedule crossed with those same defensive numbers. Everything except SOS is
// therefore backward-looking - it cannot see coaching changes or roster moves.
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { parseCSV, normTeam } from "./src/util.js";
import { quintileRatings } from "./src/compute.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const scheduleSeason = Number(args.season ?? new Date().getFullYear());
const statsSeason = scheduleSeason - 1; // last completed season
const out = String(args.out ?? `situation-${scheduleSeason}.json`);
const PLAYOFF_WEEKS = [15, 16, 17];

const GAMES_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv";
const teamStatsURL = (s) => `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${s}.csv`;

async function grab(url, file) {
  if (existsSync(file)) { console.log(`using local ${file}`); return readFileSync(file, "utf8"); }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}

const num = (v) => { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; };

const gamesFile = "games.csv";
const statsFile = `stats_team_week_${statsSeason}.csv`;
const [gamesText, statsText] = await Promise.all([grab(GAMES_URL, gamesFile), grab(teamStatsURL(statsSeason), statsFile)]);

// ---------- last completed season: per-team offense, and defense allowed ----------
const rows = parseCSV(statsText);
const H = {};
rows[0].forEach((h, i) => (H[h.trim()] = i));
const need = ["team", "opponent_team", "season_type", "attempts", "carries", "sacks_suffered", "passing_epa", "rushing_epa", "passing_cpoe"];
const missing = need.filter((c) => H[c] === undefined);
if (missing.length) throw new Error(`stats_team columns missing: ${missing.join(", ")}`);
const col = (r, name) => r[H[name]];

const off = {}; // team -> offensive totals
const defAllowed = {}; // team -> EPA/play its defense gave up
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (col(r, "season_type") !== "REG") continue;
  const team = normTeam(col(r, "team"));
  const opp = normTeam(col(r, "opponent_team"));
  if (!team || !opp) continue;
  const dropbacks = num(col(r, "attempts")) + num(col(r, "sacks_suffered"));
  const carries = num(col(r, "carries"));
  const plays = dropbacks + carries;
  const epa = num(col(r, "passing_epa")) + num(col(r, "rushing_epa"));

  const o = (off[team] ||= { games: 0, plays: 0, dropbacks: 0, carries: 0, sacks: 0, epa: 0, passEpa: 0, rushEpa: 0, cpoe: 0, cpoeWeeks: 0 });
  o.games++; o.plays += plays; o.dropbacks += dropbacks; o.carries += carries;
  o.sacks += num(col(r, "sacks_suffered"));
  o.epa += epa; o.passEpa += num(col(r, "passing_epa")); o.rushEpa += num(col(r, "rushing_epa"));
  const cp = parseFloat(col(r, "passing_cpoe"));
  if (!Number.isNaN(cp)) { o.cpoe += cp; o.cpoeWeeks++; }

  // What this offense did IS what the opponent's defense allowed.
  const d = (defAllowed[opp] ||= { plays: 0, epa: 0 });
  d.plays += plays; d.epa += epa;
}

const teams = Object.keys(off).sort();
if (teams.length < 30) throw new Error(`only ${teams.length} teams parsed from ${statsFile} — unexpected format`);

const raw = {
  offense: {},    // EPA per play
  qb: {},         // pass EPA per dropback, nudged by CPOE
  olinePass: {},  // sack rate (low is good)
  olineRun: {},   // rush EPA per carry
  pace: {},       // plays per game
};
for (const t of teams) {
  const o = off[t];
  raw.offense[t] = o.plays ? o.epa / o.plays : null;
  raw.qb[t] = o.dropbacks ? o.passEpa / o.dropbacks + (o.cpoeWeeks ? (o.cpoe / o.cpoeWeeks) / 100 : 0) : null;
  raw.olinePass[t] = o.dropbacks ? o.sacks / o.dropbacks : null;
  raw.olineRun[t] = o.carries ? o.rushEpa / o.carries : null;
  raw.pace[t] = o.games ? o.plays / o.games : null;
}
const defStrength = {}; // EPA/play allowed — higher means a worse defense, i.e. easier opponent
for (const t of teams) defStrength[t] = defAllowed[t]?.plays ? defAllowed[t].epa / defAllowed[t].plays : null;

// ---------- upcoming schedule: strength of schedule ----------
const gRows = parseCSV(gamesText);
const G = {};
gRows[0].forEach((h, i) => (G[h.trim()] = i));
for (const c of ["season", "week", "game_type", "home_team", "away_team"]) {
  if (G[c] === undefined) throw new Error(`games.csv missing column: ${c}`);
}
const oppsOf = {}; // team -> [{week, opp}]
for (let i = 1; i < gRows.length; i++) {
  const r = gRows[i];
  if (Number(r[G.season]) !== scheduleSeason || r[G.game_type] !== "REG") continue;
  const home = normTeam(r[G.home_team]);
  const away = normTeam(r[G.away_team]);
  const wk = Number(r[G.week]);
  (oppsOf[home] ||= []).push({ week: wk, opp: away });
  (oppsOf[away] ||= []).push({ week: wk, opp: home });
}
const scheduled = Object.keys(oppsOf).length;
if (!scheduled) throw new Error(`no ${scheduleSeason} regular-season games in games.csv — is the schedule published yet?`);

// Mean defensive strength faced. Higher = softer defenses = better for fantasy.
const sosMean = (list) => {
  const vals = list.map(({ opp }) => defStrength[opp]).filter(Number.isFinite);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
raw.sosSeason = {};
raw.sosPlayoff = {};
for (const t of Object.keys(oppsOf)) {
  raw.sosSeason[t] = sosMean(oppsOf[t]);
  raw.sosPlayoff[t] = sosMean(oppsOf[t].filter((g) => PLAYOFF_WEEKS.includes(g.week)));
}

// ---------- to 1-5 ----------
// olinePass is a sack rate, so low is good; everything else is higher-is-better
// (SOS included, since a high EPA-allowed opponent set is a soft schedule).
const ratings = {
  offense: quintileRatings(raw.offense, true),
  qb: quintileRatings(raw.qb, true),
  olinePass: quintileRatings(raw.olinePass, false),
  olineRun: quintileRatings(raw.olineRun, true),
  pace: quintileRatings(raw.pace, true),
  sosSeason: quintileRatings(raw.sosSeason, true),
  sosPlayoff: quintileRatings(raw.sosPlayoff, true),
};

const byTeam = {};
for (const t of new Set([...teams, ...Object.keys(oppsOf)])) {
  const entry = {};
  for (const [field, table] of Object.entries(ratings)) if (table[t] != null) entry[field] = table[t];
  if (Object.keys(entry).length) byTeam[t] = entry;
}

writeFileSync(out, JSON.stringify({
  app: "draftboard-situation",
  version: 1,
  statsSeason,
  scheduleSeason,
  generated: new Date().toISOString(),
  teams: byTeam,
}, null, 2));

if (!args.keep) for (const f of [gamesFile, statsFile]) { try { unlinkSync(f); } catch {} }

console.log(`wrote ${out} — ${Object.keys(byTeam).length} teams`);
console.log(`  team quality from ${statsSeason}; SOS from the ${scheduleSeason} schedule (${scheduled} teams scheduled)`);
const show = ["offense", "qb", "olinePass", "olineRun", "pace", "sosSeason", "sosPlayoff"];
const best = Object.entries(byTeam).sort((a, b) => (b[1].offense ?? 0) - (a[1].offense ?? 0)).slice(0, 5);
console.log(`  ${"team".padEnd(5)}${show.map((s) => s.slice(0, 8).padEnd(9)).join("")}`);
for (const [t, v] of best) console.log(`  ${t.padEnd(5)}${show.map((s) => String(v[s] ?? "-").padEnd(9)).join("")}`);
