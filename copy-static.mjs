// Copy the static app shell (public/) into dist/ alongside the bundled app.js + styles.css.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
console.log("copied public/ -> dist/");
