import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./supabase/admin";
import { sessionClient } from "./supabase/session";
import type { ProfileRow } from "./database.types";

/**
 * Username/password accounts are Supabase email accounts under a reserved, undeliverable domain
 * (RFC 2606 `.invalid`), so players only ever see a username. Consequence: there is no
 * "forgot password" email — an admin resets passwords from /admin.
 */
const PASSWORD_ACCOUNT_DOMAIN = "users.daily.invalid";

export function emailForUsername(username: string): string {
  return `${username}@${PASSWORD_ACCOUNT_DOMAIN}`;
}

export function isPasswordAccountEmail(email: string | undefined): boolean {
  return Boolean(email?.endsWith(`@${PASSWORD_ACCOUNT_DOMAIN}`));
}

export interface SessionUser {
  id: string;
  /** The account email (synthetic for username/password accounts). */
  email: string | null;
  /** Name from the identity provider (Google), used to set up a new player's profile. */
  providerName: string | null;
  /**
   * The account's sign-in providers (`app_metadata.providers`: "google", "email"). Set by Supabase
   * Auth, not the user, so it says how the account was really made.
   */
  providers: readonly string[];
}

/** The verified caller, or null. Memoized per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const meta = (data.claims.user_metadata ?? {}) as Record<string, unknown>;
  const name = meta.full_name ?? meta.name;
  const appMeta = (data.claims.app_metadata ?? {}) as Record<string, unknown>;
  const providers = new Set<string>();
  if (typeof appMeta.provider === "string") providers.add(appMeta.provider);
  if (Array.isArray(appMeta.providers)) for (const p of appMeta.providers) if (typeof p === "string") providers.add(p);
  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" && data.claims.email ? data.claims.email : null,
    providerName: typeof name === "string" ? name : null,
    providers: [...providers],
  };
});

export const getProfile = cache(async (userId: string): Promise<ProfileRow | null> => {
  const { data, error } = await db().from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return data;
});

/**
 * For route handlers, which answer with a status code rather than a redirect: the signed-in
 * caller with a profile, or null (respond 401).
 */
export async function getCurrentProfile(): Promise<ProfileRow | null> {
  const user = await getSessionUser();
  return user ? getProfile(user.id) : null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Where a signed-in account without a profile (a first Google sign-in) gets one set up
 * automatically: `src/app/auth/welcome/route.ts`.
 */
export const WELCOME_PATH = "/auth/welcome";

/** A signed-in player with a profile. Use at the top of every app page/action. */
export async function requireProfile(): Promise<ProfileRow> {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  if (!profile) redirect(WELCOME_PATH);
  return profile;
}

export async function requireAdmin(): Promise<ProfileRow> {
  const profile = await requireProfile();
  if (!profile.is_admin) notFound();
  return profile;
}
