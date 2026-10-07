/**
 * What kind of film Wikidata says each film is: **animated** (instance of, or genre, animated film
 * or any subclass of it), **hybrid** (live-action/animated, e.g. Avatar, Sonic, Space Jam, Who
 * Framed Roger Rabbit) or **live** action (neither). The four must all be the same kind: an
 * animated film among live-action ones gives the answer away, and so does a hybrid.
 *
 * Answers are cached in `wikidata-kind-v2.json` in the content cache folder and re-asked after a month.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { chunk } from "./http.mjs";
import { isQid, qidFromUri, sparqlSelect } from "./sparql.mjs";

const ANIMATED_FILM = "Q202866";
const LIVE_ACTION_ANIMATED_FILM = "Q25110269";
const CACHE_FILE = "wikidata-kind-v2.json";
const MAX_AGE_DAYS = 30;
const BATCH = 100;
export const KIND_CACHE_DIR = fileURLToPath(new URL("../../../../content/movies/cache/", import.meta.url));

export const FILM_KINDS = ["animated", "hybrid", "live"] as const;
export type FilmKind = (typeof FILM_KINDS)[number];

const cacheSchema = z.record(z.string(), z.object({ kind: z.enum(FILM_KINDS), checkedAt: z.string() }));

/** The films (of those given) that reach `classQid` as instance of or genre, through subclasses. */
export function reachesQuery(qids: readonly string[], classQid: string): string {
  return `SELECT DISTINCT ?film WHERE { VALUES ?film { ${qids.map((q) => `wd:${q}`).join(" ")} } ?film (wdt:P31|wdt:P136)/wdt:P279* wd:${classQid} . }`;
}

/** A film's kind from the two answers: hybrid wins over animated; neither is live action. */
export function kindFrom(qid: string, animated: ReadonlySet<string>, hybrid: ReadonlySet<string>): FilmKind {
  if (hybrid.has(qid)) return "hybrid";
  return animated.has(qid) ? "animated" : "live";
}

async function reaching(batch: readonly string[], classQid: string): Promise<Set<string>> {
  const rows = await sparqlSelect(reachesQuery(batch, classQid));
  return new Set(rows.map((row) => qidFromUri(row.film ?? "")).filter((q): q is string => q !== null));
}

/** Each given Wikidata id's kind (films Wikidata says nothing about are live action), from the cache or Wikidata. */
export async function filmKinds(qids: readonly string[], { cacheDir = KIND_CACHE_DIR, now = new Date() }: { cacheDir?: string; now?: Date } = {}): Promise<Map<string, FilmKind>> {
  const file = path.join(cacheDir, CACHE_FILE);
  const cache = existsSync(file) ? cacheSchema.parse(JSON.parse(readFileSync(file, "utf8"))) : {};
  const stale = (checkedAt: string) => now.getTime() - Date.parse(checkedAt) > MAX_AGE_DAYS * 86_400_000;
  const valid = [...new Set(qids.filter(isQid))];
  const toAsk = valid.filter((q) => !cache[q] || stale(cache[q]!.checkedAt));
  for (const batch of chunk(toAsk, BATCH)) {
    const [animated, hybrid] = [await reaching(batch, ANIMATED_FILM), await reaching(batch, LIVE_ACTION_ANIMATED_FILM)];
    for (const q of batch) cache[q] = { kind: kindFrom(q, animated, hybrid), checkedAt: now.toISOString() };
  }
  if (toAsk.length > 0) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
  }
  return new Map(valid.map((q) => [q, cache[q]?.kind ?? "live"]));
}
