import { CATALOG_MAX_LIMIT, catalogLimitSchema, catalogQuerySchema, filmIdSchema, personIdSchema } from "./schemas";
import { catalogSearchKey, catalogSplitKey } from "./search-key";

export { catalogSearchKey, catalogSplitKey };

/**
 * Scoped catalog routes: one person's filmography (`/api/catalog/filmography`) or one film's cast
 * (`/api/catalog/cast`). Degrees of Separation uses these so a player picks a film the current
 * actor was in, then a co-star from it.
 *
 * A filmography is searched in SQL (`search_films` with a person), so films match by every name
 * they are known by. A cast is small (a few dozen people), so it is matched here, in memory, with
 * the same keys as the SQL `catalog_search_key` and `catalog_split_key` and the same match classes
 * and bonuses as `search_people` (`catalog_name_match_class`), minus the typo-tolerant tier. One
 * difference: a cast ranks by Wikipedia editions, where `search_people` ranks by the votes of each
 * person's films (namesakes in one film's cast are rare, so that lookup isn't worth a query). Pure;
 * safe on both sides of the wire.
 */

/** The search key without spaces (SQL `compact_key`): "xmen" matches X-Men, "shahrukh" Shah Rukh Khan. */
export function compactSearchKey(key: string): string {
  return key.replaceAll(" ", "");
}

/** Prefix matches ignore spaces from this many characters (shorter, "it" would match "I, Tonya"). */
const COMPACT_PREFIX_MIN = 3;

export type MatchClass = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * How `textKey` matches `queryKey` (both search keys, or both split keys), as SQL
 * `catalog_match_class` classifies it:
 *
 *  - 0 exact (ignoring spaces);
 *  - 1 the text starts with the query as whole words, or does after a leading "the", "a" or "an"
 *    ("stree" → "stree 2", "dark" → "the dark knight");
 *  - 2 the text starts with the query, ending mid-word ("stree" → "street kings"), also after an
 *    article;
 *  - 3 a later word starts with the query, ending at a word end ("guide" → "the hitchhikers guide…");
 *  - 4 a later word starts with the query, ending mid-word ("stree" → "the wolf of wall street");
 *  - 5 substring;
 *
 * or null when it doesn't match. Starts ignore spaces from 3 characters of query; later words and
 * substrings need 3 characters.
 */
export function matchClass(queryKey: string, textKey: string): MatchClass | null {
  const queryCompact = compactSearchKey(queryKey);
  if (!queryCompact) return null;
  if (compactSearchKey(textKey) === queryCompact) return 0;
  const starts = (text: string) =>
    queryCompact.length >= COMPACT_PREFIX_MIN ? compactSearchKey(text).startsWith(queryCompact) : text.startsWith(queryKey);
  // The query's characters with optional spaces between them, then a word end. Search keys hold
  // only letters, digits and single spaces, so nothing here needs escaping.
  const wholeStart = new RegExp(`^${[...queryCompact].join(" ?")}( |$)`, "u");
  const bare = /^(the|a|an) /.test(textKey) ? textKey.slice(textKey.indexOf(" ") + 1) : null;
  const startsFull = starts(textKey);
  const startsBare = bare !== null && starts(bare);
  if ((startsFull && wholeStart.test(textKey)) || (startsBare && wholeStart.test(bare))) return 1;
  if (startsFull || startsBare) return 2;
  if (queryKey.length >= 3 && textKey.includes(` ${queryKey}`)) return new RegExp(` ${queryKey}( |$)`, "u").test(textKey) ? 3 : 4;
  if (queryKey.length >= 3 && textKey.includes(queryKey)) return 5;
  return null;
}

/**
 * A name's or a query's two keys: the search key, apostrophes dropped (`key`: "maureen ohara"), and
 * the split key, apostrophes as spaces (`split`: "maureen o hara").
 */
export interface SearchKeys {
  key: string;
  split: string;
}

export function searchKeys(value: string): SearchKeys {
  return { key: catalogSearchKey(value), split: catalogSplitKey(value) };
}

/**
 * How a name matches a query by both keys, as SQL `catalog_name_match_class` decides: the search
 * keys' `matchClass`, or a later word in the split keys (class 3 or 4) when that is better. So a
 * word after an apostrophe is a word of its own ("hara" → "maureen o hara", 3) and a later word may
 * end at one ("cuckoo" → "one flew over the cuckoo s nest", 3). The split keys make no starts:
 * "don" starts "don t look up" with a whole word, but the word is "dont", and the whole-word bonus
 * would put Don't Look Up above Don.
 */
export function nameMatchClass(query: SearchKeys, name: SearchKeys): MatchClass | null {
  const joined = matchClass(query.key, name.key);
  if (query.split === query.key && name.split === name.key) return joined;
  const split = matchClass(query.split, name.split);
  if (split !== 3 && split !== 4) return joined;
  return joined === null ? split : (Math.min(joined, split) as MatchClass);
}

/** An exact name beats a whole-word start unless that one has ten times the fame (log scale)… */
const EXACT_BONUS = Math.log(30);
/** …and a whole-word start beats a start that ends mid-word unless that one has three times. */
const WORD_BONUS = Math.log(3);

/**
 * Matches of `query` among `items`, ranked like `search_people`: classes 0–3 together by score
 * (fame = ln(1 + popularity); exact names + ln 30, whole-word starts + ln 3, later whole words
 * never above an exact name), then partial later words, then substrings. Ties: more popular, then
 * lower id.
 */
export function rankByQuery<T extends { id: number }>(
  items: readonly T[],
  query: string,
  options: { text(item: T): string; popularity(item: T): number; limit: number },
): T[] {
  const queryKeys = searchKeys(query);
  const hits = items.flatMap((item) => {
    const match = nameMatchClass(queryKeys, searchKeys(options.text(item)));
    const popularity = options.popularity(item);
    return match === null ? [] : [{ item, match, popularity, fame: Math.log1p(Math.max(0, popularity)) }];
  });
  const exactFames = hits.filter((hit) => hit.match === 0).map((hit) => hit.fame);
  const laterWordCap = exactFames.length ? Math.min(...exactFames) + EXACT_BONUS - 0.001 : Infinity;
  const score = (hit: (typeof hits)[number]) =>
    hit.match === 0 ? hit.fame + EXACT_BONUS : hit.match === 1 ? hit.fame + WORD_BONUS : hit.match === 3 ? Math.min(hit.fame, laterWordCap) : hit.fame;
  const group = (match: number) => (match <= 3 ? 0 : match);
  return hits
    .map((hit) => ({ ...hit, score: score(hit) }))
    .sort((a, b) => group(a.match) - group(b.match) || b.score - a.score || b.popularity - a.popularity || a.item.id - b.item.id)
    .slice(0, options.limit)
    .map((hit) => hit.item);
}

export type ScopedSearchParams<Scope extends "person" | "film"> = { [K in Scope]: number } & { q: string; limit: number };

/**
 * A scoped catalog route's query string → validated params, or null (respond 400). `scope` names
 * the id parameter: `person` for a filmography, `film` for a cast. Repeated keys are refused.
 */
export function parseScopedSearchParams<Scope extends "person" | "film">(
  search: URLSearchParams,
  scope: Scope,
): ScopedSearchParams<Scope> | null {
  if ([scope, "q", "limit"].some((key) => search.getAll(key).length > 1)) return null;
  const id = (scope === "person" ? personIdSchema : filmIdSchema).safeParse(Number(search.get(scope) ?? ""));
  const q = catalogQuerySchema.safeParse(search.get("q") ?? undefined);
  const limit = catalogLimitSchema.safeParse(search.get("limit") || undefined);
  if (!id.success || !q.success || !limit.success || !/^[1-9][0-9]*$/.test(search.get(scope) ?? "")) return null;
  return { [scope]: id.data, q: q.data, limit: limit.data } as ScopedSearchParams<Scope>;
}

export const SCOPED_PARAMS_ERROR = `Pass a catalog id and a search of 2–80 characters, with a limit of 1–${CATALOG_MAX_LIMIT}.`;
