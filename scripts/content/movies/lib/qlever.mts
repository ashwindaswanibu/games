import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetchWithRetry } from "./http.mjs";

/**
 * Bulk Wikidata reads through QLever (https://qlever.dev), a fast public SPARQL engine over a
 * recent Wikidata dump plus live updates. It returns whole tables (every film with an IMDb id,
 * 1.3 million cast pairs) in seconds with no key, where the official query service times out or
 * rate-limits. Results come as CSV (QLever's TSV keeps RDF term syntax), are streamed to a cache
 * file, then read row by row with a small RFC 4180 parser.
 *
 * Quirk: QLever silently returns no rows for `FILTER(?links >= N)` on sitelink counts, so every
 * threshold is applied after download, in TypeScript.
 */

export const QLEVER_ENDPOINT = "https://qlever.dev/api/wikidata";

const PREFIXES = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX psv: <http://www.wikidata.org/prop/statement/value/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX schema: <http://schema.org/>`;

/** Film items: an IMDb title id and an instance of film or any subclass (TV film, animated film, …). */
const FILM = `?item wdt:P345 ?imdb . FILTER(STRSTARTS(?imdb, "tt")) ?item wdt:P31/wdt:P279* wd:Q11424 .`;
const label = (variable: string, lang: string, out: string) => `OPTIONAL { ${variable} rdfs:label ?${out} FILTER(LANG(?${out}) = "${lang}") }`;

export interface QleverQuery {
  /** Cache file name, without extension. */
  name: string;
  /** Expected CSV header, in order. */
  columns: readonly string[];
  sparql: string;
}

/** Every query the catalog build runs, with the columns it reads. */
export const CATALOG_QUERIES = {
  films: {
    name: "films",
    columns: ["item", "imdb", "links", "en", "mul", "enwiki", "tmdb"],
    sparql: `${PREFIXES}
SELECT ?item ?imdb ?links ?en ?mul ?enwiki ?tmdb WHERE {
  ${FILM}
  OPTIONAL { ?item wikibase:sitelinks ?links }
  ${label("?item", "en", "en")}
  ${label("?item", "mul", "mul")}
  OPTIONAL { ?wp schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki }
  OPTIONAL { ?item wdt:P4947 ?tmdb }
}`,
  },
  years: {
    name: "years",
    columns: ["item", "year"],
    // Earliest publication date with at least year precision, ignoring deprecated statements.
    sparql: `${PREFIXES}
SELECT ?item (MIN(YEAR(?date)) AS ?year) WHERE {
  ${FILM}
  ?item p:P577 ?statement . ?statement psv:P577 ?value ; wikibase:rank ?rank .
  ?value wikibase:timeValue ?date ; wikibase:timePrecision ?precision .
  FILTER(?precision >= 9 && ?rank != wikibase:DeprecatedRank)
}
GROUP BY ?item`,
  },
  directors: {
    name: "directors",
    columns: ["item", "person", "en", "mul"],
    sparql: `${PREFIXES}
SELECT DISTINCT ?item ?person ?en ?mul WHERE {
  ${FILM}
  ?item wdt:P57 ?person .
  ${label("?person", "en", "en")}
  ${label("?person", "mul", "mul")}
}`,
  },
  genres: {
    name: "genres",
    columns: ["item", "genre", "en"],
    sparql: `${PREFIXES}
SELECT DISTINCT ?item ?genre ?en WHERE {
  ${FILM}
  ?item wdt:P136 ?genre .
  ?genre rdfs:label ?en FILTER(LANG(?en) = "en")
}`,
  },
  aliases: {
    name: "aliases",
    columns: ["item", "alias"],
    sparql: `${PREFIXES}
SELECT DISTINCT ?item ?alias WHERE {
  ${FILM}
  ?item skos:altLabel ?alias FILTER(LANG(?alias) = "en")
}`,
  },
  countries: {
    name: "countries",
    columns: ["item", "country"],
    // Only for the build summary (how many Indian films): India is Q668.
    sparql: `${PREFIXES}
SELECT DISTINCT ?item ?country WHERE {
  ${FILM}
  ?item wdt:P495 ?country . VALUES ?country { wd:Q668 }
}`,
  },
  cast: {
    name: "cast",
    columns: ["item", "person"],
    sparql: `${PREFIXES}
SELECT DISTINCT ?item ?person WHERE {
  ${FILM}
  ?item wdt:P161 ?person .
}`,
  },
  castPeople: {
    name: "cast-people",
    columns: ["person", "en", "mul", "links", "nm"],
    sparql: `${PREFIXES}
SELECT ?person ?en ?mul ?links ?nm WHERE {
  { SELECT DISTINCT ?person WHERE { ${FILM} ?item wdt:P161 ?person . } }
  ${label("?person", "en", "en")}
  ${label("?person", "mul", "mul")}
  OPTIONAL { ?person wikibase:sitelinks ?links }
  OPTIONAL { ?person wdt:P345 ?nm FILTER(STRSTARTS(?nm, "nm")) }
}`,
  },
  castDeaths: {
    name: "cast-deaths",
    columns: ["person", "died"],
    // The year each film cast member died (date of death, P570, at least year precision; the latest
    // when there are several), for the cast rule on footage of the dead (`castToKeep`).
    sparql: `${PREFIXES}
SELECT ?person (MAX(YEAR(?date)) AS ?died) WHERE {
  { SELECT DISTINCT ?person WHERE { ${FILM} ?item wdt:P161 ?person . } }
  ?person p:P570 ?statement . ?statement psv:P570 ?value ; wikibase:rank ?rank .
  ?value wikibase:timeValue ?date ; wikibase:timePrecision ?precision .
  FILTER(?precision >= 9 && ?rank != wikibase:DeprecatedRank)
}
GROUP BY ?person`,
  },
  actors: {
    name: "actors",
    columns: ["person"],
    // Everyone with an acting occupation: actor (Q33999), film actor (Q10800557), voice actor (Q2405480).
    sparql: `${PREFIXES}
SELECT DISTINCT ?person WHERE {
  ?person wdt:P106 ?occupation . VALUES ?occupation { wd:Q33999 wd:Q10800557 wd:Q2405480 }
}`,
  },
  humans: {
    name: "humans",
    columns: ["person"],
    // Which of the people the catalog can carry (anyone with an IMDb person id, anyone in a film's
    // cast) are instances of human (Q5): Degrees starts and ends only at people, never at a group
    // (the Marx Brothers, the Beatles) or an animal. ~610,000 rows.
    sparql: `${PREFIXES}
SELECT DISTINCT ?person WHERE {
  { ?person wdt:P345 ?nm . FILTER(STRSTARTS(?nm, "nm")) }
  UNION
  { ${FILM} ?item wdt:P161 ?person . }
  ?person wdt:P31 wd:Q5 .
}`,
  },
  series: {
    name: "series",
    columns: ["item", "series", "en", "creative", "universe", "brand", "list"],
    // Every "part of the series" (P179) value of every film, with what Wikidata says the value is
    // (`seriesOfFilm` decides which count): a series of creative works (Q7725310: film series,
    // TV series, trilogy, media franchise…), a fictional or shared universe (Q559618, Q3275581:
    // the MCU), a brand (Q431289: the MCU's phases and sagas) or a list article (Q13406463:
    // "list of Pixar films", "BBC's 100 Greatest Films of the 21st Century"). ~15,000 rows.
    sparql: `${PREFIXES}
SELECT DISTINCT ?item ?series ?en ?creative ?universe ?brand ?list WHERE {
  ${FILM}
  ?item wdt:P179 ?series .
  ${label("?series", "en", "en")}
  BIND(EXISTS { ?series wdt:P31/wdt:P279* wd:Q7725310 } AS ?creative)
  BIND(EXISTS { ?series wdt:P31/wdt:P279* wd:Q559618 } || EXISTS { ?series wdt:P31/wdt:P279* wd:Q3275581 } AS ?universe)
  BIND(EXISTS { ?series wdt:P31/wdt:P279* wd:Q431289 } AS ?brand)
  BIND(EXISTS { ?series wdt:P31/wdt:P279* wd:Q13406463 } AS ?list)
}`,
  },
  imdbPeople: {
    name: "imdb-people",
    columns: ["person", "nm", "en", "mul", "links"],
    // Everyone with an IMDb person id, to land IMDb's cast and directors on Wikidata's people.
    sparql: `${PREFIXES}
SELECT ?person ?nm ?en ?mul ?links WHERE {
  ?person wdt:P345 ?nm . FILTER(STRSTARTS(?nm, "nm"))
  ${label("?person", "en", "en")}
  ${label("?person", "mul", "mul")}
  OPTIONAL { ?person wikibase:sitelinks ?links }
}`,
  },
} as const satisfies Record<string, QleverQuery>;

// ---------------------------------------------------------------------------------------------
// CSV (RFC 4180): quoted fields may hold commas, quotes ("") and newlines; CRLF or LF.
// ---------------------------------------------------------------------------------------------

const QUOTE = 34;
const COMMA = 44;
const LF = 10;
const CR = 13;

/** Incremental CSV parser: feed chunks with `push`, then `end`. Calls `onRecord` per record. */
export class CsvParser {
  private field = "";
  private record: string[] = [];
  private quoted = false;
  /** Inside quotes, a quote was just seen: either an escaped quote or the end of the field. */
  private quotePending = false;
  private fieldStarted = false;

  constructor(private readonly onRecord: (record: string[]) => void) {}

  push(chunk: string): void {
    const length = chunk.length;
    let i = 0;
    while (i < length) {
      if (this.quoted) {
        if (this.quotePending) {
          this.quotePending = false;
          if (chunk.charCodeAt(i) === QUOTE) {
            this.field += '"'; // "" inside quotes
            i++;
            continue;
          }
          this.quoted = false; // that was the closing quote; read chunk[i] unquoted
          continue;
        }
        const quote = chunk.indexOf('"', i);
        if (quote < 0) {
          this.field += chunk.slice(i);
          return;
        }
        this.field += chunk.slice(i, quote);
        this.quotePending = true;
        i = quote + 1;
        continue;
      }
      const code = chunk.charCodeAt(i);
      if (code === QUOTE && !this.fieldStarted) {
        this.quoted = true;
        this.fieldStarted = true;
        i++;
      } else if (code === COMMA) {
        this.endField();
        i++;
      } else if (code === LF) {
        this.endRecord();
        i++;
      } else if (code === CR) {
        i++; // CRLF line ends. (A bare CR in an unquoted field isn't valid CSV anyway.)
      } else {
        // A run of ordinary characters, appended in one slice.
        let end = i + 1;
        while (end < length) {
          const next = chunk.charCodeAt(end);
          if (next === COMMA || next === LF || next === CR || next === QUOTE) break;
          end++;
        }
        this.field += chunk.slice(i, end);
        this.fieldStarted = true;
        i = end;
      }
    }
  }

  end(): void {
    if (this.quoted && !this.quotePending) throw new Error("CSV ends inside a quoted field");
    this.quoted = false;
    this.quotePending = false;
    if (this.fieldStarted || this.record.length > 0) this.endRecord();
  }

  private endField(): void {
    this.record.push(this.field);
    this.field = "";
    this.fieldStarted = false;
  }

  private endRecord(): void {
    this.endField();
    const record = this.record;
    this.record = [];
    // A blank line is not a record.
    if (!(record.length === 1 && record[0] === "")) this.onRecord(record);
  }
}

/** Parses a whole CSV text (for tests and small inputs). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  const parser = new CsvParser((record) => out.push(record));
  parser.push(text);
  parser.end();
  return out;
}

/** Row objects keyed by `columns`, after checking the header matches them exactly. */
export function csvRows(columns: readonly string[], onRow: (row: Record<string, string>) => void): (record: string[]) => void {
  let header = true;
  return (record) => {
    if (header) {
      header = false;
      if (record.length !== columns.length || record.some((name, i) => name !== columns[i])) {
        throw new Error(`Unexpected CSV header ${JSON.stringify(record)}; expected ${JSON.stringify(columns)}`);
      }
      return;
    }
    if (record.length !== columns.length) throw new Error(`CSV row has ${record.length} fields, expected ${columns.length}: ${JSON.stringify(record).slice(0, 200)}`);
    const row: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) row[columns[i]!] = record[i]!;
    onRow(row);
  };
}

/** Reads a cached CSV file row by row (streaming). Returns the number of data rows. */
export async function forEachCsvRow(path: string, columns: readonly string[], onRow: (row: Record<string, string>) => void): Promise<number> {
  let count = 0;
  const parser = new CsvParser(
    csvRows(columns, (row) => {
      count++;
      onRow(row);
    }),
  );
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 });
  for await (const chunk of stream as AsyncIterable<string>) parser.push(chunk);
  parser.end();
  return count;
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

const ENTITY = /^http:\/\/www\.wikidata\.org\/entity\/(Q[1-9][0-9]*)$/;

/** Entity URI → QID; blank nodes ("unknown value") and anything else → null. */
export function qidOf(uri: string): string | null {
  return ENTITY.exec(uri)?.[1] ?? null;
}

/** A boolean cell ("true" or "false", as QLever writes xsd:boolean), or null when it is neither. */
export function boolCell(value: string | undefined): boolean | null {
  return value === "true" ? true : value === "false" ? false : null;
}

/** A non-negative integer cell, or null when empty or malformed. */
export function intCell(value: string | undefined): number | null {
  if (!value || !/^[0-9]+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

// ---------------------------------------------------------------------------------------------
// Fetch with a cache fallback
// ---------------------------------------------------------------------------------------------

export interface QueryCacheOptions {
  cacheDir: string;
  /** Use cached results only (no network). */
  offline: boolean;
  /** Oldest cached result usable when QLever fails. */
  maxFallbackAgeDays: number;
  log: (message: string) => void;
}

/**
 * Runs `query` on QLever and stores the CSV at `<cacheDir>/<name>.csv` (written to a temporary
 * file first, so a failed download never replaces a good cache). If QLever fails, a cached result
 * up to `maxFallbackAgeDays` old is used with a loud warning, so the IMDb half of a refresh still
 * runs. Returns the file path and its age.
 */
export async function cachedQuery(query: QleverQuery, options: QueryCacheOptions): Promise<{ path: string; fetchedAt: Date; fromCache: boolean }> {
  const path = join(options.cacheDir, `${query.name}.csv`);
  const cached = await stat(path).catch(() => null);
  if (options.offline) {
    if (!cached) throw new Error(`Wikidata result "${query.name}" isn't cached in ${options.cacheDir} (needed with --offline)`);
    return { path, fetchedAt: cached.mtime, fromCache: true };
  }
  await mkdir(options.cacheDir, { recursive: true });
  const partial = `${path}.partial`;
  const started = Date.now();
  try {
    const response = await fetchWithRetry(
      QLEVER_ENDPOINT,
      {
        method: "POST",
        headers: { accept: "text/csv", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ query: query.sparql }).toString(),
      },
      { label: `qlever ${query.name}`, attempts: 4, timeoutMs: 5 * 60_000 },
    );
    if (!response.body) throw new Error("empty response");
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(partial));
    await assertHeader(partial, query.columns);
    await rename(partial, path);
    const size = (await stat(path)).size;
    options.log(`  wikidata ${query.name}: ${(size / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return { path, fetchedAt: new Date(), fromCache: false };
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    const ageDays = cached ? (Date.now() - cached.mtimeMs) / 86_400_000 : Infinity;
    if (!cached || ageDays > options.maxFallbackAgeDays) throw error;
    options.log(
      `\n  !!! QLever failed for "${query.name}" (${error instanceof Error ? error.message : String(error)}).\n` +
        `  !!! Using the cached result from ${cached.mtime.toISOString()} (${ageDays.toFixed(1)} days old). Wikidata details may be stale.\n`,
    );
    return { path, fetchedAt: cached.mtime, fromCache: true };
  }
}

/** QLever reports some errors as a 200 with a JSON or HTML body; a result always starts with the header. */
async function assertHeader(path: string, columns: readonly string[]): Promise<void> {
  const stream = createReadStream(path, { encoding: "utf8", start: 0, end: 4095 });
  let head = "";
  for await (const chunk of stream as AsyncIterable<string>) head += chunk;
  const firstLine = head.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine !== columns.join(",")) throw new Error(`unexpected response (first line: ${JSON.stringify(firstLine.slice(0, 200))})`);
}
