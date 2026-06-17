import { load } from "cheerio";
import { BrefClient, uncommentBrefHtml } from "../brefClient.js";
import type { WnbaPlayerMeta, WnbaSeasonRow } from "../types.js";
import { buildPlayerSeasonRecord } from "../transform.js";
import type { WnbaPlayerSeasonRecord } from "../types.js";
import { normalizeSeasonLabel, round1, seasonLabelToEndYear } from "../utils/season.js";
import {
  getCachedTeam,
  loadTeamCache,
  saveTeamCache,
  setCachedTeam,
  type TeamCache,
} from "./teamCache.js";

function parseNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number.parseFloat(value.trim());
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCellNum($tr: { find: (sel: string) => { text: () => string } }, dataStat: string): number | null {
  return parseNumber($tr.find(`td[data-stat="${dataStat}"]`).text());
}

function extractTeamAbbrevFromRow($: ReturnType<typeof load>, $tr: ReturnType<ReturnType<typeof load>>): string | null {
  const $teamLink = $tr
    .find(
      'td[data-stat="team_id"] a, td[data-stat="team"] a, [data-stat="team_id"] a, [data-stat="team"] a',
    )
    .first();
  const teamLink = $teamLink.attr("href") ?? "";

  if (teamLink) {
    const match =
      /\/wnba\/teams\/([A-Za-z0-9]+)\/(\d{4})\.html/i.exec(teamLink) ??
      /\/teams\/([A-Za-z0-9]+)\/(\d{4})\.html/i.exec(teamLink);
    if (match) return match[1].toUpperCase();
  }

  if (!teamLink) {
    let found: string | null = null;
    $tr.find('a[href*="teams"]').each((_, el) => {
      if (found) return;
      const href = $(el).attr("href") ?? "";
      const m =
        /\/wnba\/teams\/([A-Za-z0-9]+)\//i.exec(href) ??
        /\/teams\/([A-Za-z0-9]+)\//i.exec(href);
      if (m) found = m[1].toUpperCase();
    });
    if (found) return found;
  }

  const text = (
    $tr.find('td[data-stat="team_id"]').text() ||
    $tr.find('td[data-stat="team"]').text() ||
    $tr.find('td[data-stat="tm"]').text() ||
    ""
  ).trim();
  if (text && /^[A-Za-z]{2,5}$/.test(text)) return text.toUpperCase();

  return null;
}

function extractTeamSeasonYear($: ReturnType<typeof load>, $tr: ReturnType<ReturnType<typeof load>>): number | null {
  const $teamLink = $tr
    .find(
      'td[data-stat="team_id"] a, td[data-stat="team"] a, [data-stat="team_id"] a, [data-stat="team"] a',
    )
    .first();
  const teamLink = $teamLink.attr("href") ?? "";
  const match =
    /\/wnba\/teams\/[A-Za-z0-9]+\/(\d{4})\.html/i.exec(teamLink) ??
    /\/teams\/[A-Za-z0-9]+\/(\d{4})\.html/i.exec(teamLink);
  if (match) return Number.parseInt(match[1], 10);
  return null;
}

function readSeasonRaw($: ReturnType<typeof load>, $tr: ReturnType<ReturnType<typeof load>>): string {
  const statNames = ["season", "Season", "year_id", "year"];
  for (const stat of statNames) {
    const cell = $tr.find(`th[data-stat="${stat}"]`);
    if (cell.length) {
      return (cell.find("a").length ? cell.find("a") : cell).text().trim();
    }
  }
  return "";
}

function extractSeasonRowsFromTable(
  $: ReturnType<typeof load>,
  $table: ReturnType<ReturnType<typeof load>>,
): WnbaSeasonRow[] {
  const rows: WnbaSeasonRow[] = [];
  const $bodyRows = $table.find("tbody tr.full_table");
  const $rows = $bodyRows.length ? $bodyRows : $table.find("tbody tr");

  $rows.each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass("thead") || $tr.hasClass("partial_table")) return;

    const seasonRaw = readSeasonRaw($, $tr);
    const seasonLabel = normalizeSeasonLabel(seasonRaw);
    if (!seasonLabel) return;

    const teamAbbreviation = extractTeamAbbrevFromRow($, $tr);
    if (!teamAbbreviation || teamAbbreviation === "TOT") return;

    const lg = (
      $tr.find('td[data-stat="lg_id"]').text() ||
      $tr.find('td[data-stat="comp_name_abbr"]').text() ||
      ""
    ).trim();
    if (lg === "NBA") return;

    const gamesPlayed = parseCellNum($tr, "g") ?? parseCellNum($tr, "games");
    if (!gamesPlayed || gamesPlayed <= 0) return;

    const pointsPerGame = parseCellNum($tr, "pts_per_g");
    const reboundsPerGame = parseCellNum($tr, "trb_per_g");
    const assistsPerGame = parseCellNum($tr, "ast_per_g");
    if (pointsPerGame == null || reboundsPerGame == null || assistsPerGame == null) return;

    const teamSeasonYear =
      extractTeamSeasonYear($, $tr) ?? seasonLabelToEndYear(seasonLabel);

    rows.push({
      seasonLabel,
      teamAbbreviation,
      teamSeasonYear: Number.isNaN(teamSeasonYear)
        ? seasonLabelToEndYear(seasonLabel)
        : teamSeasonYear,
      gamesPlayed: Math.round(gamesPlayed),
      pointsPerGame: round1(pointsPerGame),
      reboundsPerGame: round1(reboundsPerGame),
      assistsPerGame: round1(assistsPerGame),
      stealsPerGame: round1(parseCellNum($tr, "stl_per_g") ?? 0),
      blocksPerGame: round1(parseCellNum($tr, "blk_per_g") ?? 0),
    });
  });

  return rows;
}

function parseSeasonRowsFromTable($: ReturnType<typeof load>): WnbaSeasonRow[] {
  const selectors = [
    "#wnba_per_game",
    "#wnba_per_game_stats",
    "#per_game",
    "#per_game_stats",
    "#per_game0",
    'table[id^="per_game0"]',
  ];

  for (const selector of selectors) {
    const $table = $(selector).first();
    if ($table.length) {
      const rows = extractSeasonRowsFromTable($, $table);
      if (rows.length > 0) return rows;
    }
  }

  const rows: WnbaSeasonRow[] = [];
  $("table").each((_, table) => {
    if (rows.length > 0) return;
    const $t = $(table);
    const hasSeason =
      $t.find('tbody tr th[data-stat="season"]').length +
      $t.find('tbody tr th[data-stat="Season"]').length +
      $t.find('tbody tr th[data-stat="year_id"]').length +
      $t.find('tbody tr th[data-stat="year"]').length;
    const hasTeam =
      $t.find('tbody tr td[data-stat="team_id"]').length +
      $t.find('tbody tr td[data-stat="team_name_abbr"]').length +
      $t.find('tbody tr td[data-stat="team"]').length;
    const hasPts = $t.find('tbody tr td[data-stat="pts_per_g"]').length;
    if ((hasSeason || hasTeam) && (hasPts || hasTeam)) {
      const extracted = extractSeasonRowsFromTable($, $t);
      if (extracted.length > 0) rows.push(...extracted);
    }
  });

  return rows;
}

function parseSeasonRowsFromComments(rawHtml: string): WnbaSeasonRow[] {
  const tryComment = (commentContent: string, requireFullSeasons = false): WnbaSeasonRow[] => {
    if (!commentContent || commentContent.length < 300) return [];
    try {
      const $ = load(commentContent);
      const rows = parseSeasonRowsFromTable($);
      const hasFullSeasons = rows.some((r) => r.gamesPlayed > 1);
      if (rows.length === 0) return [];
      if (requireFullSeasons && !hasFullSeasons) return [];
      return rows;
    } catch {
      return [];
    }
  };

  const patterns = [
    /<div[^>]*id="all_per_game"[^>]*>\s*<!--\s*([\s\S]*?)-->/i,
    /<div[^>]*id="all_per_game_stats"[^>]*>\s*<!--\s*([\s\S]*?)-->/i,
    /<div[^>]*id="all_per_game-playoffs_per_game"[^>]*>\s*<!--\s*([\s\S]*?)-->/i,
    /<div[^>]*id="all_wnba_per_game"[^>]*>\s*<!--\s*([\s\S]*?)-->/i,
    /<div[^>]*id="all_wnba_per_game_stats"[^>]*>\s*<!--\s*([\s\S]*?)-->/i,
    /<div[^>]*id="[^"]*wnba[^"]*per_game[^"]*"[^>]*>[\s\S]*?<!--\s*([\s\S]*?)-->/i,
  ];

  for (const re of patterns) {
    const m = re.exec(rawHtml);
    if (m?.[1]) {
      const rows = tryComment(m[1], false);
      if (rows.length > 0) return rows;
    }
  }

  const commentRegex = /<!--([\s\S]*?)-->/g;
  let match: RegExpExecArray | null;
  while ((match = commentRegex.exec(rawHtml)) !== null) {
    const commentContent = match[1];
    if (commentContent.length < 300) continue;
    if (
      !commentContent.includes("season") &&
      !commentContent.includes("pts_per_g") &&
      !commentContent.includes("team_id") &&
      !commentContent.includes("per_game") &&
      !commentContent.includes("year_id") &&
      !commentContent.includes('data-stat="tm"') &&
      !commentContent.includes('data-stat="team"')
    ) {
      continue;
    }
    const rows = tryComment(commentContent, true);
    if (rows.length > 0) return rows;
  }

  return [];
}

export function parseSeasonRowsFromHtml(html: string): WnbaSeasonRow[] {
  const unwrapped = uncommentBrefHtml(html);
  const $ = load(unwrapped);
  let rows = parseSeasonRowsFromTable($);
  const fromComments = parseSeasonRowsFromComments(html);
  if (fromComments.length > rows.length) {
    rows = fromComments;
  }
  return rows;
}

export async function buildPlayerSeasonRecords(
  bref: BrefClient,
  slug: string,
  html: string,
  meta: WnbaPlayerMeta,
  teamCachePath: string,
): Promise<WnbaPlayerSeasonRecord[]> {
  const seasonRows = parseSeasonRowsFromHtml(html);
  const playerUrl = bref.playerUrl(slug);
  const cache = loadTeamCache(teamCachePath);
  const records: WnbaPlayerSeasonRecord[] = [];

  for (const row of seasonRows) {
    const team = await resolveTeam(
      bref,
      cache,
      row.teamAbbreviation,
      row.teamSeasonYear,
      teamCachePath,
      playerUrl,
    );
    records.push(
      buildPlayerSeasonRecord({
        externalId: slug,
        displayName: meta.displayName,
        teamName: team.fullName,
        teamAbbreviation: team.abbrev,
        seasonLabel: row.seasonLabel,
        stats: {
          gamesPlayed: row.gamesPlayed,
          pointsPerGame: row.pointsPerGame,
          reboundsPerGame: row.reboundsPerGame,
          assistsPerGame: row.assistsPerGame,
          stealsPerGame: row.stealsPerGame,
          blocksPerGame: row.blocksPerGame,
        },
      }),
    );
  }

  return records;
}

async function resolveTeam(
  bref: BrefClient,
  cache: TeamCache,
  abbrev: string,
  seasonYear: number,
  teamCachePath: string,
  playerReferer: string,
) {
  const cached = getCachedTeam(cache, abbrev, seasonYear);
  if (cached) return cached;

  const teamHtml = uncommentBrefHtml(
    await bref.fetchHtml(bref.teamUrl(abbrev, seasonYear), playerReferer),
  );
  const fullName = bref.parseTeamNameFromTitle(teamHtml);
  const entry = setCachedTeam(cache, abbrev, seasonYear, fullName);
  saveTeamCache(teamCachePath, cache);
  return entry;
}
