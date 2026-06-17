import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const DEFAULT_CHECKPOINT = "scrape-wnba-backfill.checkpoint.json";
export const DEFAULT_LOG = "scrape-wnba-backfill.log";

export interface WnbaCheckpoint {
  version: 1;
  completedSlugs: string[];
  allSlugs?: string[];
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

export function appendLog(path: string, line: string): void {
  writeFileSync(path, `${line}\n`, { flag: "a" });
}
