"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { signUp, type FormState } from "../actions";

export function SignupForm() {
  const [state, action] = useActionState<FormState, FormData>(signUp, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      <FormMessage>{state.error}</FormMessage>
      <Field label="Username" name="username" autoComplete="username" autoCapitalize="none" required defaultValue={state.values?.username} error={err.username} hint="How you sign in. Can't be changed." />
      <Field label="Display name" name="displayName" autoComplete="nickname" required defaultValue={state.values?.displayName} error={err.displayName} hint="What friends see on the leaderboard." />
      <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} error={err.password} />
      <Field label="Invite code" name="inviteCode" autoCapitalize="none" required error={err.inviteCode} />
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
    </form>
  );
}
