import "server-only";
import { getCurrentProfile } from "./auth";
import type { ProfileRow } from "./database.types";
import { RATE_LIMITS, takeRateLimits, type RateLimitBucket } from "./rate-limit";

type ErrorStatus = 400 | 401 | 404 | 429 | 500;

/** JSON error bodies for route handlers: `{ error }`, never cached. */
export function jsonError(status: ErrorStatus, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export type GuardResult = { ok: true; profile: ProfileRow } | { ok: false; response: Response };

/**
 * The start of every route handler that serves player data: the caller must be signed in (401),
 * may be refused outright by `allowed` (404, so the route's existence isn't confirmed), and is held
 * to each of the buckets' rate limits, in order (429 with Retry-After).
 */
export async function guardRequest(options: {
  buckets: readonly [RateLimitBucket, ...RateLimitBucket[]];
  signedOutMessage: string;
  allowed?: (profile: ProfileRow) => boolean;
}): Promise<GuardResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, response: jsonError(401, options.signedOutMessage) };
  if (options.allowed && !options.allowed(profile)) return { ok: false, response: jsonError(404, "Not found.") };
  const exhausted = await takeRateLimits(options.buckets.map((bucket) => ({ subject: profile.id, bucket })));
  if (exhausted) {
    const retryAfter = String(RATE_LIMITS[exhausted].windowSeconds);
    return { ok: false, response: jsonError(429, "Too many requests. Wait a few seconds and try again.", { "Retry-After": retryAfter }) };
  }
  return { ok: true, profile };
}
