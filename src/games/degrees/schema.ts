import { z } from "zod";
import { filmRefSchema, personRefSchema } from "@/games/_movies/schemas";

/**
 * Degrees of Separation: stored puzzle and solution shapes.
 *
 * Shared by the game (`./logic.ts`), the content pipeline that writes the daily puzzles
 * (`scripts/content/movies/degrees.mts`) and the DEV FIXTURE generator
 * (`scripts/content/fixtures/degrees.mts`), so every writer agrees on exactly what is in the
 * `puzzles` table. Pure zod; safe on both sides of the wire.
 *
 * A *link* is one step of a chain: from the previous actor, through a film they both appear in, to
 * a co-star. A chain of `par` links runs from `start` to `end`.
 */

/** Shortest possible chains are 2–3 links (the generator only publishes those). */
export const DEGREES_MIN_PAR = 2;
export const DEGREES_MAX_PAR = 3;

export const degreesLinkSchema = z.object({
  /** A film the previous actor and `person` were both credited in. */
  film: filmRefSchema,
  /** The co-star the chain moves to. */
  person: personRefSchema,
});
export type DegreesLink = z.infer<typeof degreesLinkSchema>;

/** What every player receives. Par is public: it's the target, like par on a golf hole. */
export const degreesPuzzleSchema = z
  .object({
    start: personRefSchema,
    end: personRefSchema,
    /** Length of the shortest chain from `start` to `end`, in links. */
    par: z.number().int().min(DEGREES_MIN_PAR).max(DEGREES_MAX_PAR),
    /** Set only on DEV FIXTURE puzzles, so the board can label them. */
    fixture: z.literal(true).optional(),
  })
  .refine((p) => p.start.id !== p.end.id, { message: "start and end must be different people" });
export type DegreesPuzzle = z.infer<typeof degreesPuzzleSchema>;

/** Server-only until the play ends, then shown as the reveal. */
export const degreesSolutionSchema = z.object({
  /**
   * One optimal chain: `path[0]` starts from the puzzle's `start`, the last link's `person` is the
   * puzzle's `end`, and `path.length === par`.
   */
  path: z.array(degreesLinkSchema).min(DEGREES_MIN_PAR).max(DEGREES_MAX_PAR),
});
export type DegreesSolution = z.infer<typeof degreesSolutionSchema>;

/** The solution's path is a valid optimal chain for the puzzle (checked when puzzles are written). */
export function isConsistentSolution(puzzle: DegreesPuzzle, solution: DegreesSolution): boolean {
  const { path } = solution;
  if (path.length !== puzzle.par) return false;
  if (path[path.length - 1]!.person.id !== puzzle.end.id) return false;
  const people = [puzzle.start.id, ...path.map((link) => link.person.id)];
  return new Set(people).size === people.length;
}
