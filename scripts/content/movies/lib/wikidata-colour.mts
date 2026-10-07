/**
 * Which films Wikidata knows to be black and white (P462 "color" = black-and-white, and not also
 * colour, which films that switch between the two have). The planner uses it to skip grey films
 * before any frames are downloaded; the renderer's own measurement on the thumbnails still decides
 * for films Wikidata says nothing about.
 *
 * Answers are cached in `wikidata-colour.json` in the cache folder and re-asked after a month, so a
 * planning run makes at most a few small SPARQL requests.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chunk } from "./http.mjs";
import { isQid, qidFromUri, sparqlSelect } from "./wikidata.mjs";

const BLACK_AND_WHITE = "Q838368";
const COLOUR = "Q22006653";
const CACHE_FILE = "wikidata-colour.json";
const MAX_AGE_DAYS = 30;
const BATCH = 200;

const cacheSchema = z.record(z.string(), z.object({ blackAndWhite: z.boolean(), checkedAt: z.string() }));

/** The query for one batch of films: every colour value each one has. */
export function colourQuery(qids: readonly string[]): string {
  return `SELECT ?film ?colour WHERE { VALUES ?film { ${qids.map((q) => `wd:${q}`).join(" ")} } ?film wdt:P462 ?colour . }`;
}

/** Black and white only when Wikidata says so and doesn't also say colour. */
export function blackAndWhiteFrom(rows: readonly { film: string; colour: string }[]): Set<string> {
  const values = new Map<string, Set<string>>();
  for (const row of rows) {
    const film = qidFromUri(row.film);
    const colour = qidFromUri(row.colour);
    if (!film || !colour) continue;
    const set = values.get(film) ?? new Set<string>();
    set.add(colour);
    values.set(film, set);
  }
  return new Set([...values].filter(([, set]) => set.has(BLACK_AND_WHITE) && !set.has(COLOUR)).map(([film]) => film));
}

/** The Wikidata ids (of those given) of films known to be black and white, from the cache or Wikidata. */
export async function knownBlackAndWhite(qids: readonly string[], { cacheDir, now = new Date() }: { cacheDir: string; now?: Date }): Promise<Set<string>> {
  const file = path.join(cacheDir, CACHE_FILE);
  const cache = existsSync(file) ? cacheSchema.parse(JSON.parse(readFileSync(file, "utf8"))) : {};
  const stale = (checkedAt: string) => now.getTime() - Date.parse(checkedAt) > MAX_AGE_DAYS * 86_400_000;
  const toAsk = [...new Set(qids.filter(isQid))].filter((q) => !cache[q] || stale(cache[q]!.checkedAt));

  for (const batch of chunk(toAsk, BATCH)) {
    const rows = await sparqlSelect(colourQuery(batch));
    const grey = blackAndWhiteFrom(rows.map((r) => ({ film: r.film ?? "", colour: r.colour ?? "" })));
    for (const q of batch) cache[q] = { blackAndWhite: grey.has(q), checkedAt: now.toISOString() };
  }
  if (toAsk.length > 0) {
    mkdirSync(cacheDir, { recursive: true });
    const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  }
  return new Set(qids.filter((q) => cache[q]?.blackAndWhite));
}
