"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { completeOnboarding, type FormState } from "../(auth)/actions";

export function OnboardingForm({ suggestedName }: { suggestedName: string }) {
  const [state, action] = useActionState<FormState, FormData>(completeOnboarding, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      <FormMessage>{state.error}</FormMessage>
      <Field label="Username" name="username" autoCapitalize="none" required defaultValue={state.values?.username} error={err.username} hint="Your handle on the leaderboard. Can't be changed." />
      <Field label="Display name" name="displayName" required defaultValue={state.values?.displayName ?? suggestedName} error={err.displayName} />
      <Field label="Invite code" name="inviteCode" autoCapitalize="none" required error={err.inviteCode} />
      <SubmitButton pendingText="Saving…">Let&apos;s play</SubmitButton>
    </form>
  );
}
