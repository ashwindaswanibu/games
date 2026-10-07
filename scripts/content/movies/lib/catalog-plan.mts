import { catalogSearchKey } from "@/games/_movies/search-key";
import { mergeCast, type MergedCredit } from "./catalog-model.mjs";

/**
 * Pure planning for the catalog apply step: which incoming film or person is which stored row, and
 * what to write. **A stored row keeps its id forever** (stored puzzles, solutions and plays
 * reference catalog ids), so the plan only ever *updates* stored rows by their own id and
 * *inserts* new rows without one (the database assigns the next id). Unit- and property-tested.
 */

/** External ids of a stored row. `tmdbId` exists on films only. */
export interface StoredIds {
  id: number;
  wikidataId: string | null;
  imdbId: string | null;
  tmdbId?: number | null;
}

/** External ids of an incoming (snapshot) row; `key` identifies it within the snapshot. */
export interface IncomingIds {
  key: string;
  wikidataId: string | null;
  imdbId: string | null;
  tmdbId?: number | null;
}

/** The external ids a row ends up with. */
export interface PlannedIds {
  wikidataId: string | null;
  imdbId: string | null;
  tmdbId: number | null;
}

export interface PlannedUpdate extends PlannedIds {
  /** The stored row's own id: the only id the plan ever writes. */
  id: number;
  key: string;
}

export interface PlannedInsert extends PlannedIds {
  key: string;
}

export interface IdPlan {
  updates: PlannedUpdate[];
  inserts: PlannedInsert[];
  /** Human-readable notes on ids that couldn't be applied as given. */
  conflicts: string[];
}

/**
 * Matches incoming rows to stored rows and decides every external id:
 *
 * - Match by Wikidata id first, then by IMDb id (a stored row matched once is never matched again).
 * - A matched row is updated under its own id. Its non-empty external ids never change; an empty
 *   one is filled in from the incoming row, unless another stored row already holds that value
 *   (an id stays with the row that has it) or an earlier incoming row claimed it.
 * - An unmatched incoming row is inserted without an id, dropping any external id a stored row or
 *   an earlier incoming row already holds.
 *
 * Incoming rows are processed in the given order, so pass the best-known first: they win contested
 * TMDB ids.
 */
export function planCatalogWrites(stored: readonly StoredIds[], incoming: readonly IncomingIds[]): IdPlan {
  const byWikidata = new Map<string, StoredIds>();
  const byImdb = new Map<string, StoredIds>();
  const holders = { wikidata: new Map<string, string>(), imdb: new Map<string, string>(), tmdb: new Map<number, string>() };
  const rowKey = (row: StoredIds) => `#${row.id}`;
  for (const row of stored) {
    if (row.wikidataId) byWikidata.set(row.wikidataId, row);
    if (row.imdbId) byImdb.set(row.imdbId, row);
    if (row.wikidataId) holders.wikidata.set(row.wikidataId, rowKey(row));
    if (row.imdbId) holders.imdb.set(row.imdbId, rowKey(row));
    if (row.tmdbId != null) holders.tmdb.set(row.tmdbId, rowKey(row));
  }

  // 1. Matching.
  const matchOf = new Map<string, StoredIds>();
  const claimed = new Set<number>();
  for (const row of incoming) {
    const match = row.wikidataId ? byWikidata.get(row.wikidataId) : undefined;
    if (match && !claimed.has(match.id)) {
      matchOf.set(row.key, match);
      claimed.add(match.id);
    }
  }
  const conflicts: string[] = [];
  for (const row of incoming) {
    if (matchOf.has(row.key) || !row.imdbId) continue;
    const match = byImdb.get(row.imdbId);
    if (!match) continue;
    if (claimed.has(match.id)) {
      conflicts.push(`${row.key}: ${row.imdbId} belongs to row ${match.id}, which matched another item by Wikidata id; added without it`);
      continue;
    }
    if (match.wikidataId && row.wikidataId && match.wikidataId !== row.wikidataId) {
      conflicts.push(`${row.key}: matched row ${match.id} by ${row.imdbId}; it keeps its Wikidata id ${match.wikidataId} (incoming ${row.wikidataId})`);
    }
    matchOf.set(row.key, match);
    claimed.add(match.id);
  }

  // 2. External ids. `take` hands a value to `owner` unless someone else holds it.
  const take = <V,>(map: Map<V, string>, value: V | null | undefined, owner: string, label: string): V | null => {
    if (value === null || value === undefined) return null;
    const holder = map.get(value);
    if (holder !== undefined && holder !== owner) {
      conflicts.push(`${owner}: ${label} ${String(value)} is already held by ${holder}; left off`);
      return null;
    }
    map.set(value, owner);
    return value;
  };

  const updates: PlannedUpdate[] = [];
  const inserts: PlannedInsert[] = [];
  for (const row of incoming) {
    const match = matchOf.get(row.key);
    if (match) {
      const owner = rowKey(match);
      updates.push({
        id: match.id,
        key: row.key,
        wikidataId: match.wikidataId ?? take(holders.wikidata, row.wikidataId, owner, "Wikidata id"),
        imdbId: match.imdbId ?? take(holders.imdb, row.imdbId, owner, "IMDb id"),
        tmdbId: match.tmdbId ?? take(holders.tmdb, row.tmdbId, owner, "TMDB id"),
      });
    } else {
      const owner = row.key;
      inserts.push({
        key: row.key,
        wikidataId: take(holders.wikidata, row.wikidataId, owner, "Wikidata id"),
        imdbId: take(holders.imdb, row.imdbId, owner, "IMDb id"),
        tmdbId: take(holders.tmdb, row.tmdbId, owner, "TMDB id"),
      });
    }
  }
  return { updates, inserts, conflicts };
}

// ---------------------------------------------------------------------------------------------
// Searchable titles
// ---------------------------------------------------------------------------------------------

export type TitleKind = "display" | "original" | "alias" | "former";

export interface StoredTitle {
  title: string;
  kind: TitleKind;
}

export interface WantedTitle {
  title: string;
  kind: "original" | "alias";
}

export interface TitlePlan {
  /** Stored original/alias names no source lists any more (by title text, as stored). */
  remove: string[];
  /** Names to add (inserted with ON CONFLICT DO NOTHING; the display row is the trigger's job). */
  add: WantedTitle[];
}

/**
 * One film's searchable names. Display and former titles are the database trigger's (a film never
 * loses a name it was shown under); this syncs IMDb's titles and the Wikidata/Wikipedia names.
 * Names compare by search key, the way the table is keyed.
 */
export function planTitles(stored: readonly StoredTitle[], wanted: readonly WantedTitle[]): TitlePlan {
  const wantedKeys = new Set(wanted.map((t) => catalogSearchKey(t.title)));
  const storedKeys = new Set(stored.map((t) => catalogSearchKey(t.title)));
  return {
    remove: stored.filter((t) => (t.kind === "original" || t.kind === "alias") && !wantedKeys.has(catalogSearchKey(t.title))).map((t) => t.title),
    add: wanted.filter((t) => !storedKeys.has(catalogSearchKey(t.title))),
  };
}

// ---------------------------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------------------------

export interface CreditPlan {
  /** Credits to insert or whose billing changes. */
  upsert: MergedCredit[];
  /** Stored credits no source lists any more (protected pairs are never here). */
  remove: number[];
}

/**
 * One film's credits: the merged cast (see `mergeCast`) against what is stored. A stored credit no
 * source lists any more is removed, unless it is `protectedPeople` (a link of a stored Degrees
 * chain: the published chain must stay replayable).
 */
export function planCredits(input: {
  imdb: readonly number[];
  wikidata: readonly number[];
  stored: ReadonlyMap<number, number | null>;
  protectedPeople: ReadonlySet<number>;
  popularity(personId: number): number;
}): CreditPlan {
  const merged = mergeCast({ imdb: input.imdb, wikidata: input.wikidata, stored: input.stored, popularity: input.popularity });
  const keep = new Set(merged.map((c) => c.personId));
  return {
    upsert: merged.filter((c) => !input.stored.has(c.personId) || input.stored.get(c.personId) !== c.billing),
    remove: [...input.stored.keys()].filter((id) => !keep.has(id) && !input.protectedPeople.has(id)).sort((a, b) => a - b),
  };
}
