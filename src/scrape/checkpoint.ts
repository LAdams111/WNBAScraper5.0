import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { sleep } from "../utils/rateLimiter.js";

export const DEFAULT_CHECKPOINT = "scrape-wnba-backfill.checkpoint.json";
export const DEFAULT_LOG = "scrape-wnba-backfill.log";

export interface WnbaCheckpoint {
  version: 1;
  completedSlugs: string[];
  allSlugs?: string[];
  /** Do not hit BRef before this time (ISO) after a 429. */
  brefCooldownUntil?: string;
  updatedAt: string;
}

export function loadCheckpoint(path: string): WnbaCheckpoint | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as WnbaCheckpoint;
    if (raw.version !== 1 || !Array.isArray(raw.completedSlugs)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveCheckpoint(path: string, checkpoint: WnbaCheckpoint): void {
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

export function ensureCheckpoint(checkpoint: WnbaCheckpoint | null): WnbaCheckpoint {
  return (
    checkpoint ?? {
      version: 1,
      completedSlugs: [],
      updatedAt: new Date().toISOString(),
    }
  );
}

export function saveCheckpointSlugs(
  checkpoint: WnbaCheckpoint,
  allSlugs: string[],
  path: string,
): WnbaCheckpoint {
  checkpoint.allSlugs = allSlugs;
  checkpoint.updatedAt = new Date().toISOString();
  saveCheckpoint(path, checkpoint);
  return checkpoint;
}

export function markSlugComplete(
  checkpoint: WnbaCheckpoint,
  slug: string,
  path: string,
): WnbaCheckpoint {
  if (!checkpoint.completedSlugs.includes(slug)) {
    checkpoint.completedSlugs.push(slug);
  }
  checkpoint.updatedAt = new Date().toISOString();
  saveCheckpoint(path, checkpoint);
  return checkpoint;
}

export function setBrefCooldown(
  checkpoint: WnbaCheckpoint,
  cooldownHours: number,
  path: string,
): WnbaCheckpoint {
  const until = Date.now() + cooldownHours * 60 * 60 * 1000;
  checkpoint.brefCooldownUntil = new Date(until).toISOString();
  checkpoint.updatedAt = new Date().toISOString();
  saveCheckpoint(path, checkpoint);
  return checkpoint;
}

export function clearBrefCooldown(
  checkpoint: WnbaCheckpoint,
  path: string,
): WnbaCheckpoint {
  delete checkpoint.brefCooldownUntil;
  checkpoint.updatedAt = new Date().toISOString();
  saveCheckpoint(path, checkpoint);
  return checkpoint;
}

export function parseBrefCooldownUntil(checkpoint: WnbaCheckpoint): number | undefined {
  if (!checkpoint.brefCooldownUntil) return undefined;
  const ms = Date.parse(checkpoint.brefCooldownUntil);
  return Number.isNaN(ms) ? undefined : ms;
}

export async function waitForBrefCooldown(
  checkpoint: WnbaCheckpoint,
  cooldownHours: number,
): Promise<void> {
  if (cooldownHours <= 0) return;

  const until = parseBrefCooldownUntil(checkpoint);
  if (!until || until <= Date.now()) return;

  const waitMs = until - Date.now();
  console.log(
    `[bref] saved cooldown — waiting ${Math.round(waitMs / 60000)} min ` +
      `(until ${checkpoint.brefCooldownUntil})...`,
  );
  await sleep(waitMs);
}

export function appendLog(path: string, line: string): void {
  writeFileSync(path, `${line}\n`, { flag: "a" });
}
