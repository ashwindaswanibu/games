import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { animatedQuery, knownAnimated } from "./wikidata-kind.mjs";

describe("animatedQuery", () => {
  it("follows instance-of or genre through subclasses of animated film", () => {
    const q = animatedQuery(["Q1", "Q2"]);
    expect(q).toContain("VALUES ?film { wd:Q1 wd:Q2 }");
    expect(q).toContain("(wdt:P31|wdt:P136)/wdt:P279* wd:Q202866");
  });
});

describe("knownAnimated", () => {
  it("answers from a fresh cache without asking Wikidata", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kind-"));
    const now = new Date("2026-10-07T00:00:00Z");
    writeFileSync(
      path.join(dir, "wikidata-kind.json"),
      JSON.stringify({ Q171048: { animated: true, checkedAt: now.toISOString() }, Q105031: { animated: false, checkedAt: now.toISOString() } }),
    );
    expect([...(await knownAnimated(["Q171048", "Q105031"], { cacheDir: dir, now }))]).toEqual(["Q171048"]);
  });
});
