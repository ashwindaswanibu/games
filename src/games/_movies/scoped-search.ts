import { CATALOG_MAX_LIMIT, catalogLimitSchema, catalogQuerySchema, filmIdSchema, personIdSchema } from "./schemas";
import { catalogSearchKey } from "./search-key";

export { catalogSearchKey };

/**
 * Scoped catalog routes: one person's filmography (`/api/catalog/filmography`) or one film's cast
 * (`/api/catalog/cast`). Degrees of Separation uses these so a player picks a film the current
 * actor was in, then a co-star from it.
 *
 * A filmography is searched in SQL (`search_films` with a person), so films match by every name
 * they are known by. A cast is small (a few dozen people), so it is matched here, in memory, with
 * the same normalization as the SQL `catalog_search_key` and the same tiers and ranking as
 * `search_people`, minus the typo-tolerant tier. Pure; safe on both sides of the wire.
 */

/** The search key without spaces (SQL `compact_key`): "xmen" matches X-Men, "shahrukh" Shah Rukh Khan. */
export function compactSearchKey(key: string): string {
  return key.replaceAll(" ", "");
}

/** Prefix matches ignore spaces from this many characters (shorter, "it" would match "I, Tonya"). */
const COMPACT_PREFIX_MIN = 3;

/**
 * How `textKey` matches `queryKey` (both search keys): 0 exact (ignoring spaces), 1 the text
 * starts with the query (ignoring spaces from 3 characters), 2 a later word starts with it, 3
 * substring (3+ characters for both); null when it doesn't match. Mirrors `search_people`.
 */
export function matchTier(queryKey: string, textKey: string): 0 | 1 | 2 | 3 | null {
  if (!queryKey) return null;
  const queryCompact = compactSearchKey(queryKey);
  const textCompact = compactSearchKey(textKey);
  if (textCompact === queryCompact) return 0;
  if (queryCompact.length >= COMPACT_PREFIX_MIN ? textCompact.startsWith(queryCompact) : textKey.startsWith(queryKey)) return 1;
  if (queryKey.length >= 3 && textKey.includes(` ${queryKey}`)) return 2;
  if (queryKey.length >= 3 && textKey.includes(queryKey)) return 3;
  return null;
}

/** An exact name beats a prefix match unless that one has ten times the popularity (log scale). */
const EXACT_BONUS = Math.LN10;

/**
 * Matches of `query` among `items`, ranked like `search_people`: exact names, names that start
 * with the query and names with a later word that does are ranked together by
 * ln(1 + popularity), exact names with a bonus of ln 10 and later-word matches never above an
 * exact name; substring matches come after them. Ties: more popular, then lower id.
 */
export function rankByQuery<T extends { id: number }>(
  items: readonly T[],
  query: string,
  options: { text(item: T): string; popularity(item: T): number; limit: number },
): T[] {
  const queryKey = catalogSearchKey(query);
  const hits = items.flatMap((item) => {
    const tier = matchTier(queryKey, catalogSearchKey(options.text(item)));
    const popularity = options.popularity(item);
    return tier === null ? [] : [{ item, tier, popularity, fame: Math.log1p(Math.max(0, popularity)) }];
  });
  const exactFames = hits.filter((hit) => hit.tier === 0).map((hit) => hit.fame);
  const laterWordCap = exactFames.length ? Math.min(...exactFames) + EXACT_BONUS - 0.001 : Infinity;
  const score = (hit: (typeof hits)[number]) =>
    hit.tier === 0 ? hit.fame + EXACT_BONUS : hit.tier === 2 ? Math.min(hit.fame, laterWordCap) : hit.fame;
  const group = (tier: number) => (tier <= 2 ? 0 : tier);
  return hits
    .map((hit) => ({ ...hit, score: score(hit) }))
    .sort((a, b) => group(a.tier) - group(b.tier) || b.score - a.score || b.popularity - a.popularity || a.item.id - b.item.id)
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
