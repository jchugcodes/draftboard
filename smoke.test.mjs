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
const must = ["Your board is empty", "Board", "Imports", "Byes", "Vacated", "Settings"];
let fails = 0;
for (const m of must) if (!text.includes(m)) { console.log("MISSING:", m); fails++; }

// click through tabs
const btns = [...window.document.querySelectorAll("button")];
const click = (label) => {
  const b = btns.concat([...window.document.querySelectorAll("button")]).find((x) => x.textContent.includes(label));
  if (!b) { console.log("no button:", label); fails++; return; }
  b.dispatchEvent(new window.Event("click", { bubbles: true }));
};
for (const t of ["Settings", "Imports", "Byes", "Vacated"]) {
  click(t);
  await new Promise((r) => setTimeout(r, 30));
}
const t2 = window.document.body.textContent;
if (!t2.includes("Vacated opportunity by team")) { console.log("Vacated view didn't render"); fails++; }
click("Settings");
await new Promise((r) => setTimeout(r, 30));
if (!window.document.body.textContent.includes("Replacement level")) { console.log("Settings view didn't render"); fails++; }

console.log(fails ? fails + " SMOKE FAILURES" : "SMOKE PASS — app mounts, tabs render");
process.exit(fails ? 1 : 0);
