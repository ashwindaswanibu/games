"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import * as z from "zod";
import { today } from "@/core/day";
import type { AnyGame } from "@/core/game";
import type { MoveResponse, PlayView } from "@/core/view";
import { canPlay, getGame } from "@/games/registry";
import { requireProfile, requireUser } from "@/server/auth";
import { applyMove, readPlay, startPlay } from "@/server/plays";
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

/**
 * The caller and the game, plus whether they're within the moves rate limit, and whatever
 * `alongside` reads for them (nothing reaches the caller until the checks pass).
 */
async function authorize<T = undefined>(gameId: string, alongside?: (userId: string, game: AnyGame) => Promise<T>) {
  // The session is checked locally (a signed token), so the profile, the rate limit and anything
  // else the action needs can be read at once.
  const user = await requireUser();
  const known = getGame(gameId);
  const [profile, withinLimit, read] = await Promise.all([requireProfile(), takeRateLimit(user.id, "moves"), known && alongside ? alongside(user.id, known) : undefined]);
  if (!known || !canPlay(known, profile.is_admin)) notFound();
  return { profile, game: known, withinLimit, read };
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
    // on another device). Revalidating re-renders this page's server parts and, unlike refresh(),
    // drops every page the browser loaded ahead (the game's own "back to today" among them).
    revalidatePath("/");
    return { ok: true, view };
  } catch (error) {
    if (error instanceof PuzzleUnavailableError) return { ok: false, message: "Today's puzzle isn't ready yet. Check back soon." };
    throw error;
  }
}

export async function submitMove(gameId: string, date: string, version: number, move: unknown): Promise<MoveResponse> {
  const args = argsSchema.parse({ gameId, date, version });
  const current = today();
  // The play and the puzzle are read with the checks: one round of reads before the move.
  const { profile, game, withinLimit, read } = await authorize(args.gameId, (userId, known) => readPlay(userId, known, current));
  if (!withinLimit) return { ok: false, reason: "rate_limited", message: TOO_FAST };
  if (args.date !== current) return { ok: false, reason: "day_over", message: DAY_OVER };

  const response = await applyMove({ userId: profile.id, game, date: current, expectedVersion: args.version, rawMove: move, read });
  // Finishing unlocks friends' results and changes the Today screen; re-render server parts and
  // drop the loaded-ahead copy of Today (as in startGame). That includes a rejected move that hands
  // back a play finished elsewhere (another tab or device).
  if (response.view && response.view.status !== "in_progress") revalidatePath("/");
  return response;
}
