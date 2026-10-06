import "server-only";
import { headers } from "next/headers";
import { clientIp } from "./invite";
import { takeRateLimits } from "./rate-limit";

export const TOO_MANY_SIGN_IN_ATTEMPTS = "Too many attempts. Try again in a few minutes.";

/**
 * Counts one password sign-in for this client IP and for `username`, and reports whether it may go
 * ahead. Call it before asking Supabase Auth. The per-username limit holds a guesser who rotates IPs
 * to a handful of tries per quarter hour at any one account through the app; the cost is that they
 * can make a friend wait a few minutes to sign in, which is the better failure.
 */
export async function takeSignInAttempt(username: string): Promise<boolean> {
  const ip = clientIp(await headers());
  const exhausted = await takeRateLimits([
    { subject: `ip:${ip}`, bucket: "signIn" },
    { subject: `user:${username}`, bucket: "signInAccount" },
  ]);
  return exhausted === null;
}
