import { describe, expect, it } from "vitest";
import {
  directorNames,
  genreDisplayName,
  genreNames,
  MAX_CAST,
  mergeCandidates,
  parseFilm,
  parseImdbId,
  parseTmdbId,
  resolveExternalIdConflicts,
} from "./catalog-model.mjs";
import { entityTitle, parseCandidates, parseSummaries, type Claim, type WikidataEntity } from "./wikidata.mjs";

const item = (id: string, rank: Claim["rank"] = "normal"): Claim => ({
  mainsnak: { snaktype: "value", datavalue: { type: "wikibase-entityid", value: { "entity-type": "item", id } } },
  rank,
});
const text = (value: string, rank: Claim["rank"] = "normal"): Claim => ({ mainsnak: { snaktype: "value", datavalue: { type: "string", value } }, rank });
const time = (iso: string, precision = 11): Claim => ({
  mainsnak: { snaktype: "value", datavalue: { type: "time", value: { time: iso, precision, timezone: 0 } } },
  rank: "normal",
});

const inception: WikidataEntity = {
  id: "Q25188",
  labels: { en: { language: "en", value: "Inception" } },
  claims: {
    P577: [time("+2010-07-29T00:00:00Z"), time("+2010-07-08T00:00:00Z")],
    P161: [item("Q38111"), item("Q211553"), item("Q38111"), item("Q999", "deprecated"), { mainsnak: { snaktype: "somevalue" }, rank: "normal" }, item("Q177311")],
    P57: [item("Q25191")],
    P136: [item("Q471839"), item("Q496523")],
    P4947: [text("27205")],
    P345: [text("tt1375666")],
  },
};
const options = { minYear: 1950, maxYear: 2026 };

describe("parseFilm", () => {
  it("extracts a film with its cast in credited order", () => {
    const result = parseFilm(inception, 97, options);
    expect(result).toEqual({
      ok: true,
      film: {
        qid: "Q25188",
        title: "Inception",
        year: 2010,
        sitelinks: 97,
        genreQids: ["Q471839", "Q496523"],
        directorQids: ["Q25191"],
        // Duplicates, deprecated claims and unknown values are dropped; order is kept.
        castQids: ["Q38111", "Q211553", "Q177311"],
        tmdbId: 27205,
        imdbId: "tt1375666",
      },
    });
  });

  it("rejects films outside the year range, without a date, or without cast", () => {
    expect(parseFilm({ ...inception, claims: { ...inception.claims, P577: [time("+1948-01-01T00:00:00Z")] } }, 1, options)).toEqual({ ok: false, reason: "too-old" });
    expect(parseFilm({ ...inception, claims: { ...inception.claims, P577: [time("+2031-01-01T00:00:00Z")] } }, 1, options)).toEqual({ ok: false, reason: "unreleased" });
    // Decade precision (8) isn't a usable year.
    expect(parseFilm({ ...inception, claims: { ...inception.claims, P577: [time("+2010-00-00T00:00:00Z", 8)] } }, 1, options)).toEqual({ ok: false, reason: "no-year" });
    expect(parseFilm({ ...inception, claims: { ...inception.claims, P161: [] } }, 1, options)).toEqual({ ok: false, reason: "no-cast" });
    expect(parseFilm({ ...inception, labels: {} , claims: { ...inception.claims } }, 1, options)).toEqual({ ok: false, reason: "no-title" });
  });

  it("caps the cast", () => {
    const cast = Array.from({ length: MAX_CAST + 5 }, (_, i) => item(`Q${i + 1}`));
    const result = parseFilm({ ...inception, claims: { ...inception.claims, P161: cast } }, 1, options);
    expect(result.ok && result.film.castQids).toHaveLength(MAX_CAST);
  });
});

describe("titles", () => {
  it("falls back from en to mul to the original title", () => {
    expect(entityTitle({ id: "Q1", labels: { mul: { language: "mul", value: " Amélie " } } })).toBe("Amélie");
    expect(
      entityTitle({
        id: "Q1",
        claims: { P1476: [{ mainsnak: { snaktype: "value", datavalue: { type: "monolingualtext", value: { text: "七人の侍", language: "ja" } } }, rank: "normal" }] },
      }),
    ).toBe("七人の侍");
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

  it("gives a shared id to the most popular film and keeps ids already stored for other items", () => {
    const films = [
      { qid: "Q2", sitelinks: 10, tmdbId: 5, imdbId: "tt0000005" },
      { qid: "Q1", sitelinks: 50, tmdbId: 5, imdbId: "tt0000001" },
      { qid: "Q3", sitelinks: 40, tmdbId: 7, imdbId: "tt0000009" },
    ];
    const { films: resolved, dropped } = resolveExternalIdConflicts(films, { tmdb: new Map(), imdb: new Map([["tt0000009", "Q77"]]) });
    expect(resolved).toEqual([
      { qid: "Q2", sitelinks: 10, tmdbId: null, imdbId: "tt0000005" },
      { qid: "Q1", sitelinks: 50, tmdbId: 5, imdbId: "tt0000001" },
      { qid: "Q3", sitelinks: 40, tmdbId: 7, imdbId: null },
    ]);
    expect(dropped).toBe(2);
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
  });

  it("dedupes genres case-insensitively and skips unlabeled directors", () => {
    const summaries = parseSummaries([
      { item: "http://www.wikidata.org/entity/Q1", en: "drama film", links: "50" },
      { item: "http://www.wikidata.org/entity/Q2", en: "Drama", links: "5" },
      { item: "http://www.wikidata.org/entity/Q3", en: "Christopher Nolan", links: "80" },
      { item: "http://www.wikidata.org/entity/Q4", links: "1" },
    ]);
    expect(genreNames(["Q1", "Q2", "Q404"], summaries)).toEqual(["Drama"]);
    expect(directorNames(["Q4", "Q3", "Q3"], summaries)).toEqual(["Christopher Nolan"]);
  });
});

describe("candidates", () => {
  it("parses SPARQL rows and merges lists keeping the highest count", () => {
    const a = parseCandidates([
      { film: "http://www.wikidata.org/entity/Q1", links: "30" },
      { film: "http://www.wikidata.org/entity/P31", links: "99" },
      { film: "http://www.wikidata.org/entity/Q2", links: "x" },
    ]);
    expect(a).toEqual([{ qid: "Q1", sitelinks: 30 }]);
    expect(mergeCandidates([a, [{ qid: "Q1", sitelinks: 35 }, { qid: "Q9", sitelinks: 40 }]])).toEqual([
      { qid: "Q9", sitelinks: 40 },
      { qid: "Q1", sitelinks: 35 },
    ]);
  });
});
