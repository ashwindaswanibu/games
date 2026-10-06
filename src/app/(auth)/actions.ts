"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { publicEnv } from "@/lib/public-env";
import { displayNameSchema, passwordSchema, usernameSchema } from "@/lib/validation";
import { emailForUsername, getProfile, isValidInviteCode, requireUser } from "@/server/auth";
import { db } from "@/server/supabase/admin";
import { sessionClient } from "@/server/supabase/session";

export interface FormState {
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  /** Echo of non-secret inputs so the form keeps them after a failed submit. */
  values?: Record<string, string>;
}

const UNIQUE_VIOLATION = "23505";

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

const signUpSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  inviteCode: z.string().min(1, "Ask a friend for the invite code."),
});

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { username: text(formData, "username"), displayName: text(formData, "displayName") };
  const parsed = signUpSchema.safeParse({ ...values, password: text(formData, "password"), inviteCode: text(formData, "inviteCode") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const { username, displayName, password, inviteCode } = parsed.data;

  if (!isValidInviteCode(inviteCode)) return { fieldErrors: { inviteCode: "That invite code isn't right." }, values };

  const { data: taken } = await db().from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) return { fieldErrors: { username: "That username is taken." }, values };

  // Admin API: creates a confirmed account without sending email (the address is synthetic).
  const { data: created, error: createError } = await db().auth.admin.createUser({
    email: emailForUsername(username),
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (createError || !created.user) {
    const exists = createError?.code === "email_exists" || createError?.status === 422;
    return exists ? { fieldErrors: { username: "That username is taken." }, values } : { error: "Couldn't create your account. Try again.", values };
  }

  const { error: profileError } = await db()
    .from("profiles")
    .insert({ id: created.user.id, username, display_name: displayName });
  if (profileError) {
    // Don't leave an auth user without a profile behind.
    await db().auth.admin.deleteUser(created.user.id);
    return profileError.code === UNIQUE_VIOLATION
      ? { fieldErrors: { username: "That username is taken." }, values }
      : { error: "Couldn't create your account. Try again.", values };
  }

  const supabase = await sessionClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: emailForUsername(username), password });
  if (signInError) redirect("/login");
  redirect("/");
}

// ---------------------------------------------------------------------------------------------

const onboardingSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  inviteCode: z.string().min(1, "Ask a friend for the invite code."),
});

/** Google users land here after their first sign-in to claim a username. */
export async function completeOnboarding(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (await getProfile(user.id)) redirect("/");

  const values = { username: text(formData, "username"), displayName: text(formData, "displayName") };
  const parsed = onboardingSchema.safeParse({ ...values, inviteCode: text(formData, "inviteCode") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const { username, displayName, inviteCode } = parsed.data;

  if (!isValidInviteCode(inviteCode)) return { fieldErrors: { inviteCode: "That invite code isn't right." }, values };

  const { error } = await db().from("profiles").insert({ id: user.id, username, display_name: displayName });
  if (error) {
    return error.code === UNIQUE_VIOLATION
      ? { fieldErrors: { username: "That username is taken." }, values }
      : { error: "Couldn't save your profile. Try again.", values };
  }
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await sessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}
