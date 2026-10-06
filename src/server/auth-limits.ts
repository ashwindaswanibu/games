import "server-only";
import { clientNetwork } from "./client-ip";
import { takeRateLimits } from "./rate-limit";

export const TOO_MANY_SIGN_IN_ATTEMPTS = "Too many attempts. Try again in a few minutes.";
export const TOO_MANY_SIGN_UPS = "Too many new accounts from here. Try again in an hour.";

/**
 * Counts one password sign-in for this client network and for `username`, and reports whether it
 * may go ahead. Call it before asking Supabase Auth. The per-username limit holds a guesser who
 * rotates IPs to a handful of tries per quarter hour at any one account through the app; the cost
 * is that they can make a friend wait a few minutes to sign in, which is the better failure.
 */
export async function takeSignInAttempt(username: string): Promise<boolean> {
  const exhausted = await takeRateLimits([
    { subject: `ip:${await clientNetwork()}`, bucket: "signIn" },
    { subject: `user:${username}`, bucket: "signInAccount" },
  ]);
  return exhausted === null;
}

/**
 * Counts one password sign-up for this client network and overall, and reports whether it may go
 * ahead. Sign-up is open and makes a real account (auth user + profile) per call through the admin
 * API, which Supabase Auth's own per-IP limits don't cover. A refusal by the per-network limit
 * doesn't use up the overall one.
 */
export async function takeSignUpAttempt(): Promise<boolean> {
  const exhausted = await takeRateLimits([
    { subject: `ip:${await clientNetwork()}`, bucket: "signUpsPerIp" },
    { subject: "all", bucket: "signUps" },
  ]);
  return exhausted === null;
}
