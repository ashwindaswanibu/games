import "server-only";
import { db } from "./supabase/admin";

/**
 * Request limits, counted in Postgres (`take_rate_limit`, fixed windows) because the app runs on
 * several serverless instances: per player once signed in, per client IP (and in total) for
 * sign-up and sign-in. Generous for real play (a fast typist's autocomplete, a board's images,
 * quick taps), tight enough that a looping client can't walk the catalog, drain image egress,
 * hammer the database, mint accounts or guess a password.
 */
export const RATE_LIMITS = {
  /** Catalog autocomplete and scoped searches (films, people, filmography, cast), per player. */
  catalog: { limit: 20, windowSeconds: 10 },
  /** Puzzle images, per player: a burst big enough to load a full board... */
  assets: { limit: 40, windowSeconds: 10 },
  /** ...and a daily ceiling, so a script can't stream images all day (egress is metered). */
  assetsDaily: { limit: 1000, windowSeconds: 86_400 },
  /** Starting games and submitting moves, per player. */
  moves: { limit: 30, windowSeconds: 10 },
  /** Profile edits (username / display name), per player: room to fix a typo or two, not to cycle names. */
  profileEdits: { limit: 10, windowSeconds: 3_600 },
  /** Password sign-ups per client network (an IPv4 address or an IPv6 /64): a household joining together, not a script. */
  signUpsPerIp: { limit: 5, windowSeconds: 3_600 },
  /** Password sign-ups from everywhere: far above a friends' site's real rate, a ceiling on abuse. */
  signUps: { limit: 50, windowSeconds: 3_600 },
  /**
   * Password sign-ins per client network. Besides slowing guessing, this keeps one client from
   * using up Supabase Auth's own per-IP sign-in limit, which every sign-in through the app shares
   * (they all reach Auth from the server's addresses).
   */
  signIn: { limit: 10, windowSeconds: 300 },
  /** Password sign-ins per username, so guessing one friend's password from many IPs is slow too. */
  signInAccount: { limit: 10, windowSeconds: 900 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/** Counts one request by `subject` (a profile id, a client network, …) in `bucket`; false once the window's limit is used up. */
export async function takeRateLimit(subject: string, bucket: RateLimitBucket): Promise<boolean> {
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const { data, error } = await db().rpc("take_rate_limit", {
    // The table caps keys at 200 characters; subjects are ids, networks or usernames, so this never truncates real ones.
    p_key: `${bucket}:${subject}`.slice(0, 200),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  return data === true;
}

/**
 * Takes one request from each bucket in order and returns the first one that is used up (or null).
 * Later buckets aren't charged once an earlier one refuses, so a per-client limit protects the
 * global one from a single noisy client.
 */
export async function takeRateLimits(checks: readonly { subject: string; bucket: RateLimitBucket }[]): Promise<RateLimitBucket | null> {
  for (const { subject, bucket } of checks) {
    if (!(await takeRateLimit(subject, bucket))) return bucket;
  }
  return null;
}
