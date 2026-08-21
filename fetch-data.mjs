// Bake the datasets that need a server into public/data/, so the app can read
// them from its own origin instead of asking a person to run a script and hand
// it a file. CI runs this before the build, which makes every deploy a data
// refresh. Failures are non-fatal: the app degrades to its live sources.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = "public/data";
mkdirSync(OUT, { recursive: true });

const season = Number(process.argv.find((a) => a.startsWith("--season="))?.split("=")[1] ?? new Date().getFullYear());
const meta = { generated: new Date().toISOString(), season, sets: {} };

const run = (label, file, args, produces) => {
  try {
    execFileSync(process.execPath, [file, ...args], { stdio: "pipe" });
    if (!existsSync(produces)) throw new Error("script wrote nothing");
    meta.sets[label] = { file: produces.replace("public/", ""), ok: true };
    console.log(`  ok   ${label} -> ${produces}`);
  } catch (e) {
    meta.sets[label] = { ok: false, error: String(e.message || e).slice(0, 200) };
    console.log(`  SKIP ${label}: ${String(e.message || e).slice(0, 120)}`);
  }
};

console.log("baking public/data …");
run("adp", "fetch-adp.mjs", [`--year=${season}`, `--out=${OUT}/adp.csv`], `${OUT}/adp.csv`);
run("situation", "fetch-situation.mjs", [`--season=${season}`, `--out=${OUT}/situation.json`], `${OUT}/situation.json`);

writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2));
const okCount = Object.values(meta.sets).filter((s) => s.ok).length;
console.log(`wrote ${OUT}/meta.json — ${okCount}/${Object.keys(meta.sets).length} sets baked`);
