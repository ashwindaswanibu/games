import "server-only";
import { FILM_NOT_FOUND, PERSON_NOT_FOUND, toPersonRef } from "@/games/_movies/server";
import { defineGameServer } from "@/server/game-server";
import { currentActor, degrees } from "./logic";

/**
 * Checks a proposed link against the catalog: the current actor and the chosen co-star must both be
 * credited in the chosen film. It only looks things up; the chain rules live in `applyMove`.
 */
export const degreesServer = defineGameServer(degrees, {
  async resolveMove({ move, puzzle, state }, services) {
    if (move.type !== "link") return { ok: true, move };

    const from = currentActor(puzzle, state);
    if (move.personId === from.id) {
      return { ok: false, error: `Pick one of ${from.name}'s co-stars, not ${from.name} again.` };
    }

    const [films, people] = await Promise.all([services.films.get([move.filmId]), services.people.get([move.personId])]);
    const film = films.get(move.filmId);
    if (!film) return { ok: false, error: FILM_NOT_FOUND };
    const person = people.get(move.personId);
    if (!person) return { ok: false, error: PERSON_NOT_FOUND };

    const [fromCredit, coStarCredit] = await Promise.all([
      services.credits.together(from.id, film.id),
      services.credits.together(person.id, film.id),
    ]);
    if (!fromCredit) return { ok: false, error: `${from.name} isn't in the cast of ${film.title}.` };
    if (!coStarCredit) return { ok: false, error: `${person.name} isn't in the cast of ${film.title}.` };

    return {
      ok: true,
      move: {
        type: "link",
        fromPersonId: from.id,
        film: { id: film.id, title: film.title, year: film.year },
        person: toPersonRef(person),
      },
    };
  },
});
