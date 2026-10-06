"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { createInvite, type InviteFormState } from "./actions";

/** Creates a single-use invite and shows its code once, to send to the new player privately. */
export function InviteForm() {
  const [state, action] = useActionState<InviteFormState, FormData>(createInvite, {});
  const [copied, setCopied] = useState(false);

  async function copy(code: string) {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="grid gap-3 px-4 py-3">
      <form action={action} className="flex gap-2">
        <input
          name="note"
          type="text"
          autoComplete="off"
          placeholder="Who is it for?"
          maxLength={40}
          required
          aria-label="Who the invite is for"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-fg"
        />
        <SubmitButton variant="secondary" className="h-9! px-3!" pendingText="…">
          Create invite
        </SubmitButton>
      </form>
      {state.error && <p className="text-xs text-bad">{state.error}</p>}
      {state.code && (
        <div className="grid gap-2 rounded-xl bg-surface-2 p-3">
          <p className="text-xs text-muted">
            Invite for <span className="font-medium text-fg">{state.note}</span>. Send it to them privately; it works once and is shown only now.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-sm select-all">{state.code}</code>
            <button type="button" onClick={() => copy(state.code!)} className="text-xs font-medium text-muted underline underline-offset-4 hover:text-fg">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
