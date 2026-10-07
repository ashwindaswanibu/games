"use client";

import { useState } from "react";
import type { PuzzleDate } from "@/core/day";
import type { PlayView } from "@/core/view";
import { startGame, submitMove } from "./actions";

export type SessionResult = { ok: true } | { ok: false; message: string };

/**
 * One player's play of one puzzle, as the browser sees it: owns the authoritative `view` and talks
 * to the server. Both the standard game host and full-screen games build on this.
 *
 * `notice` carries platform-level problems (connection, rate limit, the day rolling over); a move
 * the game itself rejects is returned to the caller instead, for the game's UI to show.
 */
export function useGameSession({ gameId, date, initialView }: { gameId: string; date: PuzzleDate; initialView: PlayView | null }) {
  const [view, setView] = useState(initialView);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function start(): Promise<SessionResult> {
    setPending(true);
    setNotice(null);
    try {
      const res = await startGame(gameId, date);
      if (res.ok) {
        setView(res.view);
        return { ok: true };
      }
      setNotice(res.message);
      return { ok: false, message: res.message };
    } catch {
      const message = "Couldn't start the game. Check your connection and try again.";
      setNotice(message);
      return { ok: false, message };
    } finally {
      setPending(false);
    }
  }

  async function move(m: unknown): Promise<SessionResult> {
    if (!view) return { ok: false, message: "Start the game first." };
    setPending(true);
    setNotice(null);
    try {
      const res = await submitMove(gameId, date, view.version, m);
      if (res.ok) {
        setView(res.view);
        return { ok: true };
      }
      if (res.view) setView(res.view);
      // Game-level rejections are shown by the game's UI; platform-level ones through `notice`.
      if (res.reason !== "invalid_move") setNotice(res.message);
      return { ok: false, message: res.message };
    } catch {
      const message = "Couldn't reach the server. Try again.";
      setNotice(message);
      return { ok: false, message };
    } finally {
      setPending(false);
    }
  }

  return { view, pending, notice, start, move };
}
