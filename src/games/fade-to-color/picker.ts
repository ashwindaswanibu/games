import type { PuzzleDate } from "@/core/day";
import { createRng, type RngSeed } from "@/core/random";
import { sameSeriesProfile, seriesProfile, type SeriesProfile } from "./decoys";

/**
 * Which film is each day's Fade to Color answer: the approved selection logic
 * (`design/barcode-film-selection.md`, approved by the owner 2026-10-06), as pure functions. The
 * pipeline loads the inputs (`scripts/content/movies/lib/film-picker.mts`: the catalog, the films
 * that have frames, the stored puzzles) and passes a seed per day made from the server's secret.
 * Nothing here reads a clock, the network or `Math.random()`, so the same inputs always give the
 * same plan, whether the films are rendered on demand or come from a pre-rendered library.
 *
 * **Fame.** A film's score (0–100) is the higher of its overall popularity percentile and 0.9 × its
 * era percentile (among films released within 2 years of it), so recent hits that haven't built up
 * Wikipedia editions yet aren't buried. A percentile is the share of the reference films at or
 * below the film's popularity. The score is rounded to a whole number, as the tier ranges
 * (60–84, 45–59) are.
 *
 * **Tiers and the daily mix.** Iconic (85+) on 25% of days, Well-known (60–84) on 55%, Known
 * (45–59) on 20%; below 45 never. Each day draws its tier by those weights, then a film within it.
 *
 * **Rules** (each makes a film ineligible for the day):
 * - the film is another day's answer within 365 days either side (`REPEAT_GAP_DAYS`);
 * - a director of the film directed another day's answer within 30 days either side;
 * - the film looks like the same series as another day's answer within 30 days either side
 *   (`sameSeries`, a generous title match: the catalog has no franchise data);
 * - the film is known to be black and white (checked on its frames; unknown films are allowed and
 *   the renderer refuses them if they turn out to be).
 *
 * **Fallback.** If no film in the drawn tier is eligible, the nearest tier with one is used, the
 * more popular one first when two are equally near (Well-known falls back to Iconic, then Known).
 * If no tier has an eligible film the day gets no pick: the rules are never relaxed silently.
 *
 * **Deterministic.** The tier comes from the day's seeded `Rng`; within the tier, each eligible film
 * gets a key from the day's seed and its id, and the lowest key wins. The pick therefore doesn't
 * depend on the order of the inputs, and adding a film to the pool (a bigger catalog, a newly
 * rendered film) only ever changes a day's pick to that film.
 */

// ---------------------------------------------------------------------------------------------
// Constants (the approved values)
// ---------------------------------------------------------------------------------------------

export type TierName = "iconic" | "well-known" | "known";

export interface Tier {
  name: TierName;
  label: string;
  /** Lowest score in the tier. */
  minScore: number;
  /** Share of days that draw this tier. */
  weight: number;
}

/** Most popular first. The weights sum to 1. */
export const TIERS: readonly Tier[] = [
  { name: "iconic", label: "Iconic", minScore: 85, weight: 0.25 },
  { name: "well-known", label: "Well-known", minScore: 60, weight: 0.55 },
  { name: "known", label: "Known", minScore: 45, weight: 0.2 },
];

/** Films scoring below this are never picked. */
export const MIN_SCORE = TIERS[TIERS.length - 1]!.minScore;
/** The era is the films released within this many years of a film, either side. */
export const ERA_YEARS = 2;
/** The era percentile counts for this much of the score. */
export const ERA_WEIGHT = 0.9;
/** A film may be the answer again only this many days after (or before) another day it answers. */
export const REPEAT_GAP_DAYS = 365;
/** No director twice within this many days either side. */
export const DIRECTOR_GAP_DAYS = 30;
/** No series twice within this many days either side. */
export const SERIES_GAP_DAYS = 30;

const TIER_BY_NAME = new Map(TIERS.map((tier) => [tier.name, tier]));

export function tierLabel(name: TierName): string {
  return TIER_BY_NAME.get(name)!.label;
}

/** The tier a score falls in, or null below `MIN_SCORE`. */
export function tierOf(score: number): TierName | null {
  return TIERS.find((tier) => score >= tier.minScore)?.name ?? null;
}

/** The tier a draw in [0, 1) selects, by the tiers' weights. */
export function tierForDraw(draw: number): TierName {
  let upTo = 0;
  for (const tier of TIERS) {
    upTo += tier.weight;
    if (draw < upTo) return tier.name;
  }
  return TIERS[TIERS.length - 1]!.name;
}

/**
 * Where to look when a day's tier has no eligible film: the nearest tiers first, the more popular
 * one first when two are equally near. Iconic → Well-known → Known; Well-known → Iconic → Known;
 * Known → Well-known → Iconic.
 */
export function fallbackOrder(drawn: TierName): TierName[] {
  const at = TIERS.findIndex((tier) => tier.name === drawn);
  return TIERS.map((tier, i) => ({ name: tier.name, distance: Math.abs(i - at), i }))
    .sort((a, b) => a.distance - b.distance || a.i - b.i)
    .map((t) => t.name);
}

// ---------------------------------------------------------------------------------------------
// Fame scores
// ---------------------------------------------------------------------------------------------

/** What a film's score is computed from. */
export interface FameRecord {
  id: number;
  year: number | null;
  /** Wikipedia language editions with an article on the film (`movie_films.popularity`). */
  popularity: number;
}

export interface FilmScore {
  /** 0–100, whole. */
  score: number;
  /** Percentile among all the reference films (0–100, one decimal). */
  overall: number;
  /** Percentile among the reference films within `ERA_YEARS` of it (0–100, one decimal). */
  era: number;
  tier: TierName | null;
}

/** Share (0–100) of `sorted` (ascending) at or below `value`; 0 for an empty list. */
export function percentileAtOrBelow(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return (100 * lo) / sorted.length;
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/**
 * Scores for every reference film with a year: percentiles are computed over exactly these films
 * (which films that should be is the caller's choice; see `scripts/content/movies/lib/film-picker.mts`).
 * Films without a year, or with a popularity that isn't a finite number, are left out.
 */
export function scoreFilms(reference: readonly FameRecord[]): Map<number, FilmScore> {
  const films = reference.filter((f): f is FameRecord & { year: number } => f.year !== null && Number.isFinite(f.popularity));
  const all = films.map((f) => f.popularity).sort((a, b) => a - b);
  const byYear = new Map<number, number[]>();
  for (const f of films) {
    const year = byYear.get(f.year);
    if (year) year.push(f.popularity);
    else byYear.set(f.year, [f.popularity]);
  }
  const eraOf = new Map<number, number[]>();
  for (const year of byYear.keys()) {
    const era: number[] = [];
    for (let y = year - ERA_YEARS; y <= year + ERA_YEARS; y++) era.push(...(byYear.get(y) ?? []));
    eraOf.set(year, era.sort((a, b) => a - b));
  }
  const scores = new Map<number, FilmScore>();
  for (const f of films) {
    const overall = percentileAtOrBelow(all, f.popularity);
    const era = percentileAtOrBelow(eraOf.get(f.year)!, f.popularity);
    const score = Math.round(Math.max(overall, ERA_WEIGHT * era));
    scores.set(f.id, { score, overall: oneDecimal(overall), era: oneDecimal(era), tier: tierOf(score) });
  }
  return scores;
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

/** A film that could be picked. */
export interface PickCandidate {
  id: number;
  title: string;
  year: number | null;
  directors: readonly string[];
  /** From `scoreFilms`. */
  score: number;
  /**
   * true: known to be black and white (never picked). false: known to be in colour. null: not
   * checked yet; allowed, and the renderer refuses it if its frames turn out grey.
   */
  monochrome: boolean | null;
}

/** Another day's answer: a stored puzzle, or a day planned earlier in the same run. */
export interface DayAnswer {
  date: PuzzleDate;
  filmId: number;
  title: string;
  directors: readonly string[];
}

export type Clash =
  | { rule: "repeat"; date: PuzzleDate; title: string }
  | { rule: "director"; date: PuzzleDate; title: string; directors: string[] }
  | { rule: "series"; date: PuzzleDate; title: string };

export type Exclusion = { rule: "too-obscure"; score: number } | { rule: "black-and-white" } | Clash;

const nameKey = (name: string) => name.trim().toLowerCase();
const DAY_MS = 86_400_000;
const dayNumber = (date: PuzzleDate) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

type FilmIdentity = { id: number; title: string; directors: readonly string[] };

/** What the rules compare about a film: its normalised directors and series profile. */
interface FilmTraits {
  directors: string[];
  series: SeriesProfile;
}

/**
 * A pure memo: the same candidate objects are checked against every day of a plan, so their traits
 * are worked out once. Keyed by object, so an edited copy of a film is never confused with it.
 */
const traitsMemo = new WeakMap<object, FilmTraits>();
function traitsOf(film: { title: string; directors: readonly string[] }): FilmTraits {
  let traits = traitsMemo.get(film);
  if (!traits) {
    traits = { directors: film.directors.map(nameKey).filter(Boolean), series: seriesProfile(film.title) };
    traitsMemo.set(film, traits);
  }
  return traits;
}

interface Rules {
  /** Every rule `film` breaks, nearest days first. */
  all(film: FilmIdentity): Clash[];
  /** Whether `film` breaks any rule (the same answer as `all(film).length > 0`, faster). */
  any(film: FilmIdentity): boolean;
}

/**
 * The other days' answers as seen from `date`, indexed once so that many films can be checked
 * against them: the uses of each film within the repeat window, and the answers near enough for the
 * director and series rules.
 */
function rulesAround(date: PuzzleDate, answers: readonly DayAnswer[], repeatGapDays: number): Rules {
  const target = dayNumber(date);
  const nearDays = Math.max(DIRECTOR_GAP_DAYS, SERIES_GAP_DAYS);
  const uses = new Map<number, { answer: DayAnswer; gap: number }[]>();
  const near: { answer: DayAnswer; gap: number; traits: FilmTraits }[] = [];
  for (const answer of answers) {
    if (answer.date === date) continue;
    const gap = Math.abs(dayNumber(answer.date) - target);
    if (gap < repeatGapDays) {
      const list = uses.get(answer.filmId);
      if (list) list.push({ answer, gap });
      else uses.set(answer.filmId, [{ answer, gap }]);
    }
    if (gap <= nearDays) near.push({ answer, gap, traits: traitsOf(answer) });
  }

  /** Calls `found` for each clash in answer order; stops early when it returns true. */
  const scan = (film: FilmIdentity, found: (clash: Clash, gap: number) => boolean | void): void => {
    for (const { answer, gap } of uses.get(film.id) ?? []) if (found({ rule: "repeat", date: answer.date, title: answer.title }, gap)) return;
    if (near.length === 0) return;
    const mine = traitsOf(film);
    for (const { answer, gap, traits } of near) {
      if (answer.filmId === film.id) continue;
      if (gap <= DIRECTOR_GAP_DAYS && mine.directors.some((d) => traits.directors.includes(d))) {
        const shared = answer.directors.filter((d) => mine.directors.includes(nameKey(d)));
        if (found({ rule: "director", date: answer.date, title: answer.title, directors: shared }, gap)) return;
      }
      if (gap <= SERIES_GAP_DAYS && sameSeriesProfile(mine.series, traits.series)) {
        if (found({ rule: "series", date: answer.date, title: answer.title }, gap)) return;
      }
    }
  };

  return {
    all(film) {
      const found: { clash: Clash; gap: number }[] = [];
      scan(film, (clash, gap) => {
        found.push({ clash, gap });
      });
      return found.sort((a, b) => a.gap - b.gap || a.clash.date.localeCompare(b.clash.date)).map((f) => f.clash);
    },
    any(film) {
      let hit = false;
      scan(film, () => (hit = true));
      return hit;
    },
  };
}

/**
 * Every rule `film` breaks on `date` against the other days' answers, nearest days first. An
 * answer stored on `date` itself is ignored: the day is being (re)picked.
 */
export function clashes(film: FilmIdentity, date: PuzzleDate, answers: readonly DayAnswer[], { repeatGapDays = REPEAT_GAP_DAYS }: { repeatGapDays?: number } = {}): Clash[] {
  return rulesAround(date, answers, repeatGapDays).all(film);
}

/** Why `candidate` can't be `date`'s answer, or null if it can. */
export function exclusion(candidate: PickCandidate, date: PuzzleDate, answers: readonly DayAnswer[]): Exclusion | null {
  if (candidate.score < MIN_SCORE) return { rule: "too-obscure", score: candidate.score };
  if (candidate.monochrome === true) return { rule: "black-and-white" };
  return clashes(candidate, date, answers)[0] ?? null;
}

export function describeExclusion(e: Exclusion): string {
  switch (e.rule) {
    case "too-obscure":
      return `scores ${e.score}, below ${MIN_SCORE}`;
    case "black-and-white":
      return "black and white";
    case "repeat":
      return `already the answer on ${e.date}`;
    case "director":
      return `${e.directors.join(" & ")} directed ${e.title} (${e.date})`;
    case "series":
      return `same series as ${e.title} (${e.date})`;
  }
}

// ---------------------------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------------------------

/**
 * A film's key for the day: uniform in [0, 1), from the day's seed and the film's id only. The
 * lowest key among the eligible films wins.
 */
export function filmKey(seed: RngSeed, filmId: number): number {
  // MurmurHash3's finaliser, chained over the four seed words and the id: every bit of each input
  // reaches every bit of the key.
  const mix = (h: number) => {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  let h = mix(seed[0] ^ Math.imul(filmId, 0x9e3779b1));
  h = mix(h ^ seed[1]);
  h = mix(h ^ seed[2] ^ filmId);
  h = mix(h ^ seed[3]);
  return h / 4294967296;
}

export interface DayPick {
  date: PuzzleDate;
  /** Null when no tier has an eligible film (see `why`). */
  film: PickCandidate | null;
  /** The tier the film came from (null with no film). */
  tier: TierName | null;
  /** The tier the day drew. */
  drawn: TierName;
  /** Eligible films in each tier that day. */
  eligible: Record<TierName, number>;
  /** One line: the draw, any fallback, and how many films were eligible. */
  why: string;
}

/** The day's film from `candidates`, given every other day's answer. */
export function pickFilm(date: PuzzleDate, candidates: readonly PickCandidate[], answers: readonly DayAnswer[], seed: RngSeed): DayPick {
  const drawn = tierForDraw(createRng(seed).next());
  const check = rulesAround(date, answers, REPEAT_GAP_DAYS);
  const byTier: Record<TierName, PickCandidate[]> = { iconic: [], "well-known": [], known: [] };
  for (const candidate of candidates) {
    const tier = tierOf(candidate.score);
    // The same test as `exclusion(candidate, date, answers) === null`, with the answers indexed once.
    if (tier && candidate.monochrome !== true && !check.any(candidate)) byTier[tier].push(candidate);
  }
  const eligible = { iconic: byTier.iconic.length, "well-known": byTier["well-known"].length, known: byTier.known.length };
  const drew = `${tierLabel(drawn)} draw`;
  for (const tier of fallbackOrder(drawn)) {
    const films = byTier[tier];
    if (films.length === 0) continue;
    let best = films[0]!;
    let bestKey = filmKey(seed, best.id);
    for (const film of films.slice(1)) {
      const key = filmKey(seed, film.id);
      if (key < bestKey || (key === bestKey && film.id < best.id)) [best, bestKey] = [film, key];
    }
    const of = `1 of ${films.length} eligible`;
    const why = tier === drawn ? `${drew}, ${of}` : `${drew}, none eligible → ${tierLabel(tier)} (fallback), ${of}`;
    return { date, film: best, tier, drawn, eligible, why };
  }
  return { date, film: null, tier: null, drawn, eligible, why: `${drew}: no eligible film in any tier` };
}

export type PlannedDay =
  /** The day already has a puzzle; it's kept as it is. */
  | { date: PuzzleDate; kind: "stored"; answer: DayAnswer }
  /** A film was picked (`pick.film` is set). */
  | { date: PuzzleDate; kind: "picked"; pick: DayPick & { film: PickCandidate; tier: TierName } }
  /** No film could be picked: every tier is exhausted under the rules. */
  | { date: PuzzleDate; kind: "none"; pick: DayPick };

/**
 * Picks `dates` in order. A date that already has an answer in `answers` keeps it. Each new pick
 * joins the answers the later days are checked against, so the plan obeys every rule within itself
 * and against the stored days on either side. `seedFor` must be seeded with the server's secret.
 */
export function planDays(dates: readonly PuzzleDate[], candidates: readonly PickCandidate[], answers: readonly DayAnswer[], seedFor: (date: PuzzleDate) => RngSeed): PlannedDay[] {
  for (let i = 1; i < dates.length; i++) {
    if (dates[i]! <= dates[i - 1]!) throw new Error("planDays needs dates in order, each once");
  }
  const known = [...answers];
  const stored = new Map(answers.map((a) => [a.date as string, a]));
  return dates.map((date): PlannedDay => {
    const answer = stored.get(date);
    if (answer) return { date, kind: "stored", answer };
    const pick = pickFilm(date, candidates, known, seedFor(date));
    if (!pick.film || !pick.tier) return { date, kind: "none", pick };
    known.push({ date, filmId: pick.film.id, title: pick.film.title, directors: pick.film.directors });
    return { date, kind: "picked", pick: { ...pick, film: pick.film, tier: pick.tier } };
  });
}
