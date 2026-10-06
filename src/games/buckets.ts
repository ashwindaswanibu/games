import { BUCKET_IDS, type AnyGame, type BucketId } from "@/core/game";

/**
 * Bucket metadata. A bucket is one of the app's worlds (Words, Movies, …): it groups games on the
 * Today page and has its own leaderboard, which is the ordinary `leaderboard()` RPC called with the
 * bucket's live game ids.
 */
export interface Bucket {
  readonly id: BucketId;
  readonly name: string;
  /** One line under the bucket's heading. */
  readonly tagline: string;
  /** Theme color for the bucket's headings and tabs (any CSS color). */
  readonly accent: string;
}

/** In display order. */
export const BUCKETS: readonly Bucket[] = [
  { id: "words", name: "Words", tagline: "Letters, ladders and lists", accent: "#c93a1b" },
  { id: "movies", name: "Movies", tagline: "A daily picture in several reels", accent: "#efa51c" },
  { id: "geography", name: "Geography", tagline: "Maps, borders and distances", accent: "#24917b" },
  { id: "chess", name: "Chess", tagline: "One position a day", accent: "#8a8378" },
];

const byId = new Map(BUCKETS.map((b) => [b.id, b]));

export function getBucket(id: BucketId): Bucket {
  const bucket = byId.get(id);
  if (!bucket) throw new Error(`Unknown bucket "${id}"`);
  return bucket;
}

export function isBucketId(value: unknown): value is BucketId {
  return typeof value === "string" && (BUCKET_IDS as readonly string[]).includes(value);
}

/** The games of one bucket, in the order given. */
export function gamesInBucket<G extends AnyGame>(games: readonly G[], bucket: BucketId): G[] {
  return games.filter((g) => g.bucket === bucket);
}

/** Games grouped by bucket in bucket order. Buckets with no games are left out. */
export function groupByBucket<G extends AnyGame>(games: readonly G[]): { bucket: Bucket; games: G[] }[] {
  return BUCKETS.map((bucket) => ({ bucket, games: gamesInBucket(games, bucket.id) })).filter((g) => g.games.length > 0);
}
