import "server-only";
import { db } from "./supabase/admin";

/**
 * Limits for route handlers and server actions that do real work on every call: per player once
 * signed in, per client IP (and in total) for sign-up. Counted in Postgres (`take_rate_limit`,
 * fixed windows) because the app runs on several serverless instances. Generous for real play (a
 * fast typist's autocomplete, a board's images), tight enough that a looping client can't walk the
 * catalog, hammer the asset route or mint accounts.
 */
export const RATE_LIMITS = {
  /** Catalog autocomplete and scoped searches (films, people, filmography, cast). */
  catalog: { limit: 40, windowSeconds: 10 },
  /** Puzzle images. */
  assets: { limit: 120, windowSeconds: 10 },
  /** Profile edits (username / display name): room to fix a typo or two, not to cycle names. */
  profileEdits: { limit: 10, windowSeconds: 60 * 60 },
  /** Password sign-ups from one client IP: a household joining together, not a script. */
  signUpsPerIp: { limit: 5, windowSeconds: 60 * 60 },
  /** Password sign-ups from everywhere: far above a friends' site's real rate, a ceiling on abuse. */
  signUps: { limit: 50, windowSeconds: 60 * 60 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/**
 * Counts one request by `subject` (a profile id; for sign-up, a client IP or "all") in `bucket`;
 * false once the window's limit is used up.
 */
export async function takeRateLimit(subject: string, bucket: RateLimitBucket): Promise<boolean> {
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const { data, error } = await db().rpc("take_rate_limit", {
    p_key: `${bucket}:${subject}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  return data === true;
}

/**
 * Counts one password sign-up from `ip` (null when the platform didn't say; those share a bucket)
 * against both the per-IP and the overall limit. A refusal by the first doesn't use up the second.
 */
export async function takeSignUpAllowance(ip: string | null): Promise<boolean> {
  return (await takeRateLimit(ip ?? "unknown", "signUpsPerIp")) && (await takeRateLimit("all", "signUps"));
}
