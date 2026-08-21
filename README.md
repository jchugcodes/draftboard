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
4. **Fetch Sleeper projections + ADP** for real stat projections (scored under
   your rules, so Proj/VOR stop using the fallback curve) plus a half-PPR ADP
   column, in one call. **Sync Sleeper** for injury status, age/experience, and
   trending adds/drops.
   **Fetch nflverse** last-season stats for the advanced panel (target share,
   air-yards share, WOPR, aDOT, carry share, goal-line context) and
   vacated-opportunity math (last-season volume of players who changed teams,
   per current Sleeper rosters).
5. **Board** — drag rows (or `[` `]` / shift+↑↓) to build your order, 1–5 to
   tag, `/` to search, Enter for the detail panel (notes, handcuff link,
   situation scorecard, advanced stats, news links). `#` is overall board rank
   and `Pos#` is the rank within position, both in *your* order.

   Tiers work like the divider stick at a checkout belt: drag **⠿ drag divider**
   from the toolbar onto a player to drop a break above him, drag an existing
   bar to move it, type into the bar to name the tier, and `✕` pulls it out
   (merging into the tier above). `t` toggles a break above the selected row and
   "Suggest tiers" cuts on consensus gaps. Tiers belong to the view you cut them
   in — filter to RB and you are editing RB tiers, and clearing them leaves the
   full-board tiers alone.
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

## Version history

The **History** tab keeps snapshots of the board. One is captured automatically a
few seconds after you stop editing, and **Save version** names a milestone. Each
entry shows what changed against the one before it ("4 moved (Gibbs up 3) · +1
tier · 2 tags"), and any version can be restored — restoring snapshots the
current board first, so it is itself undoable.

A version stores your order, tier breaks and labels, tags, notes, and
scorecards. It does **not** store imported sources; those are shared across
versions, so restoring an old order will not resurrect a deleted ADP column.

Auto versions are culled past 30; named ones are kept. Sleeper metadata and the
nflverse aggregate are no longer written to localStorage — they are large and
re-fetchable, and leaving them out is what makes room for history.

## Ranking sources

| Source | How | Gives |
| --- | --- | --- |
| Sleeper | in-app button | stat projections + half-PPR ADP |
| ESPN | in-app button | ESPN's own PPR draft ranks + ESPN ADP |
| Fantasy Football Calculator | `npm run adp` | consensus ADP from real mock drafts |
| Yahoo / FantasyPros / anything else | export a CSV, load it on Imports | whatever the file has |

Every source becomes its own column on the board, and the detail panel plots them
all on one scale against your rank ("Where the sites have him") so you can see
who you are high or low on at a glance.

Yahoo and FantasyPros are not fetched directly: Yahoo's Fantasy API needs a
registered OAuth app and FantasyPros' API needs a paid key — both return 401/403
to anonymous requests, and scraping their pages instead is against their terms.
Exporting a CSV from either and importing it works fine.

Until you reorder a row yourself, importing re-seeds the board in consensus
order; after that your order is yours and imports only add columns.

## Situation scorecards

`npm run situation` builds per-team scorecard ratings from nflverse open data and
writes `situation-<season>.json`. Load it via **Imports → Situation scorecards**.

```bash
npm run situation                       # SOS for the current year
node fetch-situation.mjs --season=2027
node fetch-situation.mjs --keep         # keep the downloaded CSVs
```

Each metric is ranked across the 32 teams and split into even quintiles, so a 5
means top-six-in-the-league rather than an absolute cutoff.

| Field | Derived from |
| --- | --- |
| Offense | team EPA per play |
| QB quality | pass EPA per dropback, nudged by CPOE |
| OL pass block | sack rate allowed (inverted) |
| OL run block | rush EPA per carry |
| Pace | offensive plays per game |
| SOS season / wk 15–17 | upcoming schedule × opponents' EPA allowed |
| Target competition | the player's own target share (needs an nflverse stats load) |

Coach/scheme is never auto-filled — there is no honest statistical proxy for it.

**Team quality comes from the last completed season**, so it cannot see coaching
changes, roster moves, or a QB who switched teams; only SOS is grounded in the
upcoming schedule. Applying overwrites those seven sliders, sets the card to
"not projected", and leaves any grade note you wrote intact.

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
