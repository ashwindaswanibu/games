/**
 * Movie catalog import: Wikidata → movie_films, movie_people, movie_credits.
 *
 *   npm run content:movies:catalog                          import / refresh the local catalog
 *   npm run content:movies:catalog -- --dry-run             fetch and report, write nothing
 *   npm run content:movies:catalog -- --limit 3000          fewer films from the global list
 *
 * Which films: every film item released from --min-year (1950) on, ranked by Wikidata sitelink
 * count (how many Wikipedias have an article on it: a robust, language-neutral fame signal). The
 * top --limit of those, plus the best-known films in each of ~30 major non-English languages so
 * Bollywood, Japanese, Korean, French… cinema is represented even where English Wikipedia
 * dominates the global ranking. Cast comes in Wikidata's credited order (billing).
 *
 * Idempotent: rows are upserted on `wikidata_id`, so a rerun refreshes titles, genres, ids and
 * popularity in place and never duplicates. Credits of every imported film are replaced by the
 * current Wikidata cast. Films and people are never deleted (a published puzzle or a play may
 * reference them), so a film that drops out of the selection simply stays.
 */
import { parseArgs } from "node:util";
import type { ContentDb } from "../lib/db.mjs";
import {
  directorNames,
  genreNames,
  mergeCandidates,
  parseFilm,
  resolveExternalIdConflicts,
  type ParsedFilm,
} from "./lib/catalog-model.mjs";
import { chunk, mapPool } from "./lib/http.mjs";
import { pipelineDb, positiveInt, selectAllPages } from "./lib/pipeline.mjs";
import {
  fetchEntities,
  fetchSummaries,
  languageFilmsQuery,
  parseCandidates,
  popularFilmsQuery,
  sparqlSelect,
  type Candidate,
  type ItemSummary,
} from "./lib/wikidata.mjs";

/** Original languages (P364) that get a guaranteed slice of the catalog. */
const LANGUAGES: ReadonlyArray<readonly [qid: string, name: string]> = [
  ["Q1568", "Hindi"],
  ["Q5287", "Japanese"],
  ["Q9176", "Korean"],
  ["Q150", "French"],
  ["Q652", "Italian"],
  ["Q1321", "Spanish"],
  ["Q188", "German"],
  ["Q7850", "Chinese"],
  ["Q9192", "Mandarin"],
  ["Q9186", "Cantonese"],
  ["Q5885", "Tamil"],
  ["Q8097", "Telugu"],
  ["Q36236", "Malayalam"],
  ["Q33673", "Kannada"],
  ["Q9610", "Bengali"],
  ["Q7737", "Russian"],
  ["Q9168", "Persian"],
  ["Q9027", "Swedish"],
  ["Q9035", "Danish"],
  ["Q9043", "Norwegian"],
  ["Q5146", "Portuguese"],
  ["Q256", "Turkish"],
  ["Q809", "Polish"],
  ["Q13955", "Arabic"],
  ["Q9056", "Czech"],
  ["Q9067", "Hungarian"],
  ["Q7411", "Dutch"],
  ["Q9217", "Thai"],
  ["Q9288", "Hebrew"],
  ["Q9129", "Greek"],
];

const { values: args } = parseArgs({
  options: {
    limit: { type: "string", default: "4500" },
    "min-sitelinks": { type: "string", default: "20" },
    "min-year": { type: "string", default: "1950" },
    "per-language": { type: "string", default: "40" },
    "language-min-sitelinks": { type: "string", default: "12" },
    "dry-run": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
  },
  strict: true,
});

const log = (message: string) => console.log(message);

interface Selection {
  films: ParsedFilm[];
  skipped: Record<string, number>;
}

/** Fetches entities in order (50 per request, one at a time: the Action API rate-limits bursts) and keeps the ones that qualify. */
async function selectFilms(
  globalCandidates: readonly Candidate[],
  languageCandidates: readonly Candidate[],
  options: { limit: number; minYear: number; maxYear: number },
): Promise<Selection> {
  const skipped: Record<string, number> = {};
  const sitelinksOf = new Map([...globalCandidates, ...languageCandidates].map((c) => [c.qid, c.sitelinks]));
  const parseBatch = async (qids: readonly string[]): Promise<ParsedFilm[]> => {
    const out: ParsedFilm[] = [];
    for (const entity of await fetchEntities(qids)) {
      const requested = entity.redirects?.from ?? entity.id;
      const result = parseFilm(entity, sitelinksOf.get(requested) ?? sitelinksOf.get(entity.id) ?? 0, options);
      if (result.ok) out.push(result.film);
      else skipped[result.reason] = (skipped[result.reason] ?? 0) + 1;
    }
    return out;
  };

  const byQid = new Map<string, ParsedFilm>();
  // Global list, most popular first, until `limit` films qualify. Fetch in waves of 4 requests.
  const globalBatches = chunk(globalCandidates.map((c) => c.qid), 50);
  let globalAccepted = 0;
  for (let i = 0; i < globalBatches.length && globalAccepted < options.limit; i += 4) {
    const wave = globalBatches.slice(i, i + 4);
    for (const films of await mapPool(wave, 1, parseBatch)) {
      for (const film of films) {
        if (globalAccepted >= options.limit) break;
        if (!byQid.has(film.qid)) {
          byQid.set(film.qid, film);
          globalAccepted++;
        }
      }
    }
    log(`  global list: ${globalAccepted}/${options.limit} films (${Math.min(i + 4, globalBatches.length) * 50} candidates checked)`);
  }

  // Per-language picks that the global list didn't already include.
  const extra = languageCandidates.map((c) => c.qid).filter((qid) => !byQid.has(qid));
  const extraFilms = (await mapPool(chunk([...new Set(extra)], 50), 1, parseBatch)).flat();
  for (const film of extraFilms) byQid.set(film.qid, film);
  log(`  language picks: +${extraFilms.length} films not in the global list`);

  return { films: [...byQid.values()].sort((a, b) => b.sitelinks - a.sitelinks || a.qid.localeCompare(b.qid)), skipped };
}

async function loadStoredExternalIds(db: ContentDb) {
  const rows = await selectAllPages<{ wikidata_id: string | null; tmdb_id: number | null; imdb_id: string | null }>((from, to) =>
    db.from("movie_films").select("wikidata_id, tmdb_id, imdb_id").order("id").range(from, to),
  );
  const tmdb = new Map<number, string>();
  const imdb = new Map<string, string>();
  for (const row of rows) {
    // Rows without a wikidata_id can't be matched by the importer; treat their ids as taken.
    const owner = row.wikidata_id ?? "(no wikidata id)";
    if (row.tmdb_id !== null) tmdb.set(row.tmdb_id, owner);
    if (row.imdb_id !== null) imdb.set(row.imdb_id, owner);
  }
  return { tmdb, imdb };
}

type UpsertResult = PromiseLike<{ data: { id: number; wikidata_id: string | null }[] | null; error: { message: string } | null }>;

/** Upserts rows in batches of 500 (`upsert` keys on wikidata_id) and returns wikidata_id → catalog id. */
async function upsertBatches<Row>(rows: readonly Row[], label: string, upsert: (batch: Row[]) => UpsertResult): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const batches = chunk(rows, 500);
  for (const [index, batch] of batches.entries()) {
    const { data, error } = await upsert(batch);
    if (error) throw new Error(`Upserting ${label} failed: ${error.message}`);
    for (const row of data ?? []) if (row.wikidata_id) ids.set(row.wikidata_id, row.id);
    if ((index + 1) % 10 === 0 || index === batches.length - 1) log(`  ${label}: ${Math.min((index + 1) * 500, rows.length)}/${rows.length}`);
  }
  return ids;
}

interface CreditRow {
  film_id: number;
  person_id: number;
  billing: number;
}

/** Upserts credits, then deletes credits of these films that Wikidata no longer lists. */
async function replaceCredits(db: ContentDb, credits: readonly CreditRow[], filmIds: readonly number[]): Promise<number> {
  const batches = chunk(credits, 1000);
  for (const [index, batch] of batches.entries()) {
    const { error } = await db.from("movie_credits").upsert([...batch], { onConflict: "film_id,person_id" });
    if (error) throw new Error(`Upserting credits failed: ${error.message}`);
    if ((index + 1) % 20 === 0 || index === batches.length - 1) log(`  credits: ${Math.min((index + 1) * 1000, credits.length)}/${credits.length}`);
  }

  const wanted = new Set(credits.map((c) => `${c.film_id}:${c.person_id}`));
  const stale = new Map<number, number[]>();
  for (const part of chunk(filmIds, 200)) {
    const existing = await selectAllPages<{ film_id: number; person_id: number }>((from, to) =>
      db.from("movie_credits").select("film_id, person_id").in("film_id", part).order("film_id").order("person_id").range(from, to),
    );
    for (const { film_id, person_id } of existing) {
      if (!wanted.has(`${film_id}:${person_id}`)) stale.set(film_id, [...(stale.get(film_id) ?? []), person_id]);
    }
  }
  let removed = 0;
  for (const [filmId, personIds] of stale) {
    const { error } = await db.from("movie_credits").delete().eq("film_id", filmId).in("person_id", personIds);
    if (error) throw new Error(`Removing stale credits failed: ${error.message}`);
    removed += personIds.length;
  }
  return removed;
}

async function tableCount(db: ContentDb, table: "movie_films" | "movie_people" | "movie_credits"): Promise<number> {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function main() {
  const limit = positiveInt(args.limit, "limit", { max: 20_000 });
  const minSitelinks = positiveInt(args["min-sitelinks"], "min-sitelinks", { max: 400 });
  const minYear = positiveInt(args["min-year"], "min-year", { min: 1870, max: 2100 });
  const perLanguage = positiveInt(args["per-language"], "per-language", { min: 0, max: 500 });
  const languageMinSitelinks = positiveInt(args["language-min-sitelinks"], "language-min-sitelinks", { max: 400 });
  const maxYear = new Date().getUTCFullYear();
  const dryRun = args["dry-run"];
  // Fail on a remote database before spending minutes on the network.
  const db = dryRun ? null : pipelineDb({ allowRemote: args["allow-remote"] });

  log(`Selecting films (sitelinks ≥ ${minSitelinks}, released ${minYear}–${maxYear}, top ${limit} + ${perLanguage} per language)…`);
  const globalCandidates = mergeCandidates([parseCandidates(await sparqlSelect(popularFilmsQuery(minSitelinks)))]);
  log(`  ${globalCandidates.length} film items with ≥ ${minSitelinks} sitelinks`);
  const languageLists: Candidate[][] = [];
  if (perLanguage > 0) {
    for (const [qid, name] of LANGUAGES) {
      const list = parseCandidates(await sparqlSelect(languageFilmsQuery(qid, languageMinSitelinks, perLanguage)));
      languageLists.push(list);
      log(`  ${name}: ${list.length}`);
    }
  }
  const languageCandidates = mergeCandidates(languageLists);
  const { films: selected, skipped } = await selectFilms(globalCandidates, languageCandidates, { limit, minYear, maxYear });
  log(`Selected ${selected.length} films. Skipped: ${Object.entries(skipped).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);

  log("Resolving genres and directors…");
  const facets = await fetchSummaries(selected.flatMap((f) => [...f.genreQids, ...f.directorQids]));
  log("Resolving cast…");
  const castQids = [...new Set(selected.flatMap((f) => f.castQids))];
  const people: Map<string, ItemSummary> = await fetchSummaries(castQids, {
    onBatch: (done, total) => {
      if (done === total || done % 8000 < 400) log(`  people: ${done}/${total}`);
    },
  });
  const namedPeople = [...people.values()].filter((p): p is ItemSummary & { label: string } => p.label !== null && p.label.length <= 200);
  const named = new Set(namedPeople.map((p) => p.qid));

  const stored = db ? await loadStoredExternalIds(db) : undefined;
  const { films, dropped } = resolveExternalIdConflicts(selected, stored);
  const filmRows = films.map((film) => ({
    wikidata_id: film.qid,
    title: film.title,
    year: film.year,
    genres: genreNames(film.genreQids, facets),
    directors: directorNames(film.directorQids, facets),
    popularity: film.sitelinks,
    tmdb_id: film.tmdbId,
    imdb_id: film.imdbId,
  }));
  const personRows = namedPeople.map((p) => ({ wikidata_id: p.qid, name: p.label, popularity: p.sitelinks }));
  const creditCount = films.reduce((sum, f) => sum + f.castQids.filter((q) => named.has(q)).length, 0);

  const stats = {
    films: filmRows.length,
    nonEnglishPicks: languageCandidates.length,
    withTmdbId: filmRows.filter((f) => f.tmdb_id !== null).length,
    withDirectors: filmRows.filter((f) => f.directors.length > 0).length,
    withGenres: filmRows.filter((f) => f.genres.length > 0).length,
    people: personRows.length,
    unnamedCastSkipped: castQids.length - personRows.length,
    credits: creditCount,
    externalIdConflictsDropped: dropped,
  };
  log(`Prepared: ${JSON.stringify(stats)}`);
  if (!db) {
    log("Dry run: nothing written.");
    return;
  }

  log("Writing films…");
  const filmIds = await upsertBatches(filmRows, "films", (batch) =>
    db.from("movie_films").upsert(batch, { onConflict: "wikidata_id" }).select("id, wikidata_id"),
  );
  log("Writing people…");
  const personIds = await upsertBatches(personRows, "people", (batch) =>
    db.from("movie_people").upsert(batch, { onConflict: "wikidata_id" }).select("id, wikidata_id"),
  );
  log("Writing credits…");
  const credits: CreditRow[] = films.flatMap((film) => {
    const filmId = filmIds.get(film.qid);
    if (filmId === undefined) throw new Error(`Film ${film.qid} wasn't returned by the upsert`);
    return film.castQids.flatMap((qid, billing) => {
      const personId = personIds.get(qid);
      return personId === undefined ? [] : [{ film_id: filmId, person_id: personId, billing }];
    });
  });
  const removed = await replaceCredits(db, credits, [...filmIds.values()]);

  const [filmTotal, peopleTotal, creditTotal] = await Promise.all([tableCount(db, "movie_films"), tableCount(db, "movie_people"), tableCount(db, "movie_credits")]);
  log(`Done. This run: ${filmRows.length} films, ${personRows.length} people, ${credits.length} credits (${removed} stale credits removed).`);
  log(`Catalog now holds ${filmTotal} films, ${peopleTotal} people, ${creditTotal} credits.`);
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
