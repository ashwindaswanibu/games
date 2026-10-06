"use client";

import { useState, type FormEvent } from "react";
import type { GameUiProps } from "@/core/view";
import { numberHunt, remainingRange, type Hint } from "./logic";
import { connectGameUi } from "../game-ui-context";

const HINT_STYLE: Record<Hint, { label: string; className: string }> = {
  higher: { label: "Higher ↑", className: "text-sky-600 dark:text-sky-400" },
  lower: { label: "Lower ↓", className: "text-rose-600 dark:text-rose-400" },
  correct: { label: "Got it!", className: "text-emerald-600 dark:text-emerald-400" },
};

export function NumberHuntUi({ view, submitMove, pending }: GameUiProps<typeof numberHunt>) {
  const { puzzle, state, status, reveal } = view;
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const range = remainingRange(puzzle, state);
  const guessesLeft = puzzle.maxGuesses - state.guesses.length;
  const playing = status === "in_progress";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const guess = Number(input);
    if (!Number.isInteger(guess)) {
      setError("Enter a whole number.");
      return;
    }
    setError(null);
    const result = await submitMove({ guess });
    if (result.ok) setInput("");
    else setError(result.message);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted">
          {playing ? (
            <>
              It&apos;s between <strong className="text-fg">{range.low}</strong> and{" "}
              <strong className="text-fg">{range.high}</strong>
            </>
          ) : status === "won" ? (
            "Nice hunting."
          ) : (
            <>
              The number was <strong className="text-fg">{reveal?.secret}</strong>.
            </>
          )}
        </p>
        <p className="text-sm tabular-nums text-muted">
          {guessesLeft} {guessesLeft === 1 ? "guess" : "guesses"} left
        </p>
      </div>

      <ol className="grid gap-2">
        {Array.from({ length: puzzle.maxGuesses }, (_, i) => {
          const g = state.guesses[i];
          return (
            <li
              key={i}
              className={`flex h-12 items-center justify-between rounded-xl border px-4 tabular-nums transition-colors ${
                g ? "border-border bg-surface" : "border-dashed border-border/70"
              }`}
            >
              <span className="text-lg font-semibold">{g?.value ?? ""}</span>
              {g && <span className={`text-sm font-medium ${HINT_STYLE[g.hint].className}`}>{HINT_STYLE[g.hint].label}</span>}
            </li>
          );
        })}
      </ol>

      {playing && (
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={puzzle.min}
            max={puzzle.max}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`${range.low}–${range.high}`}
            aria-label="Your guess"
            autoFocus
            disabled={pending}
            className="h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 text-lg tabular-nums outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending || input === ""}
            className="h-12 rounded-xl bg-accent px-6 font-semibold text-black transition-opacity disabled:opacity-40"
          >
            Guess
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** What the play page renders for this game; the game host supplies the props. */
export const NumberHuntEntry = connectGameUi(NumberHuntUi);
