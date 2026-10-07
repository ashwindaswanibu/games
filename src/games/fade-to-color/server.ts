import "server-only";
import { resolveFilm } from "@/games/_movies/server";
import { defineGameServer } from "@/server/game-server";
import { fadeToColor } from "./logic";

/**
 * Fade to Color's move resolver: the browser sends only a film id, and the guessed film's title and
 * year (all the state records about it) come from the catalog, never from the browser. Deciding
 * whether the guess is right is left to the pure `applyMove`. A skip, a stop and a pick need no
 * lookup and pass through unchanged (`applyMove` checks a pick against the four in the state).
 */
export const fadeToColorServer = defineGameServer(fadeToColor, {
  async resolveMove({ move }, services) {
    if (move.type === "skip" || move.type === "stop" || move.type === "pick") return { ok: true, move };
    const film = await resolveFilm(services, move.filmId);
    if (!film.ok) return film;
    const { id, title, year } = film.move;
    return { ok: true, move: { type: "guess", film: { id, title, year } } };
  },
});
