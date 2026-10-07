import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blackAndWhiteFrom, colourQuery, knownBlackAndWhite } from "./wikidata-colour.mjs";

const uri = (q: string) => `http://www.wikidata.org/entity/${q}`;

describe("blackAndWhiteFrom", () => {
  it("counts a film as black and white only when it isn't also listed in colour", () => {
    const rows = [
      { film: uri("Q132689"), colour: uri("Q838368") }, // Casablanca: black and white
      { film: uri("Q193695"), colour: uri("Q838368") }, // The Wizard of Oz: both
      { film: uri("Q193695"), colour: uri("Q22006653") },
      { film: uri("Q24871"), colour: uri("Q22006653") }, // Avatar: colour
    ];
    expect([...blackAndWhiteFrom(rows)]).toEqual(["Q132689"]);
  });
});

describe("colourQuery", () => {
  it("asks for every colour value of the given films", () => {
    expect(colourQuery(["Q1", "Q2"])).toContain("VALUES ?film { wd:Q1 wd:Q2 }");
  });
});

describe("knownBlackAndWhite", () => {
  it("answers from a fresh cache without asking Wikidata", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "colour-"));
    const now = new Date("2026-10-07T00:00:00Z");
    writeFileSync(
      path.join(dir, "wikidata-colour.json"),
      JSON.stringify({ Q132689: { blackAndWhite: true, checkedAt: now.toISOString() }, Q24871: { blackAndWhite: false, checkedAt: now.toISOString() } }),
    );
    expect([...(await knownBlackAndWhite(["Q132689", "Q24871", "not-a-qid"], { cacheDir: dir, now }))]).toEqual(["Q132689"]);
  });
});
