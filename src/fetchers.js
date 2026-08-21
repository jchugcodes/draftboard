import { parseCSV, normName, normTeam } from "./util.js";

// ---------- Sleeper (free, public, CORS-friendly) ----------
// Player metadata + injury status. ~5 MB payload; we trim to what we use.
export async function fetchSleeperPlayers() {
  const res = await fetch("https://api.sleeper.app/v1/players/nfl");
  if (!res.ok) throw new Error(`Sleeper players: HTTP ${res.status}`);
  const raw = await res.json();
  const out = {}; // normName|pos -> meta
  for (const sp of Object.values(raw)) {
    if (!sp.full_name || !sp.position) continue;
    let pos = sp.position === "DEF" ? "DST" : sp.position;
    if (!["QB", "RB", "WR", "TE", "K", "DST"].includes(pos)) continue;
    const key = `${normName(sp.full_name)}|${pos}`;
    out[key] = {
      sleeperId: sp.player_id,
      team: normTeam(sp.team) || null,
      injury: sp.injury_status || null,
      status: sp.status || null,
      age: sp.age ?? null,
      yearsExp: sp.years_exp ?? null,
      number: sp.number ?? null,
    };
  }
  return out;
}

export async function fetchSleeperTrending(kind = "add", hours = 48, limit = 60) {
  const res = await fetch(`https://api.sleeper.app/v1/players/nfl/trending/${kind}?lookback_hours=${hours}&limit=${limit}`);
  if (!res.ok) throw new Error(`Sleeper trending: HTTP ${res.status}`);
  return res.json(); // [{player_id, count}]
}

// ---------- Sleeper season projections (free, public, CORS-friendly) ----------
// Returns both a stat-projection set and a half-PPR ADP set from one call, so
// Proj/VOR stop falling back to the generic positional curve.
export async function fetchSleeperProjections(season) {
  const pos = ["QB", "RB", "WR", "TE"].map((p) => `position[]=${p}`).join("&");
  const url = `https://api.sleeper.app/projections/nfl/${season}?season_type=regular&order_by=ppr&${pos}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper projections: HTTP ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error("Unexpected projections payload");

  const projRows = [];
  const adpRows = [];
  for (const e of raw) {
    const pl = e.player;
    const st = e.stats;
    if (!pl || !st) continue;
    const name = [pl.first_name, pl.last_name].filter(Boolean).join(" ").trim();
    const position = pl.position === "DEF" ? "DST" : pl.position;
    if (!name || !["QB", "RB", "WR", "TE"].includes(position)) continue;
    const team = normTeam(e.team) || null;

    // A projection row only counts if Sleeper actually projected volume for him.
    const hasVolume = ["pass_att", "rush_att", "rec"].some((k) => (st[k] ?? 0) > 0);
    if (hasVolume) {
      projRows.push({
        name, team, pos: position, rank: null,
        statLine: {
          passYd: st.pass_yd ?? 0, passTD: st.pass_td ?? 0, passInt: st.pass_int ?? 0,
          rushYd: st.rush_yd ?? 0, rushTD: st.rush_td ?? 0,
          rec: st.rec ?? 0, recYd: st.rec_yd ?? 0, recTD: st.rec_td ?? 0,
          fumbles: st.fum_lost ?? 0,
          firstDowns: (st.pass_fd ?? 0) + (st.rush_fd ?? 0) + (st.rec_fd ?? 0),
        },
      });
    }
    // 999 is Sleeper's "undrafted" sentinel, not a real ADP.
    const adp = st.adp_half_ppr;
    if (adp != null && adp > 0 && adp < 999) adpRows.push({ name, team, pos: position, rank: adp });
  }
  if (!projRows.length && !adpRows.length) throw new Error(`no ${season} projections returned`);
  adpRows.sort((a, b) => a.rank - b.rank);
  return { projRows, adpRows };
}

// ---------- nflverse weekly player stats → season aggregates ----------
// Release asset (CORS-enabled): stats_player_week_{season}.csv
export function nflverseURL(season) {
  return `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
}

const num = (v) => { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; };

// Aggregates a weekly stats CSV (regular season) into per-player season lines,
// plus team totals so we can derive shares.
export function aggregateNflverse(csvText) {
  const rows = parseCSV(csvText);
  if (!rows.length) throw new Error("Empty stats file");
  const H = {};
  rows[0].forEach((h, i) => (H[h.trim()] = i));
  const col = (r, name) => (H[name] !== undefined ? r[H[name]] : "");
  const need = ["player_display_name", "position", "team"].filter((c) => H[c] === undefined);
  if (need.length) throw new Error("Unrecognized stats format (missing: " + need.join(", ") + ")");

  const players = {}; // name|pos
  const teams = {};   // team totals
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (H["season_type"] !== undefined && col(r, "season_type") !== "REG") continue;
    let pos = col(r, "position");
    if (pos === "DEF") pos = "DST";
    if (!["QB", "RB", "WR", "TE"].includes(pos)) continue;
    const name = col(r, "player_display_name");
    const team = normTeam(col(r, "team") || col(r, "recent_team"));
    const key = `${normName(name)}|${pos}`;
    const p = (players[key] ||= { name, pos, team, games: 0,
      targets: 0, rec: 0, recYd: 0, recTD: 0, airYd: 0, rzTgt: 0,
      carries: 0, rushYd: 0, rushTD: 0, glCarries: 0, rzTouch: 0,
      dropbacks: 0, passYd: 0, passTD: 0, passAtt: 0, rushAtt: 0,
      snaps: null, fp: 0 });
    p.team = team || p.team;
    p.games++;
    p.targets += num(col(r, "targets"));
    p.rec += num(col(r, "receptions"));
    p.recYd += num(col(r, "receiving_yards"));
    p.recTD += num(col(r, "receiving_tds"));
    p.airYd += num(col(r, "receiving_air_yards"));
    p.carries += num(col(r, "carries"));
    p.rushYd += num(col(r, "rushing_yards"));
    p.rushTD += num(col(r, "rushing_tds"));
    p.passYd += num(col(r, "passing_yards"));
    p.passTD += num(col(r, "passing_tds"));
    p.passAtt += num(col(r, "attempts"));
    p.dropbacks += num(col(r, "attempts")) + num(col(r, "sacks_suffered")) ;
    p.fp += num(col(r, "fantasy_points_ppr")) - 0.5 * num(col(r, "receptions")); // → half-PPR
    const t = (teams[team] ||= { targets: 0, airYd: 0, carries: 0, rushTD: 0, recTD: 0 });
    t.targets += num(col(r, "targets"));
    t.airYd += num(col(r, "receiving_air_yards"));
    t.carries += num(col(r, "carries"));
    t.rushTD += num(col(r, "rushing_tds"));
    t.recTD += num(col(r, "receiving_tds"));
  }

  // derive shares / rates
  for (const p of Object.values(players)) {
    const t = teams[p.team] || {};
    p.tgtShare = t.targets ? p.targets / t.targets : null;
    p.airShare = t.airYd ? p.airYd / t.airYd : null;
    p.wopr = p.tgtShare != null && p.airShare != null ? 1.5 * p.tgtShare + 0.7 * p.airShare : null;
    p.adot = p.targets ? p.airYd / p.targets : null;
    p.carryShare = t.carries ? p.carries / t.carries : null;
    p.fpg = p.games ? p.fp / p.games : null;
    p.ypc = p.carries ? p.rushYd / p.carries : null;
    p.ypt = p.targets ? p.recYd / p.targets : null;
  }
  return { players, teams };
}

// Vacated opportunity: last-season production of players who are no longer on
// that team per current Sleeper metadata (cut, traded, signed elsewhere, FA).
export function computeVacated(nflverseAgg, sleeperMeta) {
  const vac = {}; // team -> {targets, carries, tds, names: []}
  for (const [key, p] of Object.entries(nflverseAgg.players)) {
    const meta = sleeperMeta?.[key];
    const currentTeam = meta ? meta.team : undefined; // undefined = unknown
    if (currentTeam === undefined) continue; // can't tell without metadata
    if (currentTeam !== p.team) {
      const v = (vac[p.team] ||= { targets: 0, carries: 0, tds: 0, names: [] });
      v.targets += p.targets;
      v.carries += p.carries;
      v.tds += p.recTD + p.rushTD;
      if (p.targets + p.carries > 20) v.names.push(`${p.name} (${p.targets}t/${p.carries}c)`);
    }
  }
  return vac;
}

// ---------- Google News RSS (optional, via user-supplied CORS proxy) ----------
export function newsRSSUrl(name, team) {
  const q = encodeURIComponent(`${name} ${team || ""} fantasy`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}
export async function fetchRSSHeadlines(proxy, rssUrl, max = 8) {
  const url = proxy.includes("{url}") ? proxy.replace("{url}", encodeURIComponent(rssUrl)) : proxy + encodeURIComponent(rssUrl);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RSS fetch: HTTP ${res.status}`);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, "text/xml");
  return [...doc.querySelectorAll("item")].slice(0, max).map((it) => ({
    title: it.querySelector("title")?.textContent || "",
    link: it.querySelector("link")?.textContent || "",
    date: it.querySelector("pubDate")?.textContent || "",
  }));
}

// ---------- ESPN draft rankings + ADP ----------
// ESPN's fantasy app reads this unauthenticated JSON endpoint and it reflects
// the caller's Origin, so the browser can hit it directly. It is undocumented,
// so treat a shape change as expected breakage rather than a bug.
const ESPN_POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" };
const ESPN_TEAM = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

export async function fetchEspnRanks(season, limit = 300) {
  const filter = { players: { limit, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" } } };
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`;
  const res = await fetch(url, { headers: { "x-fantasy-filter": JSON.stringify(filter) } });
  if (!res.ok) throw new Error(`ESPN: HTTP ${res.status}`);
  const data = await res.json();
  const list = data?.players;
  if (!Array.isArray(list) || !list.length) throw new Error(`no ${season} players returned`);

  const rankRows = [];
  const adpRows = [];
  for (const entry of list) {
    const pl = entry.player;
    if (!pl?.fullName) continue;
    const pos = ESPN_POS[pl.defaultPositionId];
    if (!pos) continue;
    const team = ESPN_TEAM[pl.proTeamId] || null; // 0 = free agent
    const base = { name: pl.fullName, team, pos };

    const dr = pl.draftRanksByRankType || {};
    const rank = (dr.PPR || dr.STANDARD)?.rank;
    if (rank > 0) rankRows.push({ ...base, rank });

    const adp = pl.ownership?.averageDraftPosition;
    if (adp > 0) adpRows.push({ ...base, rank: adp });
  }
  if (!rankRows.length && !adpRows.length) throw new Error("no ranks or ADP in payload — ESPN shape may have changed");
  rankRows.sort((a, b) => a.rank - b.rank);
  adpRows.sort((a, b) => a.rank - b.rank);
  return { rankRows, adpRows };
}
