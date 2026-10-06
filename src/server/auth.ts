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
  /** Name from the identity provider (Google), used to prefill onboarding. */
  suggestedName: string | null;
}

/** The verified caller, or null. Memoized per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const meta = (data.claims.user_metadata ?? {}) as Record<string, unknown>;
  const name = meta.full_name ?? meta.name;
  return { id: data.claims.sub, suggestedName: typeof name === "string" ? name : null };
});

export const getProfile = cache(async (userId: string): Promise<ProfileRow | null> => {
  const { data, error } = await db().from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return data;
});

/**
 * For route handlers, which answer with a status code rather than a redirect: the signed-in,
 * onboarded caller, or null (respond 401).
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

/** A signed-in player who has finished onboarding. Use at the top of every app page/action. */
export async function requireProfile(): Promise<ProfileRow> {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  if (!profile) redirect("/onboarding");
  return profile;
}

/**
 * An admin, re-verified with the auth server. Elsewhere the session JWT is checked locally
 * (`getClaims`), which keeps accepting an access token until it expires even after sign-out or a
 * password reset revoked its session; admin powers shouldn't outlive that, so this asks Supabase
 * whether the session is still live.
 */
export async function requireAdmin(): Promise<ProfileRow> {
  const profile = await requireProfile();
  if (!profile.is_admin) notFound();
  const { data, error } = await (await sessionClient()).auth.getUser();
  if (error || data.user?.id !== profile.id) redirect("/login");
  return profile;
}
