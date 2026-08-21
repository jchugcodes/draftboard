// One call that fills an empty board. Each step is independent and reports its
// own outcome, so a provider being down costs you that column and nothing else.
// Baked files come from this app's own origin (see fetch-data.mjs + CI), which
// is why they need no CORS and no file picker.
import { rowsFromCSV } from "./util.js";
import { fetchEspnRanks, fetchSleeperProjections, fetchSleeperPlayers, fetchSleeperTrending } from "./fetchers.js";

const baked = (name) => new URL(`./data/${name}`, document.baseURI).href;

export async function loadBakedMeta() {
  try {
    const res = await fetch(baked("meta.json"), { cache: "no-cache" });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// step: {key, label, run} — run returns a short outcome string or throws.
export function bootstrapSteps(season) {
  return [
    {
      key: "espn",
      label: "ESPN ranks + ADP",
      async run(dispatch) {
        const { rankRows, adpRows } = await fetchEspnRanks(season);
        if (rankRows.length) dispatch({ type: "IMPORT", name: `ESPN rank ${season}`, srcType: "ranks", rows: rankRows });
        if (adpRows.length) dispatch({ type: "IMPORT", name: `ESPN ADP`, srcType: "adp", rows: adpRows });
        return `${rankRows.length} ranks · ${adpRows.length} ADP`;
      },
    },
    {
      key: "sleeper-proj",
      label: "Sleeper projections + ADP",
      async run(dispatch) {
        const { projRows, adpRows } = await fetchSleeperProjections(season);
        if (projRows.length) dispatch({ type: "IMPORT", name: `Sleeper proj ${season}`, srcType: "proj", rows: projRows });
        if (adpRows.length) dispatch({ type: "IMPORT", name: `Sleeper ADP`, srcType: "adp", rows: adpRows });
        return `${projRows.length} projections · ${adpRows.length} ADP`;
      },
    },
    {
      key: "ffc",
      label: "Consensus ADP (mock drafts)",
      async run(dispatch) {
        const res = await fetch(baked("adp.csv"), { cache: "no-cache" });
        if (!res.ok) throw new Error("not baked into this build");
        const parsed = rowsFromCSV(await res.text());
        if (!parsed?.rows?.length) throw new Error("empty file");
        dispatch({ type: "IMPORT", name: "Consensus ADP", srcType: "adp", rows: parsed.rows });
        return `${parsed.rows.length} players`;
      },
    },
    {
      key: "sleeper-meta",
      label: "Injuries + trending",
      async run(dispatch) {
        const meta = await fetchSleeperPlayers();
        dispatch({ type: "SLEEPER_META", meta });
        const [adds, drops] = await Promise.all([fetchSleeperTrending("add"), fetchSleeperTrending("drop")]);
        dispatch({ type: "TRENDING", adds, drops });
        return "synced";
      },
    },
    {
      key: "situation",
      label: "Situation scorecards",
      async run(dispatch) {
        const res = await fetch(baked("situation.json"), { cache: "no-cache" });
        if (!res.ok) throw new Error("not baked into this build");
        const data = await res.json();
        if (data.app !== "draftboard-situation" || !data.teams) throw new Error("unexpected file");
        dispatch({ type: "APPLY_SITUATION", teams: data.teams, meta: { statsSeason: data.statsSeason, scheduleSeason: data.scheduleSeason } });
        return `${Object.keys(data.teams).length} teams`;
      },
    },
  ];
}

// Runs steps in order, reporting progress. Order matters: player rows must exist
// before Sleeper metadata and situation ratings have anything to attach to.
export async function runBootstrap(dispatch, season, onProgress) {
  const steps = bootstrapSteps(season);
  const results = [];
  for (const s of steps) {
    onProgress({ key: s.key, label: s.label, state: "running" });
    try {
      const detail = await s.run(dispatch);
      results.push({ key: s.key, ok: true, detail });
      onProgress({ key: s.key, label: s.label, state: "done", detail });
    } catch (e) {
      const msg = String(e.message || e);
      results.push({ key: s.key, ok: false, detail: msg });
      onProgress({ key: s.key, label: s.label, state: "failed", detail: msg });
    }
  }
  return results;
}
