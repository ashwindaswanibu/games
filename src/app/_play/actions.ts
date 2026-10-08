"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import { today } from "@/core/day";
import type { MoveResponse, PlayView } from "@/core/view";
import { canPlay, getGame } from "@/games/registry";
import { requireProfile } from "@/server/auth";
import { applyMove, startPlay } from "@/server/plays";
import { takeRateLimit } from "@/server/rate-limit";
import { PuzzleUnavailableError } from "@/server/puzzles";

// Server actions are public POST endpoints: validate every argument, trust nothing.
const argsSchema = z.object({
  gameId: z.string().max(64),
  date: z.string().max(10),
  version: z.number().int().nonnegative(),
});

const DAY_OVER = "A new day has started — refresh for today's puzzles.";
const TOO_FAST = "Slow down a little and try again.";

/** The caller and the game, plus whether they're within the moves rate limit. */
async function authorize(gameId: string) {
  const profile = await requireProfile();
  const game = getGame(gameId);
  if (!game || !canPlay(game, profile.is_admin)) notFound();
  const withinLimit = await takeRateLimit(profile.id, "moves");
  return { profile, game, withinLimit };
}

export type StartResponse = { ok: true; view: PlayView } | { ok: false; message: string };

export async function startGame(gameId: string, date: string): Promise<StartResponse> {
  const args = argsSchema.pick({ gameId: true, date: true }).parse({ gameId, date });
  const { profile, game, withinLimit } = await authorize(args.gameId);
  if (!withinLimit) return { ok: false, message: TOO_FAST };
  const current = today();
  if (args.date !== current) return { ok: false, message: DAY_OVER };

  try {
    const view = await startPlay(profile.id, game, current);
    // Today's cards change ("Continue", or a result if it was already finished in another tab or
    // on another device): refresh, which also drops the browser's kept copy of Today (staleTimes).
    refresh();
    return { ok: true, view };
  } catch (error) {
    if (error instanceof PuzzleUnavailableError) return { ok: false, message: "Today's puzzle isn't ready yet. Check back soon." };
    throw error;
  }
}

export async function submitMove(gameId: string, date: string, version: number, move: unknown): Promise<MoveResponse> {
  const args = argsSchema.parse({ gameId, date, version });
  const { profile, game, withinLimit } = await authorize(args.gameId);
  if (!withinLimit) return { ok: false, reason: "rate_limited", message: TOO_FAST };
  const current = today();
  if (args.date !== current) return { ok: false, reason: "day_over", message: DAY_OVER };

  const response = await applyMove({ userId: profile.id, game, date: current, expectedVersion: args.version, rawMove: move });
  // Finishing unlocks friends' results and changes the Today screen; re-render server parts. That
  // includes a rejected move that hands back a play finished elsewhere (another tab or device).
  if (response.view && response.view.status !== "in_progress") refresh();
  return response;
}
