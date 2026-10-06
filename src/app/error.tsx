"use client";

import { buttonClass } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl" aria-hidden>
        😵
      </p>
      <h1 className="text-xl font-bold">Something broke</h1>
      <p className="text-sm text-muted">It&apos;s not you. Try again in a moment.</p>
      <button type="button" onClick={reset} className={buttonClass("primary")}>
        Try again
      </button>
    </main>
  );
}
