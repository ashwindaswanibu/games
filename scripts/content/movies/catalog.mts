/**
 * Movie catalog import: IMDb's non-commercial datasets + Wikidata → movie_films, movie_people,
 * movie_credits and movie_film_titles.
 *
 *   npm run content:movies:catalog                                build a snapshot and apply it locally
 *   npm run content:movies:catalog -- --dry-run                   build, then print what would change
 *   npm run content:movies:catalog -- --build-only                build the snapshot only
 *   npm run content:movies:catalog -- --apply-only                apply the last snapshot (no downloads)
 *   npm run content:movies:catalog -- --build-only --allow-remote-read   build against the hosted catalog (read-only)
 *   npm run content:movies:catalog -- --apply-only --dry-run --allow-remote-read   what applying it would change there
 *   npm run content:movies:catalog -- --apply-only --allow-remote apply it to the hosted database (owner only)
 *
 * Two steps (see scripts/content/movies/README.md, section 1):
 *  1. **Build** (no database writes): download IMDb's files when IMDb has newer ones, read
 *     Wikidata in bulk through QLever, select the films, join everything into a snapshot under
 *     `--snapshot` (default `<cache-dir>/snapshot`). It reads the target's film ids so films
 *     already in the catalog are refreshed even when no rule selects them any more.
 *  2. **Apply**: plan every write against the target's rows and write in small batches. Existing
 *     films and people keep their ids (stored puzzles and plays reference them); nothing is
 *     deleted except credits no source lists any more (never one a stored Degrees chain uses).
 *     The id contract is checked afterwards (`catalog-check`) and a failure exits non-zero.
 *
 * A non-local database (the hosted one) is refused unless the run passes `--allow-remote-read`
 * (only with `--build-only` or `--dry-run`: the client refuses every write) or `--allow-remote`
 * (writes; the owner's call). The rollout order is in design/catalog-rollout.md.
 */
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { applySnapshot } from "./lib/catalog-apply.mjs";
import { buildSnapshot } from "./lib/catalog-build.mjs";
import { DEFAULT_IMDB_CAST, DEFAULT_RULES, type SelectionRules } from "./lib/catalog-model.mjs";
import { readSnapshot, writeSnapshot } from "./lib/catalog-snapshot.mjs";
import { pipelineDb, positiveInt, selectAllById } from "./lib/pipeline.mjs";

const { values: args } = parseArgs({
  options: {
    "min-votes": { type: "string", default: String(DEFAULT_RULES.minVotes) },
    "min-sitelinks": { type: "string", default: String(DEFAULT_RULES.minSitelinks) },
    "recent-min-votes": { type: "string", default: String(DEFAULT_RULES.recentMinVotes) },
    "extra-min-votes": { type: "string", default: String(DEFAULT_RULES.extraMinVotes) },
    "imdb-cast": { type: "string", default: String(DEFAULT_IMDB_CAST.always) },
    "imdb-cast-known": { type: "string", default: String(DEFAULT_IMDB_CAST.known) },
    "cache-dir": { type: "string", default: "content/movies/catalog-cache" },
    snapshot: { type: "string" },
    "build-only": { type: "boolean", default: false },
    "apply-only": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
    "allow-mass-removal": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
    "allow-remote-read": { type: "boolean", default: false },
  },
  strict: true,
});

const log = (message: string) => console.log(message);

async function main() {
  if (args["build-only"] && args["apply-only"]) throw new Error("--build-only and --apply-only exclude each other");
  const cacheDir = resolve(args["cache-dir"]);
  const snapshotDir = resolve(args.snapshot ?? join(cacheDir, "snapshot"));
  const rules: SelectionRules = {
    ...DEFAULT_RULES,
    minVotes: positiveInt(args["min-votes"], "min-votes", { max: 10_000_000 }),
    minSitelinks: positiveInt(args["min-sitelinks"], "min-sitelinks", { max: 400 }),
    recentMinVotes: positiveInt(args["recent-min-votes"], "recent-min-votes", { max: 10_000_000 }),
    extraMinVotes: positiveInt(args["extra-min-votes"], "extra-min-votes", { max: 10_000_000 }),
    currentYear: new Date().getUTCFullYear(),
  };
  const writes = !args["build-only"] && !args["dry-run"];
  if (args["allow-remote-read"] && !args["allow-remote"] && writes) {
    throw new Error("--allow-remote-read only reads: use it with --build-only or --dry-run. Applying to a non-local database needs --allow-remote (owner only).");
  }
  // Refuses a non-local database before minutes of downloads unless a flag allows it; with
  // --allow-remote-read the client refuses every write.
  const db = pipelineDb({ allowRemote: args["allow-remote"], allowRemoteRead: args["allow-remote-read"] });
  const started = Date.now();

  let snapshot;
  if (args["apply-only"]) {
    log(`Reading the snapshot in ${snapshotDir}…`);
    snapshot = await readSnapshot(snapshotDir);
    log(`  built ${snapshot.meta.createdAt}: ${snapshot.films.length} films, ${snapshot.people.length} people`);
  } else {
    const existing = await selectAllById<{ id: number; imdb_id: string | null; wikidata_id: string | null }>((after, limit) =>
      db.from("movie_films").select("id, imdb_id, wikidata_id").gt("id", after).order("id").limit(limit),
    );
    log(`Building the catalog snapshot (votes ≥ ${rules.minVotes} or Wikipedia editions ≥ ${rules.minSitelinks}; ` +
      `recent ≥ ${rules.recentMinVotes}; TV/video ≥ ${rules.extraMinVotes}; plus the ${existing.length} films already stored)…`);
    snapshot = await buildSnapshot({
      cacheDir,
      offline: args.offline,
      rules,
      imdbCast: {
        always: positiveInt(args["imdb-cast"], "imdb-cast", { min: 0, max: 10 }),
        known: positiveInt(args["imdb-cast-known"], "imdb-cast-known", { min: 0, max: 10 }),
      },
      existing: { films: existing.map((f) => ({ imdbId: f.imdb_id, wikidataId: f.wikidata_id })) },
      log,
    });
    await writeSnapshot(snapshotDir, snapshot);
    log(`Snapshot written to ${snapshotDir}:\n${JSON.stringify(snapshot.meta.summary, null, 2)}`);
    if (args["build-only"]) return;
  }

  const report = await applySnapshot(db, snapshot, {
    dryRun: args["dry-run"],
    baselineDir: join(cacheDir, "baselines"),
    allowMassRemoval: args["allow-mass-removal"],
    log,
  });
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  if (args["dry-run"]) {
    log(`Dry run: nothing written (${minutes} min).`);
    return;
  }
  for (const note of report.check?.notes ?? []) log(`  · ${note}`);
  for (const warning of report.check?.warnings ?? []) console.warn(`  ! ${warning}`);
  if (report.check?.problems.length) {
    for (const problem of report.check.problems.slice(0, 50)) console.error(`  ✗ ${problem}`);
    throw new Error(`The catalog id contract is broken (${report.check.problems.length} problems). Baseline: ${report.baselinePath}`);
  }
  log(
    `Done in ${minutes} min: films +${report.films.added}, ${report.films.updated} updated (${report.films.retitled} retitled); ` +
      `people +${report.people.added}, ${report.people.updated} updated; titles +${report.titles.added} −${report.titles.removed}; ` +
      `credits ${report.credits.upserted} written, ${report.credits.removed} removed. Every stored id checked: ✓`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
