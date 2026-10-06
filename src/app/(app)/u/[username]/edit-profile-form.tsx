"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { FormState } from "@/lib/form-state";
import { editProfile } from "./actions";

export function EditProfileForm({
  username,
  displayName,
  passwordAccount,
}: {
  username: string;
  displayName: string;
  /** Username/password accounts sign in with their username, so changing it changes sign-in. */
  passwordAccount: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(editProfile, {});
  const err = state.fieldErrors ?? {};
  // A failed save opens the panel, so its errors are visible.
  const open = Boolean(state.error || state.fieldErrors);
  return (
    <details open={open || undefined} className="group rounded-2xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Edit profile
        <span aria-hidden className="text-muted transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <form action={action} className="grid gap-4 border-t border-border px-4 pt-4 pb-4">
        <FormMessage>{state.error}</FormMessage>
        <Field
          label="Display name"
          name="displayName"
          autoComplete="nickname"
          required
          maxLength={40}
          defaultValue={state.values?.displayName ?? displayName}
          error={err.displayName}
          hint="What friends see on the leaderboard."
        />
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={20}
          defaultValue={state.values?.username ?? username}
          error={err.username}
          hint={passwordAccount ? "You sign in with this. 3–20 letters, numbers or underscores." : "3–20 letters, numbers or underscores."}
        />
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
      </form>
    </details>
  );
}
