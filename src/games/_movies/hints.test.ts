import { describe, expect, it } from "vitest";
import {
  compareYear,
  computeClues,
  decadeOf,
  directorClue,
  genresClue,
  nameKey,
  sameDecade,
  sameDirector,
  sharedDirectors,
  sharedGenres,
} from "./hints";
import { clueSchema, type FilmFacts } from "./schemas";

const heat: FilmFacts = { year: 1995, genres: ["Crime", "Thriller", "Drama"], directors: ["Michael Mann"] };
const collateral: FilmFacts = { year: 2004, genres: ["Thriller", "Crime"], directors: ["Michael Mann"] };
const amelie: FilmFacts = { year: 2001, genres: ["Comedy", "Romance"], directors: ["Jean-Pierre Jeunet"] };
const unknown: FilmFacts = { year: null, genres: [], directors: [] };

describe("compareYear", () => {
  it("says where the answer lies relative to the guess", () => {
    expect(compareYear(1995, 2004)).toBe("later");
    expect(compareYear(2004, 1995)).toBe("earlier");
    expect(compareYear(2001, 2001)).toBe("same");
  });

  it("is unknown when either year is missing", () => {
    expect(compareYear(null, 2001)).toBe("unknown");
    expect(compareYear(2001, null)).toBe("unknown");
  });
});

describe("decades", () => {
  it("floors to the decade", () => {
    expect(decadeOf(1990)).toBe(1990);
    expect(decadeOf(1999)).toBe(1990);
    expect(decadeOf(2000)).toBe(2000);
  });

  it("compares decades, not ten-year distances", () => {
    expect(sameDecade(1991, 1999)).toBe("same");
    expect(sameDecade(1999, 2000)).toBe("different");
    expect(sameDecade(null, 2000)).toBe("unknown");
  });
});

describe("nameKey", () => {
  it("ignores case, accents, punctuation and spacing", () => {
    expect(nameKey("  Science-Fiction ")).toBe(nameKey("science fiction"));
    expect(nameKey("Alejandro González Iñárritu")).toBe(nameKey("alejandro gonzalez inarritu"));
    expect(nameKey("Bong Joon-ho")).toBe("bong joon ho");
  });
});

describe("sharedGenres", () => {
  it("returns the guess's genres the answer also has, in the guess's order and spelling", () => {
    expect(sharedGenres(heat, collateral)).toEqual(["Crime", "Thriller"]);
    expect(sharedGenres(collateral, heat)).toEqual(["Thriller", "Crime"]);
  });

  it("matches loosely and never repeats a genre", () => {
    expect(sharedGenres({ genres: ["Science fiction", "science-fiction", "Drama"] }, { genres: ["SCIENCE FICTION"] })).toEqual([
      "Science fiction",
    ]);
  });

  it("is empty when nothing is shared", () => {
    expect(sharedGenres(heat, amelie)).toEqual([]);
  });
});

describe("sameDirector", () => {
  it("detects a shared director", () => {
    expect(sameDirector(heat, collateral)).toBe("same");
    expect(sharedDirectors(heat, collateral)).toEqual(["Michael Mann"]);
  });

  it("handles co-directors and spelling variants", () => {
    const coDirected = { directors: ["Lana Wachowski", "Lilly Wachowski"] };
    expect(sameDirector(coDirected, { directors: ["lilly wachowski"] })).toBe("same");
    expect(sharedDirectors(coDirected, { directors: ["lilly wachowski"] })).toEqual(["Lilly Wachowski"]);
  });

  it("is different or unknown otherwise", () => {
    expect(sameDirector(heat, amelie)).toBe("different");
    expect(sameDirector(heat, unknown)).toBe("unknown");
    expect(directorClue(heat, amelie)).toEqual({ kind: "director", shared: [], match: "different" });
  });
});

describe("computeClues", () => {
  it("builds the requested clues in order, each schema-valid", () => {
    const clues = computeClues(heat, collateral, ["year", "decade", "genres", "director"]);
    expect(clues).toEqual([
      { kind: "year", guessYear: 1995, direction: "later" },
      { kind: "decade", guessDecade: 1990, match: "different" },
      { kind: "genres", shared: ["Crime", "Thriller"], match: "some" },
      { kind: "director", shared: ["Michael Mann"], match: "same" },
    ]);
    for (const clue of clues) expect(clueSchema.safeParse(clue).success).toBe(true);
  });

  it("ignores duplicate kinds", () => {
    expect(computeClues(heat, amelie, ["year", "year"])).toHaveLength(1);
  });

  it("reports unknowns instead of guessing when facts are missing", () => {
    expect(computeClues(unknown, heat, ["year", "decade", "genres", "director"])).toEqual([
      { kind: "year", guessYear: null, direction: "unknown" },
      { kind: "decade", guessDecade: null, match: "unknown" },
      { kind: "genres", shared: [], match: "unknown" },
      { kind: "director", shared: [], match: "unknown" },
    ]);
    expect(genresClue(heat, amelie)).toEqual({ kind: "genres", shared: [], match: "none" });
  });
});
