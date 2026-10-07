/**
 * Real Fade to Color puzzles: renders a film's ten levels from movie-screencaps.com frames and
 * stores them as the day's puzzle.
 *
 *   npm run content:movies:barcode-levels -- --film <catalog id | auto> --date <YYYY-MM-DD | next-free>
 *     --film auto                the film picker chooses the day's film (lib/barcode-plan.mts; needs --date);
 *                                a film refused on its frames is recorded and the day picked again
 *     [--cache-dir <dir>]        the directory copy and gallery verdicts (default content/movies/cache)
 *     [--refresh-directory]      fetch the site's directory even if the copy is less than a day old
 *     [--percentiles pool|catalog]  with --film auto: what fame percentiles are computed over (see plan-barcode.mts)
 *     [--url <gallery>]          the film's movie-screencaps.com gallery (default: found in the site's directory, cached)
 *     [--pace normal|slower|faster]   how fast the strips widen and move to the centre (default normal)
 *     [--width 2400 --height 800]     level size in pixels
 *     [--samples <n>]            frames squeezed into level 1 (default: the width, kept within 1,600–3,000)
 *     [--head 0.05 --tail 0.015] fractions of the film strips never come from: opening titles and
 *                                credits (often over the first scenes) and closing cards. Review the
 *                                first and last strips (--dry-run --out) and raise --head for a film
 *                                whose credits run longer (Barbie: 0.065)
 *     [--quality 88]             WebP quality
 *     [--concurrency 6]          requests in flight (1–6)
 *     [--replace-fixtures]       let the film take a day that holds a DEV FIXTURE nobody has played
 *     [--replace-unplayed]       let the film take a day whose curated puzzle nobody has played
 *     [--allow-repeat]           allow a film that is another day's answer within 365 days
 *     [--allow-same-director]    allow a director who has another answer within 30 days
 *     [--allow-same-series]      allow a film that looks like the same series as an answer within 30 days
 *     [--allow-monochrome]       allow a black-and-white film
 *     [--allow-few-caps]         allow a gallery of one page or under 1,000 caps (a short film)
 *     [--dry-run [--out <dir>]]  render and validate, write nothing to the database; with --out,
 *                                save the levels (level-01.webp …) and levels.json there for review
 *     [--allow-remote]           write to a non-local Supabase (refused otherwise)
 *
 * How the levels are made is in `lib/barcode-levels.mts` (the maths) and `lib/barcode-render.mts`;
 * where frames come from is `lib/screencaps.mts`. Frames are cached in a temp directory during the
 * run and deleted at the end; only the rendered levels are kept.
 *
 * Stored as: ten `puzzle_assets` (kinds `barcode-level-1` … `barcode-level-10`); the public payload
 * holds only level 1 (plus `maxGuesses` and the film's colourfulness), the solution holds the
 * answer, all ten levels and the final pick's four films (the answer and three look-alikes from
 * the catalog: `lib/decoys.mts`). A day that already has a puzzle is never overwritten (only an unplayed
 * DEV FIXTURE with --replace-fixtures, or an unplayed curated puzzle with --replace-unplayed), and a
 * day someone has played is never touched: not by this script, and never by deleting plays by hand.
 *
 * The approved selection rules (design/barcode-film-selection.md) are enforced by
 * `lib/barcode-day.mts`, which the planner (`plan-barcode.mts`) renders through too: no film twice
 * within 365 days, no director or series twice within 30 days either side (series by title,
 * `sameSeries`: the catalog has no franchise data), and no black-and-white film. The first three are
 * checked before any download; the colour check runs on the thumbnails, before the full-quality
 * frames, and its verdict is kept in the cache folder so the picker skips a grey film from then on.
 */
import { parseArgs } from "node:util";
import { tierLabel } from "@/games/fade-to-color/picker";
import { renderBarcodeDay, resolveDay } from "./lib/barcode-day.mjs";
import { DEFAULT_STORY_TRIM, MAX_TRIM, PACE_NAMES, type PaceName } from "./lib/barcode-levels.mjs";
import { pickAndRenderDay } from "./lib/barcode-plan.mjs";
import { DEFAULT_LEVEL_HEIGHT, DEFAULT_LEVEL_WIDTH } from "./lib/barcode-render.mjs";
import { DEFAULT_PERCENTILE_REFERENCE, loadPickerInputs, PERCENTILE_REFERENCES, type PercentileReference } from "./lib/film-picker.mjs";
import { pipelineDb, positiveInt } from "./lib/pipeline.mjs";
import { GalleryVerdicts, loadDirectory } from "./lib/screencaps-cache.mjs";
import { MAX_CONCURRENCY } from "./lib/screencaps.mjs";

const { values: args } = parseArgs({
  options: {
    film: { type: "string" },
    url: { type: "string" },
    date: { type: "string" },
    pace: { type: "string", default: "normal" },
    width: { type: "string", default: String(DEFAULT_LEVEL_WIDTH) },
    height: { type: "string", default: String(DEFAULT_LEVEL_HEIGHT) },
    samples: { type: "string" },
    quality: { type: "string", default: "88" },
    concurrency: { type: "string", default: String(MAX_CONCURRENCY) },
    head: { type: "string", default: String(DEFAULT_STORY_TRIM.head) },
    tail: { type: "string", default: String(DEFAULT_STORY_TRIM.tail) },
    "replace-fixtures": { type: "boolean", default: false },
    "replace-unplayed": { type: "boolean", default: false },
    "allow-repeat": { type: "boolean", default: false },
    "allow-same-director": { type: "boolean", default: false },
    "allow-same-series": { type: "boolean", default: false },
    "allow-monochrome": { type: "boolean", default: false },
    "allow-few-caps": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    out: { type: "string" },
    percentiles: { type: "string", default: DEFAULT_PERCENTILE_REFERENCE },
    "cache-dir": { type: "string" },
    "refresh-directory": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
  },
  strict: true,
});

/** A `--head`/`--tail` fraction. */
function trimArg(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_TRIM) throw new Error(`--${name} must be a fraction of the film from 0 to ${MAX_TRIM}`);
  return n;
}

async function main() {
  const auto = args.film === "auto";
  const pace = args.pace as PaceName;
  if (!PACE_NAMES.includes(pace)) throw new Error(`--pace must be one of ${PACE_NAMES.join(", ")}`);
  const settings = {
    pace,
    width: positiveInt(args.width, "width", { min: 320, max: 4096 }),
    height: positiveInt(args.height, "height", { min: 120, max: 2048 }),
    samples: args.samples === undefined ? undefined : positiveInt(args.samples, "samples", { min: 100, max: 6000 }),
    quality: positiveInt(args.quality, "quality", { min: 40, max: 100 }),
    concurrency: positiveInt(args.concurrency, "concurrency", { min: 1, max: MAX_CONCURRENCY }),
    trim: { head: trimArg(args.head, "head"), tail: trimArg(args.tail, "tail") },
    dryRun: args["dry-run"],
    out: args.out,
    replace: { fixtures: args["replace-fixtures"], unplayed: args["replace-unplayed"] },
  };
  if (args.out && !settings.dryRun) throw new Error("--out is for --dry-run reviews; drop it to store the puzzle");
  if (!args.date && !settings.dryRun) throw new Error("--date YYYY-MM-DD (or next-free) is required, except with --dry-run");

  const db = pipelineDb({ allowRemote: args["allow-remote"] });
  const date = args.date ? await resolveDay(db, args.date, settings.replace) : null;

  if (auto) {
    if (!date) throw new Error("--film auto needs --date (YYYY-MM-DD or next-free): the pick depends on the day");
    const overrides = ["url", "allow-repeat", "allow-same-director", "allow-same-series", "allow-monochrome", "allow-few-caps"] as const;
    const given = overrides.filter((flag) => args[flag]);
    if (given.length > 0) throw new Error(`--film auto follows the selection rules as they are; drop ${given.map((f) => `--${f}`).join(", ")} (or name the film yourself)`);
    const reference = args.percentiles as PercentileReference;
    if (!PERCENTILE_REFERENCES.includes(reference)) throw new Error(`--percentiles must be one of ${PERCENTILE_REFERENCES.join(", ")}`);
    const inputs = await loadPickerInputs(db, { cacheDir: args["cache-dir"], refreshDirectory: args["refresh-directory"], reference });
    const { pick } = await pickAndRenderDay(db, inputs, date, { answers: inputs.answers, excluded: new Set(), settings });
    console.log(`  picked by the planner: ${tierLabel(pick.tier)} · ${pick.why}`);
    return;
  }

  const filmId = positiveInt(args.film, "film");
  // Rendering a hand-picked film still records what its frames show, so the picker learns too.
  const verdicts = new GalleryVerdicts(args["cache-dir"]);
  // The gallery comes from the same cached directory copy the planner uses (one request a day at most).
  const directory = args.url ? undefined : (await loadDirectory({ cacheDir: args["cache-dir"], refresh: args["refresh-directory"] })).entries;
  await renderBarcodeDay(db, {
    ...settings,
    filmId,
    date,
    galleryUrl: args.url,
    directory,
    verdicts,
    allow: {
      repeat: args["allow-repeat"],
      sameDirector: args["allow-same-director"],
      sameSeries: args["allow-same-series"],
      monochrome: args["allow-monochrome"],
      fewCaps: args["allow-few-caps"],
    },
  });
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
