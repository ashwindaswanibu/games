import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  directorNames,
  displayTitle,
  genreDisplayName,
  imdbCastToKeep,
  imdbGenreNames,
  isLatinText,
  keepStoredOrder,
  lowestVoteBar,
  MAX_CAST,
  MAX_OTHER_NAMES,
  mergeCast,
  orderGenresBySpecificity,
  parseImdbId,
  parseTmdbId,
  searchableNames,
  selectionReason,
  stripWikipediaQualifier,
  wikidataGenreNames,
  type SelectionInput,
  type SelectionRules,
} from "./catalog-model.mjs";

const rules: SelectionRules = { ...DEFAULT_RULES, currentYear: 2026 };
const movie = (overrides: Partial<SelectionInput> = {}): SelectionInput => ({
  type: "movie",
  isAdult: false,
  year: 2001,
  runtimeMinutes: 120,
  genres: ["Drama"],
  votes: 0,
  sitelinks: 0,
  existing: false,
  ...overrides,
});

describe("selectionReason", () => {
  it("takes feature films with enough votes or enough Wikipedia editions", () => {
    expect(selectionReason(movie({ votes: 1000 }), rules)).toBe("votes");
    expect(selectionReason(movie({ votes: 999 }), rules)).toBeNull();
    // World cinema IMDb under-votes: 8 Wikipedia editions are enough on their own.
    expect(selectionReason(movie({ votes: 40, sitelinks: 8 }), rules)).toBe("sitelinks");
    expect(selectionReason(movie({ votes: 40, sitelinks: 7 }), rules)).toBeNull();
  });

  it("asks less of films from the last two calendar years", () => {
    expect(selectionReason(movie({ year: 2026, votes: 300 }), rules)).toBe("recent");
    expect(selectionReason(movie({ year: 2025, votes: 300 }), rules)).toBe("recent");
    expect(selectionReason(movie({ year: 2024, votes: 300 }), rules)).toBeNull();
    expect(selectionReason(movie({ year: 2026, votes: 299 }), rules)).toBeNull();
  });

  it("takes TV movies and direct-to-video features only when well known and feature length", () => {
    const tv = (overrides: Partial<SelectionInput>) => movie({ type: "tvMovie", votes: 5000, ...overrides });
    expect(selectionReason(tv({}), rules)).toBe("tv-or-video");
    expect(selectionReason(tv({ type: "video" }), rules)).toBe("tv-or-video");
    expect(selectionReason(tv({ runtimeMinutes: null }), rules)).toBe("tv-or-video");
    expect(selectionReason(tv({ votes: 4999 }), rules)).toBeNull();
    expect(selectionReason(tv({ runtimeMinutes: 39 }), rules)).toBeNull();
    expect(selectionReason(tv({ genres: ["Animation", "Short"] }), rules)).toBeNull();
    // Wikipedia editions alone don't bring in a TV movie.
    expect(selectionReason(tv({ votes: 10, sitelinks: 40 }), rules)).toBeNull();
  });

  it("never takes adult, unreleased, undated or other kinds of titles, unless they are already in the catalog", () => {
    expect(selectionReason(movie({ votes: 50_000, isAdult: true }), rules)).toBeNull();
    expect(selectionReason(movie({ votes: 50_000, year: 2027 }), rules)).toBeNull();
    expect(selectionReason(movie({ votes: 50_000, year: null }), rules)).toBeNull();
    expect(selectionReason(movie({ votes: 50_000, type: "short" }), rules)).toBeNull();
    expect(selectionReason(movie({ votes: 50_000, type: "tvSeries" }), rules)).toBeNull();
    expect(selectionReason(movie({ votes: 3, existing: true }), rules)).toBe("existing");
    expect(selectionReason(movie({ votes: 50_000, existing: true }), rules)).toBe("votes");
  });

  it("knows the lowest vote count any rule accepts", () => {
    expect(lowestVoteBar(rules)).toBe(300);
  });
});

describe("display titles", () => {
  it("strips Wikipedia's film qualifiers only", () => {
    expect(stripWikipediaQualifier("Heat (1995 film)")).toBe("Heat");
    expect(stripWikipediaQualifier("Don (2006 Hindi film)")).toBe("Don");
    expect(stripWikipediaQualifier("Kites (film)")).toBe("Kites");
    expect(stripWikipediaQualifier("Up (2009 animated film)")).toBe("Up");
    expect(stripWikipediaQualifier("Harry Potter (film series)")).toBe("Harry Potter (film series)");
    expect(stripWikipediaQualifier("M*A*S*H (novel)")).toBe("M*A*S*H (novel)");
  });

  it("keeps the English label when Wikipedia or IMDb uses that name", () => {
    expect(displayTitle({ label: "Taare Zameen Par", enwiki: "Taare Zameen Par", imdbPrimary: "Like Stars on Earth", imdbOriginal: "Taare Zameen Par" })).toBe("Taare Zameen Par");
    expect(displayTitle({ label: "The Godfather", enwiki: "The Godfather", imdbPrimary: "The Godfather", imdbOriginal: "The Godfather" })).toBe("The Godfather");
    // Punctuation and case don't make a different name.
    expect(displayTitle({ label: "Amélie", enwiki: "Amélie", imdbPrimary: "Amelie", imdbOriginal: "Le fabuleux destin d'Amélie Poulain" })).toBe("Amélie");
    expect(displayTitle({ label: "Spirited Away", enwiki: null, imdbPrimary: "Spirited Away", imdbOriginal: "Sen to Chihiro no kamikakushi" })).toBe("Spirited Away");
  });

  it("replaces a label nobody uses with the English Wikipedia title, else IMDb's", () => {
    expect(
      displayTitle({ label: "Sometimes Happiness Sometimes Sadness...", enwiki: "Kabhi Khushi Kabhie Gham", imdbPrimary: "Kabhi Khushi Kabhie Gham...", imdbOriginal: "Kabhi Khushi Kabhie Gham..." }),
    ).toBe("Kabhi Khushi Kabhie Gham");
    expect(displayTitle({ label: "Girl interrupted", enwiki: "Just Married (2003 film)", imdbPrimary: "Just Married", imdbOriginal: "Just Married" })).toBe("Just Married");
    expect(displayTitle({ label: "Some Translation", enwiki: null, imdbPrimary: "Pathaan", imdbOriginal: "Pathaan" })).toBe("Pathaan");
  });

  it("falls back when there is no label", () => {
    expect(displayTitle({ label: null, enwiki: "Drishyam (2015 film)", imdbPrimary: "Drishyam", imdbOriginal: "Drishyam" })).toBe("Drishyam");
    expect(displayTitle({ label: null, enwiki: null, imdbPrimary: "Jawan", imdbOriginal: "Jawan" })).toBe("Jawan");
    expect(displayTitle({ label: "  ", enwiki: null, imdbPrimary: null, imdbOriginal: null })).toBeNull();
    // With nothing to compare against, the label stands.
    expect(displayTitle({ label: "Only a label", enwiki: null, imdbPrimary: null, imdbOriginal: null })).toBe("Only a label");
  });
});

describe("searchable names", () => {
  const names = (display: string, list: (string | null)[]) => searchableNames(display, list.map((name) => ({ name, kind: "alias" as const }))).map((n) => n.name);

  it("keeps Latin-script names, one per search key, without the display title", () => {
    expect(
      names("Kabhi Khushi Kabhie Gham", ["Kabhi Khushi Kabhie Gham...", "Sometimes Happiness Sometimes Sadness...", "k3g", "कभी ख़ुशी कभी ग़म", "K3G", null, "  ", "x"]),
    ).toEqual(["Sometimes Happiness Sometimes Sadness...", "k3g"]);
  });

  it("keeps each name's kind and caps the list", () => {
    const out = searchableNames("Film", [
      { name: "Original", kind: "original" },
      { name: "original!", kind: "alias" },
      { name: "Alias", kind: "alias" },
    ]);
    expect(out).toEqual([
      { name: "Original", kind: "original" },
      { name: "Alias", kind: "alias" },
    ]);
    expect(names("Film", Array.from({ length: 40 }, (_, i) => `Name ${i}`))).toHaveLength(MAX_OTHER_NAMES);
    expect(names("Film", ["x".repeat(301)])).toEqual([]);
  });

  it("tells Latin script from others", () => {
    expect(isLatinText("Amélie & Co. — 2: WALL·E")).toBe(true);
    expect(isLatinText("Æon Flux, Šakalí léta")).toBe(true);
    expect(isLatinText("SSSS.DYNΛZENON")).toBe(false);
    expect(isLatinText("千と千尋の神隠し")).toBe(false);
  });
});

describe("genres and directors", () => {
  it("turns Wikidata genre labels into display names", () => {
    expect(genreDisplayName("science fiction film")).toBe("Science fiction");
    expect(genreDisplayName("drama")).toBe("Drama");
    expect(genreDisplayName("action films")).toBe("Action");
    expect(genreDisplayName("film based on a novel")).toBeNull();
    expect(genreDisplayName("film noir")).toBeNull();
    expect(genreDisplayName("  ")).toBeNull();
    expect(wikidataGenreNames(["drama film", "Drama", "comedy film", "film based on a novel"])).toEqual(["Drama", "Comedy"]);
  });

  it("maps IMDb's genres onto the catalog's names", () => {
    expect(imdbGenreNames(["Sci-Fi", "Biography", "History", "Film-Noir", "Animation", "Short", "Adult", "Reality-TV", "News", "Talk-Show", "Game-Show"])).toEqual([
      "Science fiction",
      "Biographical",
      "Historical",
      "Film noir",
      "Animation",
    ]);
    expect(imdbGenreNames(["constructor", "toString"])).toEqual(["constructor", "toString"]);
  });

  it("orders genres most specific first", () => {
    const order = orderGenresBySpecificity([["Drama", "Romance"], ["Drama", "Romantic comedy"], ["Drama", "Romance"]]);
    expect(order(["Drama", "Romance", "Romantic comedy"])).toEqual(["Romantic comedy", "Romance", "Drama"]);
  });

  it("cleans, dedupes and caps director names", () => {
    expect(directorNames([" Lana  Wachowski ", "Lilly Wachowski", "lana wachowski", null, "x".repeat(201)])).toEqual(["Lana Wachowski", "Lilly Wachowski"]);
  });

  it("keeps a stored order when the names are unchanged", () => {
    expect(keepStoredOrder(["Lana Wachowski", "Lilly Wachowski"], ["Lilly Wachowski", "Lana Wachowski"], 10)).toEqual(["Lana Wachowski", "Lilly Wachowski"]);
    expect(keepStoredOrder(["Drama", "Gone"], ["Comedy", "Drama"], 10)).toEqual(["Drama", "Comedy"]);
    expect(keepStoredOrder([], ["A", "B", "C"], 2)).toEqual(["A", "B"]);
  });
});

describe("external ids", () => {
  it("accepts only well-formed ids", () => {
    expect(parseTmdbId("27205")).toBe(27205);
    expect(parseTmdbId("0")).toBeNull();
    expect(parseTmdbId("99999999999")).toBeNull();
    expect(parseTmdbId("tv/123")).toBeNull();
    expect(parseImdbId("tt0111161")).toBe("tt0111161");
    expect(parseImdbId("nm0000138")).toBeNull();
  });
});

describe("imdbCastToKeep", () => {
  it("keeps the leads, and supporting roles only for people with a Wikipedia article", () => {
    const popularity = (key: string) => (key.startsWith("Q") ? Number(key.slice(1)) : 0);
    const cast = ["nm1", "Q5", null, "nm2", "nm3", "Q0", "Q7", "nm1", "Q9", "Q10", "Q11"];
    // Positions 0–3 always (an unnamed person still holds position 2); 4–9 when popularity ≥ 1; never past 10.
    expect(imdbCastToKeep(cast, popularity, { always: 4, known: 10 })).toEqual(["nm1", "Q5", "nm2", "Q7", "Q9", "Q10"]);
    expect(imdbCastToKeep(cast, popularity, { always: 0, known: 0 })).toEqual([]);
    expect(imdbCastToKeep(cast, popularity, { always: 10, known: 10 })).toEqual(["nm1", "Q5", "nm2", "nm3", "Q0", "Q7", "Q9", "Q10"]);
  });
});

describe("mergeCast", () => {
  const popularity = (id: number) => 1000 - id;

  it("bills IMDb's top cast first, then stored billing, then unordered Wikidata cast", () => {
    const stored = new Map<number, number | null>([
      [10, 0],
      [11, 1],
      [12, 2],
      [13, 3],
    ]);
    expect(mergeCast({ imdb: [12, 20], wikidata: [10, 11, 12, 13, 30, 31], stored, popularity })).toEqual([
      { personId: 12, billing: 0 },
      { personId: 20, billing: 1 },
      { personId: 10, billing: 2 },
      { personId: 11, billing: 3 },
      { personId: 13, billing: 4 },
      { personId: 30, billing: null },
      { personId: 31, billing: null },
    ]);
  });

  it("gives the same result when rerun on its own output", () => {
    const first = mergeCast({ imdb: [5, 6], wikidata: [1, 2, 3, 5], stored: new Map([[1, 4], [2, 0], [3, null]]), popularity });
    const stored = new Map(first.map((c) => [c.personId, c.billing]));
    expect(mergeCast({ imdb: [5, 6], wikidata: [1, 2, 3, 5], stored, popularity })).toEqual(first);
  });

  it("cuts the least known unordered credits first", () => {
    const wikidata = Array.from({ length: MAX_CAST + 10 }, (_, i) => i + 1);
    const merged = mergeCast({ imdb: [100], wikidata, stored: new Map([[40, 0]]), popularity });
    expect(merged).toHaveLength(MAX_CAST);
    expect(merged.slice(0, 2)).toEqual([
      { personId: 100, billing: 0 },
      { personId: 40, billing: 1 },
    ]);
    // Lower ids are better known here, so the cut falls on the highest ids.
    expect(merged.at(-1)).toEqual({ personId: 28, billing: null });
  });

  it("drops repeats", () => {
    expect(mergeCast({ imdb: [1, 1], wikidata: [1, 2, 2], stored: new Map(), popularity })).toEqual([
      { personId: 1, billing: 0 },
      { personId: 2, billing: null },
    ]);
  });
});
