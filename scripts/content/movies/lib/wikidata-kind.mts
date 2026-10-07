/**
 * Which films Wikidata knows to be animated (instance of, or genre, animated film or any subclass
 * of it: computer-animated, stop-motion, anime films, live-action/animated hybrids). The four must
 * all be the same kind of film: an animated film among live-action ones gives the answer away.
 *
 * Answers are cached in `wikidata-kind.json` in the content cache folder and re-asked after a month.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { chunk } from "./http.mjs";
import { isQid, qidFromUri, sparqlSelect } from "./wikidata.mjs";

const ANIMATED_FILM = "Q202866";
const CACHE_FILE = "wikidata-kind.json";
const MAX_AGE_DAYS = 30;
const BATCH = 100;
export const KIND_CACHE_DIR = fileURLToPath(new URL("../../../../content/movies/cache/", import.meta.url));

const cacheSchema = z.record(z.string(), z.object({ animated: z.boolean(), checkedAt: z.string() }));

/** The query for one batch: the films (of those given) that are animated films, directly or via a subclass. */
export function animatedQuery(qids: readonly string[]): string {
  return `SELECT DISTINCT ?film WHERE { VALUES ?film { ${qids.map((q) => `wd:${q}`).join(" ")} } ?film (wdt:P31|wdt:P136)/wdt:P279* wd:${ANIMATED_FILM} . }`;
}

/** The Wikidata ids (of those given) of animated films, from the cache or Wikidata. */
export async function knownAnimated(qids: readonly string[], { cacheDir = KIND_CACHE_DIR, now = new Date() }: { cacheDir?: string; now?: Date } = {}): Promise<Set<string>> {
  const file = path.join(cacheDir, CACHE_FILE);
  const cache = existsSync(file) ? cacheSchema.parse(JSON.parse(readFileSync(file, "utf8"))) : {};
  const stale = (checkedAt: string) => now.getTime() - Date.parse(checkedAt) > MAX_AGE_DAYS * 86_400_000;
  const toAsk = [...new Set(qids.filter(isQid))].filter((q) => !cache[q] || stale(cache[q]!.checkedAt));
  for (const batch of chunk(toAsk, BATCH)) {
    const rows = await sparqlSelect(animatedQuery(batch));
    const animated = new Set(rows.map((r) => qidFromUri(r.film ?? "")).filter((q): q is string => q !== null));
    for (const q of batch) cache[q] = { animated: animated.has(q), checkedAt: now.toISOString() };
  }
  if (toAsk.length > 0) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
  }
  return new Set(qids.filter((q) => cache[q]?.animated));
}
