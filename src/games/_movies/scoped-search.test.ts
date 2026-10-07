import { describe, expect, it } from "vitest";
import { catalogSearchKey, matchTier, parseScopedSearchParams, rankByQuery } from "./scoped-search";

describe("catalogSearchKey", () => {
  it("lowercases, strips accents and collapses punctuation like the SQL key", () => {
    expect(catalogSearchKey("  Léon: The Professional ")).toBe("leon the professional");
    expect(catalogSearchKey("Ocean's Eleven")).toBe("ocean s eleven");
    expect(catalogSearchKey("Emmanuelle Béart")).toBe("emmanuelle beart");
    expect(catalogSearchKey("Mission: Impossible – Fallout")).toBe("mission impossible fallout");
  });

  it("rewrites what SQL's unaccent rewrites beyond accents", () => {
    // Each expected key is what `catalog_search_key` returns in Postgres.
    expect(catalogSearchKey("Bølgen")).toBe("bolgen");
    expect(catalogSearchKey("Æon Flux")).toBe("aeon flux");
    expect(catalogSearchKey("Hababam Sınıfı")).toBe("hababam sinifi");
    expect(catalogSearchKey("Kanał")).toBe("kanal");
    expect(catalogSearchKey("Dýrið")).toBe("dyrid");
    expect(catalogSearchKey("À ma sœur !")).toBe("a ma soeur");
    expect(catalogSearchKey("8½")).toBe("8 1 2");
    expect(catalogSearchKey("The Lion King 1½")).toBe("the lion king 1 1 2");
    expect(catalogSearchKey("Men in Black³")).toBe("men in black");
  });
});

describe("matchTier", () => {
  it("ranks exact, then the text starting with the query, then a later word, then substring", () => {
    expect(matchTier("heat", "heat")).toBe(0);
    expect(matchTier("godf", "godfather")).toBe(1);
    expect(matchTier("the", "the godfather")).toBe(1);
    expect(matchTier("godf", "the godfather")).toBe(2);
    expect(matchTier("father", "the godfather")).toBe(3);
    expect(matchTier("alien", "the godfather")).toBeNull();
    expect(matchTier("", "heat")).toBeNull();
  });

  it("ignores spaces: exact at any length, prefix from 3 characters", () => {
    expect(matchTier("xmen", "x men")).toBe(0);
    expect(matchTier("walle", "wall e")).toBe(0);
    expect(matchTier("shahrukh", "shah rukh khan")).toBe(1);
    expect(matchTier("shah rukhkhan", "shah rukh khan")).toBe(0);
    expect(matchTier("it", "i t")).toBe(0);
    // Two characters only match the spaced key, so "it" doesn't find "I, Tonya".
    expect(matchTier("it", "i tonya")).toBeNull();
    expect(matchTier("ito", "i tonya")).toBe(1);
  });

  it("needs 3 characters for a later word or a substring", () => {
    expect(matchTier("ha", "tom hanks")).toBeNull();
    expect(matchTier("han", "tom hanks")).toBe(2);
    expect(matchTier("ank", "tom hanks")).toBe(3);
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

  it("never ranks a later-word match above an exact name, however popular", () => {
    // Godfather (exact) first; the rest only have a later word starting with "godfather".
    expect(rank("godfather")).toEqual([3, 5, 2, 1, 6]);
  });

  it("ignores case, punctuation and spaces", () => {
    expect(rank("MR. GODFATHERS")).toEqual([5]);
    // Spaces are ignored for the whole name, not inside later words.
    expect(rank("god-father")).toEqual([3]);
  });

  it("applies the limit", () => {
    expect(rank("godfather", 2)).toEqual([3, 5]);
  });

  const people = [
    { id: 1, name: "Deepika", popularity: 0 },
    { id: 2, name: "Deepika Padukone", popularity: 89 },
    { id: 3, name: "Deepika Amin", popularity: 14 },
    { id: 4, name: "Shah Rukh Khan", popularity: 136 },
    { id: 5, name: "Salman Khan", popularity: 104 },
    { id: 6, name: "Khan", popularity: 2 },
    { id: 7, name: "Aamir Khanna", popularity: 3 },
  ];
  const rankPeople = (query: string) =>
    rankByQuery(people, query, { text: (p) => p.name, popularity: (p) => p.popularity, limit: 8 }).map((p) => p.id);

  it("ranks by popularity: an exact name wins unless the other has ten times the popularity", () => {
    // ln(1 + 89) > ln(1 + 0) + ln 10, so Deepika Padukone leads; ln(1 + 14) > ln 10 too.
    expect(rankPeople("deepika")).toEqual([2, 3, 1]);
    expect(rankPeople("shahrukh")).toEqual([4]);
  });

  it("keeps later-word matches below the exact name, still by popularity among themselves", () => {
    expect(rankPeople("khan")).toEqual([6, 4, 5, 7]);
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
