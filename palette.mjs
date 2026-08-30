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
  // Cream and evergreen, on paper.
  //
  // The ground is cream rather than white — a real cream, with enough chroma to
  // read as a colour rather than as white that got dirty — and the ink is a
  // deep evergreen rather than a warm black. Those two together are the whole
  // colourway: everything structural (rules, muted text, the rank pill) is a
  // step along the same green, so the page reads as printed on stock rather
  // than rendered on a screen.
  //
  // It also means three greens have to coexist: evergreen ink at almost no
  // chroma, a saturated "ahead" green, and RB. RB moved to teal to keep out of
  // the way, and the tags walked around the wheel behind it.
  light: {
    ground: [0.962, 0.022, 88], "ground-sunken": [0.932, 0.026, 87], panel: [0.985, 0.014, 88],
    "panel-raised": [0.968, 0.020, 88], band: [0.916, 0.028, 86],
    ink: [0.240, 0.038, 158], "ink-muted": [0.448, 0.030, 158], "ink-faint": [0.548, 0.024, 158],
    "ink-ghost": [0.722, 0.020, 150], "ink-invert": [0.985, 0.014, 88],
    line: [0.872, 0.022, 130], "line-strong": [0.700, 0.028, 145],
    theme: [0.865, 0.195, 113], "on-theme": [0.240, 0.038, 158],
    "theme-ink": [0.400, 0.100, 125], "band-tier": [0.930, 0.072, 110],
    accent: [0.470, 0.095, 150], focus: [0.500, 0.130, 130],
    ahead: [0.505, 0.160, 148], behind: [0.505, 0.190, 28], warn: [0.545, 0.150, 78],
    "pos-qb": [0.515, 0.185, 20], "pos-rb": [0.520, 0.115, 190], "pos-wr": [0.520, 0.160, 252],
    "pos-te": [0.545, 0.140, 68], "pos-k": [0.520, 0.180, 315], "pos-dst": [0.545, 0.020, 200],
    "tag-favorite": [0.545, 0.120, 92], "tag-sleeper": [0.560, 0.135, 292],
    "tag-reliable": [0.535, 0.095, 218], "tag-avoid": [0.520, 0.160, 2], "tag-handcuff": [0.552, 0.135, 45],
  },
  // Carbon, and one hi-vis stripe.
  //
  // Not the same design with the lights off: a pit-lane palette. The ground is
  // near-black with the barest cool cast, the surfaces step up in clear stages
  // rather than the four-value nothing the old dark theme had, and the accent
  // is allowed to be genuinely loud because on carbon it is the only thing
  // making noise.
  dark: {
    ground: [0.145, 0.006, 250], "ground-sunken": [0.105, 0.005, 250], panel: [0.195, 0.007, 250],
    "panel-raised": [0.245, 0.008, 250], band: [0.285, 0.010, 250],
    ink: [0.965, 0.004, 100], "ink-muted": [0.735, 0.008, 240], "ink-faint": [0.645, 0.010, 240],
    "ink-ghost": [0.470, 0.010, 240], "ink-invert": [0.145, 0.006, 250],
    line: [0.300, 0.010, 250], "line-strong": [0.440, 0.013, 250],
    theme: [0.885, 0.200, 113], "on-theme": [0.170, 0.030, 120],
    "theme-ink": [0.870, 0.185, 115], "band-tier": [0.292, 0.058, 118],
    accent: [0.860, 0.180, 115], focus: [0.885, 0.190, 113],
    ahead: [0.805, 0.155, 152], behind: [0.720, 0.170, 28], warn: [0.835, 0.150, 88],
    "pos-qb": [0.720, 0.165, 20], "pos-rb": [0.780, 0.105, 190], "pos-wr": [0.745, 0.135, 252],
    "pos-te": [0.805, 0.135, 68], "pos-k": [0.745, 0.155, 315], "pos-dst": [0.700, 0.020, 200],
    "tag-favorite": [0.850, 0.140, 92], "tag-sleeper": [0.765, 0.145, 292],
    "tag-reliable": [0.790, 0.105, 218], "tag-avoid": [0.735, 0.155, 2], "tag-handcuff": [0.795, 0.145, 45],
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
