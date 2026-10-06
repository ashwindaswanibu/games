/**
 * The catalog's search normal form, the same as the SQL `catalog_search_key`: lowercase, accents
 * stripped, every run of non-alphanumerics collapsed to one space, trimmed. Pure; safe on both
 * sides of the wire.
 */
export function catalogSearchKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Shortest normalized query worth sending to the catalog ("e." normalizes to "e", too short). */
export const CATALOG_MIN_QUERY_KEY = 2;
