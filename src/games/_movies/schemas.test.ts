import { describe, expect, it } from "vitest";
import {
  CATALOG_DEFAULT_LIMIT,
  CATALOG_MAX_LIMIT,
  clueSchema,
  filmDetailsSchema,
  filmGuessSchema,
  parseCatalogSearchParams,
} from "./schemas";

const params = (query: string) => parseCatalogSearchParams(new URLSearchParams(query));

describe("parseCatalogSearchParams", () => {
  it("trims the query and defaults the limit", () => {
    expect(params("q=%20%20heat%20")).toEqual({ q: "heat", limit: CATALOG_DEFAULT_LIMIT });
    expect(params("q=heat&limit=")).toEqual({ q: "heat", limit: CATALOG_DEFAULT_LIMIT });
    expect(params("q=heat&limit=3")).toEqual({ q: "heat", limit: 3 });
    expect(params(`q=heat&limit=${CATALOG_MAX_LIMIT}`)).toEqual({ q: "heat", limit: CATALOG_MAX_LIMIT });
  });

  it("rejects missing, too-short and too-long queries", () => {
    expect(params("")).toBeNull();
    expect(params("q=h")).toBeNull();
    expect(params("q=%20h%20%20")).toBeNull();
    expect(params(`q=${"a".repeat(81)}`)).toBeNull();
  });

  it("rejects queries that are too short once normalized (they would match most of the catalog)", () => {
    expect(params("q=e.")).toBeNull();
    expect(params("q=a!")).toBeNull();
    expect(params("q=%C3%A9%20%20-")).toBeNull();
    expect(params("q=al")).toEqual({ q: "al", limit: CATALOG_DEFAULT_LIMIT });
    expect(params("q=%C3%A9t")).toEqual({ q: "ét", limit: CATALOG_DEFAULT_LIMIT });
  });

  it("rejects limits outside 1–max and non-integers", () => {
    for (const limit of ["0", "-1", String(CATALOG_MAX_LIMIT + 1), "2.5", "ten", "1e3"]) {
      expect(params(`q=heat&limit=${limit}`)).toBeNull();
    }
  });

  it("rejects repeated keys", () => {
    expect(params("q=heat&q=alien")).toBeNull();
    expect(params("q=heat&limit=2&limit=3")).toBeNull();
  });
});

describe("movie shapes", () => {
  it("accepts a complete film snapshot and rejects impossible years", () => {
    const heat = { id: 1, title: "Heat", year: 1995, genres: ["Crime"], directors: ["Michael Mann"] };
    expect(filmDetailsSchema.parse(heat)).toEqual(heat);
    expect(filmDetailsSchema.safeParse({ ...heat, year: 1700 }).success).toBe(false);
    expect(filmDetailsSchema.safeParse({ ...heat, id: 0 }).success).toBe(false);
  });

  it("discriminates clues by kind", () => {
    expect(clueSchema.safeParse({ kind: "year", guessYear: 1995, direction: "later" }).success).toBe(true);
    expect(clueSchema.safeParse({ kind: "year", guessYear: 1995, direction: "sideways" }).success).toBe(false);
    expect(clueSchema.safeParse({ kind: "palette" }).success).toBe(false);
  });

  it("caps a guess at one clue per kind", () => {
    const year = { kind: "year", guessYear: 1995, direction: "later" };
    const guess = { film: { id: 1, title: "Heat", year: 1995 }, correct: false, clues: [year] };
    expect(filmGuessSchema.safeParse(guess).success).toBe(true);
    expect(filmGuessSchema.safeParse({ ...guess, clues: Array(5).fill(year) }).success).toBe(false);
  });
});
