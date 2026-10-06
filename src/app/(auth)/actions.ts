"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrors, formText as text, type FormState } from "@/lib/form-state";
import { publicEnv } from "@/lib/public-env";
import { optionalDisplayNameSchema, passwordSchema, usernameSchema } from "@/lib/validation";
import { emailForUsername } from "@/server/auth";
import { clientIp } from "@/server/client-ip";
import { profileConflict } from "@/server/profiles";
import { takeSignUpAllowance } from "@/server/rate-limit";
import { db } from "@/server/supabase/admin";
import { sessionClient } from "@/server/supabase/session";

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

/** Sign-up is open: a username and password, and optionally a display name (else the username). */
const signUpSchema = z.object({
  username: usernameSchema,
  displayName: optionalDisplayNameSchema,
  password: passwordSchema,
});

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { username: text(formData, "username"), displayName: text(formData, "displayName") };
  const parsed = signUpSchema.safeParse({ ...values, password: text(formData, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const { username, password } = parsed.data;
  const displayName = parsed.data.displayName ?? username;

  // Open sign-up makes a real account (auth user + profile) per call, so it's metered per client
  // IP and overall. Supabase Auth's own per-IP limits don't cover the admin API used below.
  let allowed: boolean;
  try {
    allowed = await takeSignUpAllowance(await clientIp());
  } catch (error) {
    console.error("Sign-up rate limit check failed:", error);
    return { error: "Couldn't create your account. Try again.", values };
  }
  if (!allowed) return { error: "Too many new accounts from here. Try again in an hour.", values };

  const { data: taken, error: takenError } = await db().from("profiles").select("id").eq("username", username).maybeSingle();
  if (takenError) return { error: "Couldn't create your account. Try again.", values };
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
    switch (profileConflict(profileError)) {
      case "username":
        return { fieldErrors: { username: "That username is taken." }, values };
      case "display_name":
        return {
          fieldErrors: {
            displayName: parsed.data.displayName ? "Someone already goes by that name." : `Someone already goes by "${username}". Add a display name.`,
          },
          values,
        };
      default:
        return { error: "Couldn't create your account. Try again.", values };
    }
  }

  const supabase = await sessionClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: emailForUsername(username), password });
  if (signInError) redirect("/login");
  redirect("/");
}

// ---------------------------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  const supabase = await sessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}
