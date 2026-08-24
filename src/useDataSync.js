// Every way the app pulls data, in one place, so the Board and the Setup tab
// drive the same code rather than two copies that drift apart.
//
// `refreshAll` is the one-button bootstrap (see bootstrap.js) — the same run
// Setup's "Refresh all data" performs. The single-source syncs stay exported
// because Setup still offers them one at a time when a provider is flaky.
import { useCallback, useState } from "react";
import { useStore } from "./store.jsx";
import { runBootstrap, bootstrapSteps } from "./bootstrap.js";
import {
  fetchSleeperPlayers, fetchSleeperTrending, fetchSleeperProjections,
  fetchEspnRanks, nflverseURL, aggregateNflverse, computeVacated,
} from "./fetchers.js";

export function useDataSync() {
  const { state, dispatch } = useStore();
  // Which pull is in flight: null | "all" | "sleeper" | "nfl" | "proj" | "espn".
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  // Per-step progress for the bootstrap run, so a caller can show the same
  // checklist Onboard does without owning the loop.
  const [steps, setSteps] = useState(null);

  const refreshAll = useCallback(async (season = new Date().getFullYear()) => {
    setBusy("all");
    const initial = bootstrapSteps(season).map((s) => ({ key: s.key, label: s.label, state: "waiting" }));
    setSteps(initial);
    const results = await runBootstrap(dispatch, season, (u) => {
      setSteps((cur) => (cur || initial).map((s) => (s.key === u.key ? { ...s, ...u } : s)));
    });
    const failed = results.filter((r) => !r.ok);
    setMsg(failed.length
      ? `Refreshed with ${failed.length} problem${failed.length > 1 ? "s" : ""}: ${failed.map((f) => f.key).join(", ")}.`
      : "All sources refreshed.");
    setBusy(null);
    return results;
  }, [dispatch]);

  const clearSteps = useCallback(() => setSteps(null), []);

  const syncSleeper = useCallback(async () => {
    setBusy("sleeper");
    try {
      const meta = await fetchSleeperPlayers();
      dispatch({ type: "SLEEPER_META", meta });
      const [adds, drops] = await Promise.all([fetchSleeperTrending("add"), fetchSleeperTrending("drop")]);
      dispatch({ type: "TRENDING", adds, drops });
      setMsg("Sleeper metadata, injuries, and trending synced.");
    } catch (e) { setMsg("Sleeper sync failed: " + e.message); }
    setBusy(null);
  }, [dispatch]);

  const fetchStats = useCallback(async (season) => {
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
  }, [dispatch, state.sleeperMeta]);

  const loadStatsFile = useCallback((f, season) => {
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
  }, [dispatch, state.sleeperMeta]);

  const syncProjections = useCallback(async (season) => {
    setBusy("proj");
    try {
      const { projRows, adpRows } = await fetchSleeperProjections(season);
      const stamp = new Date().toLocaleDateString();
      if (projRows.length) dispatch({ type: "IMPORT", name: `Sleeper proj ${season}`, srcType: "proj", rows: projRows });
      if (adpRows.length) dispatch({ type: "IMPORT", name: `Sleeper ADP ${stamp}`, srcType: "adp", rows: adpRows });
      setMsg(`Sleeper ${season}: ${projRows.length} stat projections, ${adpRows.length} ADP entries imported.`);
    } catch (e) { setMsg("Sleeper projections failed: " + e.message); }
    setBusy(null);
  }, [dispatch]);

  const syncEspn = useCallback(async (season) => {
    setBusy("espn");
    try {
      const { rankRows, adpRows } = await fetchEspnRanks(season);
      const stamp = new Date().toLocaleDateString();
      if (rankRows.length) dispatch({ type: "IMPORT", name: `ESPN rank ${season}`, srcType: "ranks", rows: rankRows });
      if (adpRows.length) dispatch({ type: "IMPORT", name: `ESPN ADP ${stamp}`, srcType: "adp", rows: adpRows });
      setMsg(`ESPN ${season}: ${rankRows.length} ranks, ${adpRows.length} ADP entries imported.`);
    } catch (e) { setMsg("ESPN fetch failed: " + e.message); }
    setBusy(null);
  }, [dispatch]);

  return { busy, msg, setMsg, steps, clearSteps, refreshAll, syncSleeper, fetchStats, loadStatsFile, syncProjections, syncEspn };
}
