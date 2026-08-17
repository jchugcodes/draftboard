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
const must = ["Justin Jefferson","Tier 1","Tier 2","FantasyPros","Yahoo","ESPN","Y vs mkt","VOR","is more than 7 days old"];
for (const m of must) if (!text.includes(m)) { console.log("MISSING:", m); fails++; }
// verify consensus + delta rendered as numbers not NaN
if (text.includes("NaN")) { console.log("NaN leaked into UI"); fails++; }
console.log(fails ? fails+" BOARD FAILURES" : "BOARD SMOKE PASS — table, tiers, sources, stale warning all render");
process.exit(fails?1:0);
