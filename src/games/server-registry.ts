import "server-only";
import type { RegisteredGameServer } from "@/server/game-server";
import { fadeToColorServer } from "./fade-to-color/server";
import { degreesServer } from "./degrees/server";
import { frameByFrameServer } from "./frame-by-frame/server";

/**
 * Server modules for games whose moves need server-side lookups (see `src/server/game-server.ts`).
 * A game is listed here exactly when its definition has a `resolvedMoveSchema`; a registry test
 * enforces that the two agree.
 */
export const GAME_SERVERS: readonly RegisteredGameServer[] = [
  degreesServer,
  frameByFrameServer,
  fadeToColorServer,
];

const byId = new Map(GAME_SERVERS.map((s) => [s.gameId, s]));

export function getGameServer(gameId: string): RegisteredGameServer | undefined {
  return byId.get(gameId);
}
