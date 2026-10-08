import type { FilmSearchHit } from "./schemas";
import type { MatchClass } from "./scoped-search";
import { catalogNumberKey, catalogSearchKey, catalogSplitKey } from "./search-key";

/**
 * Film search in the browser. The catalog's films and every name they're known by come down once a
 * day (`/api/catalog/films/index`, in `FILM_INDEX_PARTS` parts; SQL `catalog_film_index`), and a
 * query is matched and ranked here, as you type, the way SQL `search_films` does it: the same keys
 * (`search-key.ts`), match classes (`nameMatchClass`, sequel numbers by `catalogNumberKey`), best
 * name per film (display title first), exact-title and whole-word bonuses, and order. One thing
 * stays on the server: typo-tolerant matches, which `search_films` only adds when the real matches
 * leave the list short (the caller asks the server then). Pure.
 */

export const FILM_INDEX_PARTS = 4;

/** A part as the route sends it: `[id, year, directors, fame, [display title, other names…]]` per film. */
export type FilmIndexPart = readonly (readonly [number, number | null, readonly string[], number, readonly string[]])[];

interface IndexedName {
  film: number;
  text: string;
  display: boolean;
  key: string;
  split: string;
  /** `key` without spaces, for the cheap first look. */
  compact: string;
  /** The key with sequel numbering as digits, when that differs (SQL `number_key`). */
  number: string | null;
}

export interface FilmIndex {
  films: { id: number; title: string; year: number | null; directors: string[]; fame: number }[];
  names: IndexedName[];
}

export function emptyFilmIndex(): FilmIndex {
  return { films: [], names: [] };
}

const PLAIN = /^[\x20-\x7e]*$/;
const ARTICLE = /^(?:the|a|an) /;
const APOSTROPHE = /'/;

/**
 * A name's search and split keys: `catalogSearchKey` / `catalogSplitKey`, with a fast path for
 * plain ASCII names (most of them), which need no accent stripping. Identical results either way.
 */
export function nameKeys(text: string): { key: string; split: string } {
  if (!PLAIN.test(text)) return { key: catalogSearchKey(text), split: catalogSplitKey(text) };
  const lower = text.toLowerCase();
  const key = lower.replace(/'/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return { key, split: APOSTROPHE.test(lower) ? lower.replace(/[^a-z0-9]+/g, " ").trim() : key };
}

/**
 * `matchClass` (scoped-search.ts, SQL `catalog_match_class`) for one query against many names: the
 * query's patterns are built once, and each name's compact key is already known.
 */
function queryMatcher(queryKey: string): (textKey: string, textCompact: string) => MatchClass | null {
  const queryCompact = queryKey.replaceAll(" ", "");
  const prefixBySpaces = queryCompact.length < 3;
  const wholeStart = new RegExp(`^${[...queryCompact].join(" ?")}( |$)`, "u");
  const laterWhole = new RegExp(` ${queryKey}( |$)`, "u");
  const later = ` ${queryKey}`;
  const long = queryKey.length >= 3;
  return (textKey, textCompact) => {
    if (!queryCompact) return null;
    if (textCompact === queryCompact) return 0;
    const startsFull = prefixBySpaces ? textKey.startsWith(queryKey) : textCompact.startsWith(queryCompact);
    const bare = ARTICLE.test(textKey) ? textKey.slice(textKey.indexOf(" ") + 1) : null;
    const startsBare = bare !== null && (prefixBySpaces ? bare.startsWith(queryKey) : bare.replaceAll(" ", "").startsWith(queryCompact));
    if ((startsFull && wholeStart.test(textKey)) || (startsBare && wholeStart.test(bare))) return 1;
    if (startsFull || startsBare) return 2;
    if (long && textKey.includes(later)) return laterWhole.test(textKey) ? 3 : 4;
    if (long && textKey.includes(queryKey)) return 5;
    return null;
  };
}

/** Adds one part's films to `index` (parts may arrive in any order). */
export function addFilmIndexPart(index: FilmIndex, part: FilmIndexPart): void {
  for (const [id, year, directors, fame, names] of part) {
    const film = index.films.length;
    index.films.push({ id, title: names[0] ?? "", year, directors: directors.slice(0, 2), fame });
    names.forEach((text, i) => {
      const { key, split } = nameKeys(text);
      const number = catalogNumberKey(key);
      index.names.push({ film, text, display: i === 0, key, split, compact: key.replaceAll(" ", ""), number: number === key ? null : number });
    });
  }
}

/**
 * An exact title beats a whole-word start unless that one has ten times the fame (log scale)…
 * (`search_films` adds these as `real`, so scores here are rounded to 32-bit floats the same way,
 * or near-equal films could swap places.)
 */
const EXACT_BONUS = Math.fround(Math.log(30));
/** …and a whole-word start beats a start that ends mid-word unless that one has three times. */
const WORD_BONUS = Math.fround(Math.log(3));

/**
 * The best `limit` films for `query`, ranked as `search_films` ranks its real (non-typo) matches:
 * classes 0–3 together by score, then partial later words (4), then substrings (5); ties by fame,
 * then id. Each film shows its title, and `aka` the other name it matched by, if any.
 */
export function searchFilmIndex(index: FilmIndex, query: string, limit: number): FilmSearchHit[] {
  const keys = { key: catalogSearchKey(query), split: catalogSplitKey(query) };
  const compact = keys.key.replaceAll(" ", "");
  if (!compact) return [];
  const number = catalogNumberKey(keys.key);
  const numbered = /[0-9]/.test(number);
  const numberCompact = number.replaceAll(" ", "");
  // Under 3 characters a name can only match from its start (or after an article), or exactly.
  const short = compact.length < 3;

  const joined = queryMatcher(keys.key);
  const split = keys.split === keys.key ? null : queryMatcher(keys.split);
  const byNumber = numbered ? queryMatcher(number) : null;
  // `nameMatchClass`: the search keys' class, or a later word in the split keys when better.
  const nameClass = (name: IndexedName): MatchClass | null => {
    const byKey = joined(name.key, name.compact);
    if (split === null && name.split === name.key) return byKey;
    const bySplit = (split ?? joined)(name.split, name.compact);
    if (bySplit !== 3 && bySplit !== 4) return byKey;
    return byKey === null ? bySplit : (Math.min(byKey, bySplit) as MatchClass);
  };

  const best = new Map<number, { cls: MatchClass; name: IndexedName }>();
  for (const name of index.names) {
    // A cheap first look: every class needs the query's characters in order within the name.
    const maybeJoined = short
      ? name.compact === compact ||
        name.key.startsWith(keys.key) ||
        (ARTICLE.test(name.key) && name.key.slice(name.key.indexOf(" ") + 1).startsWith(keys.key)) ||
        (keys.key.length >= 3 && name.key.includes(keys.key)) ||
        (keys.split.length >= 3 && name.split.includes(keys.split))
      : name.compact.includes(compact);
    const maybeNumbered = numbered && name.number !== null && name.number.replaceAll(" ", "").includes(numberCompact);
    if (!maybeJoined && !maybeNumbered) continue;

    let cls = maybeJoined ? nameClass(name) : null;
    if (maybeNumbered) {
      // search_films only looks for numbered names that start with the numbered query.
      const numberClass = byNumber!(name.number!, name.number!.replaceAll(" ", ""));
      if (numberClass !== null && numberClass <= 2 && (cls === null || numberClass < cls)) cls = numberClass;
    }
    if (cls === null) continue;
    const held = best.get(name.film);
    // Per film: the best class, then the display title, then the first name alphabetically.
    if (!held || cls < held.cls || (cls === held.cls && ((name.display && !held.name.display) || (name.display === held.name.display && name.text < held.name.text)))) {
      best.set(name.film, { cls, name });
    }
  }

  const matches = [...best].map(([film, { cls, name }]) => ({ film: index.films[film]!, cls, name }));
  const displayExact = matches.some((m) => m.cls === 0 && m.name.display);
  const exactTitle = (m: (typeof matches)[number]) => m.cls === 0 && (m.name.display || !displayExact);
  const exactFames = matches.filter(exactTitle).map((m) => m.film.fame);
  const laterWordCap = exactFames.length ? Math.min(...exactFames) + EXACT_BONUS - 0.001 : Infinity;
  const score = (m: (typeof matches)[number]) =>
    Math.fround(exactTitle(m) ? m.film.fame + EXACT_BONUS : m.cls <= 1 ? m.film.fame + WORD_BONUS : m.cls === 3 ? Math.min(m.film.fame, laterWordCap) : m.film.fame);
  const group = (cls: number) => (cls <= 3 ? 0 : cls);

  return matches
    .map((m) => ({ ...m, score: score(m) }))
    .sort((a, b) => group(a.cls) - group(b.cls) || b.score - a.score || b.film.fame - a.film.fame || a.film.id - b.film.id)
    .slice(0, limit)
    .map(({ film, name }) => ({ id: film.id, title: film.title, year: film.year, directors: film.directors, aka: name.display ? null : name.text }));
}
