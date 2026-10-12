/**
 * How well players know the catalog's actors, for Degrees of Separation's start and end actors.
 *
 *   npm run content:movies:fame                       measure every actor Degrees could use, unless measured in the last 30 days
 *   npm run content:movies:fame -- --max-age 0        measure everyone again
 *   npm run content:movies:fame -- --people 12,34     just these people
 *   npm run content:movies:fame -- --dry-run          measure and report, store nothing
 *
 * For each actor who could start or end a puzzle (`eligibleActors`: enough fiction films, enough
 * of them leads): their Wikidata item → its English Wikipedia article (from QLever, a thousand
 * items a query) → the median of the article's daily views over the last 60 days (Wikipedia,
 * fifty articles a request; `lib/fame.mts`) → `movie_person_fame`. The whole catalog takes minutes. An actor without an English article is
 * stored with no views, so the next run knows they were looked at.
 *
 * Ends with how the measured actors spread out, to choose `degrees --min-views` by.
 *
 * A non-local database needs `--allow-remote` to write, or `--allow-remote-read` for a dry run.
 */
import { parseArgs } from "node:util";
import { ACTOR_RULES, eligibleActors } from "./lib/degrees-graph.mjs";
import { loadDegreesCatalog } from "./lib/degrees-catalog.mjs";
import { FAME_DAYS, mergeQueries, viewsByTitle } from "./lib/fame.mjs";
import { chunk, fetchWithRetry, USER_AGENT } from "./lib/http.mjs";
import { parseCsv, qidOf, QLEVER_ENDPOINT } from "./lib/qlever.mjs";
import { pipelineDb, positiveInt, selectAllPages, type ContentDb } from "./lib/pipeline.mjs";

const { values: args } = parseArgs({
  options: {
    "max-age": { type: "string", default: "30" },
    people: { type: "string" },
    pace: { type: "string", default: "300" },
    "dry-run": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
    "allow-remote-read": { type: "boolean", default: false },
  },
  strict: true,
});

/** Items or titles a request: the most both APIs take. */
const BATCH = 50;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function json<T>(url: string, label: string): Promise<T> {
  const response = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }, { label, baseDelayMs: 5000 });
  return (await response.json()) as T;
}

/** People measured within `days` days. */
async function recentlyMeasured(db: ContentDb, days: number): Promise<Set<number>> {
  if (days === 0) return new Set();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await selectAllPages<{ person_id: number }>((from, to) => db.from("movie_person_fame").select("person_id").gte("measured_at", since).order("person_id").range(from, to));
  return new Set(rows.map((row) => row.person_id));
}

async function wikidataIds(db: ContentDb, ids: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const part of chunk(ids, 500)) {
    const { data, error } = await db.from("movie_people").select("id, wikidata_id").in("id", part);
    if (error) throw new Error(`Couldn't read Wikidata ids: ${error.message}`);
    for (const row of data) if (row.wikidata_id) out.set(row.id, row.wikidata_id);
  }
  return out;
}

/** Each title's median daily views: one request, then as many more as Wikipedia's `continue` asks for. */
async function pageviews(titles: readonly string[], pace: number): Promise<Map<string, number>> {
  const base = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=pageviews&pvipdays=${FAME_DAYS}&redirects=1&titles=${titles.map(encodeURIComponent).join("|")}`;
  const parts: NonNullable<Parameters<typeof viewsByTitle>[1]>[] = [];
  let next: Record<string, string> | undefined;
  do {
    const answer = await json<{ query?: Parameters<typeof viewsByTitle>[1]; continue?: Record<string, string> }>(next ? `${base}&${new URLSearchParams(next)}` : base, "wikipedia");
    parts.push(answer.query ?? {});
    next = answer.continue;
    await sleep(pace);
  } while (next && parts.length < 20);
  return viewsByTitle(titles, mergeQueries(parts));
}

/** Each item's English Wikipedia title, from QLever (Wikidata's sitelinks), a thousand items a query. */
async function englishTitlesOf(qids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunk(qids.filter((q) => /^Q\d+$/.test(q)), 1000)) {
    const sparql = `PREFIX schema: <http://schema.org/>
PREFIX wd: <http://www.wikidata.org/entity/>
SELECT ?item ?enwiki WHERE { VALUES ?item { ${part.map((q) => `wd:${q}`).join(" ")} } ?wp schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki }`;
    const response = await fetchWithRetry(
      QLEVER_ENDPOINT,
      { method: "POST", headers: { accept: "text/csv", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ query: sparql }).toString() },
      { label: "qlever enwiki titles", attempts: 4 },
    );
    const [header, ...rows] = parseCsv(await response.text());
    if (header?.[0] !== "item" || header[1] !== "enwiki") throw new Error(`QLever answered without the expected header: ${JSON.stringify(header)}`);
    for (const [uri, title] of rows) {
      const qid = uri ? qidOf(uri) : null;
      if (qid && title) out.set(qid, title);
    }
  }
  return out;
}

async function main() {
  const dryRun = args["dry-run"];
  if (args["allow-remote-read"] && !args["allow-remote"] && !dryRun) {
    throw new Error("--allow-remote-read is for a --dry-run; writing to a non-local database needs --allow-remote (owner only)");
  }
  const maxAge = positiveInt(args["max-age"], "max-age", { min: 0, max: 3650 });
  const pace = positiveInt(args.pace, "pace", { min: 0, max: 60_000 });
  const db = pipelineDb({ allowRemote: args["allow-remote"], allowRemoteRead: args["allow-remote-read"] });

  const { graph, films, people } = await loadDegreesCatalog(db);
  const eligible = eligibleActors(graph, people, films, ACTOR_RULES);
  const asked = args.people?.split(",").map((id) => positiveInt(id.trim(), "people")) ?? null;
  const fresh = asked ? new Set<number>() : await recentlyMeasured(db, maxAge);
  const todo = (asked ?? eligible).filter((id) => !fresh.has(id));
  console.log(`${eligible.length} actors could start or end a puzzle; measuring ${todo.length}${fresh.size ? ` (${fresh.size} measured in the last ${maxAge} days)` : ""}.`);

  const qids = await wikidataIds(db, todo);
  const titles = await englishTitlesOf([...new Set(qids.values())]);
  const titleOf = (id: number) => (qids.has(id) ? (titles.get(qids.get(id)!) ?? null) : null);
  console.log(`${[...todo].filter((id) => titleOf(id) !== null).length} of them have an English Wikipedia article.`);

  const measured: { person_id: number; en_title: string | null; daily_views: number; measured_at: string }[] = [];
  const batches = chunk(todo, BATCH);
  for (const [n, batch] of batches.entries()) {
    const named = [...new Set(batch.map(titleOf).filter((t): t is string => t !== null))];
    const views = named.length ? await pageviews(named, pace) : new Map<string, number>();
    const at = new Date().toISOString();
    for (const id of batch) {
      const title = titleOf(id);
      measured.push({ person_id: id, en_title: title, daily_views: title ? (views.get(title) ?? 0) : 0, measured_at: at });
    }
    if (!dryRun && (measured.length >= 500 || n === batches.length - 1)) {
      const { error } = await db.from("movie_person_fame").upsert(measured.splice(0), { onConflict: "person_id" });
      if (error) throw new Error(`Couldn't store fame: ${error.message}`);
    }
    if ((n + 1) % 20 === 0 || n === batches.length - 1) console.log(`  ${Math.min((n + 1) * BATCH, todo.length)}/${todo.length}`);
  }

  // How the eligible actors spread out, to choose `degrees --min-views` by.
  const all = dryRun
    ? measured.map((row) => row.daily_views)
    : (await selectAllPages<{ daily_views: number }>((from, to) => db.from("movie_person_fame").select("daily_views").order("person_id").range(from, to))).map((r) => r.daily_views);
  const sorted = all.sort((a, b) => b - a);
  const above = (n: number) => sorted.filter((v) => v >= n).length;
  console.log(`\nMeasured: ${sorted.length}. Readers a day → actors with at least that many:`);
  for (const n of [500, 1000, 1500, 2000, 3000, 5000, 10_000]) console.log(`  ${String(n).padStart(6)}: ${above(n)}`);
  if (dryRun) console.log("\nDry run: nothing stored.");
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
