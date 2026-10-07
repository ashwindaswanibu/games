import { createReadStream } from "node:fs";
import { mkdir, rename, stat, utimes, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { fetchWithRetry } from "./http.mjs";

/**
 * IMDb's non-commercial datasets (https://developer.imdb.com/non-commercial-datasets/): gzipped,
 * tab-separated, `\N` for null, refreshed daily. Personal and non-commercial use only, with the
 * attribution line in `IMDB_ATTRIBUTION`. The files are large (title.principals is ~800 MB gzipped,
 * ~4 GB of text), so they are only ever read as a stream, line by line, keeping just what a caller
 * selects. Line parsers are pure and unit-tested.
 */

export const IMDB_DATASETS_URL = "https://datasets.imdbws.com";
export const IMDB_ATTRIBUTION = "Information courtesy of IMDb (https://www.imdb.com). Used with permission.";

export const IMDB_FILES = ["title.basics", "title.ratings", "title.principals", "title.crew", "name.basics"] as const;
export type ImdbFile = (typeof IMDB_FILES)[number];

// ---------------------------------------------------------------------------------------------
// Ids: "tt0068646" ⇄ 68646. Numbers keep the big lookup tables compact.
// ---------------------------------------------------------------------------------------------

const TCONST = /^tt([0-9]{7,10})$/;
const NCONST = /^nm([0-9]{7,10})$/;

function parseConst(value: string | null | undefined, pattern: RegExp, prefix: string): number | null {
  const match = value ? pattern.exec(value) : null;
  if (!match) return null;
  const n = Number(match[1]);
  // Only canonical spellings round-trip (IMDb pads to 7 digits); anything else is not an id we write.
  return formatConst(prefix, n) === value ? n : null;
}

function formatConst(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(7, "0")}`;
}

export const parseTconst = (value: string | null | undefined): number | null => parseConst(value, TCONST, "tt");
export const parseNconst = (value: string | null | undefined): number | null => parseConst(value, NCONST, "nm");
export const formatTconst = (n: number): string => formatConst("tt", n);
export const formatNconst = (n: number): string => formatConst("nm", n);

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

/** One TSV line → fields, with IMDb's `\N` as null. */
export function tsvFields(line: string): (string | null)[] {
  return line.split("\t").map((field) => (field === "\\N" ? null : field));
}

const int = (value: string | null): number | null => {
  if (value === null || !/^[0-9]+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
};

export interface ImdbRating {
  tconst: number;
  votes: number;
}

/** title.ratings: tconst, averageRating, numVotes. */
export function parseRatingLine(line: string): ImdbRating | null {
  const [id, , votes] = tsvFields(line);
  const tconst = parseTconst(id);
  const n = int(votes ?? null);
  return tconst === null || n === null ? null : { tconst, votes: n };
}

export interface ImdbTitle {
  tconst: number;
  /** movie, tvMovie, video, short, tvSeries, … */
  type: string;
  primaryTitle: string;
  originalTitle: string;
  isAdult: boolean;
  startYear: number | null;
  runtimeMinutes: number | null;
  genres: string[];
}

/** title.basics: tconst, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres. */
export function parseTitleLine(line: string): ImdbTitle | null {
  const fields = tsvFields(line);
  if (fields.length < 9) return null;
  const [id, type, primaryTitle, originalTitle, isAdult, startYear, , runtime, genres] = fields;
  const tconst = parseTconst(id);
  if (tconst === null || !type || !primaryTitle) return null;
  return {
    tconst,
    type,
    primaryTitle,
    originalTitle: originalTitle ?? primaryTitle,
    isAdult: isAdult === "1",
    startYear: int(startYear ?? null),
    runtimeMinutes: int(runtime ?? null),
    genres: genres ? genres.split(",").filter(Boolean) : [],
  };
}

/** The tconst of a title.basics / title.principals / title.crew line, without parsing the rest. */
export function lineTconst(line: string): number | null {
  const tab = line.indexOf("\t");
  return parseTconst(tab < 0 ? line : line.slice(0, tab));
}

export interface ImdbPrincipal {
  tconst: number;
  /** Position in IMDb's principal credits (1 = first). */
  ordering: number;
  nconst: number;
  /** actor, actress, self, director, writer, archive_footage, … */
  category: string;
}

/** title.principals: tconst, ordering, nconst, category, job, characters. */
export function parsePrincipalLine(line: string): ImdbPrincipal | null {
  const [id, ordering, person, category] = tsvFields(line);
  const tconst = parseTconst(id);
  const nconst = parseNconst(person);
  const order = int(ordering ?? null);
  if (tconst === null || nconst === null || order === null || !category) return null;
  return { tconst, ordering: order, nconst, category };
}

/** Principal credits that make someone a cast member: playing a role, not appearing as themselves or in archive footage. */
export const CAST_CATEGORIES: ReadonlySet<string> = new Set(["actor", "actress"]);

export interface ImdbCrew {
  tconst: number;
  directors: number[];
}

/** title.crew: tconst, directors, writers. */
export function parseCrewLine(line: string): ImdbCrew | null {
  const [id, directors] = tsvFields(line);
  const tconst = parseTconst(id);
  if (tconst === null) return null;
  const ids = (directors ?? "").split(",").flatMap((value) => {
    const n = parseNconst(value);
    return n === null ? [] : [n];
  });
  return { tconst, directors: [...new Set(ids)] };
}

export interface ImdbName {
  nconst: number;
  name: string;
}

/** name.basics: nconst, primaryName, birthYear, deathYear, primaryProfession, knownForTitles. */
export function parseNameLine(line: string): ImdbName | null {
  const [id, name] = tsvFields(line);
  const nconst = parseNconst(id);
  return nconst === null || !name ? null : { nconst, name };
}

// ---------------------------------------------------------------------------------------------
// Compact lookups
// ---------------------------------------------------------------------------------------------

/**
 * An int → int map in two typed arrays, searched by bisection: ~13 MB for IMDb's 1.6 million
 * ratings, where a `Map` would take several times that on a machine short of memory.
 */
export class IntTable {
  private constructor(
    private readonly keys: Int32Array,
    private readonly values: Int32Array,
  ) {}

  /** From parallel key and value arrays (sorted here when they aren't already). A repeated key keeps its last value. */
  static fromArrays(keys: ArrayLike<number>, values: ArrayLike<number>): IntTable {
    if (keys.length !== values.length) throw new Error("IntTable: keys and values differ in length");
    let order: number[] | null = null;
    for (let i = 1; i < keys.length; i++) {
      if (keys[i]! < keys[i - 1]!) {
        order = Array.from({ length: keys.length }, (_, j) => j).sort((a, b) => keys[a]! - keys[b]! || a - b);
        break;
      }
    }
    const outKeys = new Int32Array(keys.length);
    const outValues = new Int32Array(keys.length);
    let size = 0;
    for (let i = 0; i < keys.length; i++) {
      const at = order ? order[i]! : i;
      const key = keys[at]!;
      if (size > 0 && outKeys[size - 1] === key) {
        outValues[size - 1] = values[at]!;
        continue;
      }
      outKeys[size] = key;
      outValues[size] = values[at]!;
      size++;
    }
    return new IntTable(outKeys.slice(0, size), outValues.slice(0, size));
  }

  get size(): number {
    return this.keys.length;
  }

  get(key: number): number | undefined {
    let lo = 0;
    let hi = this.keys.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const at = this.keys[mid]!;
      if (at === key) return this.values[mid];
      if (at < key) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  *entries(): IterableIterator<[number, number]> {
    for (let i = 0; i < this.keys.length; i++) yield [this.keys[i]!, this.values[i]!];
  }
}

// ---------------------------------------------------------------------------------------------
// IO: download (only when IMDb has a newer file) and streaming reads
// ---------------------------------------------------------------------------------------------

export const datasetPath = (cacheDir: string, file: ImdbFile): string => join(cacheDir, `${file}.tsv.gz`);

/**
 * Makes sure `<cacheDir>/<file>.tsv.gz` is IMDb's current file. A cached copy is kept when its
 * modification time (set to the server's Last-Modified on download) is at least as new as the
 * server's. `offline` uses whatever is cached and fails if nothing is.
 */
export async function ensureDataset(cacheDir: string, file: ImdbFile, options: { offline: boolean; log: (message: string) => void }): Promise<string> {
  const path = datasetPath(cacheDir, file);
  const cached = await stat(path).catch(() => null);
  if (options.offline) {
    if (!cached) throw new Error(`${file} isn't cached in ${cacheDir} (needed with --offline)`);
    return path;
  }
  const url = `${IMDB_DATASETS_URL}/${file}.tsv.gz`;
  const head = await fetchWithRetry(url, { method: "HEAD" }, { label: `imdb ${file}` });
  const remoteModified = Date.parse(head.headers.get("last-modified") ?? "");
  if (cached && Number.isFinite(remoteModified) && cached.mtimeMs >= remoteModified) {
    options.log(`  ${file}: cached copy is current (${new Date(remoteModified).toISOString().slice(0, 10)})`);
    return path;
  }
  await mkdir(cacheDir, { recursive: true });
  const partial = `${path}.partial`;
  const started = Date.now();
  const response = await fetchWithRetry(url, {}, { label: `imdb ${file}`, timeoutMs: 15 * 60_000 });
  if (!response.body) throw new Error(`imdb ${file}: empty response`);
  try {
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(partial));
    await rename(partial, path);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
  if (Number.isFinite(remoteModified)) await utimes(path, new Date(), new Date(remoteModified));
  const size = (await stat(path)).size;
  options.log(`  ${file}: downloaded ${(size / 1e6).toFixed(0)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  return path;
}

/**
 * Calls `onLine` for every line of a gzipped text file after the header, streaming (constant
 * memory). Returns the number of data lines.
 */
export async function forEachGzipLine(path: string, onLine: (line: string) => void): Promise<number> {
  let rest = "";
  let header = true;
  let count = 0;
  const stream = createReadStream(path).pipe(createGunzip({ chunkSize: 1 << 20 }));
  stream.setEncoding("utf8");
  for await (const chunk of stream as AsyncIterable<string>) {
    const text = rest + chunk;
    let start = 0;
    for (let end = text.indexOf("\n", start); end >= 0; end = text.indexOf("\n", start)) {
      const line = text.charCodeAt(end - 1) === 13 ? text.slice(start, end - 1) : text.slice(start, end);
      start = end + 1;
      if (header) {
        header = false;
        continue;
      }
      if (line) {
        count++;
        onLine(line);
      }
    }
    rest = text.slice(start);
  }
  if (rest && !header) {
    count++;
    onLine(rest);
  }
  return count;
}
