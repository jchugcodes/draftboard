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
like `jchugcodes.github.io/draftboard/` is fine. The service worker's `SHELL`
cache name is stamped per build by `copy-static.mjs` (from `GITHUB_SHA`, or a
timestamp locally), so installed clients pick up every deploy on their own —
`public/sw.js` stays the source of truth and is never edited by hand.

## Layout

- `src/` — app source. Entry is `src/main.jsx`.
  - `useDataSync.js` — every way the app pulls data, in one hook, so the Board's
    Refresh and Setup's per-source buttons drive the same code.
  - `rankbar.jsx` — where each source has a player on one shared scale. Renders
    as labelled rows in the detail panel and as an inline bar in the table.
- `public/` — the static shell (`index.html`, `sw.js`, `manifest.webmanifest`,
  `icons/`). Single source of truth; copied verbatim into `dist/` by the build.
  Its paths are dist-relative (`./app.js`), so never serve `public/` directly.
- `dist/` — build output. Committed.
- `gen-icons.mjs` — regenerates `public/icons/*.png`. Run manually.

## Using it

Four tabs: **Board**, **Compare**, **History**, **Setup**.

**First open** — the board offers one button, *Load everything*. It pulls ESPN
ranks + ADP, Sleeper projections + ADP, injuries and trending, plus the consensus
ADP and situation grades that ship with the app. Each step reports separately, so
a provider being down costs you that column and nothing else. There is no file to
download and nothing to run in a terminal.

**Board** — drag rows (or `[` `]` / shift+↑↓) to build your order, 1–5 to tag,
`/` to search, Enter for the detail panel. `#` is overall rank and `Pos#` is rank
within position, both in *your* order.

A strip above the toolbar says how old the board is — *updated today* in green,
a day count in amber, `STALE` in red past a week — names the newest source, and
offers **Refresh**, which re-runs the same full pull as *Load everything*.

`#` and `Cons` are the two numbers the table exists to compare, so they carry
chip weight while the other columns stay plain. Next to `#` is your rank minus
consensus: red means you are reaching, green means the room has him later and
you could wait, grey means the gap is under three spots and not worth the ink.
Next to `Cons` is a small bar putting every source on one scale — the grey band
is where they cluster, the pale tick is the `Cons` value, the blue tick is you.
A wide band with your tick outside it is a different decision from a tight one.

**Draft day / Full** is a density switch. Draft day folds away every source
column and every derived metric (σ, Y vs mkt, Me−ADP, Proj, VOR, Trend), leaving
rank, position, player and consensus — the question you actually ask between
picks. Full is the prep view. The choice persists across reloads.

The **View** picker is a lens: switch it to ESPN, Sleeper, consensus or any other
source and the board re-sorts through that source's eyes, with ▲▼ on every row
showing how far the player moves from where you have him. Dragging and tiers
pause while a lens is on.

**Consensus overlay** is the non-destructive version of that, and is a separate
toggle rather than a lens setting: the board stays in your order with dragging
and tiers live, and each row gains a `c#` badge showing where consensus would
rank that player among the same rows. The lens answers "what does ESPN's board
look like"; the overlay answers "where does the room disagree with mine", without
taking my list away to do it. It also persists across reloads.

Tiers work like the divider stick at a checkout belt: drag **⠿ drag divider**
onto a player to cut above him, drag a bar to move it, type in the bar to name
the tier, `✕` pulls it out. Tiers belong to the view you cut them in — filter to
RB and you are editing RB tiers.

**Compare** — every source as a column, sorted by disagreement. Green means a
site ranks him later than you (you can wait), red means they are higher (you
would reach). The top of that list is where your board actually differs from the
market.

**History** — snapshots as you edit, plus named saves. See what changed between
versions and restore any of them.

**Setup** — league rules and scoring, the data loader, manual imports behind a
disclosure, bye collisions, and vacated opportunity.

## Data

Two datasets need a server, so CI bakes them into the deploy
(`npm run data` → `public/data/`) and the app reads them from its own origin:
consensus ADP from Fantasy Football Calculator, and situation scorecard ratings.
Every deploy is therefore a data refresh. If a provider is down at build time the
step is skipped and the app falls back to its live sources.

Live in-app: ESPN (ranks + ADP), Sleeper (projections, ADP, injuries, trending).

Yahoo and FantasyPros are not fetched directly — Yahoo's API needs a registered
OAuth app and FantasyPros' needs a paid key, both refuse anonymous requests, and
scraping their pages is against their terms. Export a CSV from either and import
it under Setup → Data and it becomes just another column.

Until you reorder a row yourself, importing re-seeds the board in consensus
order; after that your order is yours and imports only add columns.

## Regenerating baked data

`npm run data` runs both generators and writes `public/data/`. CI does this
before every build, so you rarely need it locally.

```bash
npm run data                                 # both datasets for this season
node fetch-adp.mjs --teams=10 --format=ppr   # ADP only
node fetch-situation.mjs --season=2027       # situation only
```

ADP formats: `half-ppr`, `ppr`, `standard`, `2qb`, `dynasty`, `rookie`. These
run outside the browser because neither API sends CORS headers. Output is
gitignored — it goes stale, so regenerate rather than commit it.

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
