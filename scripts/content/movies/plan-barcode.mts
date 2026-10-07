/**
 * Plans (and renders) the coming Fade to Color days with the approved film picker.
 *
 *   npm run content:movies:plan-barcode -- --from 2026-10-11 --days 60 --dry-run   print the plan, write nothing
 *   npm run content:movies:plan-barcode -- --days 7                                plan and render today + 6 days
 *     [--from <YYYY-MM-DD>]       first day (default: today in New York)
 *     [--days <n>]                how many days (default 30, at most 366)
 *     [--dry-run]                 print the plan only: no downloads, nothing written
 *     [--percentiles pool|catalog]  what fame percentiles are computed over (default pool; see lib/film-picker.mts)
 *     [--cache-dir <dir>]         where the directory copy and gallery verdicts live (default content/movies/cache)
 *     [--refresh-directory]       fetch the movie-screencaps.com directory even if the copy is fresh
 *     [--pace normal|slower|faster] [--concurrency 1–6]   passed to the renderer
 *     [--allow-remote]            use a non-local Supabase (refused otherwise)
 *
 * The plan, one line per day: date, film, year, tier, score and why (the tier drawn, any fallback,
 * how many films were eligible, whether the era lifted the score). A day that already has a puzzle
 * is kept as it is, never replaced, and counts for the rules like any other answer. The picks follow
 * `src/games/fade-to-color/picker.ts`: tiers by weight, no film within 365 days, no director or
 * series (Wikidata's, or titles that look like one) within 30 days either side, no black-and-white film; deterministic for a given database,
 * directory and PUZZLE_SEED_SECRET.
 *
 * Without --dry-run each planned day is rendered and stored in date order through the same code as
 * `barcode-levels.mts` (`lib/barcode-day.mts`), about two minutes and 20 MB of downloads a film. A
 * film the renderer refuses (black and white on its thumbnails, a gallery too short to be a whole
 * film) is recorded in the gallery verdicts and the day is picked again, so the stored days can
 * differ from a dry run's plan (later days may move too). Any other failure stops the run; the days
 * stored so far stay, and rerunning carries on from there.
 */
import { parseArgs } from "node:util";
import { type PuzzleDate } from "@/core/day";
import { planDays, tierLabel, type DayAnswer } from "@/games/fade-to-color/picker";
import { PACE_NAMES, type PaceName } from "./lib/barcode-levels.mjs";
import { formatPlan, pickAndRenderDay, summarizePlan } from "./lib/barcode-plan.mjs";
import { DEFAULT_PERCENTILE_REFERENCE, loadPickerInputs, PERCENTILE_REFERENCES, pickSeed, type PercentileReference } from "./lib/film-picker.mjs";
import { pipelineDb, positiveInt, puzzleDateRange } from "./lib/pipeline.mjs";
import { MAX_CONCURRENCY } from "./lib/screencaps.mjs";

const { values: args } = parseArgs({
  options: {
    from: { type: "string" },
    days: { type: "string", default: "30" },
    "dry-run": { type: "boolean", default: false },
    percentiles: { type: "string", default: DEFAULT_PERCENTILE_REFERENCE },
    "cache-dir": { type: "string" },
    "refresh-directory": { type: "boolean", default: false },
    pace: { type: "string", default: "normal" },
    concurrency: { type: "string", default: String(MAX_CONCURRENCY) },
    "allow-remote": { type: "boolean", default: false },
  },
  strict: true,
});

async function main() {
  const dates = puzzleDateRange(positiveInt(args.days, "days", { min: 1, max: 366 }), args.from);
  const reference = args.percentiles as PercentileReference;
  if (!PERCENTILE_REFERENCES.includes(reference)) throw new Error(`--percentiles must be one of ${PERCENTILE_REFERENCES.join(", ")}`);
  const pace = args.pace as PaceName;
  if (!PACE_NAMES.includes(pace)) throw new Error(`--pace must be one of ${PACE_NAMES.join(", ")}`);
  const concurrency = positiveInt(args.concurrency, "concurrency", { min: 1, max: MAX_CONCURRENCY });
  const dryRun = args["dry-run"];

  const db = pipelineDb({ allowRemote: args["allow-remote"] });
  const inputs = await loadPickerInputs(db, { cacheDir: args["cache-dir"], refreshDirectory: args["refresh-directory"], reference });
  const plan = planDays(dates, inputs.candidates, inputs.answers, pickSeed);

  console.log(`Fade to Color plan: ${dates[0]} to ${dates.at(-1)} (${dates.length} days)${dryRun ? ", dry run" : ""}`);
  console.log("");
  for (const line of formatPlan(plan, inputs)) console.log(line);
  console.log("");
  for (const line of summarizePlan(plan, inputs)) console.log(line);
  if (dryRun) {
    console.log("");
    console.log("✓ dry run: no frames downloaded, no puzzles written (the directory and colour caches may have been refreshed)");
    return;
  }

  console.log("");
  const answers: DayAnswer[] = [...inputs.answers];
  const excluded = new Set<number>();
  const stored: { date: PuzzleDate; title: string; changed: boolean }[] = [];
  try {
    for (const day of plan) {
      if (day.kind === "stored") continue;
      const { pick, refused } = await pickAndRenderDay(db, inputs, day.date, { answers, excluded, settings: { pace, concurrency } });
      answers.push({ date: day.date, filmId: pick.film.id, title: pick.film.title, directors: pick.film.directors, series: pick.film.series });
      const planned = day.kind === "picked" ? day.pick.film.title : "(no film)";
      const changed = planned !== pick.film.title;
      stored.push({ date: day.date, title: pick.film.title, changed });
      if (changed) console.log(`  (the plan had ${planned}${refused.length > 0 ? `; refused: ${refused.map((r) => `${r.film.title} (${r.rule})`).join(", ")}` : ""}; later days may change too)`);
      console.log(`  ${tierLabel(pick.tier)} · ${pick.why}`);
      console.log("");
    }
  } finally {
    console.log(`Stored ${stored.length} day${stored.length === 1 ? "" : "s"}${stored.length > 0 ? `: ${stored.map((s) => `${s.date} ${s.title}${s.changed ? " (re-picked)" : ""}`).join(" · ")}` : ""}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
