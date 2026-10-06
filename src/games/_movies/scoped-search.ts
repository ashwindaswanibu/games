import { CATALOG_MAX_LIMIT, catalogLimitSchema, catalogQuerySchema, filmIdSchema, personIdSchema } from "./schemas";
import { catalogSearchKey } from "./search-key";

export { catalogSearchKey };

/**
 * Autocomplete within a small, known set: one person's filmography (`/api/catalog/filmography`) or
 * one film's cast (`/api/catalog/cast`). Degrees of Separation uses these so a player picks a film
 * the current actor was in, then a co-star from it.
 *
 * The sets are small (tens to a few hundred rows), so matching happens in memory with the same
 * normalization as the SQL `catalog_search_key` and the same tiers as `search_films` /
 * `search_people`, minus the typo-tolerant tier. Pure; safe on both sides of the wire.
 */


/** 0 exact, 1 prefix of the text or of any word in it, 2 substring; null when it doesn't match. */
export function matchTier(queryKey: string, textKey: string): 0 | 1 | 2 | null {
  if (!queryKey) return null;
  if (textKey === queryKey) return 0;
  if (textKey.startsWith(queryKey) || textKey.includes(` ${queryKey}`)) return 1;
  if (textKey.includes(queryKey)) return 2;
  return null;
}

/** Matches of `query` among `items`, best tier first, then most popular, then lowest id. */
export function rankByQuery<T extends { id: number }>(
  items: readonly T[],
  query: string,
  options: { text(item: T): string; popularity(item: T): number; limit: number },
): T[] {
  const queryKey = catalogSearchKey(query);
  return items
    .flatMap((item) => {
      const tier = matchTier(queryKey, catalogSearchKey(options.text(item)));
      return tier === null ? [] : [{ item, tier, popularity: options.popularity(item) }];
    })
    .sort((a, b) => a.tier - b.tier || b.popularity - a.popularity || a.item.id - b.item.id)
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
