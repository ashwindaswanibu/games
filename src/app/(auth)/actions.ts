"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { publicEnv } from "@/lib/public-env";
import { displayNameSchema, passwordSchema, usernameSchema } from "@/lib/validation";
import { emailForUsername, getProfile, requireUser } from "@/server/auth";
import { isOpenInvite, redeemInvite, takeInviteAttempt, TOO_MANY_INVITE_ATTEMPTS, type RedeemResult } from "@/server/invite";
import { takeSignInAttempt, TOO_MANY_SIGN_IN_ATTEMPTS } from "@/server/sign-in-limit";
import { db } from "@/server/supabase/admin";
import { sessionClient } from "@/server/supabase/session";

export interface FormState {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  /** Echo of non-secret inputs so the form keeps them after a failed submit. */
  values?: Record<string, string>;
}

const UNIQUE_VIOLATION = "23505";
/** The unique index on `lower(display_name)` (see the display-name migration). */
const DISPLAY_NAME_INDEX = "profiles_display_name_lower_key";
const BAD_INVITE = "That invite code isn't right, or it was already used.";

/** The field a unique violation on `profiles` is about: the display name, or else the username. */
function takenField(error: { message?: string; details?: string }): Partial<Record<string, string>> {
  return `${error.message ?? ""} ${error.details ?? ""}`.includes(DISPLAY_NAME_INDEX)
    ? { displayName: "Someone already uses that display name." }
    : { username: "That username is taken." };
}

/**
 * An auth user that holds `email` but has no profile can't be a player: a sign-up never finishes
 * without a profile (it deletes the auth user if the profile insert fails), so such a user was
 * registered straight through Supabase Auth to squat the username, or is debris from a crash.
 * Remove it so the real player can sign up. Very recent ones are left alone, since they may be a
 * concurrent sign-up that is about to insert its profile. Returns whether one was removed.
 */
const ORPHAN_MIN_AGE_MS = 2 * 60 * 1000;
async function removeOrphanAuthUser(email: string): Promise<boolean> {
  const { data, error } = await db().rpc("orphan_auth_user_for_email", { p_email: email });
  if (error) throw new Error(`Failed to look up auth user: ${error.message}`);
  const orphan = data[0];
  if (!orphan || Date.now() - new Date(orphan.created_at).getTime() < ORPHAN_MIN_AGE_MS) return false;
  const { error: deleteError } = await db().auth.admin.deleteUser(orphan.id);
  if (deleteError) throw new Error(`Failed to remove orphan auth user: ${deleteError.message}`);
  console.warn(`signUp: removed profileless auth user ${orphan.id} holding ${email}`);
  return true;
}

function createPasswordUser(username: string, password: string) {
  // Admin API: creates a confirmed account without sending email (the address is synthetic). It
  // works with public sign-ups disabled in Supabase Auth, which they should be.
  return db().auth.admin.createUser({
    email: emailForUsername(username),
    password,
    email_confirm: true,
    user_metadata: { username },
  });
}

const isEmailExists = (error: { code?: string; status?: number } | null) => error?.code === "email_exists" || error?.status === 422;

function fieldErrors(error: z.ZodError): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const issue of error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

// ---------------------------------------------------------------------------------------------

export async function signInWithPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = usernameSchema.safeParse(text(formData, "username"));
  const password = text(formData, "password");
  const values = { username: text(formData, "username") };
  if (!username.success || !password) return { error: "Wrong username or password.", values };
  if (!(await takeSignInAttempt(username.data))) return { error: TOO_MANY_SIGN_IN_ATTEMPTS, values };

  const supabase = await sessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email: emailForUsername(username.data), password });
  if (error) {
    return { error: error.status === 429 ? "Too many attempts. Try again in a minute." : "Wrong username or password.", values };
  }
  redirect("/");
}

export async function signInWithGoogle(): Promise<void> {
  if (!publicEnv.googleAuthEnabled) redirect("/login?error=google");
  const origin = (await headers()).get("origin");
  if (!origin) throw new Error("Missing Origin header");

  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

// ---------------------------------------------------------------------------------------------

const inviteCodeSchema = z.string().trim().min(1, "Ask an admin for an invite code.").max(64, "That invite code isn't right.");

const signUpSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  inviteCode: inviteCodeSchema,
});

/** The form's answer to a failed `redeemInvite`. */
function redeemFailure(result: Exclude<RedeemResult, { ok: true }>, values: Record<string, string>): FormState {
  if (result.reason === "invalid_invite") return { fieldErrors: { inviteCode: BAD_INVITE }, values };
  return result.error.code === UNIQUE_VIOLATION
    ? { fieldErrors: takenField(result.error), values }
    : { error: "Couldn't create your account. Try again.", values };
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { username: text(formData, "username"), displayName: text(formData, "displayName") };
  const parsed = signUpSchema.safeParse({ ...values, password: text(formData, "password"), inviteCode: text(formData, "inviteCode") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const { username, displayName, password, inviteCode } = parsed.data;

  if (!(await takeInviteAttempt())) return { error: TOO_MANY_INVITE_ATTEMPTS, values };
  if (!(await isOpenInvite(inviteCode))) return { fieldErrors: { inviteCode: BAD_INVITE }, values };

  const { data: taken } = await db().from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) return { fieldErrors: { username: "That username is taken." }, values };

  let { data: created, error: createError } = await createPasswordUser(username, password);
  if (isEmailExists(createError) && (await removeOrphanAuthUser(emailForUsername(username)))) {
    ({ data: created, error: createError } = await createPasswordUser(username, password));
  }
  if (createError || !created.user) {
    return isEmailExists(createError) ? { fieldErrors: { username: "That username is taken." }, values } : { error: "Couldn't create your account. Try again.", values };
  }

  // Spends the invite and creates the profile together; it fails if the invite was used meanwhile.
  const redeemed = await redeemInvite(inviteCode, { id: created.user.id, username, displayName });
  if (!redeemed.ok) {
    // Don't leave an auth user without a profile behind.
    await db().auth.admin.deleteUser(created.user.id);
    return redeemFailure(redeemed, values);
  }
  console.info(`signUp: new player ${created.user.id} (@${username})`);

  const supabase = await sessionClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: emailForUsername(username), password });
  if (signInError) redirect("/login");
  redirect("/");
}

// ---------------------------------------------------------------------------------------------

const onboardingSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  inviteCode: inviteCodeSchema,
});

/** Google users land here after their first sign-in to claim a username. */
export async function completeOnboarding(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (await getProfile(user.id)) redirect("/");

  const values = { username: text(formData, "username"), displayName: text(formData, "displayName") };
  const parsed = onboardingSchema.safeParse({ ...values, inviteCode: text(formData, "inviteCode") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const { username, displayName, inviteCode } = parsed.data;

  if (!(await takeInviteAttempt(user.id))) return { error: TOO_MANY_INVITE_ATTEMPTS, values };

  const redeemed = await redeemInvite(inviteCode, { id: user.id, username, displayName });
  if (!redeemed.ok) return redeemFailure(redeemed, values);
  console.info(`onboarding: new player ${user.id} (@${username})`);
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await sessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}
