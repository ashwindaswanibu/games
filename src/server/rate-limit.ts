import "server-only";
import { db } from "./supabase/admin";

/**
 * Per-player request limits for route handlers that do real work on every call. Counted in
 * Postgres (`take_rate_limit`, fixed windows) because the app runs on several serverless
 * instances. Generous for real play (a fast typist's autocomplete, a board's images), tight enough
 * that a looping client can't walk the catalog or hammer the asset route.
 */
export const RATE_LIMITS = {
  /** Catalog autocomplete and scoped searches (films, people, filmography, cast). */
  catalog: { limit: 40, windowSeconds: 10 },
  /** Puzzle images. */
  assets: { limit: 120, windowSeconds: 10 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/** Counts one request by `profileId` in `bucket`; false once the window's limit is used up. */
export async function takeRateLimit(profileId: string, bucket: RateLimitBucket): Promise<boolean> {
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const { data, error } = await db().rpc("take_rate_limit", {
    p_key: `${bucket}:${profileId}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  return data === true;
}
