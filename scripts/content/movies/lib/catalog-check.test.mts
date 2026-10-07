import { describe, expect, it } from "vitest";
import { chainCreditPairs, collectCatalogRefs, compareIdBaseline, type IdBaseline } from "./catalog-check.mjs";

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
