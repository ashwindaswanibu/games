import Link from "next/link";
import type { CSSProperties } from "react";
import type { AnyGame } from "@/core/game";
import type { PlayRow } from "@/server/database.types";

/** One game on the Today screen, showing where the player is with it. */
export function GameCard({ game, play, finishedCount }: { game: AnyGame; play?: PlayRow; finishedCount: number }) {
  const finished = play && play.status !== "in_progress";
  const cta = finished ? "See results" : play ? "Continue" : "Play";

  return (
    <Link
      href={`/play/${game.id}`}
      prefetch={true}
      style={{ "--accent": game.accent } as CSSProperties}
      className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-border bg-surface p-4 transition hover:border-accent active:scale-[0.99]"
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-accent" aria-hidden />
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-2xl" aria-hidden>
        {game.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-semibold">{game.name}</span>
          {game.availability === "testing" && (
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted uppercase">Testing</span>
          )}
        </span>
        <span className="block truncate text-sm text-muted">
          {finished ? `${play.result_label} · ${play.score} pts` : game.tagline}
        </span>
        <span className="block text-xs text-muted">
          {finishedCount === 0 ? "No one has finished yet" : `${finishedCount} finished`}
        </span>
      </span>
      <span
        className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold ${
          finished ? "bg-surface-2 text-muted" : "bg-accent text-black"
        }`}
      >
        {finished ? "✓ " : ""}
        {cta}
      </span>
    </Link>
  );
}
