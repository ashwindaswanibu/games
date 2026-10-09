import "server-only";
import { FILM_NOT_FOUND, PERSON_NOT_FOUND, toPersonRef } from "@/games/_movies/server";
import { defineGameServer } from "@/server/game-server";
import type { GameServices } from "@/server/game-services";
import { chainPersonIds, currentActor, degrees, hintRefusal, movesLeft, type DegreesHint, type DegreesPuzzle, type DegreesSolution, type DegreesState } from "./logic";

/**
 * Checks a proposed link against the catalog: the current actor and the chosen co-star must both be
 * credited in the chosen film. Finds what a hint shows. It only looks things up; the chain rules
 * live in `applyMove`.
 */
export const degreesServer = defineGameServer(degrees, {
  async resolveMove({ move, puzzle, solution, state }, services) {
    if (move.type === "hint") {
      const refusal = hintRefusal(puzzle, state, move.kind);
      if (refusal) return { ok: false, error: refusal };
      const hint = move.kind === "film" ? wayIn(solution) : await nextLink(puzzle, solution, state, services);
      if (!hint.ok) return hint;
      return { ok: true, move: { type: "hint", hint: hint.hint } };
    }
    if (move.type !== "link") return { ok: true, move };

    const from = currentActor(puzzle, state);
    if (move.personId === from.id) {
      return { ok: false, error: `Pick one of ${from.name}'s co-stars, not ${from.name} again.` };
    }

    const [films, people] = await Promise.all([services.films.get([move.filmId]), services.people.get([move.personId])]);
    const film = films.get(move.filmId);
    // A film search never shows (adult) can't be a link: par is computed without it too.
    if (!film || film.isAdult) return { ok: false, error: FILM_NOT_FOUND };
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

type Found = { ok: true; hint: DegreesHint } | { ok: false; error: string };

/** The way in: the film the stored shortest route reaches the end actor through. */
function wayIn(solution: DegreesSolution): Found {
  return { ok: true, hint: { kind: "film", film: solution.path.at(-1)!.film } };
}

/**
 * The next link from where the player stands: the stored route's own next link while they're on it
 * (so the hint and the reveal agree), else the first link of a shortest route the catalog finds
 * from here, within the moves they'll have left after this hint and never through anyone already
 * in their chain.
 */
async function nextLink(puzzle: DegreesPuzzle, solution: DegreesSolution, state: DegreesState, services: GameServices): Promise<Found> {
  const from = currentActor(puzzle, state);
  const used = chainPersonIds(puzzle, state);
  // The hint itself uses a move.
  const left = movesLeft(puzzle, state) - 1;

  const route = [puzzle.start, ...solution.path.map((link) => link.person)];
  const at = route.findIndex((person) => person.id === from.id);
  const rest = at >= 0 ? solution.path.slice(at) : [];
  if (rest.length > 0 && rest.length <= left && rest.every((link) => !used.includes(link.person.id))) {
    const link = rest[0]!;
    return { ok: true, hint: { kind: "link", fromPersonId: from.id, film: link.film, person: link.person } };
  }

  const step = await services.credits.nextLink(from.id, puzzle.end.id, { avoid: used, maxLinks: left });
  if (!step) {
    return {
      ok: false,
      error: `There's no short way to ${puzzle.end.name} from ${from.name}${left < 3 ? " in the moves you have left" : ""}. Undo a link and ask again from there (this hint didn't use a move).`,
    };
  }
  const [films, people] = await Promise.all([services.films.get([step.filmId]), services.people.get([step.personId])]);
  const film = films.get(step.filmId);
  const person = people.get(step.personId);
  if (!film || !person) return { ok: false, error: "Couldn't find a hint just now. Try again." };
  return {
    ok: true,
    hint: { kind: "link", fromPersonId: from.id, film: { id: film.id, title: film.title, year: film.year }, person: toPersonRef(person) },
  };
}
