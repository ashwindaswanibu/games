"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/form-state";
import { signUp } from "../actions";

export function SignupForm() {
  const [state, action] = useActionState<FormState, FormData>(signUp, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      <FormMessage>{state.error}</FormMessage>
      <Field label="Username" name="username" autoComplete="username" autoCapitalize="none" required defaultValue={state.values?.username} error={err.username} hint="How you sign in. You can change it later." />
      <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} error={err.password} />
      <Field label="Display name (optional)" name="displayName" autoComplete="nickname" defaultValue={state.values?.displayName} error={err.displayName} hint="What friends see on the leaderboard. Defaults to your username." />
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
    </form>
  );
}
