// Pull consensus ADP from the Fantasy Football Calculator public API and emit a
// CSV in the shape the Imports tab expects (name,team,pos,bye,rank).
//
// Run locally, not in the browser: the API sends no CORS headers, so the app
// itself can't fetch it. Keeping this out-of-band also keeps the app backendless.
//
//   node fetch-adp.mjs                                  → adp-half-ppr-12.csv
//   node fetch-adp.mjs --teams=10 --format=ppr
//   node fetch-adp.mjs --year=2025 --out=last-year.csv
import { writeFileSync } from "node:fs";
import { normTeam } from "./src/util.js";

const FORMATS = ["half-ppr", "ppr", "standard", "2qb", "dynasty", "rookie"];

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const format = String(args.format ?? "half-ppr");
const teams = Number(args.teams ?? 12);
const year = Number(args.year ?? new Date().getFullYear());

if (!FORMATS.includes(format)) {
  console.error(`Unknown --format "${format}". Options: ${FORMATS.join(", ")}`);
  process.exit(1);
}
if (!Number.isInteger(teams) || teams < 6 || teams > 16) {
  console.error(`--teams must be an integer 6-16 (got "${args.teams}")`);
  process.exit(1);
}

const out = String(args.out ?? `adp-${format}-${teams}.csv`);
const url = `https://fantasyfootballcalculator.com/api/v1/adp/${format}?teams=${teams}&year=${year}&position=all`;

// FFC uses PK/DEF; the app's pool uses K/DST.
const POS = { PK: "K", K: "K", DEF: "DST", "D/ST": "DST", DST: "DST" };

const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const res = await fetch(url);
if (!res.ok) {
  console.error(`FFC API: HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
const data = await res.json();
if (data.status !== "Success" || !Array.isArray(data.players) || !data.players.length) {
  console.error(`FFC API returned no players (status: ${data.status ?? "?"}). Is ${year} drafted yet?`);
  process.exit(1);
}

// API returns players in ADP order; rank by that rather than trusting adp ties.
const rows = data.players.map((p, i) => ({
  name: p.name,
  team: normTeam(p.team),
  pos: POS[p.position] || p.position,
  bye: p.bye || "",
  rank: p.adp ?? i + 1,
}));

const lines = ["name,team,pos,bye,rank"];
for (const r of rows) lines.push([r.name, r.team, r.pos, r.bye, r.rank].map(csvCell).join(","));
writeFileSync(out, lines.join("\n") + "\n");

const byPos = {};
for (const r of rows) byPos[r.pos] = (byPos[r.pos] || 0) + 1;
const m = data.meta ?? {};
const staleDays = m.end_date ? Math.floor((Date.now() - new Date(m.end_date).getTime()) / 86400000) : null;

console.log(`wrote ${out} — ${rows.length} players`);
console.log(`  ${m.type ?? format}, ${m.teams ?? teams}-team, ${m.total_drafts ?? "?"} drafts, ${m.start_date ?? "?"} → ${m.end_date ?? "?"}`);
console.log(`  ${Object.entries(byPos).map(([k, v]) => `${k} ${v}`).join("  ")}`);
if (staleDays !== null && staleDays > 7) console.log(`  NOTE: data is ${staleDays} days old — the app will flag this source as stale.`);
