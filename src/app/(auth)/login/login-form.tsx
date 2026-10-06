"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/form-state";
import { signInWithPassword } from "../actions";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action] = useActionState<FormState, FormData>(signInWithPassword, { error: initialError });
  return (
    <form action={action} className="grid gap-4">
      <FormMessage>{state.error}</FormMessage>
      <Field label="Username" name="username" autoComplete="username" autoCapitalize="none" required defaultValue={state.values?.username} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
