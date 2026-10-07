import { catalogSearchKey } from "@/games/_movies/search-key";

/**
 * Pure catalog rules: which films are in, what a film is called and which of its names are
 * searchable, how genres read, and in what order a film's cast is billed. Kept free of IO so every
 * rule is unit-tested; `catalog-build.mts` feeds them IMDb and Wikidata data.
 */

/** Limits that keep rows inside `filmDetailsSchema` (src/games/_movies/schemas.ts) and the catalog's checks. */
export const MAX_GENRES = 8;
export const MAX_DIRECTORS = 10;
/** Cast credits kept per film. Wikidata lists rarely go deeper than ~30 names. */
export const MAX_CAST = 30;
export const MAX_TITLE = 300;
export const MAX_NAME = 200;
/** Searchable names kept per film besides its display title (a handful is typical; this stops outliers). */
export const MAX_OTHER_NAMES = 12;

const IMDB_ID = /^tt[0-9]{7,10}$/;
const MAX_INT4 = 2_147_483_647;

/** NFC, whitespace collapsed, trimmed; null when nothing is left. */
export function cleanText(value: string | undefined | null): string | null {
  const text = value?.normalize("NFC").replace(/\s+/g, " ").trim();
  return text ? text : null;
}

export function parseTmdbId(value: string | null | undefined): number | null {
  if (!value || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= MAX_INT4 ? id : null;
}

export function parseImdbId(value: string | null | undefined): string | null {
  return value && IMDB_ID.test(value) ? value : null;
}

// ---------------------------------------------------------------------------------------------
// Which films
// ---------------------------------------------------------------------------------------------

export interface SelectionRules {
  /** A feature film with at least this many IMDb votes is in. */
  minVotes: number;
  /** …or one with an article in at least this many Wikipedias (catches world cinema IMDb under-votes). */
  minSitelinks: number;
  /** A feature film from the last `recentYears` calendar years needs only this many votes. */
  recentMinVotes: number;
  recentYears: number;
  /** TV movies and direct-to-video features need this many votes (and a feature's length). */
  extraMinVotes: number;
  extraMinRuntime: number;
  currentYear: number;
}

export const DEFAULT_RULES: Omit<SelectionRules, "currentYear"> = {
  minVotes: 1000,
  minSitelinks: 8,
  recentMinVotes: 300,
  recentYears: 2,
  extraMinVotes: 5000,
  extraMinRuntime: 40,
};

/** The fewest votes any rule accepts without Wikipedia's help: a cheap pre-filter for the big files. */
export const lowestVoteBar = (rules: SelectionRules): number => Math.min(rules.minVotes, rules.recentMinVotes, rules.extraMinVotes);

export interface SelectionInput {
  /** IMDb titleType: movie, tvMovie, video, short, … */
  type: string;
  isAdult: boolean;
  /** Release year (Wikidata's earliest, else IMDb's); null when unknown. */
  year: number | null;
  runtimeMinutes: number | null;
  genres: readonly string[];
  /** IMDb votes; 0 when IMDb has no rating. */
  votes: number;
  /** Wikipedia editions of the film's Wikidata item; 0 when it has none. */
  sitelinks: number;
  /** Already in the catalog (by IMDb or Wikidata id): never dropped from a refresh. */
  existing: boolean;
}

export type SelectionReason = "votes" | "sitelinks" | "recent" | "tv-or-video" | "existing";

/** Why a title is in the catalog, or null when it isn't. The first matching rule wins. */
export function selectionReason(title: SelectionInput, rules: SelectionRules): SelectionReason | null {
  const eligible = !title.isAdult && title.year !== null && title.year <= rules.currentYear;
  if (eligible && title.type === "movie") {
    if (title.votes >= rules.minVotes) return "votes";
    if (title.sitelinks >= rules.minSitelinks) return "sitelinks";
    if (title.year! > rules.currentYear - rules.recentYears && title.votes >= rules.recentMinVotes) return "recent";
  }
  if (
    eligible &&
    (title.type === "tvMovie" || title.type === "video") &&
    title.votes >= rules.extraMinVotes &&
    (title.runtimeMinutes === null || title.runtimeMinutes >= rules.extraMinRuntime) &&
    !title.genres.some((genre) => genre === "Short" || genre === "Adult")
  ) {
    return "tv-or-video";
  }
  return title.existing ? "existing" : null;
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** "Heat (1995 film)" → "Heat", "Don (2006 Hindi film)" → "Don". Other titles are unchanged. */
export function stripWikipediaQualifier(title: string): string {
  const stripped = title.replace(/\s*\((?:[^()]*\s)?(?:film|movie)\)$/i, "").trim();
  return stripped || title;
}

/** True when every letter is in the Latin script (digits, punctuation and symbols are fine). */
export function isLatinText(text: string): boolean {
  return !/[^\p{Script=Latin}\P{L}]/u.test(text);
}

export interface FilmNames {
  /** Wikidata's English label, else its language-neutral (mul) label. */
  label: string | null;
  /** English Wikipedia article title. */
  enwiki: string | null;
  imdbPrimary: string | null;
  imdbOriginal: string | null;
}

/**
 * The display title: Wikidata's English label, unless neither English Wikipedia nor IMDb uses that
 * name; then the English Wikipedia title (without its "(… film)" qualifier), else IMDb's main
 * title. Labels are sometimes literal translations nobody uses ("Sometimes Happiness Sometimes
 * Sadness..." for Kabhi Khushi Kabhie Gham) or vandalized; IMDb's main title is sometimes the US
 * release title ("Like Stars on Earth" for Taare Zameen Par). Names compare by search key.
 */
export function displayTitle(names: FilmNames): string | null {
  const label = usableName(names.label);
  const wiki = usableName(names.enwiki ? stripWikipediaQualifier(names.enwiki) : null);
  const primary = usableName(names.imdbPrimary);
  const original = usableName(names.imdbOriginal);
  if (label) {
    const key = catalogSearchKey(label);
    const witnesses = [wiki, primary, original].filter((name): name is string => name !== null);
    if (witnesses.length === 0 || witnesses.some((name) => catalogSearchKey(name) === key)) return label;
  }
  return wiki ?? primary ?? label ?? original;
}

function usableName(value: string | null | undefined): string | null {
  const text = cleanText(value);
  return text && text.length <= MAX_TITLE && catalogSearchKey(text) ? text : null;
}

/**
 * The names a film can be searched by besides its display title: Latin-script only, at most
 * MAX_TITLE characters, at least two searchable characters, one per search key (the first one
 * wins, with its kind), at most MAX_OTHER_NAMES. Pass them most useful first.
 */
export function searchableNames<Kind extends string>(
  display: string,
  candidates: ReadonlyArray<{ name: string | null | undefined; kind: Kind }>,
): { name: string; kind: Kind }[] {
  const seen = new Set([catalogSearchKey(display)]);
  const out: { name: string; kind: Kind }[] = [];
  for (const candidate of candidates) {
    const name = cleanText(candidate.name);
    if (!name || name.length > MAX_TITLE || !isLatinText(name)) continue;
    const key = catalogSearchKey(name);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, kind: candidate.kind });
    if (out.length === MAX_OTHER_NAMES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Genres and directors
// ---------------------------------------------------------------------------------------------

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

/** Display names for Wikidata genre labels, in the given order, deduplicated case-insensitively, at most `max`. */
export function wikidataGenreNames(labels: readonly string[], max = MAX_GENRES): string[] {
  return uniqueNames(labels.map(genreDisplayName), max);
}

/** IMDb's genre vocabulary → the catalog's (Wikidata-derived) names, so clues compare across sources. */
const IMDB_GENRES: Readonly<Record<string, string | null>> = {
  "Sci-Fi": "Science fiction",
  Biography: "Biographical",
  History: "Historical",
  "Film-Noir": "Film noir",
  Adult: null,
  Short: null,
  News: null,
  "Reality-TV": null,
  "Talk-Show": null,
  "Game-Show": null,
};

/** IMDb genres as catalog names. Used only for films Wikidata gives no genres. */
export function imdbGenreNames(genres: readonly string[]): string[] {
  return uniqueNames(
    genres.map((genre) => (Object.hasOwn(IMDB_GENRES, genre) ? (IMDB_GENRES[genre] ?? null) : genre)),
    MAX_GENRES,
  );
}

/**
 * Orders each film's genres most specific first, measured by rarity across `films` (bulk reads
 * carry no statement order): "Romantic comedy" before "Drama". Ties by name. Pure.
 */
export function orderGenresBySpecificity(films: ReadonlyArray<readonly string[]>): (genres: readonly string[]) => string[] {
  const counts = new Map<string, number>();
  for (const genres of films) for (const genre of genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  return (genres) => [...genres].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || a.localeCompare(b));
}

/** Director names: cleaned, deduplicated, at most MAX_NAME characters each and MAX_DIRECTORS in all. */
export function directorNames(names: ReadonlyArray<string | null | undefined>): string[] {
  return uniqueNames(
    names.map((name) => {
      const text = cleanText(name);
      return text && text.length <= MAX_NAME ? text : null;
    }),
    MAX_DIRECTORS,
  );
}

function uniqueNames(names: ReadonlyArray<string | null>, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length === max) break;
  }
  return out;
}

/**
 * `incoming` in the order `stored` already has them, then the rest in their own order. Bulk
 * Wikidata reads have no statement order, so this keeps a refresh from reshuffling a film's
 * directors or genres when nothing about them changed.
 */
export function keepStoredOrder(stored: readonly string[], incoming: readonly string[], max: number): string[] {
  const wanted = new Set(incoming);
  const kept = stored.filter((name) => wanted.has(name));
  const keptSet = new Set(kept);
  return [...kept, ...incoming.filter((name) => !keptSet.has(name))].slice(0, max);
}

// ---------------------------------------------------------------------------------------------
// Cast billing
// ---------------------------------------------------------------------------------------------

/** How much of IMDb's billed cast (title.principals actors and actresses, up to 10 a film) is kept. */
export interface ImdbCastDepth {
  /** The first `always` billed are always kept: the leads. */
  always: number;
  /** Down to `known`, someone is kept when they have a Wikipedia article (popularity ≥ 1). */
  known: number;
}

export const DEFAULT_IMDB_CAST: ImdbCastDepth = { always: 4, known: 10 };

/**
 * IMDb's billed cast to keep, in IMDb's order. `cast[i]` is the i-th billed actor's person key, or
 * null for someone nobody can name (they still hold their place in the billing). Supporting roles
 * are kept when the person is known well enough to have a Wikipedia article: they are the
 * character actors Degrees chains run through. Obscure supporting roles would add ~80,000 people
 * nobody can name a film of.
 */
export function imdbCastToKeep(cast: ReadonlyArray<string | null>, popularity: (key: string) => number, depth: ImdbCastDepth): string[] {
  const kept: string[] = [];
  cast.forEach((key, position) => {
    if (key === null || kept.includes(key)) return;
    if (position < depth.always || (position < depth.known && popularity(key) >= 1)) kept.push(key);
  });
  return kept;
}

export interface MergeCastInput {
  /** IMDb's top-billed actors and actresses, in IMDb's order (catalog person ids). */
  imdb: readonly number[];
  /** Wikidata's cast (catalog person ids), in no particular order. */
  wikidata: readonly number[];
  /** The film's stored credits: person id → billing (null when unknown). */
  stored: ReadonlyMap<number, number | null>;
  /** Person popularity (Wikipedia editions), to decide who is cut when a list is too long. */
  popularity(personId: number): number;
  max?: number;
}

export interface MergedCredit {
  personId: number;
  billing: number | null;
}

/**
 * A film's cast and billing (0 = top billed):
 *  1. IMDb's top-billed actors first, in IMDb's order (0 … k−1);
 *  2. then the other credits that have a stored billing, in that order, numbered from k (for films
 *     imported before IMDb, that is Wikidata's credited order);
 *  3. then Wikidata cast with no known order, with no billing.
 * Over `max` credits, the unordered ones are cut first, least known first (then by id), then the
 * ordered tail. Rerunning on its own output gives the same result.
 */
export function mergeCast(input: MergeCastInput): MergedCredit[] {
  const max = input.max ?? MAX_CAST;
  const imdb = [...new Set(input.imdb)];
  const inImdb = new Set(imdb);
  const rest = [...new Set(input.wikidata)].filter((id) => !inImdb.has(id));
  const storedBilling = (id: number) => input.stored.get(id) ?? null;
  const ordered = rest.filter((id) => storedBilling(id) !== null).sort((a, b) => storedBilling(a)! - storedBilling(b)! || a - b);
  const unordered = rest.filter((id) => storedBilling(id) === null).sort((a, b) => input.popularity(b) - input.popularity(a) || a - b);

  const kept = imdb.slice(0, max);
  const orderedKept = ordered.slice(0, Math.max(0, max - kept.length));
  const unorderedKept = unordered.slice(0, Math.max(0, max - kept.length - orderedKept.length));
  return [
    ...kept.map((personId, index) => ({ personId, billing: index })),
    ...orderedKept.map((personId, index) => ({ personId, billing: kept.length + index })),
    ...unorderedKept.map((personId) => ({ personId, billing: null })),
  ];
}
