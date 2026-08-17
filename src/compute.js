import { clamp } from "./util.js";

// ---------- scoring (Yahoo standard defaults, half PPR) ----------
export const DEFAULT_SCORING = {
  ppr: 0.5,          // points per reception
  tePremium: 0,      // extra points per TE reception
  passYd: 0.04,      // 1 pt / 25 yds
  passTD: 4,
  passInt: -1,
  rushYd: 0.1,
  rushTD: 6,
  recYd: 0.1,
  recTD: 6,
  fumbles: -2,
  ppfd: 0,           // points per first down
  bonusPass300: 0,
  bonusRush100: 0,
  bonusRec100: 0,
};

export const DEFAULT_ROSTER = {
  teams: 12, slot: 6,
  QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SFLEX: 0, K: 1, DST: 1, BN: 6, IR: 2,
  flexType: "WRT", // WRT | WR/RB | WR/TE | RB/WR/TE/QB handled by SFLEX
};

// Score a stat-projection row under the league's scoring rules.
export function scoreProjection(st, sc, pos) {
  if (!st) return null;
  const v = (k) => Number(st[k]) || 0;
  let pts =
    v("passYd") * sc.passYd + v("passTD") * sc.passTD + v("passInt") * sc.passInt +
    v("rushYd") * sc.rushYd + v("rushTD") * sc.rushTD +
    v("recYd") * sc.recYd + v("recTD") * sc.recTD +
    v("fumbles") * sc.fumbles + v("firstDowns") * sc.ppfd;
  pts += v("rec") * (sc.ppr + (pos === "TE" ? sc.tePremium : 0));
  if (v("passYd") >= 300) pts += sc.bonusPass300;
  if (v("rushYd") >= 100) pts += sc.bonusRush100;
  if (v("recYd") >= 100) pts += sc.bonusRec100;
  return pts;
}

// Fallback season-points curve by positional rank (approximate half-PPR shape).
// Used only when no projections source is imported; label it as such in the UI.
const CURVE = {
  QB: { top: 390, mid: 300, midRank: 12, floor: 200, floorRank: 30 },
  RB: { top: 330, mid: 200, midRank: 12, floor: 90, floorRank: 48 },
  WR: { top: 320, mid: 210, midRank: 12, floor: 100, floorRank: 60 },
  TE: { top: 250, mid: 140, midRank: 8, floor: 70, floorRank: 24 },
  K: { top: 150, mid: 130, midRank: 12, floor: 100, floorRank: 24 },
  DST: { top: 140, mid: 110, midRank: 12, floor: 80, floorRank: 24 },
};
export function curvePoints(pos, posRank) {
  const c = CURVE[pos] || CURVE.WR;
  if (posRank <= c.midRank) {
    const t = (posRank - 1) / Math.max(1, c.midRank - 1);
    return c.top - (c.top - c.mid) * Math.pow(t, 1.15);
  }
  const t = clamp((posRank - c.midRank) / Math.max(1, c.floorRank - c.midRank), 0, 1.4);
  return Math.max(30, c.mid - (c.mid - c.floor) * t);
}

// ---------- replacement level + VOR ----------
// pointsByPos: { QB: [{id, pts}, ...] sorted desc, ... }
// Returns { replacement: {pos: pts}, replRank: {pos: n} }
export function replacementLevels(roster, pointsByPos) {
  const teams = roster.teams;
  const starters = {};
  for (const p of ["QB", "RB", "WR", "TE", "K", "DST"]) starters[p] = teams * (roster[p] || 0);

  // Allocate FLEX and SFLEX greedily: each flex seat goes to the best remaining
  // player among eligible positions, league-wide.
  const flexElig = roster.flexType === "WR/RB" ? ["WR", "RB"]
    : roster.flexType === "WR/TE" ? ["WR", "TE"]
    : ["RB", "WR", "TE"];
  const cursor = {};
  for (const p in starters) cursor[p] = starters[p];

  const takeBest = (elig) => {
    let best = null;
    for (const p of elig) {
      const arr = pointsByPos[p] || [];
      const cand = arr[cursor[p]];
      if (cand && (!best || cand.pts > best.pts)) best = { pos: p, pts: cand.pts };
    }
    if (best) cursor[best.pos]++;
  };
  for (let i = 0; i < teams * (roster.FLEX || 0); i++) takeBest(flexElig);
  for (let i = 0; i < teams * (roster.SFLEX || 0); i++) takeBest(["QB", "RB", "WR", "TE"]);

  const replacement = {}, replRank = {};
  for (const p in starters) {
    const arr = pointsByPos[p] || [];
    const idx = Math.min(cursor[p], Math.max(0, arr.length - 1));
    replacement[p] = arr.length ? arr[idx]?.pts ?? arr[arr.length - 1].pts : 0;
    replRank[p] = cursor[p] + 1; // 1-based rank of first replacement-level player
  }
  return { replacement, replRank };
}

// ---------- consensus / stddev across sources ----------
export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
export function stddev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

// ---------- tier suggestion ----------
// items: [{id, value}] sorted ascending by value (consensus rank or points gap basis).
// Break where the gap to the next item exceeds mean gap + k·σ of gaps.
// Defaults are tuned for a full board (~200+ players): k=2/min=2 cut ~47 tiers
// out of 222 players, which is far finer than anyone drafts off. k=3/min=4
// lands around 16.
export function suggestTierBreaks(items, k = 3, minTierSize = 4) {
  if (items.length < 4) return [];
  const gaps = [];
  for (let i = 0; i < items.length - 1; i++) gaps.push(items[i + 1].value - items[i].value);
  // Trimmed mean: drop the largest 10% of gaps so one huge cliff doesn't
  // inflate the threshold and hide the smaller cliffs.
  const sorted = gaps.slice().sort((a, b) => a - b);
  const trimmed = sorted.slice(0, Math.max(2, sorted.length - Math.ceil(sorted.length * 0.1)));
  const thresh = Math.max(mean(trimmed) * k, 0.75);
  const breaks = [];
  let last = 0;
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] > thresh && i + 1 - last >= minTierSize) { breaks.push(i + 1); last = i + 1; }
  }
  // minTierSize only guards the distance since the previous break, so the final
  // tier can still come out as a runt. Merge it back into the one above.
  if (breaks.length && items.length - breaks[breaks.length - 1] < minTierSize) breaks.pop();
  return breaks; // indices where a new tier starts
}

// ---------- situation ratings ----------
// Scorecard sliders are 1-5, so raw metrics get ranked against their peers and
// split into even quintiles. Rank rather than absolute thresholds: EPA scales
// shift year to year, but "bottom five offenses in the league" does not.
// higherIsBetter=false for metrics where low is good (sack rate, SOS difficulty).
export function quintileRatings(map, higherIsBetter = true) {
  const entries = Object.entries(map).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return {};
  const sorted = entries.slice().sort((a, b) => (higherIsBetter ? a[1] - b[1] : b[1] - a[1]));
  const out = {};
  sorted.forEach(([k], i) => { out[k] = Math.min(5, Math.floor((i / sorted.length) * 5) + 1); });
  return out;
}

// Target competition for pass catchers: a player's own share of team targets is
// the inverse of how many mouths he competes with. Absolute thresholds here on
// purpose - a 25% target share means the same thing in any season.
export function targetCompRating(tgtShare) {
  if (!Number.isFinite(tgtShare)) return null;
  if (tgtShare >= 0.25) return 5;
  if (tgtShare >= 0.20) return 4;
  if (tgtShare >= 0.15) return 3;
  if (tgtShare >= 0.10) return 2;
  return 1;
}

// ---------- derived board metrics ----------
// Builds the full computed row set used by both table and cards.
export function computeBoard(state) {
  const { players, myRanks, sources, settings } = state;
  const rankSources = sources.filter((s) => s.type === "ranks");
  const adpSources = sources.filter((s) => s.type === "adp");
  const projSources = sources.filter((s) => s.type === "proj");
  const yahoo = adpSources.find((s) => /yahoo/i.test(s.name));
  const otherADP = adpSources.filter((s) => s !== yahoo);

  // per-player projected points (latest projections source wins)
  const proj = projSources.length ? projSources[projSources.length - 1] : null;
  const pointsByPos = {};
  const ptsById = {};
  const posLists = {};
  for (const p of Object.values(players)) {
    (posLists[p.pos] ||= []).push(p);
  }
  // order each position by consensus (or myRank) to feed the fallback curve
  const consensusOf = (p) => {
    const vals = rankSources.map((s) => s.map[p.id]).filter((v) => v != null);
    return vals.length ? mean(vals) : (myRanks.indexOf(p.id) + 1 || 9999);
  };
  for (const pos of Object.keys(posLists)) {
    const list = posLists[pos].slice().sort((a, b) => consensusOf(a) - consensusOf(b));
    pointsByPos[pos] = list.map((p, i) => {
      const stats = proj?.stats?.[p.id];
      const pts = stats ? scoreProjection(stats, settings.scoring, pos) : curvePoints(pos, i + 1);
      ptsById[p.id] = pts;
      return { id: p.id, pts };
    }).sort((a, b) => b.pts - a.pts);
  }
  const { replacement, replRank } = replacementLevels(settings.roster, pointsByPos);

  const rows = myRanks.map((id, i) => {
    const p = players[id];
    if (!p) return null;
    const myRank = i + 1;
    const rankVals = rankSources.map((s) => s.map[id]).filter((v) => v != null);
    const consensus = rankVals.length ? mean(rankVals) : null;
    const adpVals = adpSources.map((s) => s.map[id]).filter((v) => v != null);
    const yahooADP = yahoo ? yahoo.map[id] ?? null : null;
    const otherVals = otherADP.map((s) => s.map[id]).filter((v) => v != null);
    const yahooDelta = yahooADP != null && otherVals.length ? yahooADP - mean(otherVals) : null;
    const allVals = [...rankVals, ...adpVals];
    const sigma = stddev(allVals);
    const adpRef = yahooADP ?? (adpVals.length ? mean(adpVals) : null);
    const pts = ptsById[id] ?? null;
    const vor = pts != null && replacement[p.pos] != null ? pts - replacement[p.pos] : null;
    return {
      id, p, myRank, consensus,
      perSource: Object.fromEntries(sources.map((s) => [s.id, s.map[id] ?? null])),
      yahooADP, yahooDelta, sigma,
      adpDelta: adpRef != null ? myRank - adpRef : null,
      pts, vor,
    };
  }).filter(Boolean);

  return { rows, replacement, replRank, hasProj: !!proj, yahooSource: yahoo, adpSources, rankSources };
}
