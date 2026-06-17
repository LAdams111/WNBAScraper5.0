import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePlayerMetaFromHtml,
  parseTeamNameFromTitleHtml,
} from "../brefClient.js";
import { parseSeasonRowsFromHtml } from "../scrape/playerSeason.js";
import { metaToIngestPlayer } from "../utils/profile.js";
import { nameToSlug } from "../utils/teams.js";
import { normalizeSeasonLabel, round1 } from "../utils/season.js";
import { buildPlayerSeasonRecord, toIngestPayload } from "../transform.js";

function seasonRow(
  season: string,
  team: string,
  year: number,
  g: number,
  pts: number,
  trb: number,
  ast: number,
  stl = 1.0,
  blk = 0.3,
): string {
  return `<tr>
  <th data-stat="season">${season}</th>
  <td data-stat="team_id"><a href="/wnba/teams/${team}/${year}.html">${team}</a></td>
  <td data-stat="g">${g}</td>
  <td data-stat="pts_per_g">${pts}</td>
  <td data-stat="trb_per_g">${trb}</td>
  <td data-stat="ast_per_g">${ast}</td>
  <td data-stat="stl_per_g">${stl}</td>
  <td data-stat="blk_per_g">${blk}</td>
</tr>`;
}

const VISIBLE_ROWS = [
  seasonRow("2021", "PHO", 2021, 22, 17.7, 3.4, 4.0),
  seasonRow("2022", "PHO", 2022, 34, 19.7, 3.4, 5.0),
  seasonRow("2023", "SEA", 2023, 38, 16.5, 2.6, 5.4),
  seasonRow("2024", "SEA", 2024, 40, 14.5, 2.8, 6.0),
].join("\n");

const COMMENT_ROWS = [
  seasonRow("2013-14", "TUL", 2014, 34, 14.9, 2.6, 5.0),
  seasonRow("2014-15", "TUL", 2015, 34, 16.5, 3.0, 4.9),
  seasonRow("2015-16", "DAL", 2016, 34, 14.5, 3.1, 5.0),
  seasonRow("2016", "DAL", 2017, 34, 16.2, 3.1, 4.8),
  seasonRow("2017", "DAL", 2018, 34, 17.9, 3.1, 5.0),
  seasonRow("2018", "DAL", 2019, 34, 16.9, 3.1, 5.0),
  seasonRow("2019", "PHO", 2020, 24, 17.0, 3.3, 4.7),
  seasonRow("2020", "PHO", 2021, 22, 17.7, 3.4, 4.0),
  seasonRow("2021", "PHO", 2021, 22, 17.7, 3.4, 4.0),
  seasonRow("2022", "PHO", 2022, 34, 19.7, 3.4, 5.0),
  seasonRow("2023", "SEA", 2023, 38, 16.5, 2.6, 5.4),
  seasonRow("2024", "SEA", 2024, 40, 14.5, 2.8, 6.0),
  `<tr>
  <th data-stat="season">2024</th>
  <td data-stat="team_id">TOT</td>
  <td data-stat="g">40</td>
  <td data-stat="pts_per_g">14.5</td>
  <td data-stat="trb_per_g">2.8</td>
  <td data-stat="ast_per_g">6.0</td>
  <td data-stat="stl_per_g">1.5</td>
  <td data-stat="blk_per_g">0.3</td>
</tr>`,
].join("\n");

const DIGGINS_FIXTURE = `
<html><head><title>Skylar Diggins WNBA Stats | Basketball-Reference.com</title></head>
<body>
<div id="info">Position: G ▪ 5-9 (175cm), 145lb (66kg) ▪ Born: August 2, 1990 in South Bend, in</div>
<span id="necro-birth" data-birth="1990-08-02"></span>
<table id="wnba_per_game">
<tbody>
${VISIBLE_ROWS}
</tbody>
</table>
<div id="all_wnba_per_game">
<!--
<table id="wnba_per_game">
<tbody>
${COMMENT_ROWS}
</tbody>
</table>
-->
</div>
</body></html>
`;

describe("WNBA stats parsing", () => {
  it("parses player meta from page title and birth date", () => {
    const meta = parsePlayerMetaFromHtml("digginsk01w", DIGGINS_FIXTURE);
    assert.equal(meta.displayName, "Skylar Diggins");
    assert.equal(meta.birthDate, "1990-08-02");
    assert.equal(meta.position, "G");
    assert.equal(meta.heightCm, 175);
    assert.equal(meta.weightKg, 66);
  });

  it("parses digginsk01w with more than 4 season rows from comment table", () => {
    const rows = parseSeasonRowsFromHtml(DIGGINS_FIXTURE);
    assert.ok(rows.length > 4, `expected >4 rows, got ${rows.length}`);

    const seasons = rows.map((r) => r.seasonLabel);
    assert.ok(seasons.includes("2013-14"));
    assert.ok(seasons.includes("2016-17"));
    assert.ok(seasons.includes("2024-25"));

    for (const row of rows) {
      assert.notEqual(row.teamAbbreviation, "TOT");
      assert.ok(row.teamAbbreviation.length >= 2);
      assert.ok(row.gamesPlayed > 0);
      assert.ok(row.pointsPerGame >= 0);
      assert.ok(row.reboundsPerGame >= 0);
      assert.ok(row.assistsPerGame >= 0);
    }
  });

  it("skips TOT rows and zero-game rows", () => {
    const html = `${DIGGINS_FIXTURE.replace("</tbody>", `
${seasonRow("2025", "SEA", 2025, 0, 0.0, 0.0, 0.0)}
</tbody>`)}`;
    const rows = parseSeasonRowsFromHtml(html);
    assert.equal(rows.every((r) => r.teamAbbreviation !== "TOT"), true);
    assert.equal(rows.every((r) => r.gamesPlayed > 0), true);
  });

  it("parses current BRef per_game0 table format", () => {
    const html = `
<table id="per_game0"><tbody>
<tr class="full_table"><th data-stat="year"><a href='/wnba/years/2013.html'>2013</a></th>
<td data-stat="team"><a href='/wnba/teams/TUL/2013.html'>TUL</a></td>
<td data-stat="g">32</td><td data-stat="pts_per_g">8.5</td><td data-stat="trb_per_g">1.9</td><td data-stat="ast_per_g">3.8</td>
<td data-stat="stl_per_g">1.3</td><td data-stat="blk_per_g">0.3</td></tr>
<tr class="full_table"><th data-stat="year"><a href='/wnba/years/2014.html'>2014</a></th>
<td data-stat="team"><a href='/wnba/teams/TUL/2014.html'>TUL</a></td>
<td data-stat="g">34</td><td data-stat="pts_per_g">20.1</td><td data-stat="trb_per_g">2.5</td><td data-stat="ast_per_g">5.0</td>
<td data-stat="stl_per_g">1.5</td><td data-stat="blk_per_g">0.6</td></tr>
</tbody></table>`;
    const rows = parseSeasonRowsFromHtml(html);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].seasonLabel, "2013-14");
    assert.equal(rows[0].teamAbbreviation, "TUL");
    assert.equal(rows[0].teamSeasonYear, 2013);
    assert.equal(rows[1].pointsPerGame, 20.1);
  });

  it("normalizes single-year season labels", () => {
    assert.equal(normalizeSeasonLabel("2016"), "2016-17");
    assert.equal(normalizeSeasonLabel("2013-14"), "2013-14");
  });

  it("parses team title into full name", () => {
    assert.equal(
      parseTeamNameFromTitleHtml("<html><head><title>2013-14 Tulsa Shock Stats</title></head></html>"),
      "Tulsa Shock",
    );
    assert.equal(
      parseTeamNameFromTitleHtml("<html><head><title>2013 Tulsa Shock Stats</title></head></html>"),
      "Tulsa Shock",
    );
  });

  it("builds ingest payload shape", () => {
    const record = buildPlayerSeasonRecord({
      externalId: "digginsk01w",
      displayName: "Skylar Diggins",
      teamName: "Phoenix Mercury",
      teamAbbreviation: "PHO",
      seasonLabel: "2013-14",
      stats: {
        gamesPlayed: 34,
        pointsPerGame: 20.1,
        reboundsPerGame: 3.2,
        assistsPerGame: 5.0,
        stealsPerGame: 1.5,
        blocksPerGame: 0.3,
      },
    });

    const meta = parsePlayerMetaFromHtml("digginsk01w", DIGGINS_FIXTURE);
    const payload = toIngestPayload(record, metaToIngestPlayer(meta));

    assert.equal(payload.source, "basketball-reference-wnba");
    assert.equal(payload.externalId, "digginsk01w");
    assert.equal(payload.league.slug, "wnba");
    assert.equal(payload.league.name, "WNBA");
    assert.equal(payload.team.slug, "phoenix-mercury");
    assert.equal(payload.player.birthDate, "1990-08-02");
    assert.equal(payload.stats.pointsPerGame, 20.1);
  });
});

describe("helpers", () => {
  it("rounds stats to one decimal", () => {
    assert.equal(round1(19.74), 19.7);
  });

  it("slugifies team names", () => {
    assert.equal(nameToSlug("Phoenix Mercury"), "phoenix-mercury");
    assert.equal(nameToSlug("Tulsa Shock"), "tulsa-shock");
  });
});
