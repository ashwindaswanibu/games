import { describe, expect, it } from "vitest";
import { chainCreditPairs, collectCatalogRefs, compareIdBaseline, staleDegreesDays, type IdBaseline, type StoredDegreesDay } from "./catalog-check.mjs";
import { buildGraph } from "./degrees-graph.mjs";

describe("compareIdBaseline", () => {
  const baseline: IdBaseline = {
    takenAt: "2026-10-07T00:00:00Z",
    films: [
      { id: 30, wikidataId: "Q44578", imdbId: "tt0120338", tmdbId: 597 },
      { id: 1353, wikidataId: "Q3346699", imdbId: null, tmdbId: null },
    ],
    people: [{ id: 4, wikidataId: "Q192643", imdbId: null }],
  };

  it("passes when every id is still there; filling in an empty external id is fine", () => {
    const after: IdBaseline = {
      ...baseline,
      films: [...baseline.films.map((f) => (f.id === 1353 ? { ...f, imdbId: "tt1937390" } : f)), { id: 6000, wikidataId: "Q1", imdbId: "tt0000001", tmdbId: null }],
      people: [{ id: 4, wikidataId: "Q192643", imdbId: "nm0001173" }],
    };
    expect(compareIdBaseline(baseline, after)).toEqual([]);
  });

  it("reports a missing id and a changed external id", () => {
    const after: IdBaseline = { ...baseline, films: [{ id: 30, wikidataId: "Q44578", imdbId: "tt9999999", tmdbId: 597 }], people: [] };
    expect(compareIdBaseline(baseline, after)).toEqual(["film 30: imdbId changed from tt0120338 to tt9999999", "film 1353 is gone", "person 4 is gone"]);
  });
});

describe("collectCatalogRefs", () => {
  it("finds film and person refs anywhere in a stored value, and nothing else", () => {
    const refs = collectCatalogRefs({
      start: { id: 11, name: "Al Pacino" },
      path: [{ film: { id: 31, title: "The Godfather", year: 1972 }, person: { id: 12, name: "Robert De Niro" } }],
      answer: { id: 483, title: "Dune: Part Two", year: 2024, genres: [], directors: [] },
      options: [{ id: 7, title: "Heat", year: 1995 }],
      levels: [{ id: "73b0ebd7-bacd-41f3-928e-adb4c3653cda", width: 2400 }],
      turns: [{ film: { id: 8, title: "Arrival", year: 2016 }, correct: false }, { skipped: true }],
      counter: { id: 5 },
    });
    expect([...refs.films].sort((a, b) => a - b)).toEqual([7, 8, 31, 483]);
    expect([...refs.people].sort((a, b) => a - b)).toEqual([11, 12]);
  });
});

describe("chainCreditPairs", () => {
  it("pairs each link's film with both of its actors", () => {
    expect(
      chainCreditPairs(1, [
        { film: { id: 100 }, person: { id: 2 } },
        { film: { id: 200 }, person: { id: 3 } },
      ]),
    ).toEqual([
      [100, 1],
      [100, 2],
      [200, 2],
      [200, 3],
    ]);
  });
});

describe("staleDegreesDays", () => {
  // 1 ─(100)─ 2 ─(101)─ 3, and a new film 102 puts 1 and 3 together.
  const graph = buildGraph([
    { filmId: 100, personId: 1, billing: 0 },
    { filmId: 100, personId: 2, billing: 1 },
    { filmId: 101, personId: 2, billing: 0 },
    { filmId: 101, personId: 3, billing: 1 },
    { filmId: 101, personId: 4, billing: 2 },
    { filmId: 102, personId: 1, billing: 0 },
    { filmId: 102, personId: 3, billing: 1 },
  ]);
  const person = (id: number) => ({ id, name: `P${id}` });
  const day = (date: string, start: number, end: number, par: number, extra: Partial<StoredDegreesDay> = {}): StoredDegreesDay => ({
    date,
    start: person(start),
    end: person(end),
    par,
    fixture: false,
    played: false,
    ...extra,
  });

  it("lists unplayed days from today on whose pair is now closer than par, with what --repar-unplayed will do", () => {
    const stale = staleDegreesDays(
      [
        day("2026-10-08", 1, 3, 3), // now co-stars: regenerate
        day("2026-10-09", 2, 4, 3), // now 1 link too: regenerate
        day("2026-10-10", 1, 4, 3), // 1 → 102 → 3 → 101 → 4 is 2 links: par 2
        day("2026-10-11", 1, 4, 2), // still 2: fine
      ],
      graph,
      "2026-10-08",
      2,
    );
    expect(stale.map((d) => [d.date, d.shortest, d.decision])).toEqual([
      ["2026-10-08", 1, { action: "regenerate" }],
      ["2026-10-09", 1, { action: "regenerate" }],
      ["2026-10-10", 2, { action: "repar", par: 2 }],
    ]);
  });

  it("ignores played days and days before today, and marks DEV FIXTURE days as left alone", () => {
    const stale = staleDegreesDays(
      [day("2026-10-07", 1, 3, 3), day("2026-10-08", 1, 3, 3, { played: true }), day("2026-10-09", 1, 3, 3, { fixture: true })],
      graph,
      "2026-10-08",
      2,
    );
    expect(stale.map((d) => [d.date, d.decision])).toEqual([["2026-10-09", { action: "skip", reason: "fixture" }]]);
  });
});
