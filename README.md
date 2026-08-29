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
  - `icons.jsx` — every symbol in the app, on one grid. See *Design rules*.
  - `useDataSync.js` — every way the app pulls data, in one hook, so the Board's
    Refresh and Setup's per-source buttons drive the same code.
  - `rankbar.jsx` — where each source has a player on one shared scale. Renders
    as labelled rows in the detail panel and as an inline bar in the table.
- `public/` — the static shell (`index.html`, `sw.js`, `manifest.webmanifest`,
  `icons/`). Single source of truth; copied verbatim into `dist/` by the build.
  Its paths are dist-relative (`./app.js`), so never serve `public/` directly.
- `dist/` — build output. Committed.
- `gen-icons.mjs` — regenerates `public/icons/*.png`. Run manually.

## Design rules

Three rules, written down because each one was being broken in eight or nine
places before it was stated.

**Capitalization says what a thing is.** Uppercase, tracked, 10px is *signage* —
text you locate and never read: a column head, a group label, `TIER`. Sentence
case at 11px is *language* — anything that is a phrase you read before acting on
it, which is every button. A toolbar where eleven controls all shout has no
emphasis left to give the one that matters.

**The lean, not the taper.** The old signature clipped a triangle off each
bottom corner. It gave the angle but paid for it in four hard points per element
and forbade any radius, because a clip-path cuts straight through a
border-radius. `.lean` gets the same motion from a transform instead: the box
tilts nine degrees, the corners stay round, nothing is cut — a racing number,
which is set on a slant because the slant reads as motion before you have read
the number. Skew rotates glyphs too, so anything inside `.lean` is
counter-skewed back upright and therefore has to be an element, not a bare text
node. Corners run on three radii and no more (`--r-sm/md/lg`), so a button and
the sheet it sits on are the same family at different sizes.

**Tiers are drawn as depth, and depth is size.** A cliff in value is the most
important thing on the board and it was being said by a thin grey strip. Three
things now step together down `TIER_DEPTH`, and none of them is a shadow or a
gradient: the tier block gets smaller, it stands less proud of its own band, and
the rule above the band gets thinner. Near tiers read as heavier objects sitting
closer to you; far ones as marks lying flat on the page. It costs *less* height
than the old uniform band, not more — only the top tier is large, the rest shrink
past where the band used to sit, and the block's negative margin lets it break
the band's edge without adding to it. Five steps and then a floor: past tier six
the differences stop being legible and another step would only make the text
small.

**Icons are drawn, not borrowed.** Eighteen symbols used to be Unicode
characters set in Montserrat — `✕ ⋯ ⠿ ⚠ ✎ ⛓ ☾ ↕` — and a text glyph is drawn to
a type designer's brief, not ours: different optical weights, different
baselines, different shapes per platform. `src/icons.jsx` is one 16-unit grid,
1.5 stroke, round caps, `currentColor`. Two are filled rather than stroked, and
deliberately: `Caret` and `Dot` are data, not chrome, and need the same weight
as the number beside them.

**The page is paper; the board is the sheet on it.** `--ground` and `--panel`
were both pure white, which is what made the board read as a spreadsheet: with
the page and the sheet the same colour there is no figure and no ground, only
rules floating on nothing. The page is a warm grey now and the board is a white
sheet lying on it, and that one separation is what let the rules come out — the
edge of the sheet does the work a hairline under every row was doing. Ink is not
`#000` either; pure black on paper is a hole in the page and at 11px it blooms.

The density switch finally earns its name. **Full** is the view you browse and
think in, so it breathes: 14 columns on a 1170px sheet, no rule under any row,
tier bands as the only horizontal structure. **Draft day** is the one where two
more players on screen beats everything else, so rows tighten, the measure drops
to 820px, and the tools band starts collapsed — tags, tiers and the lens are
prep-time controls, not things you touch on the clock.

Numbers are right-aligned and their headers with them, so the units sit under
the units — which is the only reason a mono face was worth loading. Names, ranks
and `Cons` stay left; they are labels and chips, not quantities.

## Using it

Four tabs: **Board**, **Compare**, **History**, **Setup**.

**First open** — the board offers one button, *Load everything*. It pulls ESPN
ranks + ADP, Sleeper projections + ADP, injuries and trending, plus the consensus
ADP and situation grades that ship with the app. Each step reports separately, so
a provider being down costs you that column and nothing else. There is no file to
download and nothing to run in a terminal.

**Board** — drag rows (or `[` `]` / shift+↑↓) to build your order, 1–5 to tag,
`/` to search, Enter for the detail panel, `?` for every key at once. `#` is
overall rank and `Pos#` is rank within position, both in *your* order.

The command bar above the list is three bands, in the order you ask the
questions:

1. **How fresh is this** — *updated today* in green, a day count in amber,
   `STALE` in red past a week — the newest source, and **Refresh**, which
   re-runs the same full pull as *Load everything*.
2. **Which players** — search, the position strip, how many are showing out of
   how many you have, and the Full / Draft day density switch. The position
   strip leads with **All** and each segment keeps a hairline of its own
   position colour, so it doubles as the key for the rail beside every name.
3. **What am I doing to them** — the View lens and the consensus overlay (two
   answers to one question, so they sit together), the tag filters, and the tier
   tools. Below 1024px this band is collapsed behind **Tools**, which carries a
   dot when a filter inside it is on; the chrome above the first player costs a
   fifth of a phone screen rather than a third.

`⋯` at the end of the second band holds the keyboard sheet and *reset order to
consensus*, which replaces your whole order and therefore asks first — it used
to sit in the toolbar drawn exactly like a position filter.

Filtering to nothing is an answerable state: the board names the filters that
are on and offers to drop them, rather than showing an empty table.

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
pause while a lens is on, and the tools band says so in place of the tools it
has paused — the lens notice costs the same height as the band it replaces
rather than adding a line to the sticky chrome.

**Consensus overlay** is the non-destructive version of that, and is a separate
toggle rather than a lens setting: the board stays in your order with dragging
and tiers live, and each row gains a `c#` badge showing where consensus would
rank that player among the same rows. The lens answers "what does ESPN's board
look like"; the overlay answers "where does the room disagree with mine", without
taking my list away to do it. It also persists across reloads.

Tiers work like the divider stick at a checkout belt: drag the **⠿** handle in
the Tiers group onto a player to cut above him, drag a bar to move it, type in
the bar to name the tier, `✕` pulls it out. Tier bands stay pinned under the
column head as you scroll, so you always know which tier you are reading. Tiers
belong to the view you cut them in — filter to RB and you are editing RB tiers,
which is what the scope on the Tiers group is telling you.

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
