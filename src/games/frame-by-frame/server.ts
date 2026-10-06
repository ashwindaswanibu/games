import "server-only";
import { resolveFilm } from "@/games/_movies/server";
import { defineGameServer } from "@/server/game-server";
import { frameByFrame } from "./logic";

/**
 * Looks up the guessed film's facts (year, genres, directors) so the pure `applyMove` can judge the
 * guess and compute clues. The browser only ever sends a film id. Skips need no lookup.
 */
export const frameByFrameServer = defineGameServer(frameByFrame, {
  async resolveMove({ move }, services) {
    if (move.type === "skip") return { ok: true, move };
    const film = await resolveFilm(services, move.filmId);
    return film.ok ? { ok: true, move: { type: "guess", film: film.move } } : film;
  },
});
