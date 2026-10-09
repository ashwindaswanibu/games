import { z } from "zod";
import { defineGame } from "@/core/game";
import { clampScore } from "@/core/scoring";
import { filmIdSchema, filmRefSchema, personIdSchema, personRefSchema, type PersonRef } from "@/games/_movies/schemas";
import {
  degreesHintSchema,
  degreesPuzzleSchema,
  degreesSolutionSchema,
  type DegreesHint,
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
 * - Two hints, paid for out of the score: the way in (the film a shortest route reaches the end
 *   actor through; once) and the next link (from where you stand, the first link of a shortest
 *   route from there; once per place you stand). The server finds them; undo never refunds one.
 * - Score: 100 at par, 15 less per extra link, never below 40 for a finished chain; then the hints
 *   come off, never below 10.
 */

/** Links allowed beyond par. */
export const EXTRA_LINKS = 4;
export const PAR_SCORE = 100;
export const EXTRA_LINK_PENALTY = 15;
export const MIN_WIN_SCORE = 40;
/** What each hint costs, off the score. */
export const HINT_COST = { film: 10, link: 20 } as const;
/** A finished chain scores at least this, however many hints it took. */
export const MIN_HINTED_SCORE = 10;

export type { DegreesHint, DegreesHintKind, DegreesLink, DegreesPuzzle, DegreesSolution } from "./schema";

export interface DegreesState {
  /** The chain so far, in order. `links[0]` starts from the puzzle's start actor. */
  links: DegreesLink[];
  gaveUp: boolean;
  /** Hints taken, in order. Absent on plays started before hints existed. */
  hints?: DegreesHint[];
}

/** What the browser sends: ids only. The server looks up who and what they are. */
export const degreesMoveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("link"), filmId: filmIdSchema, personId: personIdSchema }),
  z.strictObject({ type: z.literal("hint"), kind: z.enum(["film", "link"]) }),
  z.strictObject({ type: z.literal("undo") }),
  z.strictObject({ type: z.literal("give-up") }),
]);
export type DegreesMove = z.infer<typeof degreesMoveSchema>;

/**
 * What `applyMove` receives. A link carries the catalog's film and co-star plus the actor the
 * server checked the credits for, so a link can't attach to a chain that changed underneath it. A
 * hint carries what the server found.
 */
export const degreesResolvedMoveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("link"), fromPersonId: personIdSchema, film: filmRefSchema, person: personRefSchema }),
  z.strictObject({ type: z.literal("hint"), hint: degreesHintSchema }),
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

export function hintsOf(state: DegreesState): readonly DegreesHint[] {
  return state.hints ?? [];
}

/** Points the hints taken have cost. */
export function hintCost(hints: readonly DegreesHint[]): number {
  return hints.reduce((sum, hint) => sum + HINT_COST[hint.kind], 0);
}

/** A finished chain's score: its links' score less its hints, never below 10. */
export function degreesScore(links: number, par: number, hints: readonly DegreesHint[]): number {
  const cost = hintCost(hints);
  return cost === 0 ? chainScore(links, par) : clampScore(Math.max(MIN_HINTED_SCORE, chainScore(links, par) - cost));
}

/** What the chain would score if it reached the end actor with `links` links and no more hints. */
export function worthAt(puzzle: DegreesPuzzle, state: DegreesState, links: number): number {
  return degreesScore(Math.max(links, puzzle.par), puzzle.par, hintsOf(state));
}

/** The way in, once taken. */
export function filmHint(state: DegreesState): Extract<DegreesHint, { kind: "film" }> | null {
  return (hintsOf(state).find((hint) => hint.kind === "film") as Extract<DegreesHint, { kind: "film" }> | undefined) ?? null;
}

/**
 * The next-link hint for where the player stands, if they took one here and it can still be
 * played (its co-star isn't in the chain since). Standing here again after an undo, it's still theirs.
 */
export function linkHint(puzzle: DegreesPuzzle, state: DegreesState): Extract<DegreesHint, { kind: "link" }> | null {
  const from = currentActor(puzzle, state);
  const used = chainPersonIds(puzzle, state);
  for (const hint of [...hintsOf(state)].reverse()) {
    if (hint.kind === "link" && hint.fromPersonId === from.id && !used.includes(hint.person.id)) return hint;
  }
  return null;
}

/** Why a hint can't be taken now, or null if it can. The server asks before it searches. */
export function hintRefusal(puzzle: DegreesPuzzle, state: DegreesState, kind: DegreesHint["kind"]): string | null {
  if (state.gaveUp || hasReachedEnd(puzzle, state)) return "Today's game is already over.";
  if (kind === "film") return filmHint(state) ? `You already have the way in to ${puzzle.end.name}.` : null;
  if (linkHint(puzzle, state)) return "Your hint for this link is already showing.";
  if (state.links.length >= maxLinks(puzzle)) return "You've used all your links. Undo one first.";
  return null;
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
    `Undo the last link at any time, for free. At par you score 100; each extra link costs ${EXTRA_LINK_PENALTY}.`,
    `Stuck? The way in to the second actor costs ${HINT_COST.film}; the next link from where you are costs ${HINT_COST.link}.`,
  ],
  accent: "#e9a31e",
  emoji: "🔗",
  bucket: "movies",
  availability: "testing",

  puzzleSchema: degreesPuzzleSchema,
  solutionSchema: degreesSolutionSchema,
  moveSchema: degreesMoveSchema,
  resolvedMoveSchema: degreesResolvedMoveSchema,

  initialState: () => ({ links: [], gaveUp: false, hints: [] }),

  applyMove({ puzzle, state, move }) {
    if (state.gaveUp || hasReachedEnd(puzzle, state)) return { ok: false, error: "Today's game is already over." };

    switch (move.type) {
      case "undo":
        if (state.links.length === 0) return { ok: false, error: "There's no link to undo yet." };
        return { ok: true, state: { ...state, links: state.links.slice(0, -1) } };

      case "give-up":
        return { ok: true, state: { ...state, gaveUp: true } };

      case "hint": {
        const refusal = hintRefusal(puzzle, state, move.hint.kind);
        if (refusal) return { ok: false, error: refusal };
        if (move.hint.kind === "link" && move.hint.fromPersonId !== currentActor(puzzle, state).id) {
          return { ok: false, error: "Your chain changed in another tab. Ask for the hint again." };
        }
        return { ok: true, state: { ...state, hints: [...hintsOf(state), move.hint] } };
      }

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
    const hints = hintsOf(state);
    const label = [plural(links, "link"), `par ${puzzle.par}`, hints.length > 0 ? plural(hints.length, "hint") : null].filter(Boolean).join(" · ");
    return { score: degreesScore(links, puzzle.par, hints), label };
  },

  /** A film strip per link, a bulb per hint, then a star for reaching the end or a flag for giving up. */
  shareGrid({ state, outcome }) {
    const reel = "🎞".repeat(state.links.length) + "💡".repeat(hintsOf(state).length);
    return outcome === "won" ? `${reel}⭐` : `${reel}🏳️`;
  },

  /** Friends see the chain itself once they've finished too: who, through which films, and the hints. */
  friendDetail: (state) => ({
    people: state.links.map((link) => link.person.name),
    films: state.links.map((link) => link.film.title),
    hints: hintsOf(state).length,
  }),

  reveal: ({ solution }) => solution,
});
