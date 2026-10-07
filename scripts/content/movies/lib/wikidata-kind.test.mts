import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filmKinds, kindFrom, reachesQuery } from "./wikidata-kind.mjs";

describe("reachesQuery", () => {
  it("follows instance-of or genre through subclasses", () => {
    const q = reachesQuery(["Q1", "Q2"], "Q202866");
    expect(q).toContain("VALUES ?film { wd:Q1 wd:Q2 }");
    expect(q).toContain("(wdt:P31|wdt:P136)/wdt:P279* wd:Q202866");
  });
});

describe("kindFrom", () => {
  it("calls a live-action/animated film a hybrid, not animated", () => {
    // Avatar's genre "live-action/animated film" is itself a subclass of animated film.
    expect(kindFrom("Q24871", new Set(["Q24871"]), new Set(["Q24871"]))).toBe("hybrid");
    expect(kindFrom("Q171048", new Set(["Q171048"]), new Set())).toBe("animated");
    expect(kindFrom("Q105031", new Set(), new Set())).toBe("live");
  });
});

describe("filmKinds", () => {
  it("answers from a fresh cache without asking Wikidata, and calls unknown films live action", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kind-"));
    const now = new Date("2026-10-07T00:00:00Z");
    writeFileSync(
      path.join(dir, "wikidata-kind-v2.json"),
      JSON.stringify({ Q171048: { kind: "animated", checkedAt: now.toISOString() }, Q24871: { kind: "hybrid", checkedAt: now.toISOString() }, Q105031: { kind: "live", checkedAt: now.toISOString() } }),
    );
    const kinds = await filmKinds(["Q171048", "Q24871", "Q105031", "not-a-qid"], { cacheDir: dir, now });
    expect([...kinds]).toEqual([
      ["Q171048", "animated"],
      ["Q24871", "hybrid"],
      ["Q105031", "live"],
    ]);
  });
});
