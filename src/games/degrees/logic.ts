import { z } from "zod";
import { defineGame } from "@/core/game";
import { clampScore } from "@/core/scoring";
import { filmIdSchema, filmRefSchema, personIdSchema, personRefSchema, type PersonRef } from "@/games/_movies/schemas";
import {
  DEGREES_SPARE_MOVES,
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
 * few moves as possible.
 *
 * A link names a film the current actor (the start, or the last co-star reached) was in and a
 * co-star from it. The server module (`./server.ts`) checks both credits against the catalog and
 * hands `applyMove` the resolved films and people; every rule below is pure.
 *
 * - Moves: a link, an undo and a hint each use one. A player has par + `SPARE_MOVES` of them. An
 *   undo takes the last link off the chain, but the move it used is spent. The last move has to
 *   reach the end actor: anything else is refused (and so is an undo or a hint that would leave no
 *   move to finish with). Giving up ends the game with 0.
 * - Two hints: the way in (the film a shortest route reaches the end actor through; once) and the
 *   next link (from where you stand, the first link of a shortest route from there; once per place
 *   you stand). The server finds them.
 * - Score, by rank: finishing in par moves is rank 1, 100 points. Every route length that exists
 *   is a rank; each rank down is 20 points fewer. Equal moves share a rank, and no rank is skipped,
 *   so if no chain of some length exists (the puzzle's `missingLengths`), the next length up takes
 *   its place.
 */

/** Moves beyond par: links, undos and hints alike. */
export const SPARE_MOVES = DEGREES_SPARE_MOVES;
/** Points for rank 1 (par), and what each rank down costs. */
export const TOP_SCORE = 100;
export const RANK_STEP = 20;

export type { DegreesHint, DegreesHintKind, DegreesLink, DegreesPuzzle, DegreesSolution } from "./schema";

export interface DegreesState {
  /** The chain so far, in order. `links[0]` starts from the puzzle's start actor. */
  links: DegreesLink[];
  gaveUp: boolean;
  /** Hints taken, in order. Absent on plays started before hints existed. */
  hints?: DegreesHint[];
  /** Links undone. Each one used a move. Absent on plays started before undo cost a move. */
  undos?: number;
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

/** The moves a player has for this puzzle. */
export function maxMoves(puzzle: Pick<DegreesPuzzle, "par">): number {
  return puzzle.par + SPARE_MOVES;
}

export function hintsOf(state: DegreesState): readonly DegreesHint[] {
  return state.hints ?? [];
}

/** Moves used so far: every link on the chain, every undo (the link it took off was a move too) and every hint. */
export function movesUsed(state: DegreesState): number {
  return state.links.length + (state.undos ?? 0) + hintsOf(state).length;
}

export function movesLeft(puzzle: DegreesPuzzle, state: DegreesState): number {
  return Math.max(0, maxMoves(puzzle) - movesUsed(state));
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

/**
 * The rank of finishing in `moves` moves: 1 at par (or fewer: a catalog that gained credits), then
 * one more for every route length that exists below it. Lengths no chain has don't count, so ranks
 * are never skipped.
 */
export function rankOf(puzzle: Pick<DegreesPuzzle, "par" | "missingLengths">, moves: number): number {
  const missing = new Set(puzzle.missingLengths ?? []);
  let rank = 1;
  for (let length = puzzle.par; length < moves; length++) if (!missing.has(length)) rank++;
  return rank;
}

/** Points for finishing in `moves` moves: 100 at rank 1, 20 fewer per rank down. */
export function pointsFor(puzzle: Pick<DegreesPuzzle, "par" | "missingLengths">, moves: number): number {
  return clampScore(TOP_SCORE - RANK_STEP * (rankOf(puzzle, moves) - 1));
}

/**
 * The most the play can still score: finishing in the fewest moves it could still take. From where
 * the player stands, the end is at least par minus the links made away (par is the shortest chain
 * from the start), and at least one more link.
 */
export function bestStillPossible(puzzle: DegreesPuzzle, state: DegreesState): number {
  return pointsFor(puzzle, movesUsed(state) + Math.max(1, puzzle.par - state.links.length));
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

const OVER = "Today's game is already over.";
const lastMove = (puzzle: DegreesPuzzle) => `Your last move has to reach ${puzzle.end.name}.`;

/** Why a hint can't be taken now, or null if it can. The server asks before it searches. */
export function hintRefusal(puzzle: DegreesPuzzle, state: DegreesState, kind: DegreesHint["kind"]): string | null {
  if (state.gaveUp || hasReachedEnd(puzzle, state)) return OVER;
  if (kind === "film" && filmHint(state)) return `You already have the way in to ${puzzle.end.name}.`;
  if (kind === "link" && linkHint(puzzle, state)) return "Your hint for this link is already showing.";
  if (movesLeft(puzzle, state) < 2) return lastMove(puzzle);
  return null;
}

/** Why an undo can't be made now, or null if it can. */
export function undoRefusal(puzzle: DegreesPuzzle, state: DegreesState): string | null {
  if (state.gaveUp || hasReachedEnd(puzzle, state)) return OVER;
  if (state.links.length === 0) return "There's no link to undo yet.";
  if (movesLeft(puzzle, state) < 2) return lastMove(puzzle);
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
    `You have par + ${SPARE_MOVES} moves. A link, an undo and a hint each use one.`,
    `Reach them in par moves for ${TOP_SCORE}. Each route length longer costs ${RANK_STEP}.`,
    "Stuck? The way in shows a film that leads to the second actor; the next link shows a step from where you are.",
  ],
  accent: "#e9a31e",
  emoji: "🔗",
  bucket: "movies",
  availability: "testing",

  puzzleSchema: degreesPuzzleSchema,
  solutionSchema: degreesSolutionSchema,
  moveSchema: degreesMoveSchema,
  resolvedMoveSchema: degreesResolvedMoveSchema,

  initialState: () => ({ links: [], gaveUp: false, hints: [], undos: 0 }),

  applyMove({ puzzle, state, move }) {
    if (state.gaveUp || hasReachedEnd(puzzle, state)) return { ok: false, error: OVER };

    switch (move.type) {
      case "undo": {
        const refusal = undoRefusal(puzzle, state);
        if (refusal) return { ok: false, error: refusal };
        return { ok: true, state: { ...state, links: state.links.slice(0, -1), undos: (state.undos ?? 0) + 1 } };
      }

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
        const left = movesLeft(puzzle, state);
        if (left < 1) return { ok: false, error: "You've used all your moves." };
        if (left === 1 && move.person.id !== puzzle.end.id) {
          return { ok: false, error: `That's your last move, so it has to reach ${puzzle.end.name}.` };
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
    const moves = movesUsed(state);
    return { score: pointsFor(puzzle, moves), label: `${plural(moves, "move")} · par ${puzzle.par}` };
  },

  /** A film strip per link, scissors per undo, a bulb per hint, then a star for reaching the end or a flag for giving up. */
  shareGrid({ state, outcome }) {
    const moves = "🎞".repeat(state.links.length) + "✂️".repeat(state.undos ?? 0) + "💡".repeat(hintsOf(state).length);
    return outcome === "won" ? `${moves}⭐` : `${moves}🏳️`;
  },

  /** Friends see the chain itself once they've finished too: who, through which films, and the undos and hints. */
  friendDetail: (state) => ({
    people: state.links.map((link) => link.person.name),
    films: state.links.map((link) => link.film.title),
    undos: state.undos ?? 0,
    hints: hintsOf(state).length,
  }),

  reveal: ({ solution }) => solution,
});
