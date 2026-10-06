"use server";

import { refresh } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import { today } from "@/core/day";
import type { MoveResponse, PlayView } from "@/core/view";
import { canPlay, getGame } from "@/games/registry";
import { requireProfile } from "@/server/auth";
import { applyMove, startPlay } from "@/server/plays";
import { PuzzleUnavailableError } from "@/server/puzzles";

// Server actions are public POST endpoints: validate every argument, trust nothing.
const argsSchema = z.object({
  gameId: z.string().max(64),
  date: z.string().max(10),
  version: z.number().int().nonnegative(),
});

const DAY_OVER = "A new day has started — refresh for today's puzzles.";

async function authorize(gameId: string) {
  const profile = await requireProfile();
  const game = getGame(gameId);
  if (!game || !canPlay(game, profile.is_admin)) notFound();
  return { profile, game };
}

export type StartResponse = { ok: true; view: PlayView } | { ok: false; message: string };

export async function startGame(gameId: string, date: string): Promise<StartResponse> {
  const args = argsSchema.pick({ gameId: true, date: true }).parse({ gameId, date });
  const { profile, game } = await authorize(args.gameId);
  const current = today();
  if (args.date !== current) return { ok: false, message: DAY_OVER };

  try {
    return { ok: true, view: await startPlay(profile.id, game, current) };
  } catch (error) {
    if (error instanceof PuzzleUnavailableError) return { ok: false, message: "Today's puzzle isn't ready yet. Check back soon." };
    throw error;
  }
}

export async function submitMove(gameId: string, date: string, version: number, move: unknown): Promise<MoveResponse> {
  const args = argsSchema.parse({ gameId, date, version });
  const { profile, game } = await authorize(args.gameId);
  const current = today();
  if (args.date !== current) return { ok: false, reason: "day_over", message: DAY_OVER };

  const response = await applyMove({ userId: profile.id, game, date: current, expectedVersion: args.version, rawMove: move });
  // Finishing unlocks friends' results and changes the Today screen; re-render server parts.
  if (response.ok && response.view.status !== "in_progress") refresh();
  return response;
}
