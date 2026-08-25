import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

// Seed a realistic board: players, my ranks, a rankings source, a Yahoo + ESPN ADP source, tier break.
const players = {};
const names = [["Justin Jefferson","WR","MIN",6],["Bijan Robinson","RB","ATL",5],["CeeDee Lamb","WR","DAL",7],["Sam LaPorta","TE","DET",8],["Josh Allen","QB","BUF",9],["Jahmyr Gibbs","RB","DET",8]];
const ids = [];
for (const [name,pos,team,bye] of names) {
  const id = name.toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/ /g,"_")+"|"+pos;
  ids.push(id);
  players[id] = { id, name, pos, team, bye, tags: id.includes("gibbs")?["favorite"]:[], notes:"", handcuffOf:null,
    scorecard:{offense:4,olineRun:3,olinePass:3,qb:4,targetComp:3,scheme:4,pace:3,sosSeason:3,sosPlayoff:2,projected:false,note:""}, sleeper:null, nfl:null };
}
const mk = (vals) => Object.fromEntries(ids.map((id,i)=>[id, vals[i]]));
const seed = {
  settings: { roster:{teams:12,slot:6,QB:1,RB:2,WR:3,TE:1,FLEX:1,SFLEX:0,K:1,DST:1,BN:6,IR:2,flexType:"WRT"},
    scoring:{ppr:0.5,tePremium:0,passYd:0.04,passTD:4,passInt:-1,rushYd:0.1,rushTD:6,recYd:0.1,recTD:6,fumbles:-2,ppfd:0,bonusPass300:0,bonusRush100:0,bonusRec100:0},
    corsProxy:"", newsTemplates:[{id:"wk",name:"Google · past week",url:"https://www.google.com/search?q={name}+{team}+fantasy&tbs=qdr:w"}], beatBlogs:{}, byeWeeks:{} },
  players, myRanks: ids, tierBreaks: [2],
  sources: [
    { id:"s1", name:"FantasyPros", type:"ranks", date:new Date().toISOString(), map: mk([1,2,3,12,20,9]) },
    { id:"s2", name:"Yahoo", type:"adp", date:new Date(Date.now()-9*86400000).toISOString(), map: mk([1.5,2.2,4.1,15,25,8]) },
    { id:"s3", name:"ESPN", type:"adp", date:new Date().toISOString(), map: mk([1.2,3.0,3.5,13,18,10]) },
  ],
  mergeQueue: [], trending:{adds:[],drops:[],at:null}, vacated:null, nflSeason:null,
};
const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, { url: "https://example.com/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const store = { "draftboard-v1": JSON.stringify(seed) };
Object.defineProperty(window, "localStorage", { value: {
  getItem: (k) => store[k] ?? null, setItem: (k,v) => { store[k]=String(v); }, removeItem: (k) => delete store[k],
}});
window.structuredClone = structuredClone;
window.eval(readFileSync("dist/app.js","utf8"));
await new Promise((r)=>setTimeout(r,150));
const text = window.document.body.textContent;
let fails = 0;
const must = ["Justin Jefferson","FantasyPros","Yahoo","ESPN","Y vs mkt","VOR","is more than 7 days old"];
// Tiers render as a zero-padded ordinal in an ink block beside a TIER label.
const tierMarks = () => [...window.document.querySelectorAll("span")].filter((n) => /^\d\d$/.test(n.textContent.trim()) && n.className.includes("bg-ink"));
if (tierMarks().length < 2) { console.log("expected at least two tier marks, got", tierMarks().map((n)=>n.textContent)); fails++; }
if (!text.includes("Tier")) { console.log("MISSING: Tier label"); fails++; }
for (const m of must) if (!text.includes(m)) { console.log("MISSING:", m); fails++; }
// verify consensus + delta rendered as numbers not NaN
if (text.includes("NaN")) { console.log("NaN leaked into UI"); fails++; }

// The freshness strip is always on when there are sources. The newest source in
// this seed is today's, so it reads as current even though Yahoo is 9 days old.
for (const m of ["Consensus as of", "updated today", "Refresh"]) {
  if (!text.includes(m)) { console.log("freshness strip missing:", m); fails++; }
}

const click = (label) => {
  const b = [...window.document.querySelectorAll("button")].find((x) => x.textContent.trim() === label);
  if (!b) { console.log("no button:", label); fails++; return false; }
  b.dispatchEvent(new window.Event("click", { bubbles: true }));
  return true;
};
const settle = () => new Promise((r) => setTimeout(r, 60));

// Read the header cells rather than body text: source names also appear as
// options in the View lens, which stays available in either density.
const headers = () => [...window.document.querySelectorAll("thead th")].map((n) => n.textContent.trim());

const full = headers();
for (const kept of ["#", "Pos#", "Player", "Cons", "σ", "VOR", "Trend", "FantasyPros"]) {
  if (!full.some((h) => h.startsWith(kept))) { console.log("full density missing column:", kept, JSON.stringify(full)); fails++; }
}

// Draft-day density drops every analytical column and every source column,
// keeping rank, position, player and consensus.
click("Draft day");
await settle();
const lean = headers();
if (lean.length !== 4) { console.log("compact should leave 4 columns, got:", JSON.stringify(lean)); fails++; }
for (const gone of ["Y vs mkt", "Me−ADP", "VOR", "Trend", "FantasyPros", "Yahoo"]) {
  if (lean.some((h) => h.startsWith(gone))) { console.log("compact should hide:", gone); fails++; }
}
const compact = window.document.body.textContent;
for (const kept of ["Justin Jefferson", "Tier", "Consensus as of"]) {
  if (!compact.includes(kept)) { console.log("compact should keep:", kept); fails++; }
}

click("Full");
await settle();
if (headers().length !== full.length) { console.log("Full did not restore columns"); fails++; }

// Consensus overlay is additive: my order and my tiers survive, each row just
// gains the position the room would give him.
click("Consensus overlay");
await settle();
const overlaid = window.document.body.textContent;
if (!overlaid.includes("Justin Jefferson") || !tierMarks().length) {
  console.log("overlay lost the board's own order/tiers"); fails++;
}
const badges = [...window.document.querySelectorAll("span[title]")].filter((n) => /Consensus would rank him/.test(n.getAttribute("title")));
if (!badges.length) { console.log("overlay rendered no consensus-position badges"); fails++; }

console.log(fails ? fails+" BOARD FAILURES" : "BOARD SMOKE PASS — table, tiers, sources, freshness, density, overlay all render");
process.exit(fails?1:0);
