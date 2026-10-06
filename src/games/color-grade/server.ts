import "server-only";
import { resolveFilm } from "@/games/_movies/server";
import { defineGameServer } from "@/server/game-server";
import { colorGrade } from "./logic";

/**
 * The browser sends only a film id; the server attaches the film's catalog facts (year, genres,
 * directors) so the pure `applyMove` can judge the guess and compute its clues.
 */
export const colorGradeServer = defineGameServer(colorGrade, {
  async resolveMove({ move }, services) {
    if (move.type === "skip") return { ok: true, move };
    const film = await resolveFilm(services, move.filmId);
    return film.ok ? { ok: true, move: { type: "guess", film: film.move } } : film;
  },
});
