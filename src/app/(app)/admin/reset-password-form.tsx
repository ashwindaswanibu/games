"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { resetPassword, type AdminFormState } from "./actions";

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, action] = useActionState<AdminFormState, FormData>(resetPassword, {});
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex gap-2">
        <input
          name="password"
          type="text"
          autoComplete="off"
          placeholder="New password"
          minLength={8}
          required
          aria-label="New password"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-fg"
        />
        <SubmitButton variant="secondary" className="h-9! px-3!" pendingText="…">
          Reset
        </SubmitButton>
      </div>
      {state.ok && <p className="text-xs text-good">{state.ok}</p>}
      {state.error && <p className="text-xs text-bad">{state.error}</p>}
    </form>
  );
}
