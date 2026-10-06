import "server-only";
import { resolveFilm } from "@/games/_movies/server";
import { defineGameServer } from "@/server/game-server";
import { colorBarcode } from "./logic";

/**
 * Color Barcode's move resolver: the browser sends only a film id, and the guessed film's year,
 * genres and directors (which the clues are computed from) come from the catalog, never from the
 * browser. Deciding whether the guess is right is left to the pure `applyMove`. A skip needs no
 * lookup and passes through unchanged.
 */
export const colorBarcodeServer = defineGameServer(colorBarcode, {
  async resolveMove({ move }, services) {
    if (move.type === "skip") return { ok: true, move };
    const film = await resolveFilm(services, move.filmId);
    return film.ok ? { ok: true, move: { type: "guess", film: film.move } } : film;
  },
});
