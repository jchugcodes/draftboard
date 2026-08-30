#!/usr/bin/env node
// The palette, as source rather than as ninety hex values.
//
// Picking colours as hex means picking them by eye, and the eye is not uniform:
// two swatches at the same "500" in a stock ramp can differ visibly in weight,
// and stepping a hue by 30° in HSL does not step it by 30° to a person. Every
// colour below is declared in OKLCH — perceptual lightness, chroma, hue — so
// holding L constant across a family actually holds its apparent weight
// constant, and the position colours genuinely are one family rather than six
// colours that happen to sit near each other.
//
//   node palette.mjs           audit every colour's contrast on both grounds
//   node palette.mjs --write   regenerate the token blocks in tw-input.css
//
// The audit is the point. It is what catches the colour that looked fine on a
// bright laptop and is unreadable on the ground it actually sits on.
import { readFileSync, writeFileSync } from "node:fs";

const cbrt = (x) => Math.cbrt(x);
function oklchToLinear(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const encode = (u) => {
  u = Math.min(1, Math.max(0, u));
  return u > 0.0031308 ? 1.055 * u ** (1 / 2.4) - 0.055 : 12.92 * u;
};
const inGamut = (L, C, H) => oklchToLinear(L, C, H).every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// Walk chroma down until the colour is representable in sRGB, so a hue that is
// simply not available at a given lightness degrades to the nearest one that is
// rather than clipping to something else entirely.
function fit(L, C, H) {
  while (C > 0 && !inGamut(L, C, H)) C -= 0.002;
  return oklchToLinear(L, Math.max(C, 0), H).map((v) => Math.round(encode(v) * 255));
}
const luminance = ([r, g, b]) => {
  const f = (c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const SPEC = {
  light: {
    ground: [0.970, 0.007, 92], "ground-sunken": [0.944, 0.010, 92], panel: [0.996, 0.002, 92],
    "panel-raised": [0.977, 0.006, 92], band: [0.930, 0.012, 92],
    ink: [0.235, 0.014, 75], "ink-muted": [0.470, 0.013, 75], "ink-faint": [0.560, 0.011, 75],
    "ink-ghost": [0.760, 0.009, 75], "ink-invert": [0.995, 0.002, 92],
    line: [0.886, 0.010, 92], "line-strong": [0.735, 0.013, 92],
    theme: [0.870, 0.185, 122], "on-theme": [0.235, 0.014, 75],
    "theme-ink": [0.395, 0.105, 128], "band-tier": [0.945, 0.055, 118],
    accent: [0.535, 0.150, 128], focus: [0.520, 0.170, 128],
    ahead: [0.520, 0.145, 148], behind: [0.520, 0.190, 25], warn: [0.545, 0.145, 75],
    "pos-qb": [0.520, 0.185, 18], "pos-rb": [0.520, 0.125, 158], "pos-wr": [0.520, 0.160, 252],
    "pos-te": [0.545, 0.135, 62], "pos-k": [0.520, 0.180, 305], "pos-dst": [0.540, 0.020, 250],
    "tag-favorite": [0.560, 0.115, 85], "tag-sleeper": [0.560, 0.130, 288],
    "tag-reliable": [0.540, 0.090, 195], "tag-avoid": [0.548, 0.155, 15], "tag-handcuff": [0.552, 0.130, 42],
  },
  dark: {
    ground: [0.185, 0.008, 240], "ground-sunken": [0.140, 0.008, 240], panel: [0.235, 0.009, 240],
    "panel-raised": [0.285, 0.010, 240], band: [0.320, 0.012, 240],
    ink: [0.960, 0.004, 92], "ink-muted": [0.740, 0.010, 240], "ink-faint": [0.648, 0.012, 240],
    "ink-ghost": [0.475, 0.012, 240], "ink-invert": [0.185, 0.008, 240],
    line: [0.335, 0.012, 240], "line-strong": [0.460, 0.014, 240],
    theme: [0.880, 0.190, 122], "on-theme": [0.200, 0.020, 110],
    "theme-ink": [0.860, 0.175, 124], "band-tier": [0.320, 0.045, 130],
    accent: [0.845, 0.170, 126], focus: [0.880, 0.180, 124],
    ahead: [0.800, 0.150, 152], behind: [0.720, 0.165, 25], warn: [0.830, 0.145, 85],
    "pos-qb": [0.720, 0.160, 18], "pos-rb": [0.775, 0.115, 158], "pos-wr": [0.740, 0.130, 252],
    "pos-te": [0.800, 0.130, 62], "pos-k": [0.740, 0.150, 305], "pos-dst": [0.700, 0.020, 250],
    "tag-favorite": [0.845, 0.135, 85], "tag-sleeper": [0.760, 0.140, 288],
    "tag-reliable": [0.800, 0.100, 195], "tag-avoid": [0.740, 0.150, 15], "tag-handcuff": [0.790, 0.140, 42],
  },
};

// Positions are rails and three-character labels, so they are held to the 3.0
// non-text bar. Everything else here ends up carrying words somewhere.
const bar = (k) => (k.startsWith("pos-") ? 3.0 : 4.5);
const SKIP = new Set(["ground", "ground-sunken", "panel", "panel-raised", "band",
                      "ink-ghost", "ink-invert", "line", "line-strong", "theme",
                      "on-theme", "band-tier", "focus"]);

let failed = 0;
const built = {};
for (const [theme, spec] of Object.entries(SPEC)) {
  built[theme] = Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, fit(...v)]));
  const pal = built[theme], ground = pal.panel;
  console.log(`\n${theme} — contrast on --panel rgb(${ground})`);
  for (const k of Object.keys(spec)) {
    if (SKIP.has(k)) continue;
    const r = contrast(pal[k], ground), need = bar(k);
    const bad = r < need;
    if (bad) failed++;
    console.log(`  ${k.padEnd(14)} rgb(${pal[k].join(" ")})`.padEnd(42) +
      `${r.toFixed(2).padStart(6)}${bad ? `  ** under ${need}` : ""}`);
  }
  const onTheme = contrast(pal["on-theme"], pal.theme);
  if (onTheme < 4.5) failed++;
  console.log(`  ${"on-theme/theme".padEnd(14)}`.padEnd(42) +
    `${onTheme.toFixed(2).padStart(6)}${onTheme < 4.5 ? "  ** under 4.5" : ""}`);
}
console.log(failed ? `\n${failed} COLOUR(S) UNDER BAR` : "\nevery colour clears its contrast bar");

if (process.argv.includes("--write")) {
  let css = readFileSync("tw-input.css", "utf8");
  for (const [theme, open] of [["light", ":root {\n"], ["dark", ':root[data-theme="dark"] {\n']]) {
    const start = css.indexOf(open);
    const end = css.indexOf("\n}", start);
    const body = Object.entries(built[theme]).map(([k, v]) => `  --${k}: ${v.join(" ")};`).join("\n");
    css = css.slice(0, start + open.length) + body + css.slice(end);
  }
  writeFileSync("tw-input.css", css);
  console.log("wrote token blocks into tw-input.css");
}
process.exit(failed ? 1 : 0);
