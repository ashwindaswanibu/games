import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { z } from "zod";

/**
 * The catalog snapshot: what the build step produced from IMDb and Wikidata, independent of any
 * database. Films are keyed by IMDb id, people by Wikidata id (else IMDb person id). The apply
 * step writes the same snapshot to the local database and, later, to the hosted one, so both get
 * identical content. Stored as NDJSON plus a `meta.json` summary; validated with zod on read.
 */

/** 2: people carry `isActor`. */
export const SNAPSHOT_VERSION = 2;

const qid = z.string().regex(/^Q[1-9][0-9]*$/);
const tt = z.string().regex(/^tt[0-9]{7,10}$/);
const nm = z.string().regex(/^nm[0-9]{7,10}$/);
/** A person's snapshot key: their Wikidata id, else their IMDb id. */
const personKey = z.union([qid, nm]);

export const snapshotFilmSchema = z.object({
  imdbId: tt,
  wikidataId: qid.nullable(),
  title: z.string().min(1).max(300),
  /** Other searchable names (IMDb's titles first, then Wikidata's and Wikipedia's). */
  originalTitles: z.array(z.string().min(1).max(300)),
  aliases: z.array(z.string().min(1).max(300)),
  year: z.number().int().min(1870).max(2100).nullable(),
  genres: z.array(z.string().min(1).max(60)).max(20),
  directors: z.array(z.string().min(1).max(200)).max(10),
  /** Wikipedia editions (Wikidata sitelinks); 0 without a Wikidata item. */
  popularity: z.number().int().min(0),
  imdbVotes: z.number().int().min(0).nullable(),
  tmdbId: z.number().int().positive().max(2_147_483_647).nullable(),
  /** IMDb's top-billed actors and actresses, in IMDb's order. */
  imdbCast: z.array(personKey),
  /** Wikidata's cast, best known first (no billing order). */
  wikidataCast: z.array(personKey),
  /** Why the film is in (see `selectionReason`). */
  reason: z.enum(["votes", "sitelinks", "recent", "tv-or-video", "existing"]),
});
export type SnapshotFilm = z.infer<typeof snapshotFilmSchema>;

export const snapshotPersonSchema = z.object({
  key: personKey,
  wikidataId: qid.nullable(),
  imdbId: nm.nullable(),
  name: z.string().min(1).max(200),
  popularity: z.number().int().min(0),
  /** IMDb or Wikidata says they act (see `isActor`); Degrees' start and end actors must. */
  isActor: z.boolean(),
});
export type SnapshotPerson = z.infer<typeof snapshotPersonSchema>;

export const snapshotMetaSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  createdAt: z.string(),
  rules: z.record(z.string(), z.number()),
  sources: z.record(z.string(), z.string()),
  summary: z.record(z.string(), z.unknown()),
});
export type SnapshotMeta = z.infer<typeof snapshotMetaSchema>;

export interface Snapshot {
  meta: SnapshotMeta;
  films: SnapshotFilm[];
  people: SnapshotPerson[];
}

async function writeNdjson(path: string, rows: Iterable<unknown>): Promise<void> {
  const out = createWriteStream(path, { encoding: "utf8" });
  for (const row of rows) {
    if (!out.write(`${JSON.stringify(row)}\n`)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
  }
  out.end();
  await finished(out);
}

async function readNdjson<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const rows: T[] = [];
  let lineNumber = 0;
  for await (const line of createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity })) {
    lineNumber++;
    if (!line) continue;
    const parsed = schema.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error(`${path}:${lineNumber}: ${parsed.error.message}`);
    rows.push(parsed.data);
  }
  return rows;
}

/** Writes the snapshot into `dir` (replacing any previous one only once every file is written). */
export async function writeSnapshot(dir: string, snapshot: Snapshot): Promise<void> {
  const partial = `${dir}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  await writeNdjson(join(partial, "films.ndjson"), snapshot.films);
  await writeNdjson(join(partial, "people.ndjson"), snapshot.people);
  await writeFile(join(partial, "meta.json"), `${JSON.stringify(snapshot.meta, null, 2)}\n`);
  await rm(dir, { recursive: true, force: true });
  await rename(partial, dir);
}

/** Reads and validates a snapshot, including that every credited person is in it. */
export async function readSnapshot(dir: string): Promise<Snapshot> {
  const rawMeta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as { version?: unknown };
  if (rawMeta.version !== SNAPSHOT_VERSION) {
    throw new Error(`The snapshot in ${dir} is format ${String(rawMeta.version)}; this importer reads format ${SNAPSHOT_VERSION}. Build it again (without --apply-only).`);
  }
  const meta = snapshotMetaSchema.parse(rawMeta);
  const films = await readNdjson(join(dir, "films.ndjson"), snapshotFilmSchema);
  const people = await readNdjson(join(dir, "people.ndjson"), snapshotPersonSchema);
  const keys = new Set(people.map((p) => p.key));
  for (const film of films) {
    for (const key of [...film.imdbCast, ...film.wikidataCast]) {
      if (!keys.has(key)) throw new Error(`Snapshot film ${film.imdbId} credits ${key}, who isn't among its people`);
    }
  }
  return { meta, films, people };
}
