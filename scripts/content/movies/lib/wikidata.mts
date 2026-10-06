import { z } from "zod";
import { chunk, fetchWithRetry, type RetryOptions } from "./http.mjs";

/**
 * Wikidata access for the catalog import. Two endpoints, each used for what it is good at:
 *
 * - **WDQS (SPARQL)** picks candidate films by popularity (sitelink count) and resolves labels and
 *   sitelink counts for thousands of genres, directors and actors in a few large batches.
 * - **The Action API (`wbgetentities`)** returns each film's statements *in the order editors
 *   entered them*. RDF has no statement order, so SPARQL can't say who is top billed; the cast
 *   (P161) claim order, which editors copy from the credits, is the best free billing signal.
 *
 * Responses are validated with zod: they come from the network, so they are untrusted input.
 */

export const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
export const ACTION_API = "https://www.wikidata.org/w/api.php";

/** Items treated as feature films. Wikidata types most films as Q11424; the others catch the rest. */
export const FILM_TYPES = ["Q11424" /* film */, "Q24869" /* feature film */, "Q202866" /* animated film */] as const;

const QID = /^Q[1-9][0-9]*$/;
export const isQid = (value: string): boolean => QID.test(value);

export function qidFromUri(uri: string): string | null {
  const match = /\/entity\/(Q[1-9][0-9]*)$/.exec(uri);
  return match ? match[1]! : null;
}

// ---------------------------------------------------------------------------------------------
// SPARQL
// ---------------------------------------------------------------------------------------------

const bindingValueSchema = z.object({ type: z.string(), value: z.string() });
const sparqlResultSchema = z.object({
  results: z.object({ bindings: z.array(z.record(z.string(), bindingValueSchema)) }),
});
export type SparqlRow = Record<string, string>;

/** Runs a SELECT query (POST, so large VALUES blocks fit) and flattens bindings to strings. */
export async function sparqlSelect(query: string, retry: RetryOptions = {}): Promise<SparqlRow[]> {
  const response = await fetchWithRetry(
    SPARQL_ENDPOINT,
    {
      method: "POST",
      headers: { accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query }).toString(),
    },
    { label: "wikidata sparql", ...retry },
  );
  const parsed = sparqlResultSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`Unexpected SPARQL response: ${parsed.error.message}`);
  return parsed.data.results.bindings.map((binding) => Object.fromEntries(Object.entries(binding).map(([k, v]) => [k, v.value])));
}

export interface Candidate {
  qid: string;
  sitelinks: number;
}

const values = (qids: readonly string[]) => qids.map((q) => `wd:${q}`).join(" ");

/** Every film item with at least `minSitelinks` sitelinks (any year; years are filtered later). */
export function popularFilmsQuery(minSitelinks: number): string {
  return `SELECT DISTINCT ?film ?links WHERE {
  VALUES ?type { ${values(FILM_TYPES)} }
  ?film wdt:P31 ?type ; wikibase:sitelinks ?links .
  FILTER(?links >= ${Math.floor(minSitelinks)})
}`;
}

/** The best-known films whose original language is `languageQid`, for non-English coverage. */
export function languageFilmsQuery(languageQid: string, minSitelinks: number, limit: number): string {
  if (!isQid(languageQid)) throw new Error(`Not a QID: ${languageQid}`);
  return `SELECT DISTINCT ?film ?links WHERE {
  VALUES ?type { ${values(FILM_TYPES)} }
  ?film wdt:P364 wd:${languageQid} ; wdt:P31 ?type ; wikibase:sitelinks ?links .
  FILTER(?links >= ${Math.floor(minSitelinks)})
}
ORDER BY DESC(?links)
LIMIT ${Math.floor(limit)}`;
}

export function parseCandidates(rows: readonly SparqlRow[]): Candidate[] {
  const out: Candidate[] = [];
  for (const row of rows) {
    const qid = row.film ? qidFromUri(row.film) : null;
    const sitelinks = Number(row.links);
    if (qid && Number.isInteger(sitelinks) && sitelinks >= 0) out.push({ qid, sitelinks });
  }
  return out;
}

/** Label (English, else the language-neutral `mul` label) and sitelink count for each item. */
export interface ItemSummary {
  qid: string;
  label: string | null;
  sitelinks: number;
}

export function summariesQuery(qids: readonly string[]): string {
  for (const qid of qids) if (!isQid(qid)) throw new Error(`Not a QID: ${qid}`);
  return `SELECT ?item ?en ?mul ?links WHERE {
  VALUES ?item { ${values(qids)} }
  OPTIONAL { ?item wikibase:sitelinks ?links }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item rdfs:label ?mul FILTER(LANG(?mul) = "mul") }
}`;
}

export function parseSummaries(rows: readonly SparqlRow[]): Map<string, ItemSummary> {
  const out = new Map<string, ItemSummary>();
  for (const row of rows) {
    const qid = row.item ? qidFromUri(row.item) : null;
    if (!qid) continue;
    const label = cleanText(row.en) ?? cleanText(row.mul);
    const sitelinks = Number(row.links ?? 0);
    const previous = out.get(qid);
    // An item can have several labels in one language only through data errors; keep the first.
    out.set(qid, {
      qid,
      label: previous?.label ?? label,
      sitelinks: Math.max(previous?.sitelinks ?? 0, Number.isFinite(sitelinks) ? sitelinks : 0),
    });
  }
  return out;
}

/** Summaries for many items, `batchSize` per query. Items Wikidata doesn't return are absent. */
export async function fetchSummaries(
  qids: readonly string[],
  options: { batchSize?: number; onBatch?: (done: number, total: number) => void; retry?: RetryOptions } = {},
): Promise<Map<string, ItemSummary>> {
  const { batchSize = 400, onBatch, retry } = options;
  const unique = [...new Set(qids)];
  const out = new Map<string, ItemSummary>();
  let done = 0;
  for (const part of chunk(unique, batchSize)) {
    for (const [qid, summary] of parseSummaries(await sparqlSelect(summariesQuery(part), retry))) out.set(qid, summary);
    done += part.length;
    onBatch?.(done, unique.length);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Action API: entities with ordered claims
// ---------------------------------------------------------------------------------------------

const snakSchema = z.object({
  snaktype: z.string(),
  datavalue: z.object({ type: z.string(), value: z.unknown() }).optional(),
});
const claimSchema = z.object({
  mainsnak: snakSchema,
  rank: z.enum(["preferred", "normal", "deprecated"]),
  qualifiers: z.record(z.string(), z.array(snakSchema)).optional(),
});
export type Claim = z.infer<typeof claimSchema>;

const entitySchema = z.object({
  id: z.string(),
  missing: z.union([z.string(), z.boolean()]).optional(),
  redirects: z.object({ from: z.string(), to: z.string() }).optional(),
  labels: z.record(z.string(), z.object({ language: z.string(), value: z.string() })).optional(),
  claims: z.record(z.string(), z.array(claimSchema)).optional(),
});
export type WikidataEntity = z.infer<typeof entitySchema>;

const entitiesResponseSchema = z.union([
  z.object({ entities: z.record(z.string(), entitySchema) }),
  z.object({ error: z.object({ code: z.string(), info: z.string().optional() }) }),
]);

/** Entities with labels (en, mul) and all claims; `wbgetentities` allows 50 ids per request. */
export async function fetchEntities(qids: readonly string[], retry: RetryOptions = {}): Promise<WikidataEntity[]> {
  if (qids.length === 0) return [];
  if (qids.length > 50) throw new Error("wbgetentities takes at most 50 ids per request");
  for (const qid of qids) if (!isQid(qid)) throw new Error(`Not a QID: ${qid}`);
  const url = `${ACTION_API}?${new URLSearchParams({
    action: "wbgetentities",
    ids: qids.join("|"),
    props: "labels|claims",
    languages: "en|mul",
    format: "json",
    formatversion: "2",
  })}`;
  const response = await fetchWithRetry(url, { headers: { accept: "application/json" } }, { label: "wikidata entities", ...retry });
  const parsed = entitiesResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`Unexpected wbgetentities response: ${parsed.error.message}`);
  if ("error" in parsed.data) throw new Error(`wbgetentities failed: ${parsed.data.error.code} ${parsed.data.error.info ?? ""}`.trim());
  return Object.values(parsed.data.entities).filter((entity) => entity.missing === undefined);
}

// ---------------------------------------------------------------------------------------------
// Claim helpers (pure)
// ---------------------------------------------------------------------------------------------

export function cleanText(value: string | undefined | null): string | null {
  const text = value?.normalize("NFC").replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** Usable claims for a property: deprecated ones dropped; preferred first when `preferredOnly`. */
export function activeClaims(entity: WikidataEntity, property: string, { preferredOnly = false } = {}): Claim[] {
  const claims = (entity.claims?.[property] ?? []).filter((c) => c.rank !== "deprecated" && c.mainsnak.snaktype === "value");
  if (!preferredOnly) return claims;
  const preferred = claims.filter((c) => c.rank === "preferred");
  return preferred.length ? preferred : claims;
}

const itemValueSchema = z.object({ id: z.string() });
const timeValueSchema = z.object({ time: z.string(), precision: z.number() });
const monolingualSchema = z.object({ text: z.string(), language: z.string() });

/** Item ids of a property's claims, in claim order, without duplicates. */
export function itemIds(entity: WikidataEntity, property: string): string[] {
  const out: string[] = [];
  for (const claim of activeClaims(entity, property)) {
    const parsed = itemValueSchema.safeParse(claim.mainsnak.datavalue?.value);
    if (parsed.success && isQid(parsed.data.id) && !out.includes(parsed.data.id)) out.push(parsed.data.id);
  }
  return out;
}

/** The first string value of a property (preferred rank wins). */
export function stringValue(entity: WikidataEntity, property: string): string | null {
  for (const claim of activeClaims(entity, property, { preferredOnly: true })) {
    const value = claim.mainsnak.datavalue?.value;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Earliest year among a time property's claims with at least year precision (9). */
export function earliestYear(entity: WikidataEntity, property: string): number | null {
  let earliest: number | null = null;
  for (const claim of activeClaims(entity, property)) {
    const parsed = timeValueSchema.safeParse(claim.mainsnak.datavalue?.value);
    if (!parsed.success || parsed.data.precision < 9) continue;
    const match = /^\+(\d{4,})-/.exec(parsed.data.time);
    if (!match) continue;
    const year = Number(match[1]);
    if (earliest === null || year < earliest) earliest = year;
  }
  return earliest;
}

/** Display title: English label, else `mul`, else the English (or first) original title (P1476). */
export function entityTitle(entity: WikidataEntity): string | null {
  const label = cleanText(entity.labels?.en?.value) ?? cleanText(entity.labels?.mul?.value);
  if (label) return label;
  const titles = activeClaims(entity, "P1476").flatMap((claim) => {
    const parsed = monolingualSchema.safeParse(claim.mainsnak.datavalue?.value);
    return parsed.success ? [parsed.data] : [];
  });
  return cleanText((titles.find((t) => t.language === "en") ?? titles[0])?.text);
}
