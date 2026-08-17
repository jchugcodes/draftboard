# DraftBoard — half-PPR rankings builder

Single-page React + Tailwind PWA for building and refining your rankings before
the draft. No backend, no API keys. All data lives in localStorage. One
responsive codebase: dense keyboard-first table on desktop, card list with
swipe-to-tag on mobile. Installable and offline-capable via service worker.

Not a live draft assistant — no pick tracking, no draft board.

## Build & run

```bash
npm install --include=dev   # see note below
npm run build               # esbuild + tailwind + copy public/ → dist/
npm run serve               # http://localhost:4173
npm test                    # logic tests + two jsdom render smokes
```

> **Note:** if `NODE_ENV=production` is set in your shell, npm silently omits
> every devDependency (esbuild, tailwind, jsdom) and the build can't run. Hence
> `--include=dev`. Plain `npm install` is fine otherwise.

`npm run dev` runs esbuild in watch mode (bundle only — it does not re-run
tailwind or re-copy `public/`, so re-run `npm run build` after touching styles
or the shell).

## Deploy

`dist/` is committed and self-contained. Drop it on any static host — GitHub
Pages / Netlify / Cloudflare Pages all work. Paths are relative, so a subpath
like `jchugcodes.github.io/draftboard/` is fine. **Bump `SHELL` in
`public/sw.js` on every deploy** so installed clients pick up the new build.

## Layout

- `src/` — app source. Entry is `src/main.jsx`.
- `public/` — the static shell (`index.html`, `sw.js`, `manifest.webmanifest`,
  `icons/`). Single source of truth; copied verbatim into `dist/` by the build.
  Its paths are dist-relative (`./app.js`), so never serve `public/` directly.
- `dist/` — build output. Committed.
- `gen-icons.mjs` — regenerates `public/icons/*.png`. Run manually.

## Workflow

1. **Settings** — enter league size, draft slot, starting slots (flex type,
   superflex), scoring. Yahoo half-PPR defaults are prefilled; every field
   overridable. Replacement level per position is shown live.
2. **Imports** — bring in rankings/ADP as CSV, JSON, or a pasted plain list.
   Each import is a named column. Name one ADP source "Yahoo" — it becomes the
   reference ADP and drives the "Y vs mkt" column (Yahoo ADP minus the mean of
   your other ADP sources: negative = your room takes him earlier than the
   market). Sources older than 7 days get a stale warning.
3. Optionally import a **stat-projections CSV** (columns like pass_yds,
   rush_td, rec…). Projections are re-scored under *your* scoring rules and
   drive Proj + VOR. Without one, Pts≈ falls back to a generic positional
   curve and is labeled as approximate.
4. **Sync Sleeper** for injury status, age/experience, and trending adds/drops.
   **Fetch nflverse** last-season stats for the advanced panel (target share,
   air-yards share, WOPR, aDOT, carry share, goal-line context) and
   vacated-opportunity math (last-season volume of players who changed teams,
   per current Sleeper rosters).
5. **Board** — drag rows (or `[` `]` / shift+↑↓) to build your order, `t` to
   cut a tier above the selected player, "Suggest tiers" to auto-cut on
   consensus gaps, 1–5 to tag, `/` to search, Enter for the detail panel
   (notes, handcuff link, situation scorecard, advanced stats, news links).
6. **Settings → Export board JSON** to move between phone and desktop.

## Getting ADP in

`npm run adp` pulls consensus ADP from the Fantasy Football Calculator public
API and writes `adp-<format>-<teams>.csv` in the Imports format
(`name,team,pos,bye,rank`). Load it via **Imports → CSV**.

```bash
npm run adp                                  # half-PPR, 12-team, current year
node fetch-adp.mjs --teams=10 --format=ppr
node fetch-adp.mjs --year=2025 --out=last-year.csv
```

Formats: `half-ppr`, `ppr`, `standard`, `2qb`, `dynasty`, `rookie`.

It runs locally rather than in the app because the API sends no CORS headers.
Output is gitignored — it goes stale, so re-run it rather than committing it.

FFC is consensus ADP, not Yahoo, so it won't populate the "Y vs mkt" column on
its own; that needs a source named exactly `Yahoo`. Note that most ranking sites
(FantasyPros, ESPN, Yahoo, CBS) forbid scraping in their terms — use their
official APIs or a manual export instead.

## Name matching

Imports are fuzzy-matched (bigram similarity, suffix-stripped) against the
player pool. Confident matches merge silently; ambiguous ones queue on the
Imports tab where you pick the target or create a new player.

## News

Per-player link-outs built from editable URL templates ({name}, {team}),
including a Google News RSS feed and per-team beat-blog templates. If you
supply a CORS proxy URL in Settings, RSS headlines render inline; otherwise
links open in a new tab. No scraping, no keys.

## Known limits

- Pts≈/VOR without a projections import is a shaped curve, not a projection —
  the UI labels it.
- Vacated opportunity needs both a Sleeper sync and nflverse stats, and only
  sees departures Sleeper knows about.
- nflverse fetch depends on GitHub release CORS; if it fails, download the
  `stats_player_week_<season>.csv` asset manually and load it from the same
  section.
- Yards-per-route-run and snap share aren't in the weekly stats file, so the
  advanced panel shows the share/WOPR family instead.
