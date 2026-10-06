import { z } from "zod";
import { defineGame } from "@/core/game";
import { clampScore } from "@/core/scoring";
import { filmIdSchema, filmRefSchema, personIdSchema, personRefSchema, type PersonRef } from "@/games/_movies/schemas";
import {
  degreesPuzzleSchema,
  degreesSolutionSchema,
  type DegreesLink,
  type DegreesPuzzle,
  type DegreesSolution,
} from "./schema";

/**
 * Degrees of Separation: link today's start actor to the end actor through films they shared, in as
 * few links as possible.
 *
 * A move names a film the current actor (the start, or the last co-star reached) was in and a
 * co-star from it. The server module (`./server.ts`) checks both credits against the catalog and
 * hands `applyMove` the resolved films and people; every rule below is pure.
 *
 * - Undoing the last link is free. Giving up ends the game with 0.
 * - The chain holds at most `par + EXTRA_LINKS` links, so the last allowed link must land on the end
 *   actor; anything else is refused (undo to try another route).
 * - Score: 100 at par, 15 less per extra link, never below 40 for a finished chain.
 */

/** Links allowed beyond par. */
export const EXTRA_LINKS = 4;
export const PAR_SCORE = 100;
export const EXTRA_LINK_PENALTY = 15;
export const MIN_WIN_SCORE = 40;

export type { DegreesLink, DegreesPuzzle, DegreesSolution } from "./schema";

export interface DegreesState {
  /** The chain so far, in order. `links[0]` starts from the puzzle's start actor. */
  links: DegreesLink[];
  gaveUp: boolean;
}

/** What the browser sends: ids only. The server looks up who and what they are. */
export const degreesMoveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("link"), filmId: filmIdSchema, personId: personIdSchema }),
  z.strictObject({ type: z.literal("undo") }),
  z.strictObject({ type: z.literal("give-up") }),
]);
export type DegreesMove = z.infer<typeof degreesMoveSchema>;

/**
 * What `applyMove` receives. A link carries the catalog's film and co-star plus the actor the
 * server checked the credits for, so a link can't attach to a chain that changed underneath it.
 */
export const degreesResolvedMoveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("link"), fromPersonId: personIdSchema, film: filmRefSchema, person: personRefSchema }),
  z.strictObject({ type: z.literal("undo") }),
  z.strictObject({ type: z.literal("give-up") }),
]);
export type DegreesResolvedMove = z.infer<typeof degreesResolvedMoveSchema>;

/** Shown after the play ends: one shortest chain. */
export type DegreesReveal = DegreesSolution;

/** The most links a chain may hold for this puzzle. */
export function maxLinks(puzzle: Pick<DegreesPuzzle, "par">): number {
  return puzzle.par + EXTRA_LINKS;
}

/** The actor the next link starts from. */
export function currentActor(puzzle: DegreesPuzzle, state: DegreesState): PersonRef {
  return state.links.at(-1)?.person ?? puzzle.start;
}

/** Ids of everyone in the chain so far, start included. Nobody may appear twice. */
export function chainPersonIds(puzzle: DegreesPuzzle, state: DegreesState): number[] {
  return [puzzle.start.id, ...state.links.map((link) => link.person.id)];
}

export function hasReachedEnd(puzzle: DegreesPuzzle, state: DegreesState): boolean {
  return state.links.at(-1)?.person.id === puzzle.end.id;
}

/** 100 at par, −15 per extra link, floored at 40. Chains shorter than par (a catalog that gained credits) still get 100. */
export function chainScore(links: number, par: number): number {
  return clampScore(Math.max(MIN_WIN_SCORE, PAR_SCORE - EXTRA_LINK_PENALTY * Math.max(0, links - par)));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const degrees = defineGame<DegreesPuzzle, DegreesSolution, DegreesState, DegreesMove, DegreesReveal, DegreesResolvedMove>({
  id: "degrees",
  name: "Degrees of Separation",
  tagline: "Link two actors through the films they shared",
  rules: [
    "Start from today's first actor. Pick a film they were in, then a co-star from that film.",
    "Keep linking co-stars until you reach the second actor.",
    `Par is the shortest possible chain. You can use up to ${EXTRA_LINKS} links more than par.`,
    "Undo the last link at any time, for free. At par you score 100; each extra link costs 15.",
  ],
  accent: "#e9a31e",
  emoji: "🔗",
  bucket: "movies",
  availability: "testing",

  puzzleSchema: degreesPuzzleSchema,
  solutionSchema: degreesSolutionSchema,
  moveSchema: degreesMoveSchema,
  resolvedMoveSchema: degreesResolvedMoveSchema,

  initialState: () => ({ links: [], gaveUp: false }),

  applyMove({ puzzle, state, move }) {
    if (state.gaveUp || hasReachedEnd(puzzle, state)) return { ok: false, error: "Today's game is already over." };

    switch (move.type) {
      case "undo":
        if (state.links.length === 0) return { ok: false, error: "There's no link to undo yet." };
        return { ok: true, state: { ...state, links: state.links.slice(0, -1) } };

      case "give-up":
        return { ok: true, state: { ...state, gaveUp: true } };

      case "link": {
        const from = currentActor(puzzle, state);
        if (move.fromPersonId !== from.id) {
          return { ok: false, error: "Your chain changed in another tab. Try that link again." };
        }
        if (chainPersonIds(puzzle, state).includes(move.person.id)) {
          return { ok: false, error: `${move.person.name} is already in your chain. Pick someone new.` };
        }
        const limit = maxLinks(puzzle);
        if (state.links.length >= limit) {
          return { ok: false, error: `You've used all ${limit} links. Undo one to try another route.` };
        }
        if (state.links.length === limit - 1 && move.person.id !== puzzle.end.id) {
          return {
            ok: false,
            error: `That's your last link, so it has to reach ${puzzle.end.name}. Undo a link to try another route.`,
          };
        }
        const link: DegreesLink = { film: move.film, person: move.person };
        return { ok: true, state: { ...state, links: [...state.links, link] } };
      }
    }
  },

  outcome({ puzzle, state }) {
    if (hasReachedEnd(puzzle, state)) return "won";
    return state.gaveUp ? "lost" : "in_progress";
  },

  score({ puzzle, state, outcome }) {
    if (outcome === "lost") return { score: 0, label: "Gave up" };
    const links = state.links.length;
    return { score: chainScore(links, puzzle.par), label: `${plural(links, "link")} · par ${puzzle.par}` };
  },

  shareGrid({ state, outcome }) {
    const reel = "🎞".repeat(state.links.length);
    return outcome === "won" ? `${reel}⭐` : `${reel}🏳️`;
  },

  reveal: ({ solution }) => solution,
});
