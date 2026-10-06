/**
 * How the content pipeline (`scripts/content/movies/frame-by-frame.mts`) turns a film's TMDB
 * backdrops into six frames ordered hardest to easiest. Pure, so the heuristic is unit-tested;
 * the script does the downloading and decoding.
 *
 * The heuristic, in order:
 *
 * 1. **Eligible stills only.** Backdrops tagged with a language usually carry the title or a logo,
 *    which would give the film away, so only language-free ones are used. Stills narrower than
 *    1.3:1 or under 960px wide are dropped (posters and thumbnails, not frames).
 * 2. **No near-duplicates.** Studios upload the same shot at several crops. Stills whose 64-bit
 *    difference hashes are within `DUPLICATE_DISTANCE` bits are one shot; the better-voted is kept.
 * 3. **Easiness** in [0, 1], a weighted sum of:
 *    - *Iconicity* (0.5): the still's TMDB votes, as a percentile among this film's stills. The
 *      most-voted backdrops are the promotional, poster-adjacent shots people remember.
 *    - *Detail* (0.25): grayscale histogram entropy. Busy frames show more of the scene, sets and
 *      people; flat frames (sky, a wall, darkness) show little.
 *    - *Exposure* (0.15): how close mean brightness is to mid-gray. Near-black and blown-out frames
 *      are harder to read.
 *    - *Colourfulness* (0.1): the Hasler–Süsstrunk metric. Distinctive colour is a strong cue.
 * 4. **Spread.** Six stills at evenly spaced easiness quantiles, so the six frames span the film's
 *    range from hardest to easiest rather than bunching, then sorted hardest first.
 */

export const FRAMES_PER_PUZZLE = 6;
export const DUPLICATE_DISTANCE = 10;
export const MIN_ASPECT = 1.3;
export const MIN_WIDTH = 960;
export const WEIGHTS = { iconicity: 0.5, detail: 0.25, exposure: 0.15, colorfulness: 0.1 } as const;

export interface ImageStats {
  /** Grayscale histogram entropy in bits, 0–8. */
  entropy: number;
  /** Mean luma, 0–1. */
  brightness: number;
  /** Hasler–Süsstrunk colourfulness, typically 0–150. */
  colorfulness: number;
}

export interface FrameCandidate {
  /** Stable identifier, e.g. the TMDB file path. */
  key: string;
  width: number;
  height: number;
  /** TMDB `iso_639_1`; null for language-free backdrops. */
  language: string | null;
  voteAverage: number;
  voteCount: number;
  /** 64-bit difference hash as 16 hex digits (see `differenceHash`). */
  hash: string;
  stats: ImageStats;
}

/** Luma per Rec. 601, 0–255. */
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Stats over interleaved 8-bit RGB pixels (a small thumbnail is plenty). */
export function imageStats(rgb: Uint8Array, channels = 3): ImageStats {
  const pixels = Math.floor(rgb.length / channels);
  if (pixels === 0) throw new Error("imageStats needs at least one pixel");
  const histogram = new Array<number>(256).fill(0);
  let lumaSum = 0;
  let rgSum = 0;
  let ybSum = 0;
  let rgSq = 0;
  let ybSq = 0;
  for (let i = 0; i < pixels; i++) {
    const r = rgb[i * channels];
    const g = rgb[i * channels + 1];
    const b = rgb[i * channels + 2];
    const y = luma(r, g, b);
    histogram[Math.min(255, Math.round(y))]++;
    lumaSum += y;
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    rgSum += rg;
    ybSum += yb;
    rgSq += rg * rg;
    ybSq += yb * yb;
  }
  let entropy = 0;
  for (const count of histogram) {
    if (count === 0) continue;
    const p = count / pixels;
    entropy -= p * Math.log2(p);
  }
  const rgMean = rgSum / pixels;
  const ybMean = ybSum / pixels;
  const rgStd = Math.sqrt(Math.max(0, rgSq / pixels - rgMean * rgMean));
  const ybStd = Math.sqrt(Math.max(0, ybSq / pixels - ybMean * ybMean));
  const colorfulness = Math.hypot(rgStd, ybStd) + 0.3 * Math.hypot(rgMean, ybMean);
  return { entropy, brightness: lumaSum / pixels / 255, colorfulness };
}

/**
 * dHash over a 9×8 grayscale thumbnail (72 bytes, row-major): one bit per horizontally adjacent
 * pair, set when the left pixel is brighter. Returns 16 hex digits.
 */
export function differenceHash(gray9x8: Uint8Array): string {
  if (gray9x8.length !== 72) throw new Error(`differenceHash needs a 9×8 grayscale image (72 bytes), got ${gray9x8.length}`);
  let hex = "";
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const left = gray9x8[row * 9 + col];
      const right = gray9x8[row * 9 + col + 1];
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("Hashes must be the same length");
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

/** TMDB's own ranking signal for a still: rating weighted by how many people rated it. */
const voteWeight = (c: FrameCandidate) => c.voteAverage * Math.log1p(c.voteCount);

export function isEligible(c: FrameCandidate): boolean {
  return c.language === null && c.width >= MIN_WIDTH && c.width / c.height >= MIN_ASPECT;
}

/** Drops near-duplicate shots, keeping the better-voted of each (ties: the earlier one). */
export function dedupe(candidates: readonly FrameCandidate[]): FrameCandidate[] {
  const byVotes = [...candidates].sort((a, b) => voteWeight(b) - voteWeight(a));
  const kept: FrameCandidate[] = [];
  for (const c of byVotes) {
    if (!kept.some((k) => hammingDistance(k.hash, c.hash) <= DUPLICATE_DISTANCE)) kept.push(c);
  }
  return kept;
}

/** Fraction of `values` strictly below each value, ties counted half (0–1). */
function percentiles(values: readonly number[]): number[] {
  if (values.length === 1) return [0.5];
  return values.map((v) => {
    const below = values.filter((o) => o < v).length;
    const equal = values.filter((o) => o === v).length - 1;
    return (below + equal / 2) / (values.length - 1);
  });
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Easiness of each candidate (same order), per the module comment. */
export function easiness(candidates: readonly FrameCandidate[]): number[] {
  const iconicity = percentiles(candidates.map(voteWeight));
  return candidates.map((c, i) => {
    const detail = clamp01(c.stats.entropy / 8);
    const exposure = clamp01(1 - Math.abs(c.stats.brightness - 0.5) * 2);
    const color = clamp01(c.stats.colorfulness / 150);
    return WEIGHTS.iconicity * iconicity[i] + WEIGHTS.detail * detail + WEIGHTS.exposure * exposure + WEIGHTS.colorfulness * color;
  });
}

/**
 * The six frames for a puzzle, hardest first, or null when the film doesn't have six distinct
 * eligible stills (the pipeline then moves on to another film).
 */
export function orderFrames(candidates: readonly FrameCandidate[]): FrameCandidate[] | null {
  const pool = dedupe(candidates.filter(isEligible));
  if (pool.length < FRAMES_PER_PUZZLE) return null;
  const scores = easiness(pool);
  const ranked = pool.map((c, i) => ({ c, score: scores[i] })).sort((a, b) => a.score - b.score || a.c.key.localeCompare(b.c.key));
  const last = ranked.length - 1;
  const picks = Array.from({ length: FRAMES_PER_PUZZLE }, (_, i) => ranked[Math.round((i * last) / (FRAMES_PER_PUZZLE - 1))]);
  return picks.map((p) => p.c);
}
