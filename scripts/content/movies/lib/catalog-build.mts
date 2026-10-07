import { join } from "node:path";
import {
  cleanText,
  directorNames,
  displayTitle,
  imdbGenreNames,
  lowestVoteBar,
  MAX_NAME,
  orderGenresBySpecificity,
  parseTmdbId,
  searchableNames,
  selectionReason,
  stripWikipediaQualifier,
  wikidataGenreNames,
  imdbCastToKeep,
  type ImdbCastDepth,
  type SelectionReason,
  type SelectionRules,
} from "./catalog-model.mjs";
import { SNAPSHOT_VERSION, type Snapshot, type SnapshotFilm, type SnapshotPerson } from "./catalog-snapshot.mjs";
import { mapPool } from "./http.mjs";
import {
  CAST_CATEGORIES,
  ensureDataset,
  forEachGzipLine,
  formatNconst,
  formatTconst,
  IMDB_FILES,
  IntTable,
  lineTconst,
  parseCrewLine,
  parseNameLine,
  parseNconst,
  parsePrincipalLine,
  parseRatingLine,
  parseTconst,
  parseTitleLine,
  type ImdbTitle,
} from "./imdb.mjs";
import { CATALOG_QUERIES, cachedQuery, forEachCsvRow, intCell, qidOf, type QleverQuery } from "./qlever.mjs";

/**
 * The catalog build: IMDb's datasets and Wikidata (through QLever) → a snapshot (no database).
 *
 * IMDb decides which films are in (`selectionReason`: votes, or Wikipedia editions for world cinema
 * IMDb under-votes) and supplies votes, top-billed cast, titles and, where Wikidata has none,
 * directors and genres. Wikidata adds its id, Wikipedia editions (popularity), English label and
 * aliases, the English Wikipedia title, year, genres, directors, TMDB id and deeper cast.
 *
 * Memory: the IMDb files are read as streams and only selected films and their people are kept
 * (the machine this runs on has 8 GB, and IMDb's principals alone are ~4 GB of text).
 */

export interface BuildOptions {
  cacheDir: string;
  /** Use cached downloads and query results only. */
  offline: boolean;
  rules: SelectionRules;
  /** How much of IMDb's billed cast to keep (see `imdbCastToKeep`). */
  imdbCast: ImdbCastDepth;
  /** The target catalog's films (by IMDb and Wikidata id), kept even when no rule selects them. */
  existing: { films: ReadonlyArray<{ imdbId: string | null; wikidataId: string | null }> };
  log: (message: string) => void;
}

interface WikidataFilm {
  qid: string;
  links: number;
  en: string | null;
  mul: string | null;
  enwiki: string | null;
  tconsts: Set<number>;
  tmdbIds: Set<number>;
}

interface WikidataPerson {
  qid: string;
  en: string | null;
  mul: string | null;
  links: number;
  nconsts: Set<number>;
}

const fame = (votes: number | null, popularity: number) => votes ?? popularity * 437;
const qidNumber = (qid: string) => Number(qid.slice(1));
const elapsed = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)} s`;

export async function buildSnapshot(options: BuildOptions): Promise<Snapshot> {
  const { rules, log } = options;
  const imdbDir = join(options.cacheDir, "imdb");
  const wikidataDir = join(options.cacheDir, "wikidata");
  const started = Date.now();
  const sources: Record<string, string> = {};

  // ------------------------------------------------------------------------------------------
  // Downloads: IMDb files (when IMDb has newer ones) and every Wikidata table.
  // ------------------------------------------------------------------------------------------
  log("Downloading…");
  const imdb = Object.fromEntries(
    await mapPool([...IMDB_FILES], 2, async (file) => [file, await ensureDataset(imdbDir, file, { offline: options.offline, log })] as const),
  ) as Record<(typeof IMDB_FILES)[number], string>;
  const queries = Object.values(CATALOG_QUERIES) as QleverQuery[];
  const wikidata = new Map<string, string>();
  for (const result of await mapPool(queries, 2, async (query) => {
    const out = await cachedQuery(query, { cacheDir: wikidataDir, offline: options.offline, maxFallbackAgeDays: 30, log });
    return [query.name, out] as const;
  })) {
    wikidata.set(result[0], result[1].path);
    sources[`wikidata:${result[0]}`] = `${result[1].fetchedAt.toISOString()}${result[1].fromCache ? " (cached)" : ""}`;
  }
  const csv = (query: QleverQuery, onRow: (row: Record<string, string>) => void) => forEachCsvRow(wikidata.get(query.name)!, query.columns, onRow);
  log(`  downloads ready (${elapsed(started)})`);

  // ------------------------------------------------------------------------------------------
  // Votes, then the Wikidata film items worth considering.
  // ------------------------------------------------------------------------------------------
  let phase = Date.now();
  const ratingKeys: number[] = [];
  const ratingValues: number[] = [];
  await forEachGzipLine(imdb["title.ratings"], (line) => {
    const rating = parseRatingLine(line);
    if (rating) {
      ratingKeys.push(rating.tconst);
      ratingValues.push(rating.votes);
    }
  });
  const votes = IntTable.fromArrays(ratingKeys, ratingValues);
  ratingKeys.length = ratingValues.length = 0;
  const votesOf = (tconst: number) => votes.get(tconst) ?? 0;
  const voteBar = lowestVoteBar(rules);
  log(`  ratings: ${votes.size} titles rated (${elapsed(phase)})`);

  const existingTconsts = new Set(options.existing.films.flatMap((f) => {
    const tconst = parseTconst(f.imdbId);
    return tconst === null ? [] : [tconst];
  }));
  const existingQids = new Set(options.existing.films.flatMap((f) => (f.wikidataId ? [f.wikidataId] : [])));
  // A stored film without an IMDb id is kept through its Wikidata item's IMDb title. (Through the
  // item alone, every other IMDb title the item lists would come in too: sequels, TV cuts.)
  const existingQidsWithoutImdb = new Set(options.existing.films.flatMap((f) => (f.wikidataId && !f.imdbId ? [f.wikidataId] : [])));
  const existingPairs = options.existing.films.flatMap((f) => {
    const tconst = parseTconst(f.imdbId);
    return f.wikidataId && tconst !== null ? [[f.wikidataId, tconst] as const] : [];
  });

  phase = Date.now();
  const wdFilms = new Map<string, WikidataFilm>();
  await csv(CATALOG_QUERIES.films, (row) => {
    const qid = qidOf(row.item!);
    const tconst = parseTconst(row.imdb);
    if (!qid || tconst === null) return;
    const links = intCell(row.links) ?? 0;
    if (votesOf(tconst) < voteBar && links < rules.minSitelinks && !existingTconsts.has(tconst) && !existingQids.has(qid)) return;
    let film = wdFilms.get(qid);
    if (!film) {
      film = { qid, links, en: null, mul: null, enwiki: null, tconsts: new Set(), tmdbIds: new Set() };
      wdFilms.set(qid, film);
    }
    film.links = Math.max(film.links, links);
    film.en ??= cleanText(row.en);
    film.mul ??= cleanText(row.mul);
    film.enwiki ??= cleanText(row.enwiki);
    film.tconsts.add(tconst);
    const tmdb = parseTmdbId(row.tmdb);
    if (tmdb !== null) film.tmdbIds.add(tmdb);
  });
  const wdByTconst = new Map<number, WikidataFilm[]>();
  for (const film of wdFilms.values()) for (const tconst of film.tconsts) (wdByTconst.get(tconst) ?? wdByTconst.set(tconst, []).get(tconst)!).push(film);
  const wdYears = new Map<string, number>();
  await csv(CATALOG_QUERIES.years, (row) => {
    const qid = qidOf(row.item!);
    const year = intCell(row.year);
    if (qid && year !== null && wdFilms.has(qid)) wdYears.set(qid, year);
  });
  log(`  wikidata: ${wdFilms.size} film items considered (${elapsed(phase)})`);

  // ------------------------------------------------------------------------------------------
  // IMDb titles → which films are in.
  // ------------------------------------------------------------------------------------------
  phase = Date.now();
  const candidates = new Set<number>([...existingTconsts, ...wdByTconst.keys()]);
  for (const [tconst, n] of votes.entries()) if (n >= voteBar) candidates.add(tconst);
  const titles = new Map<number, ImdbTitle>();
  await forEachGzipLine(imdb["title.basics"], (line) => {
    const tconst = lineTconst(line);
    if (tconst === null || !candidates.has(tconst)) return;
    const title = parseTitleLine(line);
    if (title && (title.type === "movie" || title.type === "tvMovie" || title.type === "video" || existingTconsts.has(tconst))) titles.set(tconst, title);
  });
  candidates.clear();

  const reasons = new Map<number, SelectionReason>();
  for (const title of titles.values()) {
    const items = wdByTconst.get(title.tconst) ?? [];
    const sitelinks = Math.max(0, ...items.map((f) => f.links));
    const wdYear = items.map((f) => wdYears.get(f.qid)).find((y) => y !== undefined) ?? null;
    const reason = selectionReason(
      {
        type: title.type,
        isAdult: title.isAdult,
        year: title.startYear ?? wdYear,
        runtimeMinutes: title.runtimeMinutes,
        genres: title.genres,
        votes: votesOf(title.tconst),
        sitelinks,
        existing: existingTconsts.has(title.tconst) || items.some((f) => existingQidsWithoutImdb.has(f.qid)),
      },
      rules,
    );
    if (reason) reasons.set(title.tconst, reason);
  }
  for (const tconst of titles.keys()) if (!reasons.has(tconst)) titles.delete(tconst);
  log(`  selected ${reasons.size} films (${elapsed(phase)})`);

  // One Wikidata item per film and one film per item: existing pairs first, then most sitelinks.
  const qidOfFilm = matchWikidataItems(
    [...reasons.keys()].flatMap((tconst) => (wdByTconst.get(tconst) ?? []).map((f) => ({ qid: f.qid, tconst, links: f.links, votes: votesOf(tconst) }))),
    existingPairs.map(([qid, tconst]) => ({ qid, tconst })),
  );
  const matchedQids = new Set(qidOfFilm.values());
  for (const qid of [...wdFilms.keys()]) if (!matchedQids.has(qid)) wdFilms.delete(qid);
  wdByTconst.clear();

  // ------------------------------------------------------------------------------------------
  // Wikidata details of the matched items.
  // ------------------------------------------------------------------------------------------
  phase = Date.now();
  const directorsOf = new Map<string, { qid: string; name: string | null }[]>();
  await csv(CATALOG_QUERIES.directors, (row) => {
    const qid = qidOf(row.item!);
    const person = qidOf(row.person!);
    if (!qid || !person || !matchedQids.has(qid)) return;
    (directorsOf.get(qid) ?? directorsOf.set(qid, []).get(qid)!).push({ qid: person, name: cleanText(row.en) ?? cleanText(row.mul) });
  });
  const genreLabelsOf = new Map<string, string[]>();
  await csv(CATALOG_QUERIES.genres, (row) => {
    const qid = qidOf(row.item!);
    if (!qid || !matchedQids.has(qid) || !row.en) return;
    (genreLabelsOf.get(qid) ?? genreLabelsOf.set(qid, []).get(qid)!).push(row.en);
  });
  const aliasesOf = new Map<string, string[]>();
  await csv(CATALOG_QUERIES.aliases, (row) => {
    const qid = qidOf(row.item!);
    if (!qid || !matchedQids.has(qid) || !row.alias) return;
    (aliasesOf.get(qid) ?? aliasesOf.set(qid, []).get(qid)!).push(row.alias);
  });
  const indian = new Set<string>();
  await csv(CATALOG_QUERIES.countries, (row) => {
    const qid = qidOf(row.item!);
    if (qid && matchedQids.has(qid)) indian.add(qid);
  });
  const wdCastOf = new Map<string, Set<string>>();
  await csv(CATALOG_QUERIES.cast, (row) => {
    const qid = qidOf(row.item!);
    const person = qidOf(row.person!);
    if (!qid || !person || !matchedQids.has(qid)) return;
    (wdCastOf.get(qid) ?? wdCastOf.set(qid, new Set()).get(qid)!).add(person);
  });
  log(`  wikidata details: ${directorsOf.size} films with directors, ${genreLabelsOf.size} with genres, ${aliasesOf.size} with aliases, ${wdCastOf.size} with cast (${elapsed(phase)})`);

  // ------------------------------------------------------------------------------------------
  // IMDb cast and directors of the selected films.
  // ------------------------------------------------------------------------------------------
  phase = Date.now();
  const principalsOf = new Map<number, [ordering: number, nconst: number][]>();
  const principalLines = await forEachGzipLine(imdb["title.principals"], (line) => {
    const tconst = lineTconst(line);
    if (tconst === null || !reasons.has(tconst)) return;
    const principal = parsePrincipalLine(line);
    if (!principal || !CAST_CATEGORIES.has(principal.category)) return;
    (principalsOf.get(tconst) ?? principalsOf.set(tconst, []).get(tconst)!).push([principal.ordering, principal.nconst]);
  });
  for (const list of principalsOf.values()) list.sort((a, b) => a[0] - b[0]);
  log(`  principals: ${principalLines} lines read, cast for ${principalsOf.size} films (${elapsed(phase)})`);

  phase = Date.now();
  const imdbDirectorsOf = new Map<number, number[]>();
  await forEachGzipLine(imdb["title.crew"], (line) => {
    const tconst = lineTconst(line);
    if (tconst === null || !reasons.has(tconst)) return;
    const qid = qidOfFilm.get(tconst);
    if (qid && directorsOf.get(qid)?.some((d) => d.name)) return; // Wikidata's directors win
    const crew = parseCrewLine(line);
    if (crew?.directors.length) imdbDirectorsOf.set(tconst, crew.directors);
  });
  log(`  crew: IMDb directors for ${imdbDirectorsOf.size} films without Wikidata directors (${elapsed(phase)})`);

  // ------------------------------------------------------------------------------------------
  // People: Wikidata's, matched to IMDb's by IMDb person id.
  // ------------------------------------------------------------------------------------------
  phase = Date.now();
  const castQids = new Set<string>();
  for (const cast of wdCastOf.values()) for (const qid of cast) castQids.add(qid);
  const imdbPeopleNeeded = new Set<number>();
  for (const list of principalsOf.values()) for (const [, nconst] of list) imdbPeopleNeeded.add(nconst);
  for (const list of imdbDirectorsOf.values()) for (const nconst of list) imdbPeopleNeeded.add(nconst);

  const wdPeople = new Map<string, WikidataPerson>();
  const addPerson = (row: Record<string, string>, qid: string) => {
    let person = wdPeople.get(qid);
    if (!person) {
      person = { qid, en: null, mul: null, links: 0, nconsts: new Set() };
      wdPeople.set(qid, person);
    }
    person.en ??= cleanText(row.en);
    person.mul ??= cleanText(row.mul);
    person.links = Math.max(person.links, intCell(row.links) ?? 0);
    const nconst = parseNconst(row.nm);
    if (nconst !== null) person.nconsts.add(nconst);
  };
  await csv(CATALOG_QUERIES.castPeople, (row) => {
    const qid = qidOf(row.person!);
    if (qid && castQids.has(qid)) addPerson(row, qid);
  });
  await csv(CATALOG_QUERIES.imdbPeople, (row) => {
    const qid = qidOf(row.person!);
    const nconst = parseNconst(row.nm);
    if (qid && nconst !== null && (imdbPeopleNeeded.has(nconst) || castQids.has(qid))) addPerson(row, qid);
  });
  // An IMDb person id → the best-known Wikidata person carrying it.
  const qidOfPerson = new Map<number, string>();
  for (const person of wdPeople.values()) {
    for (const nconst of person.nconsts) {
      const current = qidOfPerson.get(nconst);
      const rival = current ? wdPeople.get(current)! : null;
      if (!rival || person.links > rival.links || (person.links === rival.links && qidNumber(person.qid) < qidNumber(rival.qid))) qidOfPerson.set(nconst, person.qid);
    }
  }
  // The IMDb id a Wikidata person row carries: the lowest one that maps back to them.
  const imdbIdOfQid = new Map<string, number>();
  for (const [nconst, qid] of qidOfPerson) if ((imdbIdOfQid.get(qid) ?? Infinity) > nconst) imdbIdOfQid.set(qid, nconst);

  // IMDb's names for whoever Wikidata can't name: IMDb-only people, and Wikidata people without an English or neutral label.
  const imdbNamesNeeded = new Set<number>();
  for (const nconst of imdbPeopleNeeded) {
    const qid = qidOfPerson.get(nconst);
    const person = qid ? wdPeople.get(qid) : undefined;
    if (!person || !(person.en ?? person.mul)) imdbNamesNeeded.add(nconst);
  }
  for (const qid of castQids) {
    const person = wdPeople.get(qid);
    const nconst = imdbIdOfQid.get(qid);
    if (person && !(person.en ?? person.mul) && nconst !== undefined) imdbNamesNeeded.add(nconst);
  }
  const imdbNames = new Map<number, string>();
  await forEachGzipLine(imdb["name.basics"], (line) => {
    const tab = line.indexOf("\t");
    const nconst = parseNconst(tab < 0 ? line : line.slice(0, tab));
    if (nconst === null || !imdbNamesNeeded.has(nconst)) return;
    const parsed = parseNameLine(line);
    const name = cleanText(parsed?.name);
    if (name) imdbNames.set(nconst, name);
  });
  log(`  people: ${wdPeople.size} from Wikidata, ${imdbNames.size} names from IMDb (${elapsed(phase)})`);

  const validName = (name: string | null | undefined): string | null => (name && name.length <= MAX_NAME ? name : null);
  const people = new Map<string, SnapshotPerson>();
  /** Snapshot key of a Wikidata cast member, or null when nobody can name them. */
  const wdPersonKey = (qid: string): string | null => {
    if (people.has(qid)) return qid;
    const person = wdPeople.get(qid);
    if (!person) return null;
    const nconst = imdbIdOfQid.get(qid) ?? null;
    const name = validName(person.en) ?? validName(person.mul) ?? validName(nconst !== null ? imdbNames.get(nconst) : null);
    if (!name) return null;
    people.set(qid, { key: qid, wikidataId: qid, imdbId: nconst !== null ? formatNconst(nconst) : null, name, popularity: person.links });
    return qid;
  };
  /** Snapshot key of an IMDb person: their Wikidata person when there is one, else themselves. */
  const imdbPersonKey = (nconst: number): string | null => {
    const qid = qidOfPerson.get(nconst);
    if (qid) {
      const key = wdPersonKey(qid);
      if (key) return key;
    }
    const key = formatNconst(nconst);
    if (people.has(key)) return key;
    if (qid && imdbIdOfQid.get(qid) === nconst) return null; // carried by a Wikidata person nobody can name
    const name = validName(imdbNames.get(nconst));
    if (!name) return null;
    people.set(key, { key, wikidataId: null, imdbId: key, name, popularity: 0 });
    return key;
  };
  const directorName = (nconst: number): string | null => {
    const qid = qidOfPerson.get(nconst);
    const person = qid ? wdPeople.get(qid) : undefined;
    return validName(person?.en) ?? validName(person?.mul) ?? validName(imdbNames.get(nconst));
  };

  // ------------------------------------------------------------------------------------------
  // Films.
  // ------------------------------------------------------------------------------------------
  // Every Wikidata genre (up to the catalog's limit of 20), most specific first; the apply step
  // keeps a stored film's own genres first and trims to MAX_GENRES.
  const wdGenreNames = new Map([...genreLabelsOf].map(([qid, labels]) => [qid, wikidataGenreNames(labels, 20)]));
  const bySpecificity = orderGenresBySpecificity([...wdGenreNames.values()]);
  const films: SnapshotFilm[] = [];
  for (const [tconst, reason] of reasons) {
    const title = titles.get(tconst)!;
    const qid = qidOfFilm.get(tconst) ?? null;
    const wd = qid ? wdFilms.get(qid)! : null;
    const label = wd ? (wd.en ?? wd.mul) : null;
    const display = displayTitle({ label, enwiki: wd?.enwiki ?? null, imdbPrimary: title.primaryTitle, imdbOriginal: title.originalTitle }) ?? cleanText(title.primaryTitle)!.slice(0, 300);
    const names = searchableNames(display, [
      { name: title.primaryTitle, kind: "original" as const },
      { name: title.originalTitle, kind: "original" as const },
      { name: wd?.en, kind: "alias" as const },
      { name: wd?.mul, kind: "alias" as const },
      { name: wd?.enwiki ? stripWikipediaQualifier(wd.enwiki) : null, kind: "alias" as const },
      ...[...(qid ? (aliasesOf.get(qid) ?? []) : [])].sort().map((name) => ({ name, kind: "alias" as const })),
    ]);
    const wdDirectors = qid ? (directorsOf.get(qid) ?? []).map((d) => d.name).sort() : [];
    const genres = bySpecificity(qid ? (wdGenreNames.get(qid) ?? []) : []);
    const directors = directorNames(wdDirectors);
    const imdbCast = imdbCastToKeep(
      (principalsOf.get(tconst) ?? []).map(([, nconst]) => imdbPersonKey(nconst)),
      (key) => people.get(key)?.popularity ?? 0,
      options.imdbCast,
    );
    const wikidataCast = dedupe([...(qid ? (wdCastOf.get(qid) ?? []) : [])].map(wdPersonKey)).sort(
      (a, b) => (people.get(b)!.popularity - people.get(a)!.popularity) || a.localeCompare(b),
    );
    const imdbVotes = votes.get(tconst) ?? null;
    films.push({
      imdbId: formatTconst(tconst),
      wikidataId: qid,
      title: display,
      originalTitles: names.filter((n) => n.kind === "original").map((n) => n.name),
      aliases: names.filter((n) => n.kind === "alias").map((n) => n.name),
      year: clampYear((qid ? wdYears.get(qid) : undefined) ?? title.startYear),
      genres: genres.length ? genres : imdbGenreNames(title.genres),
      directors: directors.length ? directors : directorNames((imdbDirectorsOf.get(tconst) ?? []).map(directorName)),
      popularity: wd?.links ?? 0,
      imdbVotes,
      tmdbId: wd && wd.tmdbIds.size ? Math.min(...wd.tmdbIds) : null,
      imdbCast,
      wikidataCast,
      reason,
    });
  }
  films.sort((a, b) => fame(b.imdbVotes, b.popularity) - fame(a.imdbVotes, a.popularity) || a.imdbId.localeCompare(b.imdbId));
  // TMDB ids are unique in the catalog; the best-known film keeps a contested one.
  const tmdbTaken = new Set<number>();
  let tmdbDropped = 0;
  for (const film of films) {
    if (film.tmdbId === null) continue;
    if (tmdbTaken.has(film.tmdbId)) {
      film.tmdbId = null;
      tmdbDropped++;
    } else {
      tmdbTaken.add(film.tmdbId);
    }
  }
  const referenced = new Set(films.flatMap((f) => [...f.imdbCast, ...f.wikidataCast]));
  const snapshotPeople = [...people.values()].filter((p) => referenced.has(p.key)).sort((a, b) => b.popularity - a.popularity || a.key.localeCompare(b.key));

  const count = (predicate: (film: SnapshotFilm) => boolean) => films.filter(predicate).length;
  const castSizes = [...principalsOf.values()].map((list) => list.length).sort((a, b) => a - b);
  const credits = films.reduce((sum, f) => sum + new Set([...f.imdbCast, ...f.wikidataCast]).size, 0);
  const summary = {
    films: films.length,
    byReason: Object.fromEntries((["votes", "sitelinks", "recent", "tv-or-video", "existing"] as const).map((r) => [r, count((f) => f.reason === r)])),
    withWikidata: count((f) => f.wikidataId !== null),
    imdbOnly: count((f) => f.wikidataId === null),
    indian: count((f) => f.wikidataId !== null && indian.has(f.wikidataId)),
    before1950: count((f) => f.year !== null && f.year < 1950),
    withImdbCast: count((f) => f.imdbCast.length > 0),
    imdbCredits: films.reduce((sum, f) => sum + f.imdbCast.length, 0),
    withWikidataCast: count((f) => f.wikidataCast.length > 0),
    withoutCast: count((f) => f.imdbCast.length === 0 && f.wikidataCast.length === 0),
    imdbBilledPerFilm: { median: castSizes[castSizes.length >> 1] ?? 0, max: castSizes[castSizes.length - 1] ?? 0, mean: +(castSizes.reduce((s, n) => s + n, 0) / Math.max(1, castSizes.length)).toFixed(2) },
    searchableNamesPerFilm: +(films.reduce((s, f) => s + 1 + f.originalTitles.length + f.aliases.length, 0) / Math.max(1, films.length)).toFixed(2),
    people: snapshotPeople.length,
    imdbOnlyPeople: snapshotPeople.filter((p) => p.wikidataId === null).length,
    creditsBeforeCap: credits,
    tmdbIdsDropped: tmdbDropped,
    buildSeconds: Math.round((Date.now() - started) / 1000),
  };
  return {
    meta: {
      version: SNAPSHOT_VERSION,
      createdAt: new Date().toISOString(),
      rules: { ...rules, imdbCastAlways: options.imdbCast.always, imdbCastKnown: options.imdbCast.known },
      sources,
      summary,
    },
    films,
    people: snapshotPeople,
  };
}

function clampYear(year: number | null | undefined): number | null {
  return year !== null && year !== undefined && year >= 1870 && year <= 2100 ? year : null;
}

function dedupe(keys: ReadonlyArray<string | null>): string[] {
  return [...new Set(keys.filter((key): key is string => key !== null))];
}

/**
 * Pairs each film with at most one Wikidata item and each item with at most one film. Pairs the
 * catalog already stores win first (so a refresh keeps them), then the item with the most
 * Wikipedia editions, then the film with the most votes. Pure.
 */
export function matchWikidataItems(
  pairs: ReadonlyArray<{ qid: string; tconst: number; links: number; votes: number }>,
  preferred: ReadonlyArray<{ qid: string; tconst: number }> = [],
): Map<number, string> {
  const valid = new Set(pairs.map((p) => `${p.qid}:${p.tconst}`));
  const ordered = [...pairs].sort(
    (a, b) => b.links - a.links || b.votes - a.votes || qidNumber(a.qid) - qidNumber(b.qid) || a.tconst - b.tconst,
  );
  const filmOf = new Map<string, number>();
  const qidOf = new Map<number, string>();
  for (const pair of [...preferred.filter((p) => valid.has(`${p.qid}:${p.tconst}`)), ...ordered]) {
    if (filmOf.has(pair.qid) || qidOf.has(pair.tconst)) continue;
    filmOf.set(pair.qid, pair.tconst);
    qidOf.set(pair.tconst, pair.qid);
  }
  return qidOf;
}
