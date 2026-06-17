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
- **Rate limiting** — 6s/player, 10s/index letter, jitter, 429 backoff (mirrors G-League-Scraper)
- **Checkpoint/resume** — `scrape-wnba-backfill.checkpoint.json` tracks completed slugs

## Runtime files (gitignored)

| File | Purpose |
|------|---------|
| `scrape-wnba-backfill.checkpoint.json` | Completed slugs for `--resume` |
| `wnba-player-slugs.cache.json` | Full A–Z slug index |
| `wnba-teams.cache.json` | `{ABBREV:YEAR}` → team name/slug |
| `scrape-wnba-backfill.log` | Append-only success/fail log |
