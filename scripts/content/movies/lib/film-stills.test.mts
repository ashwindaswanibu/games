import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilmRecord } from "@/server/game-services";

const cache = vi.hoisted(() => ({ entries: new Map<number, { manifest: unknown; images: unknown[] }>(), dirEntries: [] as string[] }));

vi.mock("./stills-cache.mjs", () => ({
  STILLS_DIR: "/virtual/stills/",
  readCachedStills: (tmdbId: number) => cache.entries.get(tmdbId) ?? null,
}));
vi.mock("node:fs", () => ({
  existsSync: () => cache.dirEntries.length > 0,
  readdirSync: () => cache.dirEntries,
}));

const { stillsSource, StillsUnavailableError } = await import("./film-stills.mjs");

const film = (over: Partial<FilmRecord>): FilmRecord => ({
  id: 1,
  title: "Heat",
  year: 1995,
  genres: [],
  directors: ["Michael Mann"],
  popularity: 1,
  tmdbId: 949,
  imdbId: "tt0113277",
  wikidataId: "Q11101",
  isAdult: false,
  ...over,
});

const image = (n: number) => ({ bytes: Buffer.from([n]), mime: "image/webp", width: 1280, height: 720 });

afterEach(() => {
  vi.unstubAllEnvs();
  cache.entries.clear();
  cache.dirEntries = [];
});

describe("stillsSource", () => {
  it("fails at once with the key's instructions when there is neither a key nor a cache", () => {
    vi.stubEnv("TMDB_API_KEY", "");
    expect(() => stillsSource()).toThrow(/TMDB_API_KEY is not set.*themoviedb\.org/);
  });

  it("serves cached stills without a key, with their votes", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    cache.dirEntries = ["tmdb-949"];
    cache.entries.set(949, {
      manifest: {
        stills: [
          { tmdbPath: "/a.jpg", voteAverage: 6.5, voteCount: 12 },
          { tmdbPath: "/b.jpg", voteAverage: 5, voteCount: 3 },
        ],
      },
      images: [image(1), image(2)],
    });
    const source = stillsSource();
    expect(source.online).toBe(false);
    const found = await source.stillsFor(film({}), 1);
    expect(found).toEqual({ tmdbId: 949, from: "cache", stills: [{ ...image(1), source: "/a.jpg", voteAverage: 6.5, voteCount: 12 }] });
  });

  it("without a key, an uncached film is unavailable (not an error for the whole run)", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    cache.dirEntries = ["tmdb-1"];
    const source = stillsSource();
    await expect(source.stillsFor(film({}), 6)).rejects.toBeInstanceOf(StillsUnavailableError);
    await expect(source.stillsFor(film({ tmdbId: null }), 6)).rejects.toBeInstanceOf(StillsUnavailableError);
  });

  it("knows a film with no TMDB or IMDb id has no stills", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    cache.dirEntries = ["tmdb-1"];
    await expect(stillsSource().stillsFor(film({ tmdbId: null, imdbId: null }), 6)).resolves.toBeNull();
  });
});
