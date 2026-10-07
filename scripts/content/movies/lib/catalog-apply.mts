import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadStoredReferences, runCatalogChecks, type CheckReport, type IdBaseline } from "./catalog-check.mjs";
import { keepStoredOrder, MAX_DIRECTORS, MAX_GENRES } from "./catalog-model.mjs";
import { planCatalogWrites, planCredits, planTitles, type StoredTitle, type TitleKind, type WantedTitle } from "./catalog-plan.mjs";
import type { Snapshot, SnapshotFilm, SnapshotPerson } from "./catalog-snapshot.mjs";
import { chunk } from "./http.mjs";
import { selectAllById, selectAllPages, type ContentDb } from "./pipeline.mjs";

/**
 * The catalog apply step: a snapshot (see `catalog-build.mts`) → a database, local by default.
 *
 * It reads the target's rows, plans every write with the pure functions in `catalog-plan.mts`
 * (stored rows are only ever updated under their own id; new rows are inserted without one), and
 * writes in batches of at most 500 rows, each well inside the API's 8-second statement limit. It
 * records every film's and person's ids first and checks the id contract afterwards
 * (`catalog-check.mts`); a failure stops the run loudly. Films and people are never deleted.
 */

const BATCH = 500;
/** Ids per `in (...)` filter, keeping request URLs short. */
const ID_CHUNK = 200;

interface StoredFilm {
  id: number;
  title: string;
  year: number | null;
  genres: string[];
  directors: string[];
  popularity: number;
  imdb_votes: number | null;
  series_qids: string[];
  is_adult: boolean;
  tmdb_id: number | null;
  imdb_id: string | null;
  wikidata_id: string | null;
}

interface StoredPerson {
  id: number;
  name: string;
  popularity: number;
  is_actor: boolean;
  is_human: boolean | null;
  wikidata_id: string | null;
  imdb_id: string | null;
}

type FilmRow = Omit<StoredFilm, "id"> & { id?: number };
type PersonRow = Omit<StoredPerson, "id"> & { id?: number };

export interface ApplyOptions {
  dryRun: boolean;
  /** Where the pre-import id baseline is saved (for `catalog-check --baseline`). */
  baselineDir: string;
  /** Allow removing more than `MAX_REMOVED_SHARE` of the snapshot films' stored credits in one run. */
  allowMassRemoval: boolean;
  log: (message: string) => void;
}

export interface ApplyReport {
  films: { added: number; updated: number; retitled: number; unchanged: number; notInSnapshot: number; conflicts: string[] };
  people: { added: number; updated: number; unchanged: number; conflicts: string[] };
  titles: { added: number; removed: number };
  credits: { upserted: number; removed: number; protectedKept: number };
  check: CheckReport | null;
  baselinePath: string | null;
  seconds: number;
}

/** A source outage (say, an empty cast table) must not wipe the catalog's credits. */
const MAX_REMOVED_SHARE = 0.2;

/** True when `a` and `b` agree on every field of `b` (arrays compared element by element). */
function sameFields(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  return Object.entries(b).every(([field, value]) => JSON.stringify(left[field]) === JSON.stringify(value));
}

export async function applySnapshot(db: ContentDb, snapshot: Snapshot, options: ApplyOptions): Promise<ApplyReport> {
  const { log, dryRun } = options;
  const started = Date.now();

  // ------------------------------------------------------------------------------------------
  // Read the target, record its ids.
  // ------------------------------------------------------------------------------------------
  log("Reading the target catalog…");
  const [storedFilms, storedPeople] = await Promise.all([
    selectAllById<StoredFilm>((after, limit) =>
      db
        .from("movie_films")
        .select("id, title, year, genres, directors, popularity, imdb_votes, series_qids, is_adult, tmdb_id, imdb_id, wikidata_id")
        .gt("id", after)
        .order("id")
        .limit(limit),
    ).catch(explainMissingColumns),
    selectAllById<StoredPerson>((after, limit) => db.from("movie_people").select("id, name, popularity, is_actor, is_human, wikidata_id, imdb_id").gt("id", after).order("id").limit(limit)),
  ]);
  log(`  ${storedFilms.length} films, ${storedPeople.length} people stored`);
  const baseline: IdBaseline = {
    takenAt: new Date().toISOString(),
    films: storedFilms.map((f) => ({ id: f.id, wikidataId: f.wikidata_id, imdbId: f.imdb_id, tmdbId: f.tmdb_id })),
    people: storedPeople.map((p) => ({ id: p.id, wikidataId: p.wikidata_id, imdbId: p.imdb_id })),
  };
  let baselinePath: string | null = null;
  if (!dryRun) {
    await mkdir(options.baselineDir, { recursive: true });
    baselinePath = join(options.baselineDir, `catalog-ids-${baseline.takenAt.replace(/[:.]/g, "-")}.json`);
    await writeFile(baselinePath, JSON.stringify(baseline));
    log(`  id baseline saved to ${baselinePath}`);
  }

  // ------------------------------------------------------------------------------------------
  // Plan films and people.
  // ------------------------------------------------------------------------------------------
  const filmByKey = new Map(snapshot.films.map((f) => [f.imdbId, f]));
  const storedFilmById = new Map(storedFilms.map((f) => [f.id, f]));
  const filmPlan = planCatalogWrites(
    storedFilms.map((f) => ({ id: f.id, wikidataId: f.wikidata_id, imdbId: f.imdb_id, tmdbId: f.tmdb_id })),
    snapshot.films.map((f) => ({ key: f.imdbId, wikidataId: f.wikidataId, imdbId: f.imdbId, tmdbId: f.tmdbId })),
  );
  const filmRow = (film: SnapshotFilm, ids: { wikidataId: string | null; imdbId: string | null; tmdbId: number | null }, stored?: StoredFilm): FilmRow => ({
    title: film.title,
    year: film.year,
    genres: keepStoredOrder(stored?.genres ?? [], film.genres, MAX_GENRES),
    directors: keepStoredOrder(stored?.directors ?? [], film.directors, MAX_DIRECTORS),
    popularity: film.popularity,
    imdb_votes: film.imdbVotes,
    series_qids: film.series,
    is_adult: film.isAdult,
    tmdb_id: ids.tmdbId,
    imdb_id: ids.imdbId,
    wikidata_id: ids.wikidataId,
  });
  const filmUpdates: (FilmRow & { id: number })[] = [];
  let retitled = 0;
  const retitles: string[] = [];
  for (const update of filmPlan.updates) {
    const stored = storedFilmById.get(update.id)!;
    const row = { id: update.id, ...filmRow(filmByKey.get(update.key)!, update, stored) };
    if (sameFields(stored, row)) continue;
    if (stored.title !== row.title) {
      retitled++;
      if (retitles.length < 60) retitles.push(`${update.id}: ${stored.title} → ${row.title}`);
    }
    filmUpdates.push(row);
  }
  const filmInserts = filmPlan.inserts.map((insert) => ({ key: insert.key, row: filmRow(filmByKey.get(insert.key)!, insert) }));
  const matchedFilmIds = new Set(filmPlan.updates.map((u) => u.id));
  const notInSnapshot = storedFilms.filter((f) => !matchedFilmIds.has(f.id)).length;

  const personByKey = new Map(snapshot.people.map((p) => [p.key, p]));
  const storedPersonById = new Map(storedPeople.map((p) => [p.id, p]));
  const personPlan = planCatalogWrites(
    storedPeople.map((p) => ({ id: p.id, wikidataId: p.wikidata_id, imdbId: p.imdb_id })),
    snapshot.people.map((p) => ({ key: p.key, wikidataId: p.wikidataId, imdbId: p.imdbId })),
  );
  const personRow = (person: SnapshotPerson, ids: { wikidataId: string | null; imdbId: string | null }): PersonRow => ({
    name: person.name,
    popularity: person.popularity,
    is_actor: person.isActor,
    is_human: person.isHuman,
    wikidata_id: ids.wikidataId,
    imdb_id: ids.imdbId,
  });
  const personUpdates: (PersonRow & { id: number })[] = [];
  for (const update of personPlan.updates) {
    const row = personRow(personByKey.get(update.key)!, update);
    if (!sameFields(storedPersonById.get(update.id)!, row)) personUpdates.push({ id: update.id, ...row });
  }
  const personInserts = personPlan.inserts.map((insert) => ({ key: insert.key, row: personRow(personByKey.get(insert.key)!, insert) }));

  log(
    `Plan: films +${filmInserts.length} new, ${filmUpdates.length} updated (${retitled} retitled), ${filmPlan.updates.length - filmUpdates.length} unchanged, ` +
      `${notInSnapshot} stored films not in this snapshot (kept as they are); people +${personInserts.length} new, ${personUpdates.length} updated.`,
  );
  if (retitles.length) log(`  retitled: ${retitles.slice(0, 20).join("; ")}${retitled > 20 ? `; … (${retitled - 20} more)` : ""}`);
  for (const [label, conflicts] of [["films", filmPlan.conflicts], ["people", personPlan.conflicts]] as const) {
    if (conflicts.length) log(`  ${conflicts.length} ${label} id conflicts (ids stay with the rows that hold them): ${conflicts.slice(0, 5).join("; ")}${conflicts.length > 5 ? "; …" : ""}`);
  }

  // ------------------------------------------------------------------------------------------
  // Write films and people (dry run: temporary negative ids for what would be inserted).
  // ------------------------------------------------------------------------------------------
  const filmIdOf = new Map<string, number>(filmPlan.updates.map((u) => [u.key, u.id]));
  const personIdOf = new Map<string, number>(personPlan.updates.map((u) => [u.key, u.id]));
  if (dryRun) {
    filmInserts.forEach(({ key }, i) => filmIdOf.set(key, -(i + 1)));
    personInserts.forEach(({ key }, i) => personIdOf.set(key, -(i + 1)));
  } else {
    log("Writing films…");
    await writeBatches(filmUpdates, "film updates", log, async (batch) => {
      const { error } = await db.from("movie_films").upsert(batch, { onConflict: "id" });
      return error;
    });
    await insertReturningIds(filmInserts, filmIdOf, "films", log, (rows) => db.from("movie_films").insert(rows).select("id, imdb_id, wikidata_id"));
    log("Writing people…");
    await writeBatches(personUpdates, "person updates", log, async (batch) => {
      const { error } = await db.from("movie_people").upsert(batch, { onConflict: "id" });
      return error;
    });
    await insertReturningIds(personInserts, personIdOf, "people", log, (rows) => db.from("movie_people").insert(rows).select("id, imdb_id, wikidata_id"));
  }

  // ------------------------------------------------------------------------------------------
  // Searchable titles.
  // ------------------------------------------------------------------------------------------
  log("Planning titles and credits…");
  const filmIds = snapshot.films.map((f) => filmIdOf.get(f.imdbId)!);
  const storedFilmIds = filmIds.filter((id) => id > 0);
  const storedTitles = new Map<number, (StoredTitle & { search_key: string })[]>();
  for (const part of chunk(storedFilmIds, ID_CHUNK)) {
    const rows = await selectAllPages<{ film_id: number; title: string; kind: TitleKind; search_key: string }>((from, to) =>
      db.from("movie_film_titles").select("film_id, title, kind, search_key").in("film_id", part).order("film_id").order("search_key").range(from, to),
    );
    for (const row of rows) (storedTitles.get(row.film_id) ?? storedTitles.set(row.film_id, []).get(row.film_id)!).push(row);
  }
  const titleInserts: { film_id: number; title: string; kind: "original" | "alias" }[] = [];
  const titleRemovals: { filmId: number; keys: string[] }[] = [];
  for (const film of snapshot.films) {
    const filmId = filmIdOf.get(film.imdbId)!;
    const stored = storedTitles.get(filmId) ?? [{ title: film.title, kind: "display" as const, search_key: "" }];
    const wanted: WantedTitle[] = [...film.originalTitles.map((title) => ({ title, kind: "original" as const })), ...film.aliases.map((title) => ({ title, kind: "alias" as const }))];
    const plan = planTitles(stored, wanted);
    if (plan.remove.length) {
      const remove = new Set(plan.remove);
      titleRemovals.push({ filmId, keys: stored.filter((t) => remove.has(t.title)).map((t) => t.search_key) });
    }
    for (const title of plan.add) titleInserts.push({ film_id: filmId, title: title.title, kind: title.kind });
  }

  // ------------------------------------------------------------------------------------------
  // Credits.
  // ------------------------------------------------------------------------------------------
  const references = await loadStoredReferences(db);
  const protectedPairs = new Map<number, Set<number>>();
  for (const [filmId, personId] of [...references.solutionPairs, ...references.playPairs]) {
    (protectedPairs.get(filmId) ?? protectedPairs.set(filmId, new Set()).get(filmId)!).add(personId);
  }
  const storedCredits = new Map<number, Map<number, number | null>>();
  for (const part of chunk(storedFilmIds, ID_CHUNK)) {
    const rows = await selectAllPages<{ film_id: number; person_id: number; billing: number | null }>((from, to) =>
      db.from("movie_credits").select("film_id, person_id, billing").in("film_id", part).order("film_id").order("person_id").range(from, to),
    );
    for (const row of rows) (storedCredits.get(row.film_id) ?? storedCredits.set(row.film_id, new Map()).get(row.film_id)!).set(row.person_id, row.billing);
  }
  const popularity = new Map(snapshot.people.map((p) => [personIdOf.get(p.key)!, p.popularity]));
  const creditUpserts: { film_id: number; person_id: number; billing: number | null }[] = [];
  const creditRemovals: { filmId: number; personIds: number[] }[] = [];
  let storedCreditCount = 0;
  let protectedKept = 0;
  for (const film of snapshot.films) {
    const filmId = filmIdOf.get(film.imdbId)!;
    const stored = storedCredits.get(filmId) ?? new Map<number, number | null>();
    storedCreditCount += stored.size;
    const ids = (keys: readonly string[]) => keys.map((key) => personIdOf.get(key)!);
    const protectedPeople = protectedPairs.get(filmId) ?? new Set<number>();
    const plan = planCredits({ imdb: ids(film.imdbCast), wikidata: ids(film.wikidataCast), stored, protectedPeople, popularity: (id) => popularity.get(id) ?? 0 });
    for (const credit of plan.upsert) creditUpserts.push({ film_id: filmId, person_id: credit.personId, billing: credit.billing });
    if (plan.remove.length) creditRemovals.push({ filmId, personIds: plan.remove });
    const listed = new Set(ids([...film.imdbCast, ...film.wikidataCast]));
    protectedKept += [...protectedPeople].filter((id) => stored.has(id) && !listed.has(id)).length;
  }
  const removedCredits = creditRemovals.reduce((sum, r) => sum + r.personIds.length, 0);
  const removedTitles = titleRemovals.reduce((sum, r) => sum + r.keys.length, 0);
  log(
    `Plan: titles +${titleInserts.length} / −${removedTitles}; credits ${creditUpserts.length} added or rebilled, ` +
      `${removedCredits} no longer listed by any source removed (of ${storedCreditCount} stored for these films), ${protectedKept} kept for stored Degrees chains.`,
  );
  if (storedCreditCount > 1000 && removedCredits > storedCreditCount * MAX_REMOVED_SHARE && !options.allowMassRemoval) {
    throw new Error(
      `Refusing to remove ${removedCredits} of ${storedCreditCount} stored credits (over ${MAX_REMOVED_SHARE * 100}%): ` +
        "a source is probably incomplete. Check the build summary; pass --allow-mass-removal if this is intended.",
    );
  }

  const report: ApplyReport = {
    films: { added: filmInserts.length, updated: filmUpdates.length, retitled, unchanged: filmPlan.updates.length - filmUpdates.length, notInSnapshot, conflicts: filmPlan.conflicts },
    people: { added: personInserts.length, updated: personUpdates.length, unchanged: personPlan.updates.length - personUpdates.length, conflicts: personPlan.conflicts },
    titles: { added: titleInserts.length, removed: removedTitles },
    credits: { upserted: creditUpserts.length, removed: removedCredits, protectedKept },
    check: null,
    baselinePath,
    seconds: 0,
  };
  if (dryRun) {
    report.seconds = Math.round((Date.now() - started) / 1000);
    return report;
  }

  log("Writing titles…");
  for (const { filmId, keys } of titleRemovals) {
    const { error } = await db.from("movie_film_titles").delete().eq("film_id", filmId).in("search_key", keys).in("kind", ["original", "alias"]);
    if (error) throw new Error(`Removing titles of film ${filmId} failed: ${error.message}`);
  }
  await writeBatches(titleInserts, "titles", log, async (batch) => {
    const { error } = await db.from("movie_film_titles").upsert(batch, { onConflict: "film_id,search_key", ignoreDuplicates: true });
    return error;
  });

  log("Writing credits…");
  await writeBatches(creditUpserts, "credits", log, async (batch) => {
    const { error } = await db.from("movie_credits").upsert(batch, { onConflict: "film_id,person_id" });
    return error;
  });
  for (const { filmId, personIds } of creditRemovals) {
    const { error } = await db.from("movie_credits").delete().eq("film_id", filmId).in("person_id", personIds);
    if (error) throw new Error(`Removing stale credits of film ${filmId} failed: ${error.message}`);
  }

  log("Checking the id contract…");
  report.check = await runCatalogChecks(db, { baseline });
  report.seconds = Math.round((Date.now() - started) / 1000);
  return report;
}

/** A target without this branch's columns hasn't had its migrations (`npx supabase db push` comes first). */
function explainMissingColumns(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/series_qids|is_adult/.test(message) && /does not exist|schema cache/i.test(message)) {
    throw new Error(`${message}. The target database is missing movie_films.series_qids / is_adult: apply the migrations first (npx supabase db push for the hosted one).`);
  }
  throw error;
}

async function writeBatches<Row>(rows: readonly Row[], label: string, log: (message: string) => void, write: (batch: Row[]) => Promise<{ message: string } | null>): Promise<void> {
  const batches = chunk(rows, BATCH);
  for (const [index, batch] of batches.entries()) {
    const error = await write(batch);
    if (error) throw new Error(`Writing ${label} failed: ${error.message}`);
    if ((index + 1) % 40 === 0 || index === batches.length - 1) log(`  ${label}: ${Math.min((index + 1) * BATCH, rows.length)}/${rows.length}`);
  }
}

/**
 * Inserts new rows (never with an id: the database assigns the next one) and records each one's
 * id under its snapshot key, matching returned rows by IMDb id, else Wikidata id. A row with
 * neither (both dropped by id conflicts) is inserted on its own.
 */
async function insertReturningIds<Row extends { imdb_id: string | null; wikidata_id: string | null }>(
  inserts: ReadonlyArray<{ key: string; row: Row }>,
  idOf: Map<string, number>,
  label: string,
  log: (message: string) => void,
  insert: (rows: Row[]) => PromiseLike<{ data: { id: number; imdb_id: string | null; wikidata_id: string | null }[] | null; error: { message: string } | null }>,
): Promise<void> {
  const rowKey = (row: { imdb_id: string | null; wikidata_id: string | null }) => (row.imdb_id ? `i:${row.imdb_id}` : row.wikidata_id ? `w:${row.wikidata_id}` : null);
  const keyed = inserts.filter((i) => rowKey(i.row) !== null);
  const loose = inserts.filter((i) => rowKey(i.row) === null);
  const batches = chunk(keyed, BATCH);
  for (const [index, batch] of batches.entries()) {
    const keyOf = new Map(batch.map(({ key, row }) => [rowKey(row)!, key]));
    const { data, error } = await insert(batch.map((i) => i.row));
    if (error) throw new Error(`Inserting ${label} failed: ${error.message}`);
    for (const row of data ?? []) {
      const key = keyOf.get(rowKey(row) ?? "");
      if (key) idOf.set(key, row.id);
    }
    if ((index + 1) % 40 === 0 || index === batches.length - 1) log(`  new ${label}: ${Math.min((index + 1) * BATCH, keyed.length)}/${keyed.length}`);
  }
  for (const { key, row } of loose) {
    const { data, error } = await insert([row]);
    if (error || data?.length !== 1) throw new Error(`Inserting ${label} failed: ${error?.message ?? "no row returned"}`);
    idOf.set(key, data[0]!.id);
  }
  const missing = inserts.filter((i) => !idOf.has(i.key));
  if (missing.length) throw new Error(`${missing.length} new ${label} weren't returned by the insert (first: ${missing[0]!.key})`);
}
