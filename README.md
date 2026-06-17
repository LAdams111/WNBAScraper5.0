# WNBA-Scraper 5.0

Scrapes WNBA player season stats from [Basketball Reference](https://www.basketball-reference.com/wnba/) and ingests them into [Hoop Central](https://hoopcentral-50-production.up.railway.app).

## Setup

```bash
npm install
cp .env.example .env
npm run build
```

## Tests (no BRef requests)

```bash
npm run test:build
```

## Single-player test (Skylar Diggins)

Dry-run first (hits BRef with 6s pacing — 1 player page + team pages):

```bash
npm run scrape:dry-run -- --player-slug diggisk01w
```

Live ingest to production (requires `INGEST_API_KEY` if set on server):

```bash
npm run scrape -- --player-slug diggisk01w
```

## Health check

```bash
npm run scrape -- --health
```

## Backfill (after single-player test passes)

```bash
npm run scrape:backfill -- --resume
```

## Behavior

- **Stats only** — WNBA per-game tables (`#wnba_per_game`, comment-wrapped full career table)
- **WNBA-only players** — created via season ingest with BRef bio fields (name, birth date, position, height, weight)
- **Rate limiting** — 10s/player (random +0–5s), 15s/index letter, 3–8s rest between players, fail-fast on 429, 2h saved cooldown
- **Checkpoint/resume** — `scrape-wnba-backfill.checkpoint.json` tracks completed slugs

## Avoiding BRef blocks

- **Do not run multiple scrapers in parallel** — that increases 429s, not throughput.
- On 429 the scraper **stops immediately** (no retry hammering) and saves `brefCooldownUntil` in the checkpoint.
- Resume with `--resume`; it waits out the saved cooldown automatically.
- Increase delays in `.env` if needed (`SCRAPE_REQUEST_DELAY_MS=12000` or higher).

## Runtime files (gitignored)

| File | Purpose |
|------|---------|
| `scrape-wnba-backfill.checkpoint.json` | Completed slugs for `--resume` |
| `wnba-player-slugs.cache.json` | Full A–Z slug index |
| `wnba-teams.cache.json` | `{ABBREV:YEAR}` → team name/slug |
| `scrape-wnba-backfill.log` | Append-only success/fail log |
