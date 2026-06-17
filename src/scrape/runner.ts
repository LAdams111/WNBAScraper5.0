import type { AppConfig } from "../config.js";
import { BrefClient, BrefRateLimitError, uncommentBrefHtml } from "../brefClient.js";
import { IngestClient } from "../ingestClient.js";
import { toIngestPayload } from "../transform.js";
import type { ScrapeOptions, ScrapeSummary } from "../types.js";
import { metaToIngestPlayer } from "../utils/profile.js";
import {
  appendLog,
  ensureCheckpoint,
  loadCheckpoint,
  markSlugComplete,
  saveCheckpointSlugs,
} from "./checkpoint.js";
import { buildPlayerSeasonRecords } from "./playerSeason.js";
import { loadSlugCache, saveSlugCache } from "./slugCache.js";

async function processPlayer(
  bref: BrefClient,
  ingest: IngestClient,
  options: ScrapeOptions,
  slug: string,
): Promise<{ ok: boolean; seasonRows: number; playerId?: number }> {
  const html = await bref.fetchHtml(bref.playerUrl(slug));
  const pageHtml = uncommentBrefHtml(html);
  const meta = bref.parsePlayerMeta(slug, pageHtml);
  const records = await buildPlayerSeasonRecords(
    bref,
    slug,
    html,
    meta,
    options.teamCachePath,
  );

  if (records.length === 0) {
    console.warn(`[skip] ${slug}: no regular-season stat rows found`);
    return { ok: true, seasonRows: 0 };
  }

  const playerFields = metaToIngestPlayer(meta);
  let failures = 0;
  let playerId: number | undefined;

  for (const record of records) {
    const payload = toIngestPayload(record, playerFields);

    if (options.dryRun) {
      console.log(JSON.stringify(payload, null, 2));
      continue;
    }

    try {
      const result = await ingest.sendPlayerSeason(payload);
      playerId = result.playerId;
      console.log(
        `[season] ${slug} ${record.seasonLabel} ${record.teamAbbreviation} → playerId=${result.playerId}`,
      );
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[season-fail] ${slug} ${record.seasonLabel}: ${message}`);
    }
  }

  if (!options.dryRun && failures === 0) {
    appendLog(
      options.logPath,
      `OK ${slug}: ${meta.displayName} → playerId=${playerId ?? "?"} (${records.length} seasons)`,
    );
  }

  return {
    ok: failures === 0,
    seasonRows: records.length,
    playerId,
  };
}

export async function runScrape(
  config: AppConfig,
  options: ScrapeOptions,
): Promise<{ summary: ScrapeSummary }> {
  const bref = new BrefClient(options.requestDelayMs, options.indexDelayMs);
  const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);

  if (options.backfill) {
    console.log(
      `BRef pacing: ${options.requestDelayMs}ms between requests, ` +
        `${options.indexDelayMs}ms between index letters (+ jitter, slows further after 429).`,
    );
    console.log("");
  }

  let checkpoint = ensureCheckpoint(
    options.resume ? loadCheckpoint(options.checkpointPath) : null,
  );

  let slugs: string[];
  if (options.playerSlug) {
    slugs = [options.playerSlug.toLowerCase()];
  } else if (options.backfill) {
    const cachedSlugs =
      loadSlugCache(options.slugCachePath) ?? checkpoint.allSlugs ?? null;

    if (cachedSlugs?.length) {
      console.log(`Using saved WNBA slug index (${cachedSlugs.length} players).`);
      slugs = cachedSlugs;
    } else {
      console.log("Crawling WNBA player index A–Z...");
      try {
        slugs = await bref.listAllSlugs();
      } catch (error) {
        if (error instanceof BrefRateLimitError) {
          console.error("");
          console.error("BRef rate limit hit during index crawl.");
          console.error("Wait 1–2 hours, then rerun with --resume.");
          throw error;
        }
        throw error;
      }
      saveSlugCache(options.slugCachePath, slugs);
      checkpoint = saveCheckpointSlugs(checkpoint, slugs, options.checkpointPath);
    }
  } else {
    throw new Error("Either --player-slug or --backfill is required");
  }

  const pending = slugs.filter((slug) => !checkpoint.completedSlugs.includes(slug));
  const toProcess = options.limit ? pending.slice(0, options.limit) : pending;

  const summary: ScrapeSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: slugs.length - pending.length,
    seasonRows: 0,
  };

  for (const slug of toProcess) {
    summary.processed += 1;
    console.log(`\n[${summary.processed}/${toProcess.length}] ${slug}`);

    try {
      const result = await processPlayer(bref, ingest, options, slug);
      if (result.ok) {
        summary.succeeded += 1;
        summary.seasonRows += result.seasonRows;
        if (!options.dryRun && result.seasonRows > 0) {
          markSlugComplete(checkpoint, slug, options.checkpointPath);
        }
      } else {
        summary.failed += 1;
        appendLog(options.logPath, `FAIL ${slug}`);
      }
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      appendLog(options.logPath, `FAIL ${slug}: ${message}`);
      console.error(`[error] ${slug}: ${message}`);

      if (error instanceof BrefRateLimitError) {
        console.error("");
        console.error("Stopping backfill — BRef rate limit reached.");
        console.error("Wait 1–2 hours, then rerun with --resume.");
        break;
      }
    }
  }

  return { summary };
}

export function printSummary(summary: ScrapeSummary, dryRun: boolean): void {
  console.log("");
  console.log("=== Summary ===");
  console.log(`Processed: ${summary.processed}`);
  console.log(`Succeeded: ${summary.succeeded}`);
  console.log(`Failed:    ${summary.failed}`);
  console.log(`Skipped:   ${summary.skipped} (already in checkpoint)`);
  console.log(`Season rows: ${summary.seasonRows}`);
  if (dryRun) {
    console.log("");
    console.log("Dry run — no data was POSTed to Hoop Central.");
  }
}
