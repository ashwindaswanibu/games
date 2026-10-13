"use client";

import { useState } from "react";
import type { PuzzleDate } from "@/core/day";
import type { PlayView } from "@/core/view";
import { receiveSealed } from "@/lib/sealed-assets";
import { startGame, submitMove } from "./actions";
import { createPlaySession } from "./session";

export type { SessionResult } from "./session";

/**
 * One player's play of one puzzle, as the browser sees it: owns the authoritative `view` and talks
 * to the server (`createPlaySession`). Both the standard game host and full-screen games build on
 * this.
 *
 * `notice` carries platform-level problems (connection, rate limit, the day rolling over); a move
 * the game itself rejects is returned to the caller instead, for the game's UI to show.
 *
 * With `startingView` (the view a new play starts from, built by the server with the page), Start
 * shows the board at once and the server confirms behind it.
 *
 * Every view's sealed images go to `receiveSealed` as it arrives (during render, before any image
 * asks for them; it's idempotent), and `preload` (the puzzle's images, for the start screen, which
 * has no view yet) starts downloading at once.
 */
export function useGameSession({
  gameId,
  date,
  initialView,
  startingView = null,
  preload = [],
}: {
  gameId: string;
  date: PuzzleDate;
  initialView: PlayView | null;
  startingView?: PlayView | null;
  preload?: string[];
}) {
  const [view, setView] = useState(initialView);
  receiveSealed(view?.sealed ?? { preload, keys: {} });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Made once: the host is keyed by game and date, so neither changes under it.
  const [session] = useState(() =>
    createPlaySession({
      initialView,
      startingView,
      startGame: () => startGame(gameId, date),
      submitMove: (version, move) => submitMove(gameId, date, version, move),
      show(change) {
        if (change.view !== undefined) setView(change.view);
        if (change.pending !== undefined) setPending(change.pending);
        if (change.notice !== undefined) setNotice(change.notice);
      },
    }),
  );

  return { view, pending, notice, start: session.start, move: session.move };
}
