/**
 * Checks the movie catalog's id contract, read-only (see lib/catalog-check.mts):
 *
 *   npm run content:movies:catalog-check                                   references only
 *   npm run content:movies:catalog-check -- --baseline <ids.json>          also: no id changed since the baseline
 *   npm run content:movies:catalog-check -- --allow-remote                 against the hosted database (owner only)
 *
 * Every catalog id a stored puzzle, solution or play references must exist, and every link of a
 * stored Degrees solution must still be a credit. With `--baseline` (the file
 * `content:movies:catalog` saves before it writes, under `<cache-dir>/baselines/`), every film and
 * person in it must still exist with the same non-empty Wikidata, IMDb and TMDB ids.
 * Exits 1 when any check fails.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runCatalogChecks, type IdBaseline } from "./lib/catalog-check.mjs";
import { pipelineDb } from "./lib/pipeline.mjs";

const { values: args } = parseArgs({
  options: {
    baseline: { type: "string" },
    "allow-remote": { type: "boolean", default: false },
  },
  strict: true,
});

const baselineSchema = z.object({
  takenAt: z.string(),
  films: z.array(z.object({ id: z.number().int(), wikidataId: z.string().nullable(), imdbId: z.string().nullable(), tmdbId: z.number().int().nullable() })),
  people: z.array(z.object({ id: z.number().int(), wikidataId: z.string().nullable(), imdbId: z.string().nullable() })),
});

async function main() {
  // Read-only, but a hosted database is still the owner's call.
  const db = pipelineDb({ allowRemote: args["allow-remote"] });
  const baseline: IdBaseline | undefined = args.baseline ? baselineSchema.parse(JSON.parse(await readFile(args.baseline, "utf8"))) : undefined;
  const report = await runCatalogChecks(db, { baseline });
  for (const note of report.notes) console.log(`· ${note}`);
  for (const problem of report.problems) console.error(`✗ ${problem}`);
  console.log(report.problems.length ? `\n${report.problems.length} problem(s)` : "\n✓ The catalog id contract holds.");
  if (report.problems.length) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
