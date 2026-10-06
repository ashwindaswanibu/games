import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { takeRateLimits } from "./rate-limit";
import { db } from "./supabase/admin";

export const TOO_MANY_INVITE_ATTEMPTS = "Too many attempts. Try again in a few minutes.";

/**
 * The caller's IP for rate limiting. On Vercel `x-forwarded-for` is set by the platform (a value
 * sent by the client is overwritten), so its first entry is the real client. Elsewhere it may be
 * spoofable, which is why invite checks also have a global cap.
 */
export function clientIp(h: Pick<Headers, "get">): string {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip")?.trim() || "unknown";
  // IPv6 is at most 45 characters; anything longer isn't an address.
  return ip.slice(0, 64);
}

/**
 * Counts one invite-code check for this caller and reports whether it may go ahead. The invite code
 * is the only thing between the internet and a player account, so guesses are limited per client
 * IP (and per user, for onboarding) and across everyone. Call it before looking the code up.
 */
export async function takeInviteAttempt(userId?: string): Promise<boolean> {
  const ip = clientIp(await headers());
  const exhausted = await takeRateLimits([
    { subject: `ip:${ip}`, bucket: "invite" },
    ...(userId ? [{ subject: `user:${userId}`, bucket: "invite" as const }] : []),
    { subject: "all", bucket: "inviteGlobal" },
  ]);
  return exhausted === null;
}

// ---------------------------------------------------------------------------------------------
// Invite codes
// ---------------------------------------------------------------------------------------------

/**
 * Every account needs its own invite: an admin creates one per new player in /admin, it works once
 * and expires. (A shared code would let any player mint alt accounts to see each day's answers
 * before playing on their main one.) Codes are 20 characters of Crockford's base32 (100 random
 * bits), shown in groups of five; only their SHA-256 is stored.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const CODE_LENGTH = 20;
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);
export const INVITE_TTL_DAYS = 7;

/** A new random invite code, formatted for display (`xxxxx-xxxxx-xxxxx-xxxxx`). */
export function generateInviteCode(): string {
  // 32 divides 256, so taking each byte mod 32 is unbiased.
  const chars = [...randomBytes(CODE_LENGTH)].map((byte) => ALPHABET[byte % ALPHABET.length]);
  return (chars.join("").match(/.{5}/g) ?? []).join("-");
}

/**
 * The canonical form of what a player typed: case, spaces and dashes don't matter, and the letters
 * Crockford's base32 leaves out read as the digits they look like. Null if it can't be a code.
 */
export function normalizeInviteCode(input: string): string | null {
  const code = input
    .toLowerCase()
    .replace(/[\s-]+/g, "")
    .replace(/[il]/g, "1")
    .replace(/o/g, "0");
  return CODE_PATTERN.test(code) ? code : null;
}

export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Stores a new invite and returns its code, which is never stored or shown again. `createdBy` is the
 * admin's id, or null from the command line (`npm run invite`).
 */
export async function createInvite(createdBy: string | null, note: string, now = new Date()): Promise<string> {
  const code = generateInviteCode();
  const { error } = await db()
    .from("invites")
    .insert({
      token_hash: hashInviteCode(normalizeInviteCode(code)!),
      note,
      created_by: createdBy,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
    });
  if (error) throw new Error(`Failed to create invite: ${error.message}`);
  return code;
}

/** Whether `input` is an invite that can still be used (a cheap check before creating anything). */
export async function isOpenInvite(input: string): Promise<boolean> {
  const code = normalizeInviteCode(input);
  if (!code) return false;
  const { data, error } = await db()
    .from("invites")
    .select("id")
    .eq("token_hash", hashInviteCode(code))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`Failed to look up invite: ${error.message}`);
  return data !== null;
}

export type RedeemResult = { ok: true } | { ok: false; reason: "invalid_invite" } | { ok: false; reason: "profile_error"; error: { code?: string; message?: string; details?: string } };

/**
 * Creates the player's profile and spends the invite, atomically (`redeem_invite`): an invite never
 * makes two accounts, even when two sign-ups race with it.
 */
export async function redeemInvite(input: string, profile: { id: string; username: string; displayName: string }): Promise<RedeemResult> {
  const code = normalizeInviteCode(input);
  if (!code) return { ok: false, reason: "invalid_invite" };
  const { data, error } = await db().rpc("redeem_invite", {
    p_token_hash: hashInviteCode(code),
    p_user_id: profile.id,
    p_username: profile.username,
    p_display_name: profile.displayName,
  });
  if (error) return { ok: false, reason: "profile_error", error };
  return data === true ? { ok: true } : { ok: false, reason: "invalid_invite" };
}
