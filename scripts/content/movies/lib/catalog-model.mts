import { cleanText, earliestYear, entityTitle, itemIds, stringValue, type ItemSummary, type WikidataEntity } from "./wikidata.mjs";

/**
 * Pure transformation from Wikidata entities to catalog rows. Kept free of IO so every rule
 * (which films qualify, how genres read, which external ids are kept) is unit-tested.
 */

/** Limits that keep rows inside `filmDetailsSchema` (src/games/_movies/schemas.ts). */
export const MAX_GENRES = 8;
export const MAX_DIRECTORS = 10;
/** Cast credits kept per film, in billing order. Wikidata lists rarely go deeper than ~30 names. */
export const MAX_CAST = 30;

const IMDB_ID = /^tt[0-9]{7,10}$/;
const MAX_INT4 = 2_147_483_647;

export interface ParsedFilm {
  qid: string;
  title: string;
  year: number;
  /** Popularity proxy: Wikipedia language editions with an article on the film. */
  sitelinks: number;
  genreQids: string[];
  directorQids: string[];
  /** Cast in credited order (claim order), at most MAX_CAST. Index = billing. */
  castQids: string[];
  tmdbId: number | null;
  imdbId: string | null;
}

export type FilmParseResult = { ok: true; film: ParsedFilm } | { ok: false; reason: "no-title" | "no-year" | "too-old" | "unreleased" | "no-cast" };

export function parseFilm(entity: WikidataEntity, sitelinks: number, options: { minYear: number; maxYear: number }): FilmParseResult {
  const title = entityTitle(entity);
  if (!title || title.length > 300) return { ok: false, reason: "no-title" };
  const year = earliestYear(entity, "P577");
  if (year === null) return { ok: false, reason: "no-year" };
  if (year < options.minYear) return { ok: false, reason: "too-old" };
  if (year > options.maxYear) return { ok: false, reason: "unreleased" };
  const castQids = itemIds(entity, "P161").slice(0, MAX_CAST);
  if (castQids.length === 0) return { ok: false, reason: "no-cast" };
  return {
    ok: true,
    film: {
      qid: entity.id,
      title,
      year,
      sitelinks,
      genreQids: itemIds(entity, "P136"),
      directorQids: itemIds(entity, "P57"),
      castQids,
      tmdbId: parseTmdbId(stringValue(entity, "P4947")),
      imdbId: parseImdbId(stringValue(entity, "P345")),
    },
  };
}

export function parseTmdbId(value: string | null): number | null {
  if (!value || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= MAX_INT4 ? id : null;
}

export function parseImdbId(value: string | null): string | null {
  return value && IMDB_ID.test(value) ? value : null;
}

/**
 * Wikidata genre labels → display names: "science fiction film" → "Science fiction". Labels that
 * describe a source rather than a genre ("film based on a novel") are dropped, as are labels that
 * would be empty or overlong.
 */
export function genreDisplayName(label: string | null | undefined): string | null {
  const text = cleanText(label);
  if (!text) return null;
  if (/^(film|movie)s?\b/i.test(text) || /\bbased on\b/i.test(text)) return null;
  const stripped = text.replace(/\s+(feature\s+)?(film|movie|cinema)s?$/i, "").trim();
  if (!stripped || stripped.length > 60) return null;
  return stripped.charAt(0).toLocaleUpperCase("en-US") + stripped.slice(1);
}

/** Display names for a film's genres, in claim order, deduplicated case-insensitively. */
export function genreNames(qids: readonly string[], summaries: ReadonlyMap<string, ItemSummary>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const qid of qids) {
    const name = genreDisplayName(summaries.get(qid)?.label);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length === MAX_GENRES) break;
  }
  return out;
}

/** Director names in credited order; directors without a usable label are skipped. */
export function directorNames(qids: readonly string[], summaries: ReadonlyMap<string, ItemSummary>): string[] {
  const out: string[] = [];
  for (const qid of qids) {
    const name = summaries.get(qid)?.label;
    if (name && name.length <= 200 && !out.includes(name)) out.push(name);
    if (out.length === MAX_DIRECTORS) break;
  }
  return out;
}

/**
 * `tmdb_id` and `imdb_id` are unique in the catalog, but Wikidata occasionally gives two items the
 * same external id (duplicates awaiting a merge, a film and its director's cut). Films are visited
 * most popular first; an id goes to the first film that claims it, and an id already stored for a
 * different Wikidata item stays with that item. Returns copies; the losers get `null`.
 */
export function resolveExternalIdConflicts<T extends { qid: string; sitelinks: number; tmdbId: number | null; imdbId: string | null }>(
  films: readonly T[],
  stored: { tmdb: ReadonlyMap<number, string>; imdb: ReadonlyMap<string, string> } = { tmdb: new Map(), imdb: new Map() },
): { films: T[]; dropped: number } {
  const tmdbOwner = new Map(stored.tmdb);
  const imdbOwner = new Map(stored.imdb);
  let dropped = 0;
  const ordered = [...films].sort((a, b) => b.sitelinks - a.sitelinks || a.qid.localeCompare(b.qid));
  const resolved = new Map<string, T>();
  for (const film of ordered) {
    let { tmdbId, imdbId } = film;
    if (tmdbId !== null) {
      const owner = tmdbOwner.get(tmdbId);
      if (owner && owner !== film.qid) {
        tmdbId = null;
        dropped++;
      } else {
        tmdbOwner.set(tmdbId, film.qid);
      }
    }
    if (imdbId !== null) {
      const owner = imdbOwner.get(imdbId);
      if (owner && owner !== film.qid) {
        imdbId = null;
        dropped++;
      } else {
        imdbOwner.set(imdbId, film.qid);
      }
    }
    resolved.set(film.qid, { ...film, tmdbId, imdbId });
  }
  return { films: films.map((film) => resolved.get(film.qid)!), dropped };
}

/**
 * Merges candidate lists (the global popularity list and the per-language lists), keeping each
 * item once with its highest sitelink count, most popular first.
 */
export function mergeCandidates(lists: ReadonlyArray<ReadonlyArray<{ qid: string; sitelinks: number }>>): { qid: string; sitelinks: number }[] {
  const best = new Map<string, number>();
  for (const list of lists) for (const { qid, sitelinks } of list) best.set(qid, Math.max(best.get(qid) ?? 0, sitelinks));
  return [...best].map(([qid, sitelinks]) => ({ qid, sitelinks })).sort((a, b) => b.sitelinks - a.sitelinks || a.qid.localeCompare(b.qid));
}
