/**
 * The "game day". Everyone plays the same puzzle on the same day, and the day rolls over at
 * midnight in a single fixed timezone so the leaderboard is fair regardless of where friends are.
 *
 * Dates are carried around as `PuzzleDate` strings ("YYYY-MM-DD") — the same representation
 * Postgres uses for `date` columns — so there is never any ambiguity about which instant a
 * calendar day refers to.
 */

export const TIMEZONE = "America/New_York";

declare const puzzleDateBrand: unique symbol;
export type PuzzleDate = string & { readonly [puzzleDateBrand]: true };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isPuzzleDate(value: string): value is PuzzleDate {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parsePuzzleDate(value: string): PuzzleDate {
  if (!isPuzzleDate(value)) throw new Error(`Invalid puzzle date: ${value}`);
  return value;
}

const zonedPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(instant: Date) {
  const parts: Record<string, number> = {};
  for (const { type, value } of zonedPartsFormatter.formatToParts(instant)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

/** The puzzle date that `instant` falls on in the game timezone. */
export function puzzleDateAt(instant: Date): PuzzleDate {
  const { year, month, day } = zonedParts(instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}` as PuzzleDate;
}

export function today(now: Date = new Date()): PuzzleDate {
  return puzzleDateAt(now);
}

export function addDays(date: PuzzleDate, days: number): PuzzleDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10) as PuzzleDate;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: PuzzleDate, to: PuzzleDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Monday of the week containing `date`. */
export function weekStart(date: PuzzleDate): PuzzleDate {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

/** Milliseconds the game timezone is ahead of UTC at `instant` (negative for the Americas). */
function zoneOffsetMs(instant: Date): number {
  const p = zonedParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant `date` begins in the game timezone. DST-safe. */
export function startOfDay(date: PuzzleDate): Date {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  // First pass guesses using the offset at UTC midnight; the second pass corrects for a DST
  // transition between that guess and the true local midnight.
  const firstGuess = utcMidnight - zoneOffsetMs(new Date(utcMidnight));
  return new Date(utcMidnight - zoneOffsetMs(new Date(firstGuess)));
}

/** The instant the next puzzle unlocks. */
export function nextRollover(now: Date = new Date()): Date {
  return startOfDay(addDays(today(now), 1));
}

/** Human label for a date, e.g. "Mon, Oct 5". */
export function formatPuzzleDate(
  date: PuzzleDate,
  options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" },
): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
