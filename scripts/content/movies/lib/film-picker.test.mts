import { describe, expect, it } from "vitest";
import { buildPickerInputs, type CatalogFilm } from "./film-picker.mjs";
import type { GalleryVerdict } from "./screencaps-cache.mjs";
import type { DirectoryEntry } from "./screencaps.mjs";

const gallery = (slug: string, title: string, year: number): DirectoryEntry => ({ title, year, tags: [], url: `https://movie-screencaps.com/${slug}/` });
const film = (id: number, title: string, year: number | null, popularity: number, directors: string[] = []): CatalogFilm => ({ id, title, year, directors, popularity });

/**
 * Ten films with galleries (popularity 10…100) among a catalog padded with forty obscure films
 * that have none: over the pool, the best of the ten is Iconic; over the whole catalog, nearly
 * all ten are.
 */
const withGalleries = Array.from({ length: 10 }, (_, i) => film(i + 1, `Picture${i + 1}x`, 2000, 10 * (i + 1), [`Director ${i + 1}`]));
const obscure = Array.from({ length: 40 }, (_, i) => film(100 + i, `Obscure${i}x`, 2000, 1));
const catalog = [...withGalleries, ...obscure, film(200, "No Year", null, 500)];
const directory = withGalleries.map((f) => gallery(`picture${f.id}x-2000`, f.title, 2000));
const none = () => undefined;

describe("the picker's inputs", () => {
  it("puts every catalog film with a gallery in the pool, and nothing else", () => {
    const inputs = buildPickerInputs(catalog, directory, none);
    expect([...inputs.pool.keys()].sort((a, b) => a - b)).toEqual(withGalleries.map((f) => f.id));
    expect(inputs.pool.get(3)!.gallery.url).toBe("https://movie-screencaps.com/picture3x-2000/");
  });

  it("computes percentiles over the pool by default", () => {
    const inputs = buildPickerInputs(catalog, directory, none);
    expect(inputs.reference).toBe("pool");
    expect(inputs.referenceSize).toBe(10);
    expect(inputs.pool.get(10)!.score.score).toBe(100);
    expect(inputs.pool.get(5)!.score.score).toBe(50);
    // Pool percentiles: 50 → Known, 60 → Well-known, 90 and 100 → Iconic; 10–40 are below 45.
    expect(inputs.candidates.map((c) => c.id).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("can compute them over every catalog film with a year instead", () => {
    const inputs = buildPickerInputs(catalog, directory, none, "catalog");
    expect(inputs.referenceSize).toBe(50);
    // Above forty obscure films, even the least known film with a gallery is in the 82nd percentile.
    expect(inputs.pool.get(1)!.score.score).toBe(82);
    expect(inputs.candidates).toHaveLength(10);
  });

  it("marks black-and-white and colour galleries, and leaves out galleries too short to use", () => {
    const verdicts: Record<string, GalleryVerdict> = {
      "https://movie-screencaps.com/picture10x-2000/": { verdict: "black-and-white", detail: "", film: { title: "Picture10x", year: 2000 }, checkedAt: "" },
      "https://movie-screencaps.com/picture9x-2000/": { verdict: "colour", detail: "", film: { title: "Picture9x", year: 2000 }, checkedAt: "" },
      "https://movie-screencaps.com/picture8x-2000/": { verdict: "too-short", detail: "", film: { title: "Picture8x", year: 2000 }, checkedAt: "" },
    };
    const inputs = buildPickerInputs(catalog, directory, (url) => verdicts[url]);
    const byId = new Map(inputs.candidates.map((c) => [c.id, c]));
    expect(byId.get(10)!.monochrome).toBe(true);
    expect(byId.get(9)!.monochrome).toBe(false);
    expect(byId.get(7)!.monochrome).toBeNull();
    expect(byId.has(8)).toBe(false);
    expect(inputs.tooShort).toBe(1);
    // Verdicts never move scores: the reference is still every film with a gallery.
    expect(inputs.referenceSize).toBe(10);
    expect(inputs.pool.get(8)!.score.score).toBe(80);
  });

  it("carries what the rules need into each candidate", () => {
    const inputs = buildPickerInputs(catalog, directory, none);
    expect(inputs.candidates.find((c) => c.id === 7)).toEqual({ id: 7, title: "Picture7x", year: 2000, directors: ["Director 7"], score: 70, monochrome: null });
  });
});
