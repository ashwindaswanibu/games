/**
 * Small Wikidata SELECT queries (a VALUES list of a few hundred films), for the content checks that
 * ask one fact per film: colour (`wikidata-colour.mts`) and kind (`wikidata-kind.mts`). The bulk
 * catalog import reads Wikidata through QLever's CSV downloads instead (`qlever.mts`).
 *
 * Asks QLever first (fast, no rate limit) and falls back to the official query service.
 */
import { z } from "zod";
import { fetchWithRetry } from "./http.mjs";
import { QLEVER_ENDPOINT, qidOf } from "./qlever.mjs";

const WDQS_ENDPOINT = "https://query.wikidata.org/sparql";
const PREFIXES = "PREFIX wd: <http://www.wikidata.org/entity/>\nPREFIX wdt: <http://www.wikidata.org/prop/direct/>\n";

const QID = /^Q[1-9][0-9]*$/;
export const isQid = (value: string): boolean => QID.test(value);
export const qidFromUri = qidOf;

const resultSchema = z.object({
  results: z.object({ bindings: z.array(z.record(z.string(), z.object({ type: z.string(), value: z.string() }))) }),
});
export type SparqlRow = Record<string, string>;

async function select(endpoint: string, query: string, attempts: number): Promise<SparqlRow[]> {
  const response = await fetchWithRetry(
    endpoint,
    {
      method: "POST",
      headers: { accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query: PREFIXES + query }).toString(),
    },
    { label: "wikidata sparql", attempts },
  );
  const parsed = resultSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`Unexpected SPARQL response from ${endpoint}: ${parsed.error.message}`);
  return parsed.data.results.bindings.map((binding) => Object.fromEntries(Object.entries(binding).map(([k, v]) => [k, v.value])));
}

/** Runs a SELECT query and flattens the bindings to strings. */
export async function sparqlSelect(query: string): Promise<SparqlRow[]> {
  try {
    return await select(QLEVER_ENDPOINT, query, 3);
  } catch (error) {
    console.warn(`  ⚠ QLever failed (${error instanceof Error ? error.message : String(error)}); asking the Wikidata query service`);
    return select(WDQS_ENDPOINT, query, 6);
  }
}
