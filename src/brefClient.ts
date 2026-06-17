import { buildBrefHeaders } from "./utils/browserHeaders.js";
import {
  backoffMs,
  parseRetryAfterMs,
  randomDelayMs,
  sleep,
} from "./utils/rateLimiter.js";
import { parseWnbaBioFromHtml } from "./utils/profile.js";
import type { WnbaPlayerMeta } from "./types.js";

export class BrefClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrefClientError";
  }
}

export class BrefRateLimitError extends BrefClientError {}

/** BRef serves stat tables inside HTML comments; unwrap before cheerio parse. */
export function uncommentBrefHtml(html: string): string {
  return html.replace(/<!--\s*\n/g, "").replace(/\n\s*-->/g, "");
}

export interface BrefClientOptions {
  requestDelayMs: number;
  indexDelayMs?: number;
  /** Extra random spread added on top of requestDelayMs (+ penalty). */
  jitterMaxMs?: number;
  /** Stop after N 429 retries (backfill uses 1 short wait, not 8 hammer retries). */
  rateLimitRetries?: number;
  /** Wait before a 429 retry during backfill. */
  rateLimitWaitMs?: number;
  /** Resume after a saved checkpoint cooldown. */
  initialCooldownUntil?: number;
}

export class BrefClient {
  private lastRequestAt = 0;
  private cooldownUntil: number;
  private penaltyDelayMs = 0;

  constructor(private readonly options: BrefClientOptions) {
    this.cooldownUntil = options.initialCooldownUntil ?? 0;
  }

  private get requestDelayMs(): number {
    return this.options.requestDelayMs;
  }

  private get indexDelayMs(): number {
    return this.options.indexDelayMs ?? 15_000;
  }

  private get jitterMaxMs(): number {
    return this.options.jitterMaxMs ?? 1500;
  }

  private effectiveDelay(minDelayMs: number): number {
    const base = minDelayMs + this.penaltyDelayMs;
    return randomDelayMs(base, base + this.jitterMaxMs);
  }

  private decayPenalty(): void {
    if (this.penaltyDelayMs > 0) {
      this.penaltyDelayMs = Math.max(0, this.penaltyDelayMs - 500);
    }
  }

  private async throttle(minDelayMs = this.requestDelayMs): Promise<void> {
    const now = Date.now();
    if (now < this.cooldownUntil) {
      const waitMs = this.cooldownUntil - now;
      console.error(`[bref] cooldown active, waiting ${Math.round(waitMs / 1000)}s...`);
      await sleep(waitMs);
    }

    const targetDelay = this.effectiveDelay(minDelayMs);
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < targetDelay) {
      await sleep(targetDelay - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  /** Extra breathing room between players during backfill. */
  async restBetweenPlayers(minMs = 3000, maxMs = 8000): Promise<void> {
    const restMs = randomDelayMs(minMs, maxMs);
    console.log(`[bref] resting ${Math.round(restMs / 1000)}s before next player...`);
    await sleep(restMs);
  }

  private async applyRateLimitCooldown(response: Response, attempt: number): Promise<void> {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
    const waitMs = retryAfterMs ?? backoffMs(attempt);
    this.cooldownUntil = Date.now() + waitMs;
    this.penaltyDelayMs = Math.min(15_000, this.penaltyDelayMs + 3000);
    console.error(
      `[bref] rate limited (${response.status}), waiting ${Math.round(waitMs / 1000)}s ` +
        `(penalty delay now +${this.penaltyDelayMs}ms)...`,
    );
    await sleep(waitMs);
  }

  async fetchHtml(url: string, referer?: string, retries = 8): Promise<string> {
    const maxRateLimitRetries = this.options.rateLimitRetries ?? 0;
    let rateLimitHits = 0;
    const rateLimitWaitMs = this.options.rateLimitWaitMs ?? 90_000;
    const maxAttempts = retries;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.throttle();

      let response: Response;
      try {
        response = await fetch(url, {
          headers: buildBrefHeaders(referer),
        });
      } catch (error) {
        if (attempt === maxAttempts) {
          const message = error instanceof Error ? error.message : String(error);
          throw new BrefClientError(message);
        }
        await sleep(backoffMs(attempt, 2000));
        continue;
      }

      if (response.status === 429 || response.status === 503) {
        if (rateLimitHits < maxRateLimitRetries) {
          rateLimitHits += 1;
          const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
          const waitMs = retryAfterMs ?? rateLimitWaitMs;
          this.penaltyDelayMs = Math.min(15_000, this.penaltyDelayMs + 3000);
          console.error(
            `[bref] rate limited (${response.status}), pausing ${Math.round(waitMs / 1000)}s ` +
              `then retrying (${rateLimitHits}/${maxRateLimitRetries})...`,
          );
          await sleep(waitMs);
          attempt -= 1;
          continue;
        }
        throw new BrefRateLimitError(`BRef rate limited (${response.status}): ${url}`);
      } else if (response.status >= 500) {
        if (attempt < maxAttempts) {
          await sleep(backoffMs(attempt, 3000));
          continue;
        }
      }

      if (!response.ok) {
        throw new BrefClientError(`BRef fetch failed (${response.status}): ${url}`);
      }

      this.decayPenalty();
      return await response.text();
    }

    throw new BrefClientError(`Failed to fetch ${url}`);
  }

  playerUrl(slug: string): string {
    const letter = slug.slice(0, 1).toLowerCase();
    return `https://www.basketball-reference.com/wnba/players/${letter}/${slug}.html`;
  }

  indexUrl(letter: string): string {
    return `https://www.basketball-reference.com/wnba/players/${letter.toLowerCase()}/`;
  }

  teamUrl(abbrev: string, seasonYear: number): string {
    return `https://www.basketball-reference.com/wnba/teams/${abbrev.toUpperCase()}/${seasonYear}.html`;
  }

  async listSlugsForLetter(letter: string): Promise<string[]> {
    const html = await this.fetchHtml(
      this.indexUrl(letter),
      "https://www.basketball-reference.com/wnba/players/",
    );
    const slugs = new Set<string>();

    for (const match of html.matchAll(/href="\/wnba\/players\/[a-z]\/([a-z0-9]+)\.html"/gi)) {
      const slug = match[1].toLowerCase();
      if (slug.endsWith("w")) slugs.add(slug);
    }

    return [...slugs].sort();
  }

  async listAllSlugs(): Promise<string[]> {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    const all = new Set<string>();

    for (const letter of letters) {
      await this.throttle(this.indexDelayMs);
      const slugs = await this.listSlugsForLetter(letter);
      for (const slug of slugs) all.add(slug);
      console.log(`[index] ${letter.toUpperCase()}: ${slugs.length} players`);
    }

    return [...all].sort();
  }

  parsePlayerMeta(slug: string, html: string): WnbaPlayerMeta {
    return parsePlayerMetaFromHtml(slug, html);
  }

  parseTeamNameFromTitle(html: string): string {
    return parseTeamNameFromTitleHtml(html);
  }
}

export function parsePlayerMetaFromHtml(slug: string, html: string): WnbaPlayerMeta {
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
  let displayName = slug;
  if (titleMatch) {
    const title = titleMatch[1].replace(/\s+/g, " ").trim();
    const nameMatch = /^(.+?)\s+WNBA\s+Stats/i.exec(title);
    if (nameMatch) displayName = nameMatch[1].trim();
  }

  const bio = parseWnbaBioFromHtml(html);

  return {
    slug,
    displayName,
    birthDate: bio.birthDate,
    position: bio.position,
    heightCm: bio.heightCm,
    weightKg: bio.weightKg,
    hometown: bio.hometown,
  };
}

export function parseTeamNameFromTitleHtml(html: string): string {
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
  if (!titleMatch) {
    throw new BrefClientError("Team page missing title");
  }

  const title = titleMatch[1].replace(/\s+/g, " ").trim();
  const match =
    /^\d{4}-\d{2}\s+(.+?)\s+Stats/i.exec(title) ??
    /^\d{4}\s+(.+?)\s+Stats/i.exec(title);
  if (!match) {
    throw new BrefClientError(`Could not parse team name from title: ${title}`);
  }

  return match[1].trim();
}
