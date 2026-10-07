import type { AnyGame } from "@/core/game";
import { fadeToColor } from "./fade-to-color/logic";
import { colorGrade } from "./color-grade/logic";
import { degrees } from "./degrees/logic";
import { frameByFrame } from "./frame-by-frame/logic";
import { numberHunt } from "./number-hunt/logic";

/**
 * Every game the platform knows about, in display order. Adding a game = add its logic here and
 * its UI in `./ui.ts` (a test enforces that the two stay in sync).
 */
export const GAMES: readonly AnyGame[] = [
  numberHunt,
  degrees,
  frameByFrame,
  colorGrade,
  fadeToColor,
];

const byId = new Map(GAMES.map((g) => [g.id, g]));

export function getGame(id: string): AnyGame | undefined {
  return byId.get(id);
}

/** Games that count on leaderboards and appear for everyone. */
export function liveGames(): AnyGame[] {
  return GAMES.filter((g) => g.availability === "live");
}

export function liveGameIds(): string[] {
  return liveGames().map((g) => g.id);
}

/** Games a given player may open: admins also see games still in testing. */
export function visibleGames(isAdmin: boolean): AnyGame[] {
  return isAdmin ? [...GAMES] : liveGames();
}

export function canPlay(game: AnyGame, isAdmin: boolean): boolean {
  return game.availability === "live" || isAdmin;
}
