export const WNBA_SOURCE = "basketball-reference-wnba" as const;

export interface WnbaPlayerMeta {
  slug: string;
  displayName: string;
  birthDate: string | null;
  position: string | null;
  heightCm: number | null;
  weightKg: number | null;
  hometown: string | null;
}

export interface WnbaSeasonRow {
  seasonLabel: string;
  teamAbbreviation: string;
  teamSeasonYear: number;
  gamesPlayed: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
  stealsPerGame: number;
  blocksPerGame: number;
}

export interface WnbaPlayerSeasonRecord {
  source: typeof WNBA_SOURCE;
  externalId: string;
  displayName: string;
  leagueSlug: "wnba";
  leagueName: "WNBA";
  teamSlug: string;
  teamName: string;
  teamAbbreviation: string;
  seasonLabel: string;
  stats: {
    gamesPlayed: number;
    pointsPerGame: number;
    reboundsPerGame: number;
    assistsPerGame: number;
    stealsPerGame: number;
    blocksPerGame: number;
  };
}

export interface HoopCentralIngestPayload {
  source: typeof WNBA_SOURCE;
  externalId: string;
  player: {
    displayName: string;
    birthDate?: string | null;
    position?: string | null;
    heightCm?: number | null;
    weightKg?: number | null;
    hometown?: string | null;
    headshotUrl?: string | null;
  };
  league: {
    slug: "wnba";
    name: "WNBA";
  };
  team: {
    slug: string;
    name: string;
    abbreviation: string;
  };
  season: {
    label: string;
  };
  stats: {
    gamesPlayed: number;
    pointsPerGame: number;
    reboundsPerGame: number;
    assistsPerGame: number;
    stealsPerGame?: number | null;
    blocksPerGame?: number | null;
  };
}

export interface HoopCentralIngestResponse {
  ok: true;
  playerId: number;
  created: {
    player: boolean;
    league: boolean;
    team: boolean;
    season: boolean;
    stint: boolean;
    stats: boolean;
  };
}

export interface ScrapeOptions {
  backfill: boolean;
  dryRun: boolean;
  resume: boolean;
  health?: boolean;
  limit?: number;
  playerSlug?: string;
  requestDelayMs: number;
  indexDelayMs: number;
  checkpointPath: string;
  logPath: string;
  slugCachePath: string;
  teamCachePath: string;
}

export interface ScrapeSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  seasonRows: number;
}
