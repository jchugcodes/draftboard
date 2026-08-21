import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
  url: "https://example.com/", runScripts: "outside-only", pretendToBeVisual: true,
});
const { window } = dom;
// localStorage shim with seed data exercising the board path
const store = {};
Object.defineProperty(window, "localStorage", { value: {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => delete store[k],
}});
window.structuredClone = structuredClone;
window.confirm = () => true;

const code = readFileSync("dist/app.js", "utf8");
window.eval(code);
await new Promise((r) => setTimeout(r, 100));

const text = window.document.body.textContent;
const must = ["Set up your board", "Board", "Compare", "History", "Setup"];
let fails = 0;
for (const m of must) if (!text.includes(m)) { console.log("MISSING:", m); fails++; }

// click through tabs
const btns = [...window.document.querySelectorAll("button")];
const click = (label) => {
  const b = btns.concat([...window.document.querySelectorAll("button")]).find((x) => x.textContent.includes(label));
  if (!b) { console.log("no button:", label); fails++; return; }
  b.dispatchEvent(new window.Event("click", { bubbles: true }));
};
for (const t of ["Compare", "History", "Setup"]) {
  click(t);
  await new Promise((r) => setTimeout(r, 30));
}
const t2 = window.document.body.textContent;
// Setup composes what used to be four tabs — all of it should be on the one page.
for (const m of ["Replacement level", "Data", "Vacated opportunity by team"]) {
  if (!t2.includes(m)) { console.log("Setup missing:", m); fails++; }
}
// The one-button loader is the only entry point that should be prominent.
if (!t2.includes("Load everything") && !t2.includes("Refresh all data")) {
  console.log("no bootstrap button on Setup"); fails++;
}

console.log(fails ? fails + " SMOKE FAILURES" : "SMOKE PASS — app mounts, tabs render");
process.exit(fails ? 1 : 0);
