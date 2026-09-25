# Thursday Arena ladder tracker

Unofficial fan tracker for the [Thursday Arena](https://thursdayarena.com) ladder and catalog. The page follows whatever season the public API says is current. Built by LevelUp.

Times on the page are Pacific Time. Stored timestamps are UTC.

## What the page shows

- Current top 20 from a live leaderboard read when the browser can reach the API, otherwise the latest stored snapshot. Rank, handle (links to X), avatar, rating, W-L-D, and win% (wins divided by wins, losses, and draws).
- If fewer than 20 rows are `ranked: true`, the table shows those rows and how many ranked players exist. If none are ranked, it says so and shows the previous season's final top 20 instead of an empty table.
- Previous season card from `data/seasons/<n>/final.json` when that file exists. Otherwise it is labeled "Last snapshot, not official final."
- Movers between two stored snapshots of the **same season number**, with both timestamps. Publishing every 15 minutes does not shrink these windows: the 24-hour and 7-day cards still use the stored snapshot at or before that mark, not the snapshot from 15 minutes earlier. A window shorter than 24 hours or 7 days is relabeled and is not presented as that window. A season younger than 24 hours uses "Movers since season start (N h)" against the 1000 starting rating, and players with no games are hidden. A season shorter than 7 days shows season-to-date. After the first 24 hours, a separate list can show "Current rating vs Season N finish (not a mover)" for players who have played at least one game. The match list is not a mover source. Unverified snapshots and saved season finals stay in the archive and on the chart, and they are not mover anchors.
- Top-20 entrants and exits only when both snapshots are in the same season and have the same row count. The first snapshot of a season says everyone is new. A name missing from a shorter snapshot is not an exit from the ladder.
- Top-20 appearance counts for one season, with the snapshot denominator. The count is ranks 1–20 on verified snapshots only. A new season waits until it has 6 of those snapshots. The all-time table is a per-season breakdown plus a total.
- Rating history for one player. Lines break at season boundaries. An official final is drawn at that season's end, or at the next season's start, rather than at the hour it was downloaded. Labels use the season number, because older snapshots used a name that does not match the number.
- Catalog counts by rarity (and average cost, attack, and health) from the latest daily catalog snapshot.
- An empty "Winning lineups / bot usage — coming soon" section. No usage numbers.
- Freshness in PT, plus a stale badge when the last successful check is more than 3 hours old. After a season's stored end time, the header says that season ended and the next snapshot has not arrived.

## Data flow

```
every 15 minutes (minutes 2, 17, 32, and 47, or workflow_dispatch)
  import seed into data/seasons/<number>/ if needed
  GET /api/public/v1/season          → data/seasons/index.json
  GET /api/public/v1/leaderboard?limit=100
    if the season number increased, mark the old one ended and
    GET /api/public/v1/leaderboard?season=<old>&limit=100  (cursor pages, up to 20)
    an unfinished page set is saved with complete:false and retried on the next run
    save data/seasons/<old>/final.json
    also backfill final.json for the immediate previous season if it is missing
  append data/seasons/<number>/snapshots/<UTC-date>.json unless the board is unchanged
  GET /api/catalog once per UTC day → data/catalog/<UTC-date>.json
  commit data/ only when files changed
  record the check time in gitignored .cache/last-check.json
pages build
  scripts/build-data.mjs → public/data/site-data.json
  vite build (GitHub Pages base /thursday-arena-tracker/, Vercel base /)
```

The leaderboard allows browser CORS, so the top 20 can refresh live. The catalog does not, so the page only reads the stored catalog summary. An HTTP error, a non-JSON body, or a season number below the stored current season does not write a snapshot. An empty ladder is written only for HTTP 200 with a valid season and `data: []`. Identical boards are not appended. A run that only moves `last_checked` does not commit `index.json`. That run still writes the check time to gitignored `.cache/last-check.json`, and the site build uses it for `last_checked` when it is newer than the committed value.

`leaderboard?season=<number>` is the final-standings query. `cursor` is the paging parameter (`next_cursor` in the query string is ignored). `limit=100` works. A missing season returns 404 `season_not_found`.

The seed file stays at `data/seed/ladder-history-seed.json`. Snapshot 23 is the PMT draft file `site/_draft-local-20260924/data/snapshots/2026-09-24.json`, not `strategy/data-20260924`. Snapshot 24 is marked `verified: false` because no response copy remains on disk. Partitions are keyed by `season.number`.

Samples for a later lineups section live in `data/samples/`. Match detail is `GET /api/public/v1/matches/{id}` and includes rounds. v1 does not aggregate it.

## Local commands

```bash
npm install
npm test
npm run snapshot   # one live leaderboard read, previous-season final if missing, daily catalog
npm run dev
npm run build
```

## GitHub Pages

The repo uses a workflow build. `.github/workflows/site.yml` snapshots, commits `data/`, and deploys `dist/` to GitHub Pages. Pull requests run the tests in `ci.yml`; the every-15-minutes job does not, so a test cannot block a deploy. The site URL is `https://levelupworldhub.github.io/thursday-arena-tracker/`. Actions needs permission to write contents so that job can push. No personal token and no paid services.

## Linking Vercel later

The Vercel GitHub App does not have access to this repo yet. When it does:

1. Import the repo. Framework preset Vite. Build command `npm run build`. Output directory `dist`.
2. Leave `BASE_PATH` unset so the site is served from `/`. Pages sets `BASE_PATH=/thursday-arena-tracker/` in Actions; Vercel should not.
3. Keep history on the GitHub Action. Vercel only builds the static page. Do not add a second cron.

`vercel.json` records the Vite build. No code change is required beyond the unset base path.
