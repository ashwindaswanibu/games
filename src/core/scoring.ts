/**
 * Every game reports a normalized 0–100 integer score for a finished play. The overall
 * leaderboard is simply the sum of those scores, so a game's normalization decides how much it
 * "weighs" against the others — keep the scales comparable (a great day ≈ 100, a loss = 0).
 */

export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Score must be finite, got ${value}`);
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(value)));
}

export function isValidScore(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_SCORE && (value as number) <= MAX_SCORE;
}

/**
 * Linear interpolation from `best` (→ 100) to `worst` (→ `floor`). Works in either direction,
 * e.g. fewer guesses is better (best < worst) or more points is better (best > worst).
 */
export function linearScore(value: number, best: number, worst: number, floor = 0): number {
  if (best === worst) return MAX_SCORE;
  const t = Math.min(1, Math.max(0, (value - best) / (worst - best)));
  return clampScore(MAX_SCORE - t * (MAX_SCORE - floor));
}

/**
 * Common shape for "solve in N attempts" games: solving on the first attempt is 100, solving on
 * the last allowed attempt is `floor`, and failing is 0.
 */
export function attemptsScore(attempts: number, maxAttempts: number, solved: boolean, floor = 40) {
  return solved ? linearScore(attempts, 1, maxAttempts, floor) : MIN_SCORE;
}
