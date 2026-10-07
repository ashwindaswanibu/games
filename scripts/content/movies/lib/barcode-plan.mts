/**
 * Picking and rendering Fade to Color days with the film picker: what `plan-barcode.mts` and
 * `barcode-levels.mts --film auto` share. The choice itself is `src/games/fade-to-color/picker.ts`
 * (pure); the inputs come from `film-picker.mts`; a day is rendered by `barcode-day.mts`.
 */
import { daysBetween, type PuzzleDate } from "@/core/day";
import type { RngSeed } from "@/core/random";
import {
  ERA_WEIGHT,
  pickFilm,
  TIERS,
  tierLabel,
  tierOf,
  type DayAnswer,
  type DayPick,
  type PickCandidate,
  type PlannedDay,
  type TierName,
} from "@/games/fade-to-color/picker";
import { sameSeries } from "@/games/fade-to-color/decoys";
import { FilmRefusedError, renderBarcodeDay, type BarcodeDayOptions, type BarcodeDayResult } from "./barcode-day.mjs";
import { pickSeed, type LoadedPickerInputs, type PickerInputs } from "./film-picker.mjs";
import type { ContentDb } from "./pipeline.mjs";
import type { GalleryVerdicts } from "./screencaps-cache.mjs";

/** Films refused in a row for one day (black and white, too short) before giving up on it. */
export const MAX_REFUSALS_PER_DAY = 5;

export type RenderSettings = Omit<BarcodeDayOptions, "filmId" | "date" | "galleryUrl" | "directory" | "verdicts" | "replace" | "allow" | "log" | "warn">;

export interface PickedDay {
  pick: DayPick & { film: PickCandidate; tier: TierName };
  result: BarcodeDayResult;
  /** Films the renderer refused for this day before `pick` (each now has a verdict). */
  refused: { film: PickCandidate; rule: string; message: string }[];
}

export interface PickAndRenderOptions {
  /** Every other day's answer: the stored puzzles, and days stored earlier in the same run. */
  answers: readonly DayAnswer[];
  /** Films refused during this run; refused films are added to it. */
  excluded: Set<number>;
  settings: RenderSettings & { replace?: BarcodeDayOptions["replace"]; dryRun?: boolean; out?: string };
  log?: (message: string) => void;
  /** The day's seed (default `pickSeed`: the server's secret). */
  seedFor?: (date: PuzzleDate) => RngSeed;
  /** The renderer (default `renderBarcodeDay`; tests pass a fake). */
  render?: (db: ContentDb, options: BarcodeDayOptions) => Promise<BarcodeDayResult>;
}

/**
 * Picks `date`'s film and renders it. When the renderer finds the film is black and white or its
 * gallery too short (it records a verdict, so later runs skip the film), the film joins `excluded`
 * and the day is picked again, up to `MAX_REFUSALS_PER_DAY` times. Any other failure stops.
 */
export async function pickAndRenderDay(db: ContentDb, inputs: PickerInputs & { verdicts?: GalleryVerdicts }, date: PuzzleDate, options: PickAndRenderOptions): Promise<PickedDay> {
  const { answers, excluded, settings, log = (m) => console.log(m), seedFor = pickSeed, render = renderBarcodeDay } = options;
  const refused: PickedDay["refused"] = [];
  for (let attempt = 0; attempt <= MAX_REFUSALS_PER_DAY; attempt++) {
    const candidates = inputs.candidates.filter((c) => !excluded.has(c.id));
    const pick = pickFilm(date, candidates, answers, seedFor(date));
    if (!pick.film || !pick.tier) throw new Error(`No film can be ${date}'s answer: ${pick.why}`);
    const pooled = inputs.pool.get(pick.film.id);
    if (!pooled) throw new Error(`${pick.film.title} was picked but has no gallery`);
    log(`◆ ${date}: ${pick.film.title} (${pick.film.year ?? "?"}), ${tierLabel(pick.tier)}, score ${pick.film.score}: ${pick.why}`);
    try {
      const result = await render(db, { ...settings, filmId: pick.film.id, date, galleryUrl: pooled.gallery.url, verdicts: inputs.verdicts, log });
      return { pick: { ...pick, film: pick.film, tier: pick.tier }, result, refused };
    } catch (error) {
      if (!(error instanceof FilmRefusedError) || (error.rule !== "black-and-white" && error.rule !== "too-short")) throw error;
      excluded.add(pick.film.id);
      refused.push({ film: pick.film, rule: error.rule, message: error.message });
      log(`  ↻ refused (${error.rule}): ${error.message}`);
      log(`    picking ${date} again without it`);
    }
  }
  throw new Error(`${MAX_REFUSALS_PER_DAY + 1} films in a row were refused for ${date}; stopping. Look at the verdicts before running again.`);
}

// ---------------------------------------------------------------------------------------------
// Printing a plan
// ---------------------------------------------------------------------------------------------

const pad = (text: string, width: number) => (text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width));

/** How the score came about, when the era lifted it. */
function scoreNote(inputs: PickerInputs, filmId: number): string {
  const score = inputs.pool.get(filmId)?.score;
  if (!score || ERA_WEIGHT * score.era <= score.overall) return "";
  return ` · era-lifted (overall ${score.overall}, era ${score.era} × ${ERA_WEIGHT})`;
}

/** The plan as aligned text lines: date, film, year, tier, score, why. */
export function formatPlan(plan: readonly PlannedDay[], inputs: PickerInputs): string[] {
  const lines = [`${pad("date", 10)}  ${pad("film", 44)}  year  ${pad("tier", 10)}  score  why`];
  for (const day of plan) {
    if (day.kind === "stored") {
      const pooled = inputs.pool.get(day.answer.filmId);
      const tier = pooled ? tierOf(pooled.score.score) : null;
      const year = pooled?.film.year;
      lines.push(
        `${day.date}  ${pad(day.answer.title, 44)}  ${year ?? "    "}  ${pad(tier ? tierLabel(tier) : "-", 10)}  ${pooled ? String(pooled.score.score).padStart(5) : "    -"}  stored puzzle, kept as it is`,
      );
    } else if (day.kind === "picked") {
      const { film, tier, why } = day.pick;
      const colour = film.monochrome === false ? " · colour checked" : "";
      lines.push(`${day.date}  ${pad(film.title, 44)}  ${film.year ?? "    "}  ${pad(tierLabel(tier), 10)}  ${String(film.score).padStart(5)}  ${why}${scoreNote(inputs, film.id)}${colour}`);
    } else {
      lines.push(`${day.date}  ${pad("(no film)", 44)}        ${pad("-", 10)}      -  ${day.pick.why}`);
    }
  }
  return lines;
}

/** The closest two answers share a director, and a series, across stored and planned days. */
function closestPairs(answers: readonly DayAnswer[]) {
  let director: { gap: number; text: string } | null = null;
  let series: { gap: number; text: string } | null = null;
  let repeat: { gap: number; text: string } | null = null;
  const sorted = [...answers].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const [a, b] = [sorted[i]!, sorted[j]!];
      const gap = daysBetween(a.date, b.date);
      const pair = `${a.title} ${a.date}, ${b.title} ${b.date}`;
      if (a.filmId === b.filmId) {
        if (!repeat || gap < repeat.gap) repeat = { gap, text: pair };
        continue;
      }
      const shared = a.directors.filter((d) => b.directors.some((e) => e.trim().toLowerCase() === d.trim().toLowerCase()));
      if (shared.length > 0 && (!director || gap < director.gap)) director = { gap, text: `${shared.join(" & ")}: ${pair}` };
      if (sameSeries(a.title, b.title) && (!series || gap < series.gap)) series = { gap, text: pair };
    }
  }
  return { director, series, repeat };
}

/** Summary lines: the pool, the tier mix against the target, and the closest rule-relevant pairs. */
export function summarizePlan(plan: readonly PlannedDay[], inputs: PickerInputs & Pick<LoadedPickerInputs, "answers" | "catalogSize" | "directory">): string[] {
  const picked = plan.filter((d) => d.kind === "picked");
  const lines: string[] = [];
  const tiersInPool = TIERS.map((t) => `${t.label} ${inputs.candidates.filter((c) => tierOf(c.score) === t.name).length}`).join(", ");
  lines.push(
    `pool: ${inputs.pool.size} catalog films with a gallery (catalog ${inputs.catalogSize} films with a year; directory ${inputs.directory.entries} galleries, ${inputs.directory.fromCache ? "cached" : "fetched"} ${inputs.directory.fetchedAt.toISOString()})`,
  );
  lines.push(`scores: percentiles over the ${inputs.reference === "pool" ? "pool" : "whole catalog"} (${inputs.referenceSize} films); eligible ${inputs.candidates.length}: ${tiersInPool}`);
  if (inputs.tooShort > 0) lines.push(`left out: ${inputs.tooShort} galleries too short to be a whole film (verdicts)`);
  const knownMono = inputs.candidates.filter((c) => c.monochrome === true).length;
  const unchecked = picked.filter((d) => d.pick.film.monochrome === null).length;
  lines.push(`colour: ${knownMono} candidates known black and white (skipped); ${unchecked} of ${picked.length} planned films not checked yet (a grey one is refused at render and the day picked again)`);
  if (picked.length > 0) {
    const share = (name: TierName, key: "tier" | "drawn") => picked.filter((d) => d.pick[key] === name).length;
    lines.push(
      `tiers: ${TIERS.map((t) => `${t.label} ${share(t.name, "tier")} (${((100 * share(t.name, "tier")) / picked.length).toFixed(0)}%, target ${Math.round(t.weight * 100)}%)`).join(" · ")}`,
    );
    const fallbacks = picked.filter((d) => d.pick.tier !== d.pick.drawn).length;
    lines.push(`draws: ${TIERS.map((t) => `${t.label} ${share(t.name, "drawn")}`).join(" · ")}; ${fallbacks} fallback${fallbacks === 1 ? "" : "s"}`);
  }
  const none = plan.filter((d) => d.kind === "none").length;
  if (none > 0) lines.push(`no film: ${none} day${none === 1 ? "" : "s"} (every tier exhausted under the rules)`);

  const answers: DayAnswer[] = [...inputs.answers];
  for (const day of picked) answers.push({ date: day.date, filmId: day.pick.film.id, title: day.pick.film.title, directors: day.pick.film.directors });
  const { director, series, repeat } = closestPairs(answers);
  lines.push(`closest same director: ${director ? `${director.gap} days (${director.text})` : "none"}`);
  lines.push(`closest same series: ${series ? `${series.gap} days (${series.text})` : "none"}`);
  lines.push(`closest repeat: ${repeat ? `${repeat.gap} days (${repeat.text})` : "none"}`);
  return lines;
}
