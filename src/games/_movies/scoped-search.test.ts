import { describe, expect, it } from "vitest";
import { catalogSearchKey, matchTier, parseScopedSearchParams, rankByQuery } from "./scoped-search";

describe("catalogSearchKey", () => {
  it("lowercases, strips accents and collapses punctuation like the SQL key", () => {
    expect(catalogSearchKey("  Léon: The Professional ")).toBe("leon the professional");
    expect(catalogSearchKey("Ocean's Eleven")).toBe("ocean s eleven");
    expect(catalogSearchKey("Emmanuelle Béart")).toBe("emmanuelle beart");
    expect(catalogSearchKey("Mission: Impossible – Fallout")).toBe("mission impossible fallout");
  });
});

describe("matchTier", () => {
  it("ranks exact, then prefix of the text or a word, then substring", () => {
    expect(matchTier("heat", "heat")).toBe(0);
    expect(matchTier("godf", "the godfather")).toBe(1);
    expect(matchTier("the", "the godfather")).toBe(1);
    expect(matchTier("father", "the godfather")).toBe(2);
    expect(matchTier("alien", "the godfather")).toBeNull();
    expect(matchTier("", "heat")).toBeNull();
  });
});

describe("rankByQuery", () => {
  const films = [
    { id: 1, title: "The Godfather Part II", popularity: 86 },
    { id: 2, title: "The Godfather", popularity: 132 },
    { id: 3, title: "Godfather", popularity: 1 },
    { id: 4, title: "Heat", popularity: 60 },
    { id: 5, title: "Mr. Godfathers", popularity: 999 },
    { id: 6, title: "Sons of the Godfather", popularity: 10 },
  ];
  const rank = (query: string, limit = 8) =>
    rankByQuery(films, query, { text: (f) => f.title, popularity: (f) => f.popularity, limit }).map((f) => f.id);

  it("orders by tier, then popularity, then id", () => {
    expect(rank("godfather")).toEqual([3, 5, 2, 1, 6]);
  });

  it("ignores case and punctuation, treating punctuation as a word break", () => {
    expect(rank("MR. GODFATHERS")).toEqual([5]);
    expect(rank("god-father")).toEqual([]);
  });

  it("applies the limit", () => {
    expect(rank("godfather", 2)).toEqual([3, 5]);
  });
});

describe("parseScopedSearchParams", () => {
  const parse = (query: string, scope: "person" | "film" = "person") => parseScopedSearchParams(new URLSearchParams(query), scope);

  it("parses a scope id, query and limit", () => {
    expect(parse("person=12&q=heat&limit=5")).toEqual({ person: 12, q: "heat", limit: 5 });
    expect(parse("film=7&q=  de niro ", "film")).toEqual({ film: 7, q: "de niro", limit: 8 });
    expect(parse("person=12&q=heat&limit=")).toEqual({ person: 12, q: "heat", limit: 8 });
  });

  it("refuses missing, malformed or repeated values", () => {
    for (const bad of [
      "q=heat",
      "person=&q=heat",
      "person=0&q=heat",
      "person=-3&q=heat",
      "person=1.5&q=heat",
      "person=1e3&q=heat",
      "person=0x10&q=heat",
      "person=12",
      "person=12&q=h",
      "person=12&q=heat&limit=21",
      "person=12&person=13&q=heat",
      "person=12&q=heat&q=alien",
      "person=99999999999&q=heat",
    ]) {
      expect(parse(bad), bad).toBeNull();
    }
    expect(parse("person=12&q=heat", "film")).toBeNull();
  });
});
