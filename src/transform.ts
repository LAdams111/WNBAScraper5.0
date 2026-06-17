import type { WnbaPlayerSeasonRecord, HoopCentralIngestPayload } from "./types.js";
import { nameToSlug } from "./utils/teams.js";

export function toIngestPayload(
  record: WnbaPlayerSeasonRecord,
  playerOverride?: HoopCentralIngestPayload["player"],
): HoopCentralIngestPayload {
  return {
    source: record.source,
    externalId: record.externalId,
    player: playerOverride ?? { displayName: record.displayName },
    league: {
      slug: record.leagueSlug,
      name: record.leagueName,
    },
    team: {
      slug: record.teamSlug,
      name: record.teamName,
      abbreviation: record.teamAbbreviation,
    },
    season: {
      label: record.seasonLabel,
    },
    stats: record.stats,
  };
}

export function buildPlayerSeasonRecord(input: {
  externalId: string;
  displayName: string;
  teamName: string;
  teamAbbreviation: string;
  seasonLabel: string;
  stats: WnbaPlayerSeasonRecord["stats"];
}): WnbaPlayerSeasonRecord {
  return {
    source: "basketball-reference-wnba",
    externalId: input.externalId,
    displayName: input.displayName,
    leagueSlug: "wnba",
    leagueName: "WNBA",
    teamSlug: nameToSlug(input.teamName),
    teamName: input.teamName,
    teamAbbreviation: input.teamAbbreviation,
    seasonLabel: input.seasonLabel,
    stats: input.stats,
  };
}
