import { parseCSV, mapHeaders, parsePastedList, normName, similarity, findCandidates, playerKey, normTeam, migrateTierBreaks, consensusOrder, addTierBreak, removeTierBreak, moveTierBreak, boardSnapshot, diffSnapshots, summarizeDiff } from "./src/util.js";
import { scoreProjection, DEFAULT_SCORING, replacementLevels, suggestTierBreaks, stddev, quintileRatings, targetCompRating } from "./src/compute.js";
import { aggregateNflverse, computeVacated } from "./src/fetchers.js";
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("FAIL:", msg); } };

const csv = parseCSV('Player,Team,Pos,Bye,Rank\n"Smith, John",DET,WR,5,1\nA B,KC,RB2,10,2');
ok(csv.length === 3 && csv[1][0] === "Smith, John", "csv quoted comma");
const H = mapHeaders(csv[0]);
ok(H.name === 0 && H.team === 1 && H.pos === 2 && H.bye === 3 && H.rank === 4, "header map");

const pl = parsePastedList("1. Justin Jefferson MIN WR\n2) Bijan Robinson - ATL RB1\nCeeDee Lamb, DAL WR");
ok(pl.length === 3 && pl[0].team === "MIN" && pl[0].pos === "WR" && pl[0].rank === 1, JSON.stringify(pl[0]));
ok(pl[1].name === "Bijan Robinson" && pl[1].pos === "RB", JSON.stringify(pl[1]));
ok(pl[2].rank === 3 && pl[2].team === "DAL", JSON.stringify(pl[2]));

ok(normName("A.J. Brown Jr.") === "a j brown", normName("A.J. Brown Jr."));
ok(similarity(normName("Kenneth Walker III"), normName("Kenneth Walker")) > 0.9, "walker sim");
ok(normTeam("JAC") === "JAX" && normTeam("gnb") === "GB", "team alias");
const kw = playerKey("Kenneth Walker", "RB");
const pool = { [kw]: { id: kw, name: "Kenneth Walker", pos: "RB" } };
const cands = findCandidates("Kenneth Walker III", "RB", pool);
ok(cands.length && cands[0].score > 0.85, "candidates");

const pts = scoreProjection({ passYd: 4000, passTD: 30, passInt: 10, rushYd: 300, rushTD: 3 }, DEFAULT_SCORING, "QB");
ok(Math.abs(pts - (160 + 120 - 10 + 30 + 18)) < 0.01, "QB score " + pts);
const te = scoreProjection({ rec: 80, recYd: 800, recTD: 6 }, { ...DEFAULT_SCORING, tePremium: 0.5 }, "TE");
ok(Math.abs(te - (80 * 1.0 + 80 + 36)) < 0.01, "TE premium " + te);

const mk = (n, base, drop) => Array.from({ length: n }, (_, i) => ({ id: i, pts: base - i * drop }));
const pbp = { QB: mk(30, 380, 8), RB: mk(60, 320, 5), WR: mk(70, 310, 4), TE: mk(30, 240, 8), K: mk(24, 140, 2), DST: mk(24, 130, 2) };
const { replacement, replRank } = replacementLevels({ teams: 12, QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DST: 1, FLEX: 1, SFLEX: 0, flexType: "WRT" }, pbp);
ok(replRank.QB === 13, "QB repl rank " + replRank.QB);
const flexTotal = (replRank.RB - 1 - 24) + (replRank.WR - 1 - 36) + (replRank.TE - 1 - 12);
ok(flexTotal === 12, "flex seats allocated: " + flexTotal + " " + JSON.stringify(replRank));
ok(replacement.RB < 320 && replacement.RB > 0, "RB repl pts");

const items = [1, 2, 3, 9, 10, 11, 25, 26].map((v, i) => ({ id: i, value: v }));
const br = suggestTierBreaks(items, 1.0, 2); // minTierSize explicit: this fixture is 8 items
ok(br.includes(3) && br.includes(6), "tier breaks " + JSON.stringify(br));

ok(Math.abs(stddev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.01, "stddev");

// suggestTierBreaks must not leave a runt final tier
const runt = [1, 2, 3, 4, 5, 6, 7, 8, 40].map((v, i) => ({ id: i, value: v }));
const rb = suggestTierBreaks(runt, 2, 4);
ok(rb.every((b) => runt.length - b >= 4), "no runt final tier " + JSON.stringify(rb));

// board history: snapshots capture edits, diffs describe them
{
  const mk = (ranks, extra = {}) => ({
    myRanks: ranks, tierBreaks: { all: [] }, tierNames: {},
    players: Object.fromEntries(ranks.map((id) => [id, { tags: [], notes: "", handcuffOf: null, scorecard: { offense: 3 } }])),
    ...extra,
  });
  const snapA = boardSnapshot(mk(["a", "b", "c"]));
  ok(snapA.myRanks.length === 3 && snapA.players.a && !("sources" in snapA), "snapshot keeps only edited fields");

  const snapB = boardSnapshot(mk(["b", "a", "c"]));
  const d = diffSnapshots(snapA, snapB);
  ok(d.moved.length === 2, "diff detects moves " + JSON.stringify(d.moved));
  ok(d.moved[0].from === 1 && d.moved[0].to === 2 || d.moved[0].from === 2, "diff reports from/to");
  ok(summarizeDiff(d).includes("moved"), "summary mentions moves: " + summarizeDiff(d));

  ok(summarizeDiff(diffSnapshots(snapA, snapA)) === "no changes", "identical snapshots read as no changes");

  const withTier = boardSnapshot(mk(["a", "b", "c"], { tierBreaks: { all: [1] } }));
  ok(diffSnapshots(snapA, withTier).tiers === 1, "diff counts tier changes");

  const tagged = boardSnapshot({ ...mk(["a", "b", "c"]), players: { a: { tags: ["favorite"], notes: "", handcuffOf: null, scorecard: { offense: 3 } } } });
  ok(diffSnapshots(snapA, tagged).tagged === 1, "diff counts tag changes");
}

// consensus ordering seeds a fresh board
{
  const srcs = [
    { type: "ranks", map: { a: 3, b: 1, c: 2 } },
    { type: "adp", map: { a: 5, b: 1, c: 2 } },
    { type: "proj", map: { a: 1, b: 99, c: 99 } }, // must be ignored
  ];
  const ord = consensusOrder(["a", "b", "c"], srcs);
  ok(JSON.stringify(ord) === '["b","c","a"]', "consensus order " + JSON.stringify(ord));

  const withUnranked = consensusOrder(["a", "z", "b"], [{ type: "ranks", map: { a: 2, b: 1 } }]);
  ok(withUnranked[2] === "z", "unranked sink to the bottom " + JSON.stringify(withUnranked));

  const tie = consensusOrder(["x", "y"], [{ type: "ranks", map: { x: 4, y: 4 } }]);
  ok(JSON.stringify(tie) === '["x","y"]', "ties keep existing order");
  ok(consensusOrder(["a"], []).length === 1, "no sources is a no-op");
}

// tier dividers: labels must follow their group when dividers move
{
  const breaks = [5, 10];
  const names = { 1: "Elite", 2: "Mid", 3: "Dart" };
  const added = addTierBreak(breaks, names, 7); // splits tier 2
  ok(JSON.stringify(added.breaks) === "[5,7,10]", "add break sorted " + JSON.stringify(added.breaks));
  ok(added.names[1] === "Elite" && added.names[2] === "Mid" && added.names[4] === "Dart",
    "add shifts labels below the split " + JSON.stringify(added.names));
  ok(added.names[3] === undefined, "new tier starts unnamed");

  const removed = removeTierBreak(breaks, names, 5); // merges tier 2 up into 1
  ok(JSON.stringify(removed.breaks) === "[10]", "remove break " + JSON.stringify(removed.breaks));
  ok(removed.names[1] === "Elite" && removed.names[2] === "Dart", "remove pulls labels up " + JSON.stringify(removed.names));

  const moved = moveTierBreak(breaks, names, 10, 8); // tier 3's divider slides up
  ok(JSON.stringify(moved.breaks) === "[5,8]", "move break " + JSON.stringify(moved.breaks));
  ok(moved.names[3] === "Dart" && moved.names[1] === "Elite", "label rides along " + JSON.stringify(moved.names));

  ok(addTierBreak([5], {}, 5).breaks.length === 1, "no duplicate break");
  ok(addTierBreak([], {}, 0).breaks.length === 0, "no break at row 0");
}

// situation ratings: even quintiles, and direction respected
const tenTeams = {}; for (let i = 0; i < 10; i++) tenTeams["T" + i] = i; // 0 worst .. 9 best
const hi = quintileRatings(tenTeams, true);
ok(hi.T0 === 1 && hi.T9 === 5, "quintile higher-is-better " + JSON.stringify([hi.T0, hi.T9]));
const lo = quintileRatings(tenTeams, false);
ok(lo.T0 === 5 && lo.T9 === 1, "quintile lower-is-better " + JSON.stringify([lo.T0, lo.T9]));
const spread = {}; for (const v of Object.values(hi)) spread[v] = (spread[v] || 0) + 1;
ok(Object.keys(spread).length === 5 && Object.values(spread).every((c) => c === 2), "quintiles even " + JSON.stringify(spread));
ok(Object.keys(quintileRatings({ A: null, B: undefined })).length === 0, "quintile ignores non-numbers");

ok(targetCompRating(0.30) === 5 && targetCompRating(0.05) === 1, "targetComp extremes");
ok(targetCompRating(0.155) === 3, "targetComp mid");
ok(targetCompRating(undefined) === null, "targetComp needs a number");

// tierBreaks migrated from the old flat-array shape to per-scope
ok(JSON.stringify(migrateTierBreaks({ tierBreaks: [3, 7] }).tierBreaks) === '{"all":[3,7]}', "migrate flat tierBreaks");
ok(JSON.stringify(migrateTierBreaks({ tierBreaks: { RB: [2] } }).tierBreaks) === '{"RB":[2]}', "scoped tierBreaks pass through");
ok(JSON.stringify(migrateTierBreaks({}).tierBreaks) === '{"all":[]}', "missing tierBreaks defaulted");

const nfl = `player_display_name,position,team,season_type,targets,receptions,receiving_yards,receiving_tds,receiving_air_yards,carries,rushing_yards,rushing_tds,passing_yards,passing_tds,attempts,sacks_suffered,fantasy_points_ppr
Amon-Ra St. Brown,WR,DET,REG,10,8,90,1,80,0,0,0,0,0,0,0,25
Amon-Ra St. Brown,WR,DET,REG,12,9,110,0,95,0,0,0,0,0,0,0,20
Sam LaPorta,TE,DET,REG,8,6,60,1,50,0,0,0,0,0,0,0,18
Old Guy,WR,DET,REG,5,4,40,0,30,0,0,0,0,0,0,0,8
Old Guy,WR,DET,POST,9,9,99,9,99,0,0,0,0,0,0,0,50`;
const agg = aggregateNflverse(nfl);
const asb = agg.players["amon ra st brown|WR"];
ok(asb && asb.targets === 22 && asb.games === 2, "agg " + JSON.stringify(asb && [asb.targets, asb.games]));
ok(asb && Math.abs(asb.tgtShare - 22 / 35) < 0.001, "target share " + asb?.tgtShare);
ok(asb && Math.abs(asb.fp - (45 - 0.5 * 17)) < 0.01, "half-ppr conv " + asb?.fp);
const vac = computeVacated(agg, { "old guy|WR": { team: "KC" }, "amon ra st brown|WR": { team: "DET" } });
ok(vac.DET && vac.DET.targets === 5 && !("KC" in vac), "vacated " + JSON.stringify(vac));

console.log(fails ? `${fails} FAILURES` : "ALL TESTS PASS");
process.exit(fails ? 1 : 0);
