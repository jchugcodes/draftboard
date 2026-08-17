// Copy the static app shell (public/) into dist/ alongside the bundled app.js + styles.css.
// Also stamps the service worker's SHELL cache name with a per-build value so
// installed clients always pick up a new deploy — public/sw.js stays the source
// of truth and is never modified.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
console.log("copied public/ -> dist/");

const stamp = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12);
const swPath = "dist/sw.js";
const sw = readFileSync(swPath, "utf8");
const stamped = sw.replace(/const SHELL = "[^"]*"/, `const SHELL = "draftboard-shell-${stamp}"`);
if (stamped === sw) {
  console.error("WARNING: could not stamp SHELL in sw.js — installed clients may serve a stale build");
  process.exit(1);
}
writeFileSync(swPath, stamped);
console.log(`stamped sw.js SHELL -> draftboard-shell-${stamp}`);
